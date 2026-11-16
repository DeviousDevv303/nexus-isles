// Nexus Isles — the world core: deterministic tick pipeline (build order 2).
//
// One tick = the 12-step order from the engineering spec:
//   1 advance clock          7 validate (engine/world/validator.ts)
//   2 environment            8 resolve conflicts (seeded, batched)
//   3 resources/ecology      9 apply consequences
//   4 resident needs        10 resolve death/lifecycle
//   5 deliver observations  11 append journal commit (state hash)
//   6 receive actions       12 persist
// Every state change is an entry appended to the ledger and applied through
// the same reducer replay uses, so state is a derivation of the journal and
// can never drift from it. Time is the integer tick; no wall-clock value
// ever enters the journal, and cross-seat submission order never matters
// (AA8): received actions are canonicalised by (seatId, per-seat sequence)
// and contention is resolved by a seeded shuffle, not by arrival.

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { Journal, type JournalEntry } from "../../ledger/journal.js";
import type { Action, Observation } from "../../seats/seatProvider.js";
import { resolveContention, type Claim, type ClaimOutcome } from "./contention.js";
import { mutateBlend, mutateFork } from "../../lineage/mutation.js";
import { rngFor } from "./rng.js";
import {
  hashState,
  lineageIdFor,
  normalizeConfig,
  reduce,
  validateConfig,
  type WorldConfig,
  type WorldState,
} from "./state.js";
import { validateAction } from "./validator.js";

interface Received {
  seatId: string;
  seq: number;
  action: Action;
}
interface NodeResolution {
  node: string;
  available: number;
  outcomes: ClaimOutcome[];
}

export interface Snapshot {
  headIndex: number;
  headHash: string;
  state: WorldState;
}

export interface WorldOptions {
  /** JSONL journal path. Tail is appended at step 12 of every tick. */
  persistPath?: string;
}

function effortOf(action: Action): number {
  return (action.args.effort as number | undefined) ?? 1;
}

export class World {
  private pending = new Map<string, Action[]>();

  private constructor(
    private readonly journal: Journal,
    private st: WorldState,
    private readonly persistPath: string | undefined,
    private persisted: number,
  ) {}

  /** Start a new world. Refuses to write over an existing journal file. */
  static create(seed: number, config: WorldConfig, opts: WorldOptions = {}): World {
    validateConfig(config);
    if (opts.persistPath && existsSync(opts.persistPath) && statSync(opts.persistPath).size > 0) {
      throw new Error(`Refusing to create a world over existing journal ${opts.persistPath}`);
    }
    const journal = new Journal();
    const genesis = journal.append({
      tick: 0,
      type: "WORLD_GENESIS",
      actor: "engine",
      payload: { seed, config: structuredClone(normalizeConfig(config)) },
    });
    const world = new World(journal, reduce(null, genesis), opts.persistPath, 0);
    world.commit();
    world.persist();
    return world;
  }

  /**
   * Rebuild a world from its journal. If a snapshot is supplied it is used
   * only as a cache: it must match the journal's own entry (hash and state
   * hash at its head); otherwise it is ignored and the full journal replays.
   */
  static restore(journal: Journal, opts: WorldOptions & { snapshot?: Snapshot } = {}): World {
    const verified = journal.verify();
    if (!verified.ok) {
      throw new Error(`Journal failed verification at index ${verified.firstBadIndex}: ${verified.reason}`);
    }
    const entries = journal.entries();
    if (entries.length === 0) throw new Error("Cannot restore from an empty journal");
    if (entries[entries.length - 1].type !== "TICK_COMMIT") {
      throw new Error("Journal ends mid-tick (no closing TICK_COMMIT)");
    }
    let state: WorldState | null = null;
    let from = 0;
    const snap = opts.snapshot;
    if (snap) {
      const head = entries[snap.headIndex];
      if (
        head &&
        head.hash === snap.headHash &&
        head.type === "TICK_COMMIT" &&
        head.payload.stateHash === hashState(snap.state)
      ) {
        state = structuredClone(snap.state);
        from = snap.headIndex + 1;
      }
    }
    for (let i = from; i < entries.length; i++) state = reduce(state, entries[i]);
    return new World(journal, state as WorldState, opts.persistPath, entries.length);
  }

