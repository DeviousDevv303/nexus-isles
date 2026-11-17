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
import { edgeKey, findEdge, regionsWithin } from "./map.js";
import { priorityOrder } from "./contention.js";
import { appendWal, readWal, rewriteWal, walPathFor, type WalRecord } from "./wal.js";
import { rngFor } from "./rng.js";
import {
  hashState,
  isBackendRef,
  lineageIdFor,
  normalizeConfig,
  reduce,
  validateConfig,
  type BackendRef,
  type WorldConfig,
  type WorldState,
} from "./state.js";
import { executeSuccession } from "../../lineage/succession.js";
import { ConsoleRejection, validateConsoleSubmission, type ConsoleSubmission } from "../../console/console.js";
import { draftInstrument, inventoryRef, successionContext, validateAction } from "./validator.js";

interface Received {
  seatId: string;
  seq: number;
  action: Action;
  credentialId: string | null;
}
interface Queued {
  action: Action;
  credentialId: string | null;
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
  private pending = new Map<string, Queued[]>();
  private pendingBinds = new Map<string, BackendRef>();
  private pendingConsole: Record<string, unknown>[] = [];
  /** Next write-ahead id for a console submission (arrival order). */
  private walSeq = 1;
  private pendingRejections: Record<string, unknown>[] = [];
  private pendingRecovery: Record<string, unknown> | null = null;
  private pendingDriverRejections: Record<string, unknown>[] = [];

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
    if (opts.persistPath && existsSync(walPathFor(opts.persistPath)) && statSync(walPathFor(opts.persistPath)).size > 0) {
      throw new Error(`Refusing to create a world over an existing write-ahead log ${walPathFor(opts.persistPath)}`);
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
    let lastCommit = -1;
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].type === "TICK_COMMIT") lastCommit = i;
    }
    if (lastCommit < 0 || entries.length - 1 !== lastCommit) {
      // A crash during step 12 can leave a tick part-written: complete
      // entries, no commit. They are complete entries, so they are never
      // dropped automatically (ledger ruling 6938908225); the operator
      // decides. Say exactly what is uncommitted.
      throw new Error(
        `Journal ends mid-tick (no closing TICK_COMMIT): entries ${lastCommit + 1}..${entries.length - 1} ` +
          `(tick ${entries[entries.length - 1].tick}) are uncommitted. Nothing was dropped.`,
      );
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
    // Repair: a torn final fragment is truncated away and an unterminated
    // final entry gets its newline, so the next append starts clean. Both
    // are reported and journaled at the next tick boundary.
    const journal = Journal.loadFromFile(path, { repair: true });
    let snapshot: Snapshot | undefined;
    if (opts.snapshotPath && existsSync(opts.snapshotPath)) {
      try {
        snapshot = JSON.parse(readFileSync(opts.snapshotPath, "utf8")) as Snapshot;
      } catch {
        snapshot = undefined; // an unreadable cache is just a cache miss
      }
    }
    const world = World.restore(journal, { persistPath: path, snapshot });
    world.recoverWal();
    const report = journal.loadReport;
    if (report.tornTail || report.unterminatedFinalEntry) {
      world.pendingRecovery = {
        tornTail: report.tornTail,
        unterminatedFinalEntry: report.unterminatedFinalEntry,
      };
    }
    return world;
  }

  /** What the last restore repaired at the end of the journal file, if anything. */
  get lastRecovery(): Record<string, unknown> | null {
    return this.pendingRecovery ? { ...this.pendingRecovery } : null;
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
  submit(seatId: string, action: Action, attribution?: { credentialId: string }): void {
    // Normalise through JSON so what is validated and journaled is exactly
    // what survives a save/load round-trip (no undefined/NaN/function edge).
    const normalised = JSON.parse(
      JSON.stringify({ verb: action.verb, args: action.args ?? {} }),
    ) as Action;
    const list = this.pending.get(seatId) ?? [];
    list.push({ action: normalised, credentialId: attribution?.credentialId ?? null });
    this.pending.set(seatId, list);
  }

  /**
   * Bind (or swap) the backend acting through a seat. Takes effect at the
   * next tick boundary as a journaled SEAT_BACKEND_BOUND event, before any
   * action of that tick is validated — so every action is stamped with the
   * backend that was bound when it resolved. The last bind queued for a
   * seat before a tick wins. The resident's identity, memory, genome and
   * history are untouched by a swap.
   */
  bindBackend(seatId: string, backend: BackendRef): void {
    if (!isBackendRef(backend)) {
      throw new Error("backend needs non-empty providerId and version");
    }
    this.pendingBinds.set(seatId, { providerId: backend.providerId, version: backend.version });
  }

  /** Queue a driver refusal; only its safe reason and backend provenance enter the journal. */
  recordDriverRefusal(seatId: string, backend: BackendRef, reason: string): void {
    this.pendingDriverRejections.push({
      seat: seatId,
      backend: { providerId: backend.providerId, version: backend.version },
      reason,
    });
  }

  /**
   * AA9: queue an owner-console intervention against a running world. All
   * console laws are checked now (draft, rollback, C3 double-confirm, and
   * that the target tick has not resolved). The event is journaled VERBATIM
   * at the start of the tick it affects — after TICK_START, before anything
   * in that tick resolves — so the journal always records it before its
   * tick and always ends at a TICK_COMMIT. Console classes have no
   * executable effect in the engine yet: the entry is the record only.
   * Queued events, like queued actions, are lost on restart.
   */
  submitConsoleEvent(submission: ConsoleSubmission): void {
    const walId = `w${this.walSeq++}`;
    try {
      const payload = { ...validateConsoleSubmission(submission, this.st.tick), walId };
      this.writeAhead({ walId, kind: "console", payload });
      this.pendingConsole.push(payload);
    } catch (err) {
      if (!(err instanceof ConsoleRejection) && (err as { walFailure?: boolean }).walFailure) throw err;
      // Owner ruling 2026-11-17 (#235, 6937254884, item 3): a refused
      // submission is still an occurrence. It is journaled as
      // OWNER_SUBMISSION_REJECTED at the next tick boundary — reason,
      // provenance and the submission as given — with no world effect and
      // nothing rewritten. The operator still gets the refusal now.
      const code = err instanceof ConsoleRejection ? err.code : "malformed_submission";
      let given: unknown;
      try {
        given = JSON.parse(JSON.stringify(submission ?? null));
      } catch {
        given = null;
      }
      const rejection = {
        status: "rejected",
        code,
        reason: err instanceof Error ? err.message : String(err),
        submittedAtTick: this.st.tick,
        submission: given,
        walId,
      };
      this.writeAhead({ walId, kind: "console-rejection", payload: rejection });
      this.pendingRejections.push(rejection);
      throw err;
    }
  }

  /** Journal what the last restore repaired, at the first boundary after it. */
  private stepRecovery(): void {
    if (!this.pendingRecovery) return;
    this.emit("JOURNAL_TAIL_RECOVERED", "engine", { ...this.pendingRecovery });
    this.pendingRecovery = null;
  }

  private stepConsoleEvents(): void {
    const refused = this.pendingRejections;
    this.pendingRejections = [];
    for (const payload of refused) this.emit("OWNER_SUBMISSION_REJECTED", "owner-console", payload);
    const due = this.pendingConsole.filter((p) => p.affectsTick === this.st.tick);
    this.pendingConsole = this.pendingConsole.filter((p) => p.affectsTick !== this.st.tick);
    for (const payload of due) this.emit("EXTERNAL_EVENT", "owner-console", payload);
  }

  private stepBindBackends(): void {
    for (const seatId of [...this.pendingBinds.keys()].sort()) {
      const backend = this.pendingBinds.get(seatId) as BackendRef;
      const r = this.st.residents[seatId];
      if (!r || !r.alive) {
        this.emit("BACKEND_BIND_REJECTED", "engine", {
          seat: seatId, backend, reason: r ? "resident_dead" : "unknown_seat",
        });
      } else if (r.backend?.providerId !== backend.providerId || r.backend?.version !== backend.version) {
        this.emit("SEAT_BACKEND_BOUND", "engine", { seat: seatId, backend, previous: r.backend });
      }
    }
    this.pendingBinds = new Map();
  }

  tick(): void {
    const t = this.st.tick + 1;
    this.emit("TICK_START", "engine", { tick: t }, t); //                      1
    this.stepRecovery(); // what the restore repaired, on the record
    this.stepConsoleEvents(); // AA9: interventions journaled before the tick resolves
    for (const payload of this.pendingDriverRejections) {
      this.emit("DRIVER_ACTION_REJECTED", "seat-driver", payload);
    }
    this.pendingDriverRejections = [];
    this.stepBindBackends(); // tick boundary: backend swaps land here
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
    const map = this.st.map;
    for (const id of this.sortedIds(this.st.residents)) {
      const r = this.st.residents[id];
      if (!r.alive) continue;
      const self = { satiety: r.satiety, maxSatiety: r.maxSatiety, inventory: r.inventory };
      let visible: Record<string, unknown>;
      if (!map) {
        // Map-less worlds (fixtures, unit tests): every seat gets the same
        // view of every node. AT-06 is demonstrated only on map worlds.
        const nodes: Record<string, number> = {};
        for (const n of this.sortedIds(this.st.nodes)) nodes[n] = this.st.nodes[n].amount;
        visible = { ...self, nodes };
      } else {
        // AT-06: a resident perceives only regions within `intel` hops of
        // where they stand — who is there and what the nodes hold. Nothing
        // outside that radius, not even that it exists, beyond the map
        // itself (geography is public).
        const regions: Record<string, { residents: string[]; nodes: Record<string, number> }> = {};
        for (const reg of regionsWithin(map, r.position as string, r.intel)) {
          const nodes: Record<string, number> = {};
          for (const n of this.sortedIds(this.st.nodes)) {
            if (this.st.nodes[n].region === reg) nodes[n] = this.st.nodes[n].amount;
          }
          const present = this.sortedIds(this.st.residents).filter(
            (o) => o !== id && this.st.residents[o].alive && this.st.residents[o].position === reg,
          );
          regions[reg] = { residents: present, nodes };
        }
        visible = { ...self, position: r.position, intel: r.intel, regions };
      }
      this.emit("OBSERVATION_DELIVERED", "engine", { seat: id, visible });
    }
  }

  private stepReceive(): Received[] {
    const out: Received[] = [];
    for (const seatId of [...this.pending.keys()].sort()) {
      (this.pending.get(seatId) ?? []).forEach((q, seq) =>
        out.push({ seatId, seq, action: q.action, credentialId: q.credentialId }),
      );
    }
    this.pending = new Map();
    return out; // already canonical: (seatId, seq)
  }

  private stepValidate(received: Received[]): Received[] {
    const accepted: Received[] = [];
    const committed = new Map<string, number>();
    const moves = new Map<string, number>();
    for (const r of received) {
      const res = validateAction(
        this.st, r.seatId, r.action, r.seq, committed.get(r.seatId) ?? 0, moves.get(r.seatId) ?? 0,
      );
      // AT-20: every action record carries the backend that produced it.
      const backend = this.st.residents[r.seatId]?.backend ?? null;
      const body = { seat: r.seatId, seq: r.seq, verb: r.action.verb, args: r.action.args, backend, credential: r.credentialId };
      if (res.ok) {
        if (r.action.verb === "gather" || r.action.verb === "move") {
          committed.set(r.seatId, (committed.get(r.seatId) ?? 0) + effortOf(r.action) - 1);
        }
        if (r.action.verb === "move") moves.set(r.seatId, (moves.get(r.seatId) ?? 0) + 1);
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
      if (r.action.verb !== "gather" && r.action.verb !== "move") continue;
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
    this.applySuccessionActs(accepted);
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
    this.applyMoves(accepted);
  }

  /**
   * Travel. Open roads take everyone. A capped edge (a bridge, the river)
   * lets at most `crossingCapacity` residents through per tick, both
   * directions combined; when more try, contention-v1's priority order
   * decides — committed effort, then initiative, then a journaled seeded
   * draw — never arrival or seat identity.
   */
  private applyMoves(accepted: Received[]): void {
    const map = this.st.map;
    if (!map) return;
    const byEdge = new Map<string, Received[]>();
    for (const r of accepted) {
      if (r.action.verb !== "move") continue;
      const k = edgeKey(this.st.residents[r.seatId].position as string, r.action.args.to as string);
      byEdge.set(k, [...(byEdge.get(k) ?? []), r]);
    }
    for (const k of [...byEdge.keys()].sort()) {
      const claims = byEdge.get(k) as Received[];
      const [a, b] = k.split("|");
      const cap = findEdge(map, a, b)?.crossingCapacity;
      let granted = claims;
      if (cap !== undefined) {
        const rng = rngFor(this.st.seed, this.st.tick, `crossing:${k}`);
        const ranked = priorityOrder(
          claims.map((r) => ({
            seatId: r.seatId,
            seq: r.seq,
            requested: 1,
            effort: effortOf(r.action),
            initiative: this.st.residents[r.seatId].initiative,
            draw: rng.uint32(),
          })),
        );
        const through = new Set(ranked.slice(0, cap).map((c) => c.seatId));
        this.emit("CROSSING_RESOLVED", "engine", {
          formulaId: this.st.rules.contentionFormula,
          edge: k,
          capacity: cap,
          claims: ranked.map((c, rank) => ({
            seat: c.seatId, seq: c.seq, effort: c.effort, initiative: c.initiative, draw: c.draw, rank,
            crossed: through.has(c.seatId),
          })),
        });
        granted = claims.filter((r) => through.has(r.seatId));
        for (const r of claims) {
          if (!through.has(r.seatId)) {
            this.emit("MOVE_DENIED", r.seatId, { resident: r.seatId, seq: r.seq, edge: k, reason: "crossing_full" });
          }
        }
      }
      for (const r of granted) {
        const from = this.st.residents[r.seatId].position as string;
        this.emit("MOVED", r.seatId, { resident: r.seatId, seq: r.seq, from, to: r.action.args.to as string });
      }
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
        ...(this.st.map
          ? { position: ps[0].position, intel: Math.floor(ps.reduce((a, p) => a + p.intel, 0) / ps.length) }
          : {}),
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

  /** AA4 stage 1 and maintenance: authorize / replace / revoke, by the living only. */
  private applySuccessionActs(accepted: Received[]): void {
    for (const r of accepted) {
      if (r.action.verb === "authorize_succession") {
        const instrument = draftInstrument(this.st, r.seatId, r.action.args);
        if (instrument) this.emit("SUCCESSION_AUTHORIZED", r.seatId, { instrument, seq: r.seq });
      } else if (r.action.verb === "revoke_succession") {
        const inst = this.st.residents[r.seatId].instrument;
        if (inst) this.emit("SUCCESSION_REVOKED", r.seatId, { resident: r.seatId, instrumentId: inst.id, seq: r.seq });
      }
    }
  }

  private stepLifecycle(): void {
    const died: string[] = [];
    for (const id of this.sortedIds(this.st.residents)) {
      const r = this.st.residents[id];
      if (r.alive && r.satiety <= 0) {
        this.emit("DEATH", "engine", { resident: id, cause: "starvation" });
        died.push(id);
      }
    }
    // AA4 stage 2: after ALL of this tick's deaths, execute each deceased's
    // in-force instrument against death-tick state. No instrument -> no
    // succession: the engine never infers an heir. Each transfer is
    // re-validated and fails closed; what fails stays as salvage.
    for (const id of died) {
      const r = this.st.residents[id];
      const inst = r.instrument;
      if (!inst) continue;
      const outcome = executeSuccession(inst, successionContext(this.st));
      const ok = outcome.executed.some((x) => x.transfer.ref === inventoryRef(id));
      if (outcome.executed.length > 0) {
        this.emit("SUCCESSION_EXECUTED", "engine", {
          deceased: id,
          successor: inst.successorId,
          instrumentId: inst.id,
          inventoryTransferred: ok ? r.inventory : 0,
          executed: outcome.executed.map((x) => x.transfer),
          failed: outcome.failed,
        });
      } else {
        this.emit("SUCCESSION_FAILED", "engine", {
          deceased: id,
          instrumentId: inst.id,
          reason: outcome.failed[0]?.reason ?? "instrument names no transfers",
          salvage: outcome.salvage,
        });
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
      this.compactWal();
    }
  }

  /** Write a queued console submission ahead, durably, before it is queued. */
  private writeAhead(record: WalRecord): void {
    if (!this.persistPath) return;
    try {
      appendWal(walPathFor(this.persistPath), record);
    } catch (cause) {
      const err = new Error(`could not write the console submission ahead: ${String(cause)}`) as Error & { walFailure: boolean };
      err.walFailure = true;
      throw err;
    }
  }

  /** After a tick lands, the WAL holds exactly what is still waiting. */
  private compactWal(): void {
    if (!this.persistPath) return;
    const waiting: WalRecord[] = [
      ...this.pendingRejections.map((payload) => ({ walId: payload.walId as string, kind: "console-rejection" as const, payload })),
      ...this.pendingConsole.map((payload) => ({ walId: payload.walId as string, kind: "console" as const, payload })),
    ].sort((x, y) => Number((x.walId as string).slice(1)) - Number((y.walId as string).slice(1)));
    rewriteWal(walPathFor(this.persistPath), waiting);
  }

  /**
   * Restart: re-queue every WAL record that has not landed in the journal.
   * A record that has landed (its walId is in the journal) is never landed
   * twice. A record that can no longer land where it says fails loudly.
   */
  private recoverWal(): number {
    if (!this.persistPath) return 0;
    const { records } = readWal(walPathFor(this.persistPath), { repair: true });
    const landed = new Set<string>();
    let maxSeq = 0;
    for (const e of this.journal.entries()) {
      const id = e.payload.walId;
      if ((e.type === "EXTERNAL_EVENT" || e.type === "OWNER_SUBMISSION_REJECTED") && typeof id === "string") {
        landed.add(id);
        maxSeq = Math.max(maxSeq, Number(id.slice(1)) || 0);
      }
    }
    let requeued = 0;
    for (const r of records) {
      maxSeq = Math.max(maxSeq, Number(r.walId.slice(1)) || 0);
      if (landed.has(r.walId)) continue;
      if (r.kind === "console") {
        if (typeof r.payload.affectsTick !== "number" || r.payload.affectsTick <= this.st.tick) {
          throw new Error(`WAL record ${r.walId} targets tick ${String(r.payload.affectsTick)}, already resolved, and never landed`);
        }
        this.pendingConsole.push(r.payload);
      } else {
        if (r.payload.submittedAtTick !== this.st.tick) {
          throw new Error(`WAL refusal ${r.walId} was submitted at tick ${String(r.payload.submittedAtTick)} but never landed`);
        }
        this.pendingRejections.push(r.payload);
      }
      requeued++;
    }
    this.walSeq = maxSeq + 1;
    this.compactWal();
    return requeued;
  }
}
