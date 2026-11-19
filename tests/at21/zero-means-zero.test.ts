// E8 (zero means zero), the regression pair required by its acceptance
// criteria (forgeclaw #235 6955932914): an axis MEASURED zero for every
// lineage and an axis UNMEASURED for every lineage must produce different
// coverage. Presence is a measurement fact, not an outcome fact. Zero never
// means missing (E8); missing never means zero (E6).

import { describe, expect, it } from "vitest";
import { DYNASTY_SCORE_WEIGHTS, type DynastyScoreAxis } from "../../governance/dynastyScoreSpec.js";
import { scoreAxes, type AxisEvidence } from "../../observer/dynastyScore.js";

const LINEAGES = ["lineage-a", "lineage-b", "lineage-c"];
const AXES = Object.keys(DYNASTY_SCORE_WEIGHTS) as DynastyScoreAxis[];

const measured = (rawValue: number): AxisEvidence => ({
  status: "available",
  evidenceClass: "verified-journal",
  rawValue,
  normalizedValue: rawValue, // recomputed by scoreAxes
  diminishedValue: rawValue,
  basis: "test fixture",
});
const unmeasured: AxisEvidence = {
  status: "missing",
  evidenceClass: "missing",
  rawValue: null,
  normalizedValue: null,
  diminishedValue: null,
  reason: "test fixture: not measured",
};

/** Every lineage gets `survival` from `survival(id)`; every other axis is unmeasured. */
function evidence(survival: (lineage: string) => AxisEvidence) {
  return new Map(
    LINEAGES.map((id) => [
      id,
      Object.fromEntries(AXES.map((axis) => [axis, axis === "survival" ? survival(id) : unmeasured])) as Record<
        DynastyScoreAxis,
        AxisEvidence
      >,
    ]),
  );
}

describe("E8 zero means zero: the regression pair", () => {
  const measuredZero = scoreAxes(LINEAGES, evidence(() => measured(0)));
  const notMeasured = scoreAxes(LINEAGES, evidence(() => unmeasured));

  it("PAIR: measured-zero and unmeasured axes produce DIFFERENT coverage", () => {
    for (let i = 0; i < LINEAGES.length; i++) {
      expect(measuredZero[i].coverage).toBe(DYNASTY_SCORE_WEIGHTS.survival);
      expect(notMeasured[i].coverage).toBe(0);
      expect(measuredZero[i].coverage).not.toBe(notMeasured[i].coverage);
    }
  });

  it("a measured zero is present, normalizes to 0 (no 0/0), and contributes zero", () => {
    for (const score of measuredZero) {
      expect(score.axes.survival).toMatchObject({ status: "available", rawValue: 0, normalizedValue: 0, diminishedValue: 0 });
      expect(score.missingAxes).not.toContain("survival");
      expect(score.weightedSubtotal).toBe(0);
      expect(score.observedWeightedAverage).toBe(0); // a real average of zero
      expect(score.status).toBe("partial");
    }
  });

  it("an unmeasured axis is missing, its weight in abeyance, never a zero", () => {
    for (const score of notMeasured) {
      expect(score.axes.survival).toMatchObject({ status: "missing", rawValue: null, normalizedValue: null });
      expect(score.missingAxes).toContain("survival");
      expect(score.weightedSubtotal).toBe(0);
      expect(score.observedWeightedAverage).toBeNull(); // no average exists, not 0
      expect(score.status).toBe("missing");
    }
  });

  it("E7 with real values: normalization is value / max, and the lowest lineage is not forced to 0", () => {
    const raw: Record<string, number> = { "lineage-a": 4, "lineage-b": 2, "lineage-c": 1 };
    const scores = scoreAxes(LINEAGES, evidence((id) => measured(raw[id])));
    const byId = Object.fromEntries(scores.map((s) => [s.lineageId, s]));
    expect(byId["lineage-a"].axes.survival.normalizedValue).toBe(1);
    expect(byId["lineage-b"].axes.survival.normalizedValue).toBe(0.5);
    expect(byId["lineage-c"].axes.survival.normalizedValue).toBe(0.25); // min-max would give 0
    expect(byId["lineage-c"].axes.survival.diminishedValue).toBe(0.5);
    expect(byId["lineage-c"].weightedSubtotal).toBeCloseTo(DYNASTY_SCORE_WEIGHTS.survival * 0.5, 12);
  });
});
