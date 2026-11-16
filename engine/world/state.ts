// Nexus Isles — world state as a pure derivation of the journal.
//
// The journal records OUTCOMES (explicit deltas), never rules. This reducer
// applies recorded deltas and nothing else, so (a) state is exactly
// replay(journal), (b) a future rule change cannot reinterpret old history,
// and (c) every invariant violation is a loud error, not a silent clamp.

import { createHash } from "node:crypto";
import { canonicalStringify, type JournalEntry } from "../../ledger/journal.js";
import { validateGenome, type Genome } from "../../lineage/genome.js";
import { CONTENTION_FORMULA_ID, KNOWN_FORMULAS } from "./contention.js";

export const DEFAULT_MAX_EFFORT = 3;

/** Fill AA8 defaults so the formula ID and bounds are always journaled. */
export function normalizeConfig(config: WorldConfig): WorldConfig {
  return {
    ...config,
    rules: {
      ...config.rules,
      maxEffort: config.rules.maxEffort ?? DEFAULT_MAX_EFFORT,
      contentionFormula: config.rules.contentionFormula ?? CONTENTION_FORMULA_ID,
      reproductionCost: config.rules.reproductionCost ?? DEFAULT_REPRODUCTION_COST,
    },
    residents: config.residents.map((r) => ({ ...r, initiative: r.initiative ?? 0 })),
  };
}

export interface NodeConfig {
  id: string;
  capacity: number;
  amount: number;
  regen: number;
}
export interface ResidentConfig {
  id: string;
  satiety: number;
  maxSatiety: number;
  actionsPerTick: number;
  /** AA8 initiative (integer >= 0). Defaults to 0; genomes feed it later. */
  initiative?: number;
  /** The backend acting through this seat at genesis (AT-20). */
  backend?: BackendRef;
  /** Trait layer only. Lineage identity is a journal fact, never genome content. */
  genome?: Genome;
}
/** Which brain acts through a seat: provider identity + exact version. */
export interface BackendRef {
  providerId: string;
  version: string;
}
export function isBackendRef(v: unknown): v is BackendRef {
  const b = v as BackendRef | null;
  return (
    typeof b === "object" && b !== null &&
    typeof b.providerId === "string" && b.providerId.length > 0 &&
    typeof b.version === "string" && b.version.length > 0
  );
}
export interface Rules {
  satietyDecay: number;
  maxGatherPerAction: number;
  /** Per node per tick, in percent (0-100). Integer so no float drift. */
  blightPercent: number;
  blightMax: number;
  /** AA8: highest committed effort a single claim may carry. Default 3. */
  maxEffort?: number;
  /** AA8: contention formula ID; stamped at genesis. Default CONTENTION_FORMULA_ID. */
  contentionFormula?: string;
  /** AA12: inventory each parent pays to reproduce. Default 4. */
  reproductionCost?: number;
}
/** Rules as journaled in WORLD_GENESIS: every AA8 field explicit. */
export type JournaledRules = Required<Rules>;
export interface WorldConfig {
  nodes: NodeConfig[];
  residents: ResidentConfig[];
  rules: Rules;
}

export interface NodeState {
  capacity: number;
  amount: number;
  regen: number;
}
export interface ResidentState {
  alive: boolean;
  satiety: number;
  maxSatiety: number;
  inventory: number;
  actionsPerTick: number;
  initiative: number;
  diedAtTick: number | null;
  bornTick: number;
  /** Set once from the journaled birth/genesis record; never re-inferred. */
  lineage: string;
  parents: string[];
  genome: Genome | null;
  /** Null until a backend is bound; an unbound seat cannot act. */
  backend: BackendRef | null;
}
export interface WorldState {
  seed: number;
  tick: number;
  rules: JournaledRules;
  nodes: Record<string, NodeState>;
  residents: Record<string, ResidentState>;
  /** Engine-assigned id counter for residents born after genesis. */
  nextResidentSeq: number;
}

export const DEFAULT_REPRODUCTION_COST = 4;
export const lineageIdFor = (founderId: string): string => `lineage:${founderId}`;

export function hashState(state: WorldState): string {
  return createHash("sha256")
    .update(canonicalStringify(state), "utf8")
    .digest("hex");
}

type Payload = Readonly<Record<string, unknown>>;

function str(p: Payload, k: string): string {
  const v = p[k];
  if (typeof v !== "string") throw new Error(`payload.${k} must be a string`);
  return v;
}
function int(p: Payload, k: string): number {
  const v = p[k];
  if (typeof v !== "number" || !Number.isSafeInteger(v)) {
    throw new Error(`payload.${k} must be a safe integer`);
  }
  return v;
}
function nonNeg(p: Payload, k: string): number {
  const v = int(p, k);
  if (v < 0) throw new Error(`payload.${k} must be >= 0`);
  return v;
}

