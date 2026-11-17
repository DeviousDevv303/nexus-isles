// AT-01 / step 7 — the dry-run epoch, wired through the real world core.
// The scripted epoch property, proven against the actual tick pipeline
// (not a journal-level stub): same seed + same config + same policy ->
// identical journal head hash and identical state hash across two
// independent worlds; a resident who never eats dies on the record; the
// observer's derivation reads the death back off the journal; and a
// persisted epoch restores to the identical world.

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { World } from "../../engine/world/world.js";
import { hashState } from "../../engine/world/state.js";
import { deriveReport } from "../../observer/report.js";
import { SEATS, baseConfig, drive, policy, rebuildJournal, restartFrom, tempDir } from "../helpers/worldFixtures.js";

describe("dry-run epoch through the world core (AT-01, step 7)", () => {
  it("two epochs from one seed are identical — journal and state", () => {
    const a = World.create(2026, baseConfig());
    const b = World.create(2026, baseConfig());
    drive(a, 8);
    drive(b, 8);
    expect(a.headHash).toBe(b.headHash);
    expect(hashState(a.state)).toBe(hashState(b.state));
    expect(a.tickNumber).toBe(8);
  });

  it("a resident who never eats dies of starvation, and the observer reads it from the journal", () => {
    const config = baseConfig();
    config.residents = config.residents.map((r) =>
      r.id === "bravo" ? { ...r, satiety: 3 } : r,
    );
    const world = World.create(99, config);
    for (let tick = 0; tick < 8; tick++) {
      for (const seat of SEATS) {
        if (seat === "bravo") continue; // bravo never acts, never eats
        policy(world, seat, world.tickNumber, SEATS.indexOf(seat));
      }
      world.tick();
    }
    const death = world
      .entries()
      .find((e) => e.type === "DEATH" && (e.payload as { resident?: string }).resident === "bravo");
    expect(death).toBeDefined();
    expect((death?.payload as { cause?: string }).cause).toBe("starvation");
    expect(world.state.residents["bravo"].alive).toBe(false);

    // The observer derives from journal entries alone — rebuild one and read it.
    const report = deriveReport(rebuildJournal(world));
    expect(report.deaths).toEqual(["bravo"]);
  });

  it("a persisted epoch restores to the identical world", () => {
    const dir = tempDir();
    const path = join(dir, "epoch.jsonl");
    const world = World.create(7, baseConfig(), { persistPath: path });
    drive(world, 8);
    const restored = restartFrom(path);
    expect(restored.headHash).toBe(world.headHash);
    expect(hashState(restored.state)).toBe(hashState(world.state));
  });
});
