// AT-21 / T7 — pure, journal-derived dynasty-score-v1 observer.
// registry: dynasty-score-v1, registry: dynasty-score-v1-axes
// The observer never opens/closes epochs or appends score records; identical
// verified journal input and explicit epoch bounds must reproduce the score.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Journal } from "../../ledger/journal.js";
import { deriveDynastyScore } from "../../observer/dynastyScore.js";
import { DYNASTY_SCORE_VERSION, DYNASTY_SCORE_WEIGHTS } from "../../governance/dynastyScoreSpec.js";
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
  it("is read-only: deriving a score does not append an epoch or score record", () => {
    const world = makeWorld();
    world.tick();
    const before = world.entries().length;
    const score = deriveDynastyScore(copyJournal(world), "pilot-1", 0, 1);
    expect(world.entries()).toHaveLength(before);
    expect(world.entries().some((entry) => entry.type.startsWith("DYNASTY_SCORE"))).toBe(false);
    expect(score.version).toBe(DYNASTY_SCORE_VERSION);
    expect(score.sourceJournalHead).toBe(world.headHash);
  });

  it("scores verified survival evidence and keeps unsupported axes MISSING, not zero", () => {
    const world = makeWorld();
    world.tick();
    const recorded = deriveDynastyScore(copyJournal(world), "pilot-1", 0, 1);
    expect(recorded.resolvedTicks).toBe(1);
    expect(recorded.evidenceClass).toBe("verified-journal");
    expect(recorded.scores).toHaveLength(4);
    for (const score of recorded.scores) {
      expect(score.axes.survival).toMatchObject({ status: "available", rawValue: 1, normalizedValue: 1, diminishedValue: 1 });
      expect(score.axes.territoryYears).toMatchObject({ status: "missing", rawValue: null });
      expect(score.axes.verifiedArtifacts).toMatchObject({ status: "missing", rawValue: null });
      expect(score.axes.successorContinuity).toMatchObject({ status: "missing", rawValue: null });
      expect(score.axes.wealthResilience).toMatchObject({ status: "missing", rawValue: null });
      expect(score.coverage).toBe(DYNASTY_SCORE_WEIGHTS.survival);
      expect(score.observedWeightedAverage).toBe(1);
      expect(score.weightedSubtotal).toBe(DYNASTY_SCORE_WEIGHTS.survival);
      expect(score.missingAxes).toEqual(["territoryYears", "verifiedArtifacts", "successorContinuity", "wealthResilience"]);
      expect(score.status).toBe("partial");
    }
    expect(recorded.excludedEvidence.join(" ")).toContain("proposals");
  });

  it("re-derives identically after JSONL save/load and journal copying", () => {
    const world = makeWorld();
    world.tick();
    const source = copyJournal(world);
    const path = join(mkdtempSync(join(tmpdir(), "nexus-dynasty-score-")), "journal.jsonl");
    source.saveToFile(path);
    const loaded = Journal.loadFromFile(path);
    const expected = deriveDynastyScore(source, "pilot-1", 0, 1);
    expect(deriveDynastyScore(loaded, "pilot-1", 0, 1)).toEqual(expected);
    expect(deriveDynastyScore(copyJournal(world), "pilot-1", 0, 1)).toEqual(expected);
  });

  it("keeps an explicit close boundary stable when later ticks change the world", () => {
    const world = makeWorld(1);
    world.tick();
    const source = copyJournal(world);
    const recorded = deriveDynastyScore(source, "pilot-1", 0, 1);
    for (let tick = 0; tick < 7; tick++) world.tick();
    expect(deriveDynastyScore(copyJournal(world), "pilot-1", 0, 1)).toEqual(recorded);
    expect(recorded.activeLineages).toHaveLength(4);
  });

  it("marks survival MISSING for an epoch with no resolved ticks", () => {
    const world = makeWorld();
    const recorded = deriveDynastyScore(copyJournal(world), "empty-epoch", 0, 0);
    expect(recorded.resolvedTicks).toBe(0);
    expect(recorded.scores[0].axes.survival).toMatchObject({ status: "missing", rawValue: null });
    expect(recorded.scores[0].observedWeightedAverage).toBeNull();
    expect(recorded.scores[0].weightedSubtotal).toBe(0);
    expect(recorded.scores[0].missingAxes).toHaveLength(5);
    expect(recorded.scores[0].status).toBe("missing");
  });

  it("rejects an epoch boundary that is not backed by committed journal ticks", () => {
    const world = makeWorld();
    expect(() => deriveDynastyScore(copyJournal(world), "bad", 1, 1)).toThrow(/startTick cannot exceed/);
    world.tick();
    expect(() => deriveDynastyScore(copyJournal(world), "bad", 0, 2)).toThrow(/past the latest committed tick/);
  });
});
