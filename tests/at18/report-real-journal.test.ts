// AT-18 regression — the observer's derivation against a REAL world
// journal. The original report tests hand-built journals in the dry-run
// fixture's dialect (TICK_RESOLVED, bare ACTION), which the world core
// never emits — it commits ticks as TICK_COMMIT and records executed
// actions as ACTION_ACCEPTED — so the observer reported zero ticks and
// zero actions for every real world while its tests stayed green. This
// test drives the actual world core and derives the report from its
// journal.

import { describe, expect, it } from "vitest";
import { World } from "../../engine/world/world.js";
import { deriveReport } from "../../observer/report.js";
import { baseConfig, drive, rebuildJournal } from "../helpers/worldFixtures.js";

describe("observer report vs a real world journal (AT-18 regression)", () => {
  it("counts committed ticks and accepted actions in the core's vocabulary", () => {
    const world = World.create(7, baseConfig());
    drive(world, 3);
    const journal = rebuildJournal(world);

    const commits = journal.entries().filter((e) => e.type === "TICK_COMMIT").length;
    const accepted = journal.entries().filter((e) => e.type === "ACTION_ACCEPTED").length;
    expect(commits).toBeGreaterThanOrEqual(4); // genesis commit + 3 ticks
    expect(accepted).toBeGreaterThan(0);

    const report = deriveReport(journal);
    expect(report.resolvedTicks).toBe(commits);
    expect(report.byType["TICK_COMMIT"]).toBe(commits);
    const actionTotal = Object.values(report.actionsByActor).reduce((a, b) => a + b, 0);
    expect(actionTotal).toBe(accepted);
  });
});
