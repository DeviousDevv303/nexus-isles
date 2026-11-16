// Nexus Isles — the single action validator (AA11).
//
// Every seat — Tier 0 Nexus included — is validated by this one pure
// function. There is no second path. Validation reads only world state and
// the action itself: never the seat's tier, provider, or submission timing.

import type { Action } from "../../seats/seatProvider.js";
import type { WorldState } from "./state.js";

export const VERBS = ["gather", "eat", "wait", "fork", "blend"] as const;

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
  /** Effort already committed (cost = effort - 1 per gather) by this seat this tick. */
  committedCost = 0,
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