  /** Restart path: load + verify the JSONL journal, then restore from it. */
  static restoreFromFile(
    path: string,
    opts: { snapshotPath?: string } = {},
  ): World {
    const journal = Journal.loadFromFile(path);
    let snapshot: Snapshot | undefined;
    if (opts.snapshotPath && existsSync(opts.snapshotPath)) {
      try {
        snapshot = JSON.parse(readFileSync(opts.snapshotPath, "utf8")) as Snapshot;
      } catch {
        snapshot = undefined; // an unreadable cache is just a cache miss
      }
    }
    return World.restore(journal, { persistPath: path, snapshot });
  }

  // ---- read side ---------------------------------------------------------

  get tickNumber(): number {
    return this.st.tick;
  }
  get state(): WorldState {
    return structuredClone(this.st);
  }
  get headHash(): string {
    return this.journal.headHash();
  }
  entries(): readonly JournalEntry[] {
    return this.journal.entries();
  }

  /**
   * The last observation the engine delivered to this seat (step 5), read
   * from the journal itself — restart-safe, no in-memory cache. Null if the
   * resident is dead or unknown.
   */
  observe(seatId: string): Observation | null {
    if (!this.st.residents[seatId]?.alive) return null;
    const all = this.journal.entries();
    for (let i = all.length - 1; i >= 0; i--) {
      const e = all[i];
      if (e.type === "OBSERVATION_DELIVERED" && e.payload.seat === seatId) {
        return { tick: e.tick, visible: e.payload.visible as Record<string, unknown> };
      }
    }
    return null;
  }

  // ---- write side --------------------------------------------------------

  /**
   * Queue an action for the next tick. The outcome (accepted / rejected and
   * why) lands in the journal at that tick. Queued-but-unticked actions are
   * not history and do not survive a restart.
   */
  submit(seatId: string, action: Action): void {
    // Normalise through JSON so what is validated and journaled is exactly
    // what survives a save/load round-trip (no undefined/NaN/function edge).
    const normalised = JSON.parse(
      JSON.stringify({ verb: action.verb, args: action.args ?? {} }),
    ) as Action;
    const list = this.pending.get(seatId) ?? [];
    list.push(normalised);
    this.pending.set(seatId, list);
  }

  tick(): void {
    const t = this.st.tick + 1;
    this.emit("TICK_START", "engine", { tick: t }, t); //                      1
    this.stepEnvironment(); //                                                 2
    this.stepResources(); //                                                   3
    this.stepNeeds(); //                                                       4
    this.stepObservations(); //                                                5
    const received = this.stepReceive(); //                                    6
    const accepted = this.stepValidate(received); //                           7
    const resolutions = this.stepResolveConflicts(accepted); //                8
    this.stepApply(resolutions, accepted); //                                       9
    this.stepLifecycle(); //                                                  10
    this.commit(); //                                                         11
    this.persist(); //                                                        12
  }

  writeSnapshot(path: string): void {
    const entries = this.journal.entries();
    const snap: Snapshot = {
      headIndex: entries.length - 1,
      headHash: this.journal.headHash(),
      state: this.st,
    };
    writeFileSync(path, JSON.stringify(snap), "utf8");
  }

  // ---- pipeline steps ----------------------------------------------------

  private emit(
    type: string,
    actor: string,
    payload: Record<string, unknown>,
    tick: number = this.st.tick,
  ): void {
    const entry = this.journal.append({ tick, type, actor, payload });
    this.st = reduce(this.st, entry);
  }

  private sortedIds(rec: Record<string, unknown>): string[] {
    return Object.keys(rec).sort();
  }

  private stepEnvironment(): void {
    const { seed, tick, rules } = this.st;
    for (const id of this.sortedIds(this.st.nodes)) {
      const rng = rngFor(seed, tick, `env:${id}`);
      if (rng.int(100) < rules.blightPercent && rules.blightMax > 0) {
        const loss = Math.min(this.st.nodes[id].amount, 1 + rng.int(rules.blightMax));
        if (loss > 0) this.emit("ENV_BLIGHT", "engine", { node: id, loss });
      }
    }
  }

  private stepResources(): void {
    for (const id of this.sortedIds(this.st.nodes)) {
      const n = this.st.nodes[id];
      const gained = Math.min(n.regen, n.capacity - n.amount);
      if (gained > 0) this.emit("RESOURCE_REGEN", "engine", { node: id, gained });
    }
  }