export function validateConfig(config: WorldConfig): void {
  const ids = new Set<string>();
  for (const n of config.nodes) {
    if (ids.has(n.id)) throw new Error(`duplicate node id ${n.id}`);
    ids.add(n.id);
    for (const v of [n.capacity, n.amount, n.regen]) {
      if (!Number.isSafeInteger(v) || v < 0) {
        throw new Error(`node ${n.id}: capacity/amount/regen must be integers >= 0`);
      }
    }
    if (n.amount > n.capacity) throw new Error(`node ${n.id}: amount > capacity`);
  }
  const rids = new Set<string>();
  for (const r of config.residents) {
    if (rids.has(r.id)) throw new Error(`duplicate resident id ${r.id}`);
    rids.add(r.id);
    for (const v of [r.satiety, r.maxSatiety, r.actionsPerTick, r.initiative ?? 0]) {
      if (!Number.isSafeInteger(v) || v < 0) {
        throw new Error(`resident ${r.id}: numeric fields must be integers >= 0`);
      }
    }
    if (r.satiety > r.maxSatiety) throw new Error(`resident ${r.id}: satiety > maxSatiety`);
    if (/^res-\d+$/.test(r.id)) throw new Error(`resident id ${r.id} is reserved for engine-born residents`);
    if (r.backend !== undefined && !isBackendRef(r.backend)) {
      throw new Error(`resident ${r.id}: backend needs non-empty providerId and version`);
    }
    if (r.genome) {
      const issues = validateGenome(r.genome);
      if (issues.length > 0) throw new Error(`resident ${r.id}: invalid genome: ${issues.join("; ")}`);
    }
  }
  const k = config.rules;
  for (const v of [k.satietyDecay, k.maxGatherPerAction, k.blightPercent, k.blightMax]) {
    if (!Number.isSafeInteger(v) || v < 0) throw new Error("rules must be integers >= 0");
  }
  if (k.blightPercent > 100) throw new Error("blightPercent must be <= 100");
  const maxEffort = k.maxEffort ?? DEFAULT_MAX_EFFORT;
  if (!Number.isSafeInteger(maxEffort) || maxEffort < 1) throw new Error("maxEffort must be an integer >= 1");
  const cost = k.reproductionCost ?? DEFAULT_REPRODUCTION_COST;
  if (!Number.isSafeInteger(cost) || cost < 1) throw new Error("reproductionCost must be an integer >= 1");
  const formula = k.contentionFormula ?? CONTENTION_FORMULA_ID;
  if (!KNOWN_FORMULAS.has(formula)) throw new Error(`unknown contention formula ${formula}`);
}

/**
 * Apply one journal entry. Pure: (state, entry) -> new state. Unknown entry
 * types throw — a journal this build cannot fully interpret must not be
 * silently half-replayed.
 */
