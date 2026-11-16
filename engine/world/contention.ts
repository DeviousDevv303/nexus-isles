// Nexus Isles — AA8 contention resolution, formula `contention-v1`.
//
// AA8: "Committed effort + initiative + seeded tiebreak, journaled with
// formula ID. Speed confers zero advantage inside the action window."
//
// contention-v1 is a strict priority order over the CLAIMS on one node in
// one tick, then sequential allocation down that order:
//
//   1. higher committed effort first        (effort is spent win or lose)
//   2. then higher initiative first         (a resident stat, not a seat tier)
//   3. then lower seeded draw first         (uint32 from rngFor(seed,tick,
//                                            "conflict:<node>"), drawn in
//                                            canonical claim order and
//                                            journaled with the claim)
//   4. (only on an exact draw tie, p = 2^-32) seatId, then seq — determinism
//      only, never a meaningful advantage.
//
// Allocation: each claim in order receives min(requested, remaining).
//
// What the order may depend on: effort, initiative, the journaled draw.
// What it may NEVER depend on (AT-15, Tier-0 parity): request size, seat
// id, tier, provider, backend, or arrival time. This module's inputs do not
// even carry tier/provider, so it cannot read them.
//
// Pure function: replay re-runs it from the journaled claims and must
// reproduce the journaled grants exactly.

export const CONTENTION_FORMULA_ID = "contention-v1";
export const KNOWN_FORMULAS: ReadonlySet<string> = new Set([CONTENTION_FORMULA_ID]);

export interface Claim {
  seatId: string;
  /** Per-seat action sequence this tick (stable, arrival-independent). */
  seq: number;
  requested: number;
  effort: number;
  initiative: number;
  /** Journaled uint32 tiebreak draw. Lower wins. */
  draw: number;
}

export interface ClaimOutcome extends Claim {
  /** 0-based position in the resolved priority order. */
  rank: number;
  granted: number;
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function priorityOrder(claims: readonly Claim[]): Claim[] {
  return [...claims].sort(
    (a, b) =>
      b.effort - a.effort ||
      b.initiative - a.initiative ||
      a.draw - b.draw ||
      cmpStr(a.seatId, b.seatId) ||
      a.seq - b.seq,
  );
}

export function resolveContention(
  available: number,
  claims: readonly Claim[],
): ClaimOutcome[] {
  if (!Number.isSafeInteger(available) || available < 0) {
    throw new Error(`available must be an integer >= 0, got ${available}`);
  }
  let remaining = available;
  return priorityOrder(claims).map((c, rank) => {
    const granted = Math.min(c.requested, remaining);
    remaining -= granted;
    return { ...c, rank, granted };
  });
}
