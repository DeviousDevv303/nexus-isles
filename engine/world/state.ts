// Nexus Isles — world state as a pure derivation of the journal.
//
// The journal records OUTCOMES (explicit deltas), never rules. This reducer
// applies recorded deltas and nothing else, so (a) state is exactly
// replay(journal), (b) a future rule change cannot reinterpret old history,
// and (c) every invariant violation is a loud error, not a silent clamp.

import { createHash } from "node:crypto";
import { canonicalStringify, type JournalEntry } from "../../ledger/journal.js";

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
}
export interface Rules {
  satietyDecay: number;
  maxGatherPerAction: number;
  /** Per node per tick, in percent (0-100). Integer so no float drift. */
  blightPercent: number;
  blightMax: number;
}
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
  diedAtTick: number | null;
}
export interface WorldState {
  seed: number;
  tick: number;
  rules: Rules;
  nodes: Record<string, NodeState>;
  residents: Record<string, ResidentState>;
}

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
    for (const v of [r.satiety, r.maxSatiety, r.actionsPerTick]) {
      if (!Number.isSafeInteger(v) || v < 0) {
        throw new Error(`resident ${r.id}: numeric fields must be integers >= 0`);
      }
    }
    if (r.satiety > r.maxSatiety) throw new Error(`resident ${r.id}: satiety > maxSatiety`);
  }
  const k = config.rules;
  for (const v of [k.satietyDecay, k.maxGatherPerAction, k.blightPercent, k.blightMax]) {
    if (!Number.isSafeInteger(v) || v < 0) throw new Error("rules must be integers >= 0");
  }
  if (k.blightPercent > 100) throw new Error("blightPercent must be <= 100");
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
    const nodes: Record<string, NodeState> = {};
    for (const n of config.nodes) {
      nodes[n.id] = { capacity: n.capacity, amount: n.amount, regen: n.regen };
    }
    const residents: Record<string, ResidentState> = {};
    for (const r of config.residents) {
      residents[r.id] = {
        alive: true,
        satiety: r.satiety,
        maxSatiety: r.maxSatiety,
        inventory: 0,
        actionsPerTick: r.actionsPerTick,
        diedAtTick: null,
      };
    }
    return { seed: int(p, "seed"), tick: 0, rules: { ...config.rules }, nodes, residents };
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
    case "ACTION_ACCEPTED":
    case "ACTION_REJECTED":
      return state;
    default:
      throw new Error(`Unknown journal entry type: ${entry.type}`);
  }
}
