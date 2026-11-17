// Directive T7 (Issue #235): regression gate for journal-derived
// dynasty-score-v1. Key decisions under test: versioned open/close records,
// verified survival, explicit MISSING axes, deterministic close-prefix
// replay, and tamper detection. Unfinished: T7's territory and continuity
// cases intentionally assert their held/MISSING status; this suite does not
// validate future evidence schemas that are not implemented yet.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Journal } from "../../ledger/journal.js";
import { closeDynastyScoreEpoch, deriveDynastyScore, openDynastyScoreEpoch } from "../../observer/dynastyScore.js";
import { DYNASTY_SCORE_VERSION, DYNASTY_SCORE_WEIGHTS } from "../../observer/dynastyScoreSpec.js";
import { World } from "../../engine/world/world.js";
import { baseConfig } from "../helpers/worldFixtures.js";

function makeWorld(satietyDecay = 0): World {
  return World.create(19, baseConfig({ rules: { ...baseConfig().rules, satietyDecay } }));
}

function copyJournal(world: World): Journal {
  const journal = new Journal();
  for (const entry of world.entries()) {
    journal.append({ tick: entry.tick, type: entry.type, actor: entry.actor, payload: { ...entry.payload } });
  }
  return journal;
}

describe("dynasty-score-v1 observer (T7)", () => {
  it("journals the frozen formula contract at epoch open before scoring ticks", () => {
    const world = makeWorld();
    const stateBefore = world.state;
    const headBefore = world.headHash;

    openDynastyScoreEpoch(world, "pilot-1");

    expect(world.state).toEqual(stateBefore);
    expect(world.headHash).not.toBe(headBefore);
    const opened = world.entries().at(-1)!;
    expect(opened.type).toBe("DYNASTY_SCORE_EPOCH_OPENED");
    expect(opened.payload).toMatchObject({
      epochId: "pilot-1",
      version: DYNASTY_SCORE_VERSION,
      startTick: 0,
      weights: DYNASTY_SCORE_WEIGHTS,
      normalizationPopulation: "active-lineages-at-epoch-close",
      tickAccounting: "resolved-ticks-after-open; alive-at-tick-start",
    });
    expect(() => World.restore(copyJournal(world))).not.toThrow();
  });

  it("scores verified survival evidence and keeps unsupported axes MISSING, not zero", () => {
    const world = makeWorld();
    openDynastyScoreEpoch(world, "pilot-1");
    world.tick();
    const recorded = closeDynastyScoreEpoch(world, "pilot-1");

    expect(recorded.resolvedTicks).toBe(1);
    expect(recorded.evidenceClass).toBe("verified-journal");
    expect(recorded.scores).toHaveLength(4);
    for (const score of recorded.scores) {
      expect(score.axes.survival).toMatchObject({ status: "available", rawValue: 1, normalizedValue: 1, diminishedValue: 1 });
      expect(score.axes.territoryYears).toMatchObject({ status: "missing", rawValue: null });
      expect(score.axes.verifiedArtifacts).toMatchObject({ status: "missing", rawValue: null });
      expect(score.axes.successorContinuity).toMatchObject({ status: "missing", rawValue: null });
      expect(score.axes.wealthResilience).toMatchObject({ status: "missing", rawValue: null });
      expect(score.availableWeight).toBe(DYNASTY_SCORE_WEIGHTS.survival);
      expect(score.score).toBe(1);
      expect(score.status).toBe("partial");
    }
    expect(recorded.excludedEvidence.join(" ")).toContain("proposals");
    expect(world.entries().at(-1)?.type).toBe("DYNASTY_SCORE_EPOCH_CLOSED");
    expect(World.restore(copyJournal(world)).tickNumber).toBe(world.tickNumber);
  });

  it("re-derives the recorded close identically after JSONL save/load", () => {
    const world = makeWorld();
    openDynastyScoreEpoch(world, "pilot-1");
    world.tick();
    const recorded = closeDynastyScoreEpoch(world, "pilot-1");
    const journal = copyJournal(world);
    const path = join(mkdtempSync(join(tmpdir(), "nexus-dynasty-score-")), "journal.jsonl");
    journal.saveToFile(path);
    const loaded = Journal.loadFromFile(path);

    expect(deriveDynastyScore(loaded, "pilot-1")).toEqual(recorded);
  });

  it("keeps close-time active lineages fixed when later ticks change the world", () => {
    const world = makeWorld(1);
    openDynastyScoreEpoch(world, "pilot-1");
    world.tick();
    const recorded = closeDynastyScoreEpoch(world, "pilot-1");
    for (let tick = 0; tick < 7; tick++) world.tick();

    expect(deriveDynastyScore(copyJournal(world), "pilot-1")).toEqual(recorded);
    expect(deriveDynastyScore(copyJournal(world), "pilot-1").activeLineages).toHaveLength(4);
  });

  it("marks survival MISSING for an epoch with no resolved ticks", () => {
    const world = makeWorld();
    openDynastyScoreEpoch(world, "empty-epoch");
    const recorded = closeDynastyScoreEpoch(world, "empty-epoch");

    expect(recorded.resolvedTicks).toBe(0);
    expect(recorded.scores[0].axes.survival).toMatchObject({ status: "missing", rawValue: null });
    expect(recorded.scores[0].score).toBeNull();
    expect(recorded.scores[0].status).toBe("missing");
  });

  it("rejects a self-consistent journal whose recorded score was edited", () => {
    const world = makeWorld();
    openDynastyScoreEpoch(world, "pilot-1");
    world.tick();
    closeDynastyScoreEpoch(world, "pilot-1");
    const original = copyJournal(world).entries();
    const altered = new Journal();
    for (const entry of original) {
      const payload = { ...entry.payload };
      if (entry.type === "DYNASTY_SCORE_EPOCH_CLOSED") {
        const score = structuredClone(payload.score) as { scores: { score: number }[] };
        score.scores[0].score = 0;
        payload.score = score;
      }
      altered.append({ tick: entry.tick, type: entry.type, actor: entry.actor, payload });
    }

    expect(altered.verify().ok).toBe(true);
    expect(() => deriveDynastyScore(altered, "pilot-1")).toThrow(/does not reproduce/);
  });

  it("refuses overlapping or duplicate epoch opens", () => {
    const world = makeWorld();
    openDynastyScoreEpoch(world, "pilot-1");
    expect(() => openDynastyScoreEpoch(world, "pilot-2")).toThrow(/already open/);
    expect(() => openDynastyScoreEpoch(world, "pilot-1")).toThrow(/already open/);
  });
});
