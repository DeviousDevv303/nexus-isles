// Directive T7 (Issue #235): version-pinned dynasty-score-v1 observer
// contract. Key decision: seal weights, axes, normalization, and tick
// conventions into the journal at epoch open so future code cannot silently
// reinterpret history. Unfinished: territory evidence remains MISSING and
// successor continuity remains held for the owner's E6 audit; this spec does
// not ratify those interpretations or add scoring behavior.

export const DYNASTY_SCORE_VERSION = "dynasty-score-v1" as const;

export const DYNASTY_SCORE_WEIGHTS = Object.freeze({
  survival: 0.25,
  territoryYears: 0.20,
  verifiedArtifacts: 0.20,
  successorContinuity: 0.20,
  wealthResilience: 0.15,
});

export type DynastyScoreAxis = keyof typeof DYNASTY_SCORE_WEIGHTS;

/**
 * The complete scoring contract is sealed into the journal when an epoch
 * opens. Later code must not silently reinterpret the historical score.
 */
export interface DynastyScoreEpochOpenPayload {
  epochId: string;
  version: typeof DYNASTY_SCORE_VERSION;
  startTick: number;
  weights: typeof DYNASTY_SCORE_WEIGHTS;
  normalizationPopulation: "active-lineages-at-epoch-close";
  formula: "weighted subtotal uses frozen weights; missing weight remains in abeyance";
  tickAccounting: "resolved-ticks-after-open; alive-at-tick-start";
  activeLineagesAtOpen: string[];
  axisDefinitions: Record<DynastyScoreAxis, string>;
  unresolvedInterpretations: string[];
}

export interface DynastyScoreEpochClosePayload {
  epochId: string;
  endTick: number;
  /** Journal head immediately before this close record was appended. */
  sourceJournalHead: string;
}

export const DYNASTY_SCORE_AXIS_DEFINITIONS: Record<DynastyScoreAxis, string> = Object.freeze({
  survival: "member-ticks survived / resolved ticks in the epoch",
  territoryYears: "",
  verifiedArtifacts: "journal-verified citations or uses by another party, counted with sqrt",
  successorContinuity: "count of heirs with at least 10 own-agency survival ticks, sqrt-capped",
  wealthResilience: "PROVISIONAL subweights: 0.4 income diversity + 0.3 reserve adequacy + 0.3 productive deployment",
});
