// AT-08 (mortality) — the succession edge: a dead resident cannot return
// through succession or identity duplication. The lineage layer enforces
// it structurally: the founder can never be their own successor, at
// authorization time or at execution time.

import { describe, expect, it } from "vitest";
import {
  executeSuccession,
  validateAuthorization,
  type SuccessionContext,
  type SuccessionInstrument,
} from "../../lineage/succession.js";

const baseCtx: SuccessionContext = {
  currentTick: 10,
  aliveResidents: new Set(["founder", "heir"]),
  ownership: new Map([["fortress-1", "founder"]]),
  standingOrders: new Map(),
  bequeathableKnowledge: new Set(),
  commandHolders: new Set(),
};

function selfInstrument(): SuccessionInstrument {
  return {
    id: "inst-self",
    founderId: "founder",
    successorId: "founder", // the founder naming themselves
    transfers: [{ kind: "asset", ref: "fortress-1" }],
    authorizedTick: 5,
    expiresTick: null,
    revoked: false,
  };
}

describe("no return through succession (AT-08)", () => {
  it("authorization rejects the founder as their own successor", () => {
    const issues = validateAuthorization(selfInstrument(), baseCtx);
    expect(issues.some((i) => i.includes("not resurrection"))).toBe(true);
  });

  it("execution refuses a self-succession even if one was recorded", () => {
    const outcome = executeSuccession(selfInstrument(), baseCtx);
    expect(outcome.executed).toEqual([]);
    expect(outcome.salvage).toEqual(["fortress-1"]);
  });

  it("a dead founder cannot authorize anything — agency dies with the resident", () => {
    const deadCtx: SuccessionContext = {
      ...baseCtx,
      aliveResidents: new Set(["heir"]),
    };
    const issues = validateAuthorization(
      { ...selfInstrument(), successorId: "heir" },
      deadCtx,
    );
    expect(issues.some((i) => i.includes("dead cannot authorize"))).toBe(true);
  });
});