  private stepNeeds(): void {
    for (const id of this.sortedIds(this.st.residents)) {
      const r = this.st.residents[id];
      if (!r.alive) continue;
      const delta = Math.min(this.st.rules.satietyDecay, r.satiety);
      if (delta > 0) this.emit("NEED_DECAY", "engine", { resident: id, delta });
    }
  }

  private stepObservations(): void {
    const nodes: Record<string, number> = {};
    for (const id of this.sortedIds(this.st.nodes)) nodes[id] = this.st.nodes[id].amount;
    for (const id of this.sortedIds(this.st.residents)) {
      const r = this.st.residents[id];
      if (!r.alive) continue;
      // Visibility filtering (geography/fog) lands with the island map; for
      // now every seat is authorised the same view — identical for all seats.
      const visible = {
        satiety: r.satiety,
        maxSatiety: r.maxSatiety,
        inventory: r.inventory,
        nodes: { ...nodes },
      };
      this.emit("OBSERVATION_DELIVERED", "engine", { seat: id, visible });
    }
  }

  private stepReceive(): Received[] {
    const out: Received[] = [];
    for (const seatId of [...this.pending.keys()].sort()) {
      (this.pending.get(seatId) ?? []).forEach((action, seq) => out.push({ seatId, seq, action }));
    }
    this.pending = new Map();
    return out; // already canonical: (seatId, seq)
  }

  private stepValidate(received: Received[]): Received[] {
    const accepted: Received[] = [];
    const committed = new Map<string, number>();
    for (const r of received) {
      const res = validateAction(this.st, r.seatId, r.action, r.seq, committed.get(r.seatId) ?? 0);
      const body = { seat: r.seatId, seq: r.seq, verb: r.action.verb, args: r.action.args };
      if (res.ok) {
        if (r.action.verb === "gather") {
          committed.set(r.seatId, (committed.get(r.seatId) ?? 0) + effortOf(r.action) - 1);
        }
        this.emit("ACTION_ACCEPTED", r.seatId, body);
        accepted.push(r);
      } else {
        this.emit("ACTION_REJECTED", r.seatId, { ...body, reason: res.reason });
      }
    }
    return accepted;
  }

  /**
   * AA8 (contention-v1). Pure with respect to the journal: builds the claims
   * for each node (draws taken in canonical claim order, so arrival order and
   * submission speed never matter) and resolves them. Emits nothing.
   */
  private stepResolveConflicts(accepted: Received[]): NodeResolution[] {
    const byNode = new Map<string, Received[]>();
    for (const r of accepted) {
      if (r.action.verb !== "gather") continue;
      const node = r.action.args.node as string;
      const list = byNode.get(node) ?? [];
      list.push(r); // `accepted` is already in canonical (seatId, seq) order
      byNode.set(node, list);
    }
    const out: NodeResolution[] = [];
    for (const node of [...byNode.keys()].sort()) {
      const rng = rngFor(this.st.seed, this.st.tick, `conflict:${node}`);
      const claims: Claim[] = (byNode.get(node) as Received[]).map((r) => ({
        seatId: r.seatId,
        seq: r.seq,
        requested: r.action.args.amount as number,
        effort: effortOf(r.action),
        initiative: this.st.residents[r.seatId].initiative,
        draw: rng.uint32(),
      }));
      const available = this.st.nodes[node].amount;
      out.push({ node, available, outcomes: resolveContention(available, claims) });
    }
    return out;
  }