export function reduce(state: WorldState | null, entry: JournalEntry): WorldState {
  const p = entry.payload;
  if (entry.type === "WORLD_GENESIS") {
    if (state !== null) throw new Error("WORLD_GENESIS after genesis");
    if (entry.index !== 0) throw new Error("WORLD_GENESIS must be index 0");
    const config = p.config as WorldConfig;
    validateConfig(config);
    const full = normalizeConfig(config);
    const nodes: Record<string, NodeState> = {};
    for (const n of full.nodes) {
      nodes[n.id] = { capacity: n.capacity, amount: n.amount, regen: n.regen };
    }
    const residents: Record<string, ResidentState> = {};
    for (const r of full.residents) {
      residents[r.id] = {
        alive: true,
        satiety: r.satiety,
        maxSatiety: r.maxSatiety,
        inventory: 0,
        actionsPerTick: r.actionsPerTick,
        initiative: r.initiative ?? 0,
        diedAtTick: null,
        bornTick: 0,
        lineage: lineageIdFor(r.id), // every genesis resident founds a lineage
        parents: [],
        genome: r.genome ? structuredClone(r.genome) : null,
        backend: r.backend ? { providerId: r.backend.providerId, version: r.backend.version } : null,
      };
    }
    return {
      seed: int(p, "seed"),
      tick: 0,
      rules: { ...full.rules } as JournaledRules,
      nodes,
      residents,
      nextResidentSeq: 1,
    };
  }
  if (state === null) throw new Error(`${entry.type} before WORLD_GENESIS`);

  const next = structuredClone(state);
  switch (entry.type) {
    case "TICK_START": {
      const t = int(p, "tick");
      if (t !== state.tick + 1) throw new Error(`TICK_START ${t} after tick ${state.tick}`);
      next.tick = t;
      return next;
    }
    case "ENV_BLIGHT": {
      const node = next.nodes[str(p, "node")];
      const loss = nonNeg(p, "loss");
      if (!node || loss > node.amount) throw new Error("ENV_BLIGHT invariant violated");
      node.amount -= loss;
      return next;
    }
    case "RESOURCE_REGEN": {
      const node = next.nodes[str(p, "node")];
      const gained = nonNeg(p, "gained");
      if (!node || node.amount + gained > node.capacity) {
        throw new Error("RESOURCE_REGEN invariant violated");
      }
      node.amount += gained;
      return next;
    }
    case "NEED_DECAY": {
      const r = next.residents[str(p, "resident")];
      const delta = nonNeg(p, "delta");
      if (!r || !r.alive || delta > r.satiety) throw new Error("NEED_DECAY invariant violated");
      r.satiety -= delta;
      return next;
    }
    case "EFFORT_SPENT": {
      // AA8: committed effort is accounted — spent win or lose.
      const r = next.residents[str(p, "resident")];
      const cost = nonNeg(p, "cost");
      if (!r || !r.alive || cost > r.satiety) {
        throw new Error("EFFORT_SPENT invariant violated");
      }
      r.satiety -= cost;
      return next;
    }
    case "GATHER_GRANTED": {
      const r = next.residents[str(p, "resident")];
      const node = next.nodes[str(p, "node")];
      const granted = nonNeg(p, "granted");
      if (!r || !r.alive || !node || granted > node.amount) {
        throw new Error("GATHER_GRANTED invariant violated (double-collect?)");
      }
      node.amount -= granted;
      r.inventory += granted;
      return next;
    }
    case "EAT_APPLIED": {
      const r = next.residents[str(p, "resident")];
      const consumed = nonNeg(p, "consumed");
      if (!r || !r.alive || consumed > r.inventory || r.satiety + consumed > r.maxSatiety) {
        throw new Error("EAT_APPLIED invariant violated");
      }
      r.inventory -= consumed;
      r.satiety += consumed;
      return next;
    }
    case "RESIDENT_BORN": {
      // AA12 reproduction. The journaled record is the ONLY source of the
      // child's lineage; nothing downstream re-derives it from parentage.
      const id = str(p, "resident");
      if (id !== `res-${state.nextResidentSeq}` || next.residents[id]) {
        throw new Error("RESIDENT_BORN invariant violated (id)");
      }
      const mode = str(p, "mode");
      const parents = p.parents as string[];
      const cost = nonNeg(p, "costPerParent");
      if (!((mode === "fork" && parents.length === 1) || (mode === "blend" && parents.length === 2))) {
        throw new Error("RESIDENT_BORN invariant violated (mode/parents)");
      }
      for (const pid of parents) {
        const parent = next.residents[pid];
        if (!parent || !parent.alive || parent.inventory < cost) {
          throw new Error("RESIDENT_BORN invariant violated (parent)");
        }
        parent.inventory -= cost;
      }
      const lineage = str(p, "lineage");
      const expected = mode === "fork" ? state.residents[parents[0]].lineage : lineageIdFor(id);
      if (lineage !== expected) throw new Error("RESIDENT_BORN invariant violated (lineage rule)");
      next.residents[id] = {
        alive: true,
        satiety: nonNeg(p, "satiety"),
        maxSatiety: nonNeg(p, "maxSatiety"),
        inventory: 0,
        actionsPerTick: nonNeg(p, "actionsPerTick"),
        initiative: nonNeg(p, "initiative"),
        diedAtTick: null,
        bornTick: entry.tick,
        lineage,
        parents: [...parents],
        genome: structuredClone(p.genome as Genome),
        backend: null, // a new resident: a brain must be bound before it can act
      };
      next.nextResidentSeq = state.nextResidentSeq + 1;
      return next;
    }
    case "SEAT_BACKEND_BOUND": {
      // AA11: a backend change is a journaled engine event. Identity, memory,
      // genome and history are untouched — the brain is replaceable, the
      // life is not. Only the backend reference changes.
      const r = next.residents[str(p, "seat")];
      const to = p.backend;
      if (!r || !r.alive || !isBackendRef(to)) throw new Error("SEAT_BACKEND_BOUND invariant violated");
      if (canonicalStringify(p.previous ?? null) !== canonicalStringify(r.backend)) {
        throw new Error("SEAT_BACKEND_BOUND invariant violated (previous mismatch)");
      }
      r.backend = { providerId: to.providerId, version: to.version };
      return next;
    }
    case "DEATH": {
      const r = next.residents[str(p, "resident")];
      if (!r || !r.alive) throw new Error("DEATH invariant violated");
      r.alive = false;
      r.diedAtTick = entry.tick;
      return next;
    }
    case "TICK_COMMIT": {
      if (int(p, "tick") !== state.tick) throw new Error("TICK_COMMIT tick mismatch");
      if (str(p, "stateHash") !== hashState(state)) {
        throw new Error(`TICK_COMMIT stateHash mismatch at journal index ${entry.index}`);
      }
      return state;
    }
    // Audit-only entries: recorded for the ledger, no state effect.
    case "OBSERVATION_DELIVERED":
    case "CONTENTION_RESOLVED":
    case "BACKEND_BIND_REJECTED":
    case "REPRODUCTION_FAILED":
    case "SUCCESSION_EXECUTED": // schema reserved; see lineage/entities.ts
    case "ACTION_ACCEPTED":
    case "ACTION_REJECTED":
      return state;
    default:
      throw new Error(`Unknown journal entry type: ${entry.type}`);
  }
}
