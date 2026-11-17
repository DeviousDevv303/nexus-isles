// Nexus Isles — the single action validator (AA11).
//
// Every seat — Tier 0 Nexus included — is validated by this one pure
// function. There is no second path. Validation reads only world state and
// the action itself: never the seat's tier, provider, or submission timing.

import type { Action } from "../../seats/seatProvider.js";
import {
  validateAuthorization,
  type SuccessionContext,
  type SuccessionInstrument,
  type Transfer,
} from "../../lineage/succession.js";
import type { WorldState } from "./state.js";

/** The one transferable asset in the placeholder economy. */
export const inventoryRef = (residentId: string): string => `inventory:${residentId}`;

/** Succession context built from world state — the single source for both stages. */
export function successionContext(state: WorldState): SuccessionContext {
  const alive = Object.keys(state.residents).filter((id) => state.residents[id].alive);
  return {
    currentTick: state.tick,
    aliveResidents: new Set(alive),
    // Ownership is as of now: a dead resident's holdings are no longer theirs to give later.
    ownership: new Map(Object.keys(state.residents).map((id) => [inventoryRef(id), id])),
    standingOrders: new Map(),
    bequeathableKnowledge: new Set(),
    commandHolders: new Set(),
  };
}

/** Build the instrument an authorize_succession action asks for, or null if malformed. */
export function draftInstrument(
  state: WorldState,
  founderId: string,
  args: Readonly<Record<string, unknown>>,
): SuccessionInstrument | null {
  if (typeof args.successor !== "string") return null;
  const expires = args.expiresTick ?? null;
  if (expires !== null && !(typeof expires === "number" && Number.isSafeInteger(expires))) return null;
  let transfers: Transfer[] = [{ kind: "asset", ref: inventoryRef(founderId) }];
  if (args.transfers !== undefined) {
    if (!Array.isArray(args.transfers)) return null;
    transfers = [];
    for (const t of args.transfers as { kind?: unknown; ref?: unknown }[]) {
      if (typeof t?.kind !== "string" || typeof t?.ref !== "string") return null;
      transfers.push({ kind: t.kind as Transfer["kind"], ref: t.ref });
    }
  }
  return {
    id: `inst-${state.nextInstrumentSeq}`,
    founderId,
    successorId: args.successor,
    transfers,
    authorizedTick: state.tick,
    expiresTick: expires as number | null,
    revoked: false,
  };
}

export const VERBS = ["gather", "eat", "wait", "move", "fork", "blend", "authorize_succession", "revoke_succession"] as const;

export type ValidationResult = { ok: true } | { ok: false; reason: string };

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}

/**
 * @param indexWithinSeat zero-based position of this action among the
 *   seat's actions this tick (the per-tick action budget is counted here).
 */
export function validateAction(
  state: WorldState,
  seatId: string,
  action: Action,
  indexWithinSeat: number,
  /** Effort already committed (cost = effort - 1 per gather or move) by this seat this tick. */
  committedCost = 0,
  /** Moves already accepted for this seat this tick. */
  movesBefore = 0,
): ValidationResult {
  const resident = state.residents[seatId];
  if (!resident) return { ok: false, reason: "unknown_seat" };
  if (!resident.alive) return { ok: false, reason: "resident_dead" };
  // AT-20: no action without an attributable backend — there is no path
  // by which an action reaches the journal unstamped.
  if (!resident.backend) return { ok: false, reason: "no_backend_bound" };
  if (indexWithinSeat >= resident.actionsPerTick) {
    return { ok: false, reason: "budget_exceeded" };
  }
  switch (action.verb) {
    case "wait":
      return { ok: true };
    case "gather": {
      const node = action.args.node;
      if (typeof node !== "string" || !(node in state.nodes)) {
        return { ok: false, reason: "unknown_node" };
      }
      // Map worlds: you gather where you stand.
      if (state.map && state.nodes[node].region !== resident.position) {
        return { ok: false, reason: "not_in_region" };
      }
      const amount = action.args.amount;
      if (!isPositiveInt(amount) || amount > state.rules.maxGatherPerAction) {
        return { ok: false, reason: "invalid_amount" };
      }
      const effort = action.args.effort ?? 1;
      if (!isPositiveInt(effort) || effort > state.rules.maxEffort) {
        return { ok: false, reason: "invalid_effort" };
      }
      // Effort costs satiety (effort - 1 beyond baseline); a claim may not
      // be committed if it would exhaust the resident outright.
      if (committedCost + (effort - 1) >= resident.satiety) {
        return { ok: false, reason: "insufficient_stamina" };
      }
      return { ok: true };
    }
    case "eat": {
      if (!isPositiveInt(action.args.amount)) {
        return { ok: false, reason: "invalid_amount" };
      }
      if (resident.inventory < 1) return { ok: false, reason: "nothing_to_eat" };
      return { ok: true };
    }
    case "move": {
      if (!state.map) return { ok: false, reason: "no_map" };
      const to = action.args.to;
      if (typeof to !== "string" || !state.map.regions.some((r) => r.id === to)) {
        return { ok: false, reason: "unknown_region" };
      }
      const from = resident.position;
      if (!state.map.edges.some((e) => (e.a === from && e.b === to) || (e.b === from && e.a === to))) {
        return { ok: false, reason: "not_adjacent" };
      }
      if (movesBefore > 0) return { ok: false, reason: "one_move_per_tick" };
      const effort = action.args.effort ?? 1;
      if (!isPositiveInt(effort) || effort > state.rules.maxEffort) {
        return { ok: false, reason: "invalid_effort" };
      }
      if (committedCost + (effort - 1) >= resident.satiety) {
        return { ok: false, reason: "insufficient_stamina" };
      }
      return { ok: true };
    }
    case "authorize_succession": {
      const inst = draftInstrument(state, seatId, action.args);
      if (!inst) return { ok: false, reason: "malformed_instrument" };
      // Only what this economy can actually transfer may be named.
      if (inst.transfers.length === 0) return { ok: false, reason: "malformed_instrument" };
      if (inst.transfers.some((t) => t.kind !== "asset")) {
        return { ok: false, reason: "unsupported_transfer" };
      }
      // AA4 stage 1, by the lineage module's own rules.
      if (validateAuthorization(inst, successionContext(state)).length > 0) {
        return { ok: false, reason: "invalid_instrument" };
      }
      return { ok: true };
    }
    case "revoke_succession":
      return resident.instrument ? { ok: true } : { ok: false, reason: "no_instrument" };
    case "fork":
    case "blend": {
      // AA12: reproduction is a costly resident action — never free.
      if (!resident.genome) return { ok: false, reason: "no_genome" };
      if (action.verb === "blend") {
        const partnerId = action.args.partner;
        const partner = typeof partnerId === "string" ? state.residents[partnerId] : undefined;
        if (!partner || !partner.alive || partnerId === seatId || !partner.genome) {
          return { ok: false, reason: "invalid_partner" };
        }
        if (state.map && partner.position !== resident.position) {
          return { ok: false, reason: "partner_not_present" };
        }
      }
      if (resident.inventory < state.rules.reproductionCost) {
        return { ok: false, reason: "insufficient_resources" };
      }
      return { ok: true };
    }
    default:
      return { ok: false, reason: "unknown_verb" };
  }
}
