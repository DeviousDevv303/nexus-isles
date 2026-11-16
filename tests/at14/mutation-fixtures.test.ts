// Step 7 fixtures — mutation rounding across genome sizes, from data.
// The budget formula's rounding (GPT's M_min = max(1, ceil(0.03N)) and the
// M_max = floor(0.25N) cap) is pinned against fixture expectations at
// three field counts, including the small-N edge where 3% of N is a
// fraction of one field.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { standardGenesisGenome } from "../../lineage/genome.js";
import { mutationBudget } from "../../lineage/mutation.js";

interface FixtureFile {
  mutationCases: {
    name: string;
    doctrineKeys: string[];
    expectEligible: number;
    expectMin: number;
    expectMax: number;
  }[];
}

const fixtures = JSON.parse(
  readFileSync(new URL("../../fixtures/edge-cases.json", import.meta.url), "utf8"),
) as FixtureFile;

describe("mutation budget fixtures (step 7)", () => {
  for (const testCase of fixtures.mutationCases) {
    it(testCase.name, () => {
      const genome = standardGenesisGenome();
      for (const key of testCase.doctrineKeys) {
        genome.doctrinePreferences[key] = "standard";
      }
      const budget = mutationBudget(genome);
      expect(budget.eligibleFields).toBe(testCase.expectEligible);
      expect(budget.minChanged).toBe(testCase.expectMin);
      expect(budget.maxChanged).toBe(testCase.expectMax);
    });
  }
});
