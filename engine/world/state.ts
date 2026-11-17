// Nexus Isles — world state as a pure derivation of the journal.
//
// The journal records OUTCOMES (explicit deltas), never rules. This reducer
// applies recorded deltas and nothing else, so (a) state is exactly
// replay(journal), (b) a future rule change cannot reinterpret old history,
// and (c) every invariant violation is a loud error, not a silent clamp.

import { createHash } from "node:crypto";
import { canonicalStringify, type JournalEntry } from "../../ledger/journal.js";
import { validateGenome, type Genome } from "../../lineage/genome.js";
import type { SuccessionInstrument } from "../../lineage/succession.js";
import { validateMap, type MapSpec } from "./map.js";
import { CONTENTION_FORMULA_ID, KNOWN_FORMULAS } from "./contention.js";

export const DEFAULT_MAX_EFFORT = 3;
/** Map worlds: default observation radius in hops. A Phase 1 proposal. */
export const DEFAULT_INTEL = 1;
/** Map worlds: the highest intel any resident may have. */
export const MAX_INTEL = 3;

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
    residents: config.residents.map((r) => ({
      ...r,
      initiative: r.initiative ?? 0,
      ...(config.map ? { intel: r.intel ?? DEFAULT_INTEL } : {}),
    })),
  };
}

export interface NodeConfig {
  id: string;
  capacity: number;
  amount: number;
  regen: number;
  /** Map worlds: the region this node stands in. */
  region?: string;
}
export interface ResidentConfig {
  id: string;
  satiety: number;
  maxSatiety: number;
  actionsPerTick: number;
  /** AA8 initiative (integer >= 0). Defaults to 0; genomes feed it later. */
  initiative?: number;
  /** Map worlds: the region the resident starts in. Required when a map is set. */
  position?: string;
  /** Map worlds: observation radius in hops (default 1). */
  intel?: number;
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
  /** Optional map. Without one the world has no positions and a uniform view. */
  map?: MapSpec;
  nodes: NodeConfig[];
  residents: ResidentConfig[];
  rules: Rules;
}

