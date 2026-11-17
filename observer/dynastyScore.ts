// Nexus Isles — dynasty-score-v1 (constitution v0.6.7, Annex B), executable.
//
// Per epoch e, per lineage L, all inputs from the journal only:
//  1. Normalize each raw axis against active lineages: norm = value / max.
//     Missing evidence -> the axis is MISSING and its weight is renormalized
//     across the available axes (never silently zero-scored; journaled).
//  2. Diminish: axis_score = sqrt(norm).
//  3. Combine: score = Σ w_i' × axis_score_i, w_i' = w_i / Σ available w.
//
// The weights are the owner-adopted dynasty-score-v1 set (Annex B; AA1).
// Everything else this file has to choose is a named reading, journaled at
// epoch open and labelled PROVISIONAL — owner-ratification item:
//   control-v0           who controls a region (engine/world/state.ts)
//   succession-v0        successor continuity counts heirs of accepted
//                        in-lineage successions, 10 ticks after succession
//   active-in-epoch-v0   a lineage is "active" if it had a living member at
//                        the end of any tick in the epoch
//   zero-max-v0          if every active lineage scores 0 on an axis that has
//                        evidence, every norm is 0 (not MISSING)
//   no-improvements-v0   the engine has no improvements yet, so the territory
//                        multiplier is (1 + 0.1 × 0) = 1
// MISSING today: verified artifacts (no artifacts exist) and wealth-
// resilience (no income sources, upkeep, or structures exist). Territory is
// MISSING in a map-less world.
//
// A score is a DERIVATION, labelled as such; verifyEpochScores re-derives it
// from the journal and refuses a journaled score that doesn't match.

import type { JournalEntry } from "../ledger/journal.js";
import { continuitySuccessors, deriveEntities, lineagePopulation } from "../lineage/entities.js";

export const DYNASTY_SCORE_ID = "dynasty-score-v1";

/** Owner-adopted (Annex B). Changeable only by owner ruling under AA10. */
export const DYNASTY_SCORE_V1_WEIGHTS = {
  survival: 0.25,
  territoryYears: 0.2,
  verifiedArtifacts: 0.2,
  successorContinuity: 0.2,
  wealthResilience: 0.15,
} as const;

export type Axis = keyof typeof DYNASTY_SCORE_V1_WEIGHTS;
export const AXES: readonly Axis[] = ["survival", "territoryYears", "verifiedArtifacts", "successorContinuity", "wealthResilience"];

export const READINGS = {
  control: "control-v0",
  successorContinuity: "succession-v0",
  activeLineage: "active-in-epoch-v0",
  zeroMax: "zero-max-v0",
  improvements: "no-improvements-v0",
} as const;

export interface AxisResult {
  raw: number;
  norm: number;
  score: number;
}

export interface EpochScore {
  status: "derived-from-journal";
  epoch: string;
  startTick: number;
  endTick: number;
  formulaId: string;
  weights: Record<Axis, number>;
  readings: typeof READINGS;
  /** Axes with no evidence this epoch, and why. Their weight is renormalized away. */
  missingAxes: Partial<Record<Axis, string>>;
  /** Σ of available axis weights (the renormalization divisor). */
  availableWeight: number;
  lineages: Record<string, { score: number; axes: Partial<Record<Axis, AxisResult>> }>;
}

/** What EPOCH_OPENED journals: the formula, weights, and readings in force. */
export function epochSpec(): Record<string, unknown> {
  return { formulaId: DYNASTY_SCORE_ID, weights: { ...DYNASTY_SCORE_V1_WEIGHTS }, readings: { ...READINGS } };
}

/** Control picture at the end of each tick, from CONTROL_CHANGED entries. */
function controlAt(entries: readonly JournalEntry[], tick: number): Map<string, string> {
  const c = new Map<string, string>();
  for (const e of entries) {
    if (e.tick > tick) break;
    if (e.type !== "CONTROL_CHANGED") continue;
    const region = e.payload.region as string;
    const to = e.payload.to as string | null;
    if (to === null) c.delete(region);
    else c.set(region, to);
  }
  return c;
}

export function scoreEpoch(entries: readonly JournalEntry[], epoch: string, endTick: number): EpochScore {
  const open = entries.find((e) => e.type === "EPOCH_OPENED" && e.payload.epoch === epoch);
  if (!open) throw new Error(`epoch ${epoch} was never opened`);
  const startTick = open.payload.startTick as number;
  if (endTick < startTick) throw new Error(`epoch ${epoch} has no committed ticks to score`);
  const ticks = endTick - startTick + 1;
  const ent = deriveEntities(entries);
  const genesis = entries[0]?.payload.config as { map?: unknown } | undefined;
  const hasMap = Boolean(genesis?.map);

  const tickRange = Array.from({ length: ticks }, (_, i) => startTick + i);
  const active = Object.keys(ent.lineages)
    .filter((l) => tickRange.some((t) => lineagePopulation(ent, l, t).length > 0))
    .sort();

  const missingAxes: Partial<Record<Axis, string>> = {
    verifiedArtifacts: "no artifacts exist in the engine",
    wealthResilience: "no income sources, upkeep, or structures exist in the engine",
  };
  if (!hasMap) missingAxes.territoryYears = "the world has no map";

  const raw: Partial<Record<Axis, Record<string, number>>> = {};
  raw.survival = Object.fromEntries(
    active.map((l) => [l, tickRange.reduce((a, t) => a + lineagePopulation(ent, l, t).length, 0) / ticks]),
  );
  if (hasMap) {
    const perTick = tickRange.map((t) => controlAt(entries, t));
    raw.territoryYears = Object.fromEntries(
      active.map((l) => [l, perTick.reduce((a, c) => a + [...c.values()].filter((x) => x === l).length * (1 + 0.1 * 0), 0)]),
    );
  }
  raw.successorContinuity = Object.fromEntries(active.map((l) => [l, continuitySuccessors(ent, l, endTick).length]));

  const available = AXES.filter((a) => !(a in missingAxes));
  const availableWeight = available.reduce((s, a) => s + DYNASTY_SCORE_V1_WEIGHTS[a], 0);
  const lineages: EpochScore["lineages"] = {};
  for (const l of active) lineages[l] = { score: 0, axes: {} };
  for (const axis of available) {
    const vals = raw[axis] as Record<string, number>;
    const max = Math.max(0, ...active.map((l) => vals[l]));
    for (const l of active) {
      const norm = max > 0 ? vals[l] / max : 0;
      const score = Math.sqrt(norm);
      lineages[l].axes[axis] = { raw: vals[l], norm, score };
      lineages[l].score += (DYNASTY_SCORE_V1_WEIGHTS[axis] / availableWeight) * score;
    }
  }

  return {
    status: "derived-from-journal",
    epoch,
    startTick,
    endTick,
    formulaId: open.payload.formulaId as string,
    weights: { ...DYNASTY_SCORE_V1_WEIGHTS },
    readings: { ...READINGS },
    missingAxes,
    availableWeight,
    lineages,
  };
}
