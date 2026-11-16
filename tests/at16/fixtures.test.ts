// Step 7 fixtures — the succession edge cases, executed from data.
// fixtures/edge-cases.json carries the cases (revoked, expired, partially
// invalid, dead successor); this suite hydrates each serialized context
// and asserts the recorded expected outcome, so the dry run's edge-case
// coverage is data-driven and grows by editing the fixture file.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  executeSuccession,
  type SuccessionContext,
  type SuccessionInstrument,
} from "../../lineage/succession.js";

interface FixtureFile {
  successionCases: {
    name: string;
    instrument: SuccessionInstrument;
    context: {
      currentTick: number;
      aliveResidents: string[];
      ownership: [string, string][];
      standingOrders: [string, { ownerId: string; inForce: boolean }][];
      bequeathableKnowledge: string[];
      commandHolders: string[];
    };
    expect: { executed: number; failedRefs: string[]; salvage: string[] };
  }[];
}

const fixtures = JSON.parse(
  readFileSync(new URL("../../fixtures/edge-cases.json", import.meta.url), "utf8"),
) as FixtureFile;

function hydrate(c: FixtureFile["successionCases"][number]["context"]): SuccessionContext {
  return {
    currentTick: c.currentTick,
    aliveResidents: new Set(c.aliveResidents),
    ownership: new Map(c.ownership),
    standingOrders: new Map(c.standingOrders),
    bequeathableKnowledge: new Set(c.bequeathableKnowledge),
    commandHolders: new Set(c.commandHolders),
  };
}

describe("succession edge-case fixtures (step 7)", () => {
  for (const testCase of fixtures.successionCases) {
    it(testCase.name, () => {
      const outcome = executeSuccession(testCase.instrument, hydrate(testCase.context));
      expect(outcome.executed).toHaveLength(testCase.expect.executed);
      expect(outcome.failed.map((f) => f.transfer.ref)).toEqual(testCase.expect.failedRefs);
      expect(outcome.salvage).toEqual(testCase.expect.salvage);
    });
  }
});