export interface NodeState {
  capacity: number;
  amount: number;
  regen: number;
  region: string | null;
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
  /** The one succession instrument this resident has in force, if any (AA4). */
  instrument: SuccessionInstrument | null;
  /** Map worlds: current region; null in a map-less world. */
  position: string | null;
  /** Map worlds: observation radius in hops. */
  intel: number;
}
export interface WorldState {
  seed: number;
  tick: number;
  rules: JournaledRules;
  map: MapSpec | null;
  nodes: Record<string, NodeState>;
  residents: Record<string, ResidentState>;
  /** Engine-assigned id counter for residents born after genesis. */
  nextResidentSeq: number;
  nextInstrumentSeq: number;
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
  const regionIds = new Set<string>();
  if (config.map) {
    validateMap(config.map);
    for (const r of config.map.regions) regionIds.add(r.id);
    for (const n of config.nodes) {
      if (!n.region || !regionIds.has(n.region)) throw new Error(`node ${n.id}: map worlds need a known region`);
    }
    for (const r of config.residents) {
      if (!r.position || !regionIds.has(r.position)) throw new Error(`resident ${r.id}: map worlds need a known starting position`);
      const intel = r.intel ?? DEFAULT_INTEL;
      if (!Number.isSafeInteger(intel) || intel < 0 || intel > MAX_INTEL) {
        throw new Error(`resident ${r.id}: intel must be an integer 0..${MAX_INTEL}`);
      }
    }
  } else {
    for (const n of config.nodes) if (n.region !== undefined) throw new Error(`node ${n.id}: region given but the world has no map`);
    for (const r of config.residents) {
      if (r.position !== undefined || r.intel !== undefined) throw new Error(`resident ${r.id}: position/intel given but the world has no map`);
    }
  }
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
      nodes[n.id] = { capacity: n.capacity, amount: n.amount, regen: n.regen, region: n.region ?? null };
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
        instrument: null,
        position: r.position ?? null,
        intel: full.map ? (r.intel ?? DEFAULT_INTEL) : 0,
      };
    }
    return {
      seed: int(p, "seed"),
      tick: 0,
      rules: { ...full.rules } as JournaledRules,
      map: full.map ? structuredClone(full.map) : null,
      nodes,
      residents,
      nextResidentSeq: 1,
      nextInstrumentSeq: 1,
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
        instrument: null,
        position: state.map ? str(p, "position") : null,
        intel: state.map ? nonNeg(p, "intel") : 0,
      };
      next.nextResidentSeq = state.nextResidentSeq + 1;
      return next;
    }
    case "SUCCESSION_AUTHORIZED": {
      // AA4 stage 1: only a LIVING resident authorizes, naming a living,
      // distinct successor. A new instrument replaces the previous one.
      const inst = p.instrument as SuccessionInstrument;
      const founder = next.residents[inst?.founderId];
      const successor = next.residents[inst?.successorId];
      if (
        !founder || !founder.alive || !successor || !successor.alive ||
        inst.founderId === inst.successorId || inst.revoked ||
        inst.id !== `inst-${state.nextInstrumentSeq}` || inst.authorizedTick !== entry.tick
      ) {
        throw new Error("SUCCESSION_AUTHORIZED invariant violated");
      }
      founder.instrument = structuredClone(inst);
      next.nextInstrumentSeq = state.nextInstrumentSeq + 1;
      return next;
    }
    case "SUCCESSION_REVOKED": {
      const r = next.residents[str(p, "resident")];
      if (!r || !r.alive || !r.instrument || r.instrument.id !== str(p, "instrumentId")) {
        throw new Error("SUCCESSION_REVOKED invariant violated (the dead cannot revoke)");
      }
      r.instrument = null;
      return next;
    }
    case "SUCCESSION_EXECUTED":
    case "SUCCESSION_FAILED": {
      // AA4 stage 2. The engine executes authority granted while the founder
      // lived; it never invents a successor. This record is only valid for a
      // resident who died THIS tick holding THIS instrument, which is then
      // spent — so it can never execute twice.
      const deceased = next.residents[str(p, "deceased")];
      const inst = deceased?.instrument;
      if (!deceased || deceased.alive || deceased.diedAtTick !== entry.tick || !inst || inst.id !== str(p, "instrumentId")) {
        throw new Error(`${entry.type} invariant violated (no in-force instrument for a resident who died this tick)`);
      }
      if (entry.type === "SUCCESSION_EXECUTED") {
        const successor = next.residents[str(p, "successor")];
        const amount = nonNeg(p, "inventoryTransferred");
        if (
          !successor || !successor.alive || inst.successorId !== p.successor ||
          (inst.expiresTick !== null && inst.expiresTick <= entry.tick) || amount > deceased.inventory
        ) {
          throw new Error("SUCCESSION_EXECUTED invariant violated");
        }
        deceased.inventory -= amount;
        successor.inventory += amount;
      }
      deceased.instrument = null;
      return next;
    }
    case "OWNER_SUBMISSION_REJECTED": {
      // A refused console submission, recorded as an occurrence. No world
      // effect. It lands at the first tick boundary after it was refused.
      if (p.status !== "rejected" || typeof p.code !== "string" || nonNeg(p, "submittedAtTick") !== entry.tick - 1 || entry.tick !== state.tick) {
        throw new Error("OWNER_SUBMISSION_REJECTED invariant violated");
      }
      return state;
    }
    case "EXTERNAL_EVENT": {
      // AA9: an owner-console intervention, recorded verbatim. No console
      // class has an executable effect yet, so this is audit-only. It must
      // sit inside the tick it names, which the world guarantees.
      if (p.affectsTick !== entry.tick || entry.tick !== state.tick) {
        throw new Error("EXTERNAL_EVENT invariant violated (journaled outside the tick it affects)");
      }
      return state;
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
    case "MOVED": {
      // One edge per tick, along an edge that exists, from where the
      // resident actually is. Capacity was decided by CROSSING_RESOLVED.
      const r = next.residents[str(p, "resident")];
      const from = str(p, "from");
      const to = str(p, "to");
      const map = state.map;
      const adjacent = map ? map.edges.some((e) => (e.a === from && e.b === to) || (e.b === from && e.a === to)) : false;
      if (!r || !r.alive || r.position !== from || !adjacent) throw new Error("MOVED invariant violated");
      r.position = to;
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
    case "CROSSING_RESOLVED":
    case "MOVE_DENIED":
    case "BACKEND_BIND_REJECTED":
    case "REPRODUCTION_FAILED":
    case "ACTION_ACCEPTED":
    case "ACTION_REJECTED":
      return state;
    default:
      throw new Error(`Unknown journal entry type: ${entry.type}`);
  }
}