  private stepApply(resolutions: NodeResolution[], accepted: Received[]): void {
    // Committed effort is spent win or lose (AA8: effort accounted).
    for (const r of accepted) {
      if (r.action.verb !== "gather") continue;
      const cost = effortOf(r.action) - 1;
      if (cost > 0) {
        this.emit("EFFORT_SPENT", r.seatId, { resident: r.seatId, seq: r.seq, cost });
      }
    }
    for (const res of resolutions) {
      // The contention record: formula ID + every input needed to re-derive
      // the grants (replay reproduces them via resolveContention).
      this.emit("CONTENTION_RESOLVED", "engine", {
        formulaId: this.st.rules.contentionFormula,
        node: res.node,
        available: res.available,
        claims: res.outcomes.map((o) => ({
          seat: o.seatId,
          seq: o.seq,
          requested: o.requested,
          effort: o.effort,
          initiative: o.initiative,
          draw: o.draw,
          rank: o.rank,
          granted: o.granted,
        })),
      });
      for (const o of res.outcomes) {
        this.emit("GATHER_GRANTED", o.seatId, {
          resident: o.seatId,
          node: res.node,
          seq: o.seq,
          requested: o.requested,
          granted: o.granted,
          effort: o.effort,
          rank: o.rank,
          formulaId: this.st.rules.contentionFormula,
        });
      }
    }
    this.applyReproduction(accepted);
    for (const r of accepted) {
      if (r.action.verb !== "eat") continue;
      const res = this.st.residents[r.seatId];
      const consumed = Math.min(
        r.action.args.amount as number,
        res.inventory,
        res.maxSatiety - res.satiety,
      );
      this.emit("EAT_APPLIED", r.seatId, { resident: r.seatId, seq: r.seq, consumed });
    }
  }

  /**
   * AA12 reproduction. Fork: one parent, child joins the parent's lineage.
   * Blend: mutual consent in the same tick (each names the other), both
   * pay, and the child FOUNDS A NEW LINEAGE with dual ancestry recorded.
   * Child ids are engine-assigned, so there is no id contention.
   */
  private applyReproduction(accepted: Received[]): void {
    const cost = this.st.rules.reproductionCost;
    const fail = (r: Received, reason: string): void =>
      this.emit("REPRODUCTION_FAILED", r.seatId, {
        resident: r.seatId, seq: r.seq, verb: r.action.verb, reason,
      });
    const born = (mode: "fork" | "blend", parentIds: string[], r: Received): void => {
      const ps = parentIds.map((id) => this.st.residents[id]);
      if (ps.some((p) => !p.alive || p.inventory < cost)) return fail(r, "insufficient_resources");
      const id = `res-${this.st.nextResidentSeq}`;
      const seed = rngFor(this.st.seed, this.st.tick, `repro:${parentIds.join("+")}:${r.seq}`).uint32();
      const { child, record } =
        mode === "fork"
          ? mutateFork(ps[0].genome!, seed)
          : mutateBlend(ps[0].genome!, ps[1].genome!, seed);
      const maxSatiety = Math.min(...ps.map((p) => p.maxSatiety));
      this.emit("RESIDENT_BORN", "engine", {
        resident: id,
        mode,
        parents: parentIds,
        lineage: mode === "fork" ? ps[0].lineage : lineageIdFor(id),
        // Dual ancestry (blend) / single (fork): the parents' lineages, as record.
        ancestry: ps.map((p) => p.lineage),
        costPerParent: cost,
        satiety: Math.min(cost * ps.length, maxSatiety),
        maxSatiety,
        actionsPerTick: Math.min(...ps.map((p) => p.actionsPerTick)),
        initiative: Math.floor(ps.reduce((a, p) => a + p.initiative, 0) / ps.length),
        genome: child,
        mutation: record,
      });
    };
    for (const r of accepted) {
      if (r.action.verb === "fork") born("fork", [r.seatId], r);
    }
    const blends = accepted.filter((r) => r.action.verb === "blend");
    const used = new Set<Received>();
    for (const r of blends) {
      if (used.has(r)) continue;
      used.add(r);
      const partner = r.action.args.partner as string;
      const match = blends.find(
        (o) => !used.has(o) && o.seatId === partner && o.action.args.partner === r.seatId,
      );
      if (!match) {
        fail(r, "no_mutual_consent");
        continue;
      }
      used.add(match);
      born("blend", [r.seatId, partner].sort(), r);
    }
  }

  private stepLifecycle(): void {
    for (const id of this.sortedIds(this.st.residents)) {
      const r = this.st.residents[id];
      if (r.alive && r.satiety <= 0) {
        this.emit("DEATH", "engine", { resident: id, cause: "starvation" });
      }
    }
  }

  private commit(): void {
    this.emit("TICK_COMMIT", "engine", { tick: this.st.tick, stateHash: hashState(this.st) });
  }

  private persist(): void {
    if (this.persistPath) {
      this.journal.saveToFile(this.persistPath, this.persisted);
      this.persisted = this.journal.length;
    }
  }
}
