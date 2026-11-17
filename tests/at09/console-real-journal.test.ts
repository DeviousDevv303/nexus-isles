// AT-09 regression — the console's "already resolved" guard against a REAL
// world journal. The original console tests hand-built journals in the
// dry-run fixture's dialect (TICK_RESOLVED), which the world core never
// emits — it commits ticks as TICK_COMMIT — so the guard passed every test
// while never firing on a real journal (an intervention targeting an
// already-resolved tick was accepted, breaking AA9). This test drives the
// actual world core and replays its journal through the console.

import { describe, expect, it } from "vitest";
import { World } from "../../engine/world/world.js";
import { submitConsoleEvent, type ConsoleSubmission } from "../../console/console.js";
import { baseConfig, drive, rebuildJournal } from "../helpers/worldFixtures.js";

function submission(overrides: Partial<ConsoleSubmission> = {}): ConsoleSubmission {
  return {
    consoleClass: "C1",
    intent: "raise storm frequency",
    diff: "weather.stormRate: 0.10 -> 0.15",
    verbatim: "make storms a bit more common",
    confirmed: true,
    affectsTick: 4,
    ...overrides,
  };
}

describe("owner console guard vs a real world journal (AT-09 regression)", () => {
  it("refuses interventions targeting ticks the world already committed", () => {
    const world = World.create(7, baseConfig());
    drive(world, 3); // genesis commit (tick 0) + ticks 1..3 committed
    const journal = rebuildJournal(world);
    expect(
      journal.entries().filter((e) => e.type === "TICK_COMMIT").length,
    ).toBeGreaterThanOrEqual(4);

    expect(() => submitConsoleEvent(journal, submission({ affectsTick: 2 }))).toThrow(
      /already resolved/,
    );
    expect(() => submitConsoleEvent(journal, submission({ affectsTick: 3 }))).toThrow(
      /already resolved/,
    );
  });

  it("accepts an intervention for the next unresolved tick and journals it", () => {
    const world = World.create(7, baseConfig());
    drive(world, 3);
    const journal = rebuildJournal(world);

    const index = submitConsoleEvent(journal, submission({ affectsTick: 4 }));
    const entry = journal.entries()[index];
    expect(entry?.type).toBe("EXTERNAL_EVENT");
    expect(entry?.tick).toBe(4);
  });
});
