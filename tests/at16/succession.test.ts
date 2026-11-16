// AT-16 (dead-hand and succession, consolidated) — the succession half.
// Subcases proven here at the lineage layer: a valid instrument executes;
// a partially invalid instrument fails closed per transfer (the
// fortress-lost-before-death case); revoked and expired instruments
// execute nothing; a dead successor inherits nothing; private knowledge
// is never bequeathable. The dead-hand order-execution subcases ride on
// the world core (build step 2) and land with it.

import { describe, expect, it } from "vitest";
import {
  executeSuccession,
  revokeInstrument,
  validateAuthorization,
  type SuccessionContext,
  type SuccessionInstrument,
} from "../../lineage/succession.js";

function ctx(overrides: Partial<SuccessionContext> = {}): SuccessionContext {
  return {
    currentTick: 50,
    aliveResidents: new Set(["founder", "heir"]),
    ownership: new Map([
      ["fortress-1", "founder"],
      ["lab-1", "founder"],
    ]),
    standingOrders: new Map([
      ["patrol-7", { ownerId: "founder", inForce: true }],
    ]),
    bequeathableKnowledge: new Set(["star-charts"]),
    commandHolders: new Set(["founder"]),
    ...overrides,
  };
}

function instrument(overrides: Partial<SuccessionInstrument> = {}): SuccessionInstrument {
  return {
    id: "inst-1",
    founderId: "founder",
    successorId: "heir",
    transfers: [
      { kind: "asset", ref: "fortress-1" },
      { kind: "infrastructure", ref: "lab-1" },
      { kind: "standing-order", ref: "patrol-7" },
      { kind: "knowledge", ref: "star-charts" },
      { kind: "command-authority", ref: "faction-1" },
    ],
    authorizedTick: 40,
    expiresTick: null,
    revoked: false,
    ...overrides,
  };
}

describe("succession instruments (AT-16)", () => {
  it("a valid instrument authorizes cleanly and executes every transfer", () => {
    expect(validateAuthorization(instrument(), ctx())).toEqual([]);
    const outcome = executeSuccession(instrument(), ctx());
    expect(outcome.executed).toHaveLength(5);
    expect(outcome.failed).toEqual([]);
    expect(outcome.salvage).toEqual([]);
  });

  it("fortress lost before death: that transfer fails closed to salvage, the rest execute", () => {
    const deathCtx = ctx({
      ownership: new Map([
        ["fortress-1", "rival"], // lost after authorization
        ["lab-1", "founder"],
      ]),
    });
    const outcome = executeSuccession(instrument(), deathCtx);
    expect(outcome.failed.map((f) => f.transfer.ref)).toEqual(["fortress-1"]);
    expect(outcome.salvage).toEqual(["fortress-1"]);
    expect(outcome.executed.map((e) => e.transfer.ref)).toEqual([
      "lab-1",
      "patrol-7",
      "star-charts",
      "faction-1",
    ]);
  });

  it("a revoked instrument executes nothing", () => {
    const revoked = revokeInstrument(instrument(), "founder", ctx());
    const outcome = executeSuccession(revoked, ctx());
    expect(outcome.executed).toEqual([]);
    expect(outcome.salvage).toHaveLength(5);
  });

  it("an expired instrument executes nothing", () => {
    const outcome = executeSuccession(instrument({ expiresTick: 50 }), ctx());
    expect(outcome.executed).toEqual([]);
    expect(outcome.failed.every((f) => f.reason.includes("expired"))).toBe(true);
  });

  it("a dead successor inherits nothing — everything salvages", () => {
    const outcome = executeSuccession(
      instrument(),
      ctx({ aliveResidents: new Set(["founder"]) }),
    );
    expect(outcome.executed).toEqual([]);
    expect(outcome.salvage).toHaveLength(5);
  });

  it("a standing order revoked before death fails at execution, not silently", () => {
    const deathCtx = ctx({
      standingOrders: new Map([["patrol-7", { ownerId: "founder", inForce: false }]]),
    });
    const outcome = executeSuccession(instrument(), deathCtx);
    expect(outcome.failed.map((f) => f.transfer.ref)).toEqual(["patrol-7"]);
    expect(outcome.executed).toHaveLength(4);
  });

  it("authorization refuses what execution must never see: dead founder, private knowledge", () => {
    const deadFounder = validateAuthorization(
      instrument(),
      ctx({ aliveResidents: new Set(["heir"]) }),
    );
    expect(deadFounder.some((i) => i.includes("dead cannot authorize"))).toBe(true);

    const privateKnowledge = validateAuthorization(
      instrument({ transfers: [{ kind: "knowledge", ref: "private-diary" }] }),
      ctx(),
    );
    expect(privateKnowledge.some((i) => i.includes("never transfers"))).toBe(true);
  });
});
