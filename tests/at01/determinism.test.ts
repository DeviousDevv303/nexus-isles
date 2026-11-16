// AT-01 Determinism: same seed + same actions -> identical outcomes,
// asserted on journal hashes. Submission order across seats must not matter
// (AA8), and the seed must matter.

import { describe, expect, it } from "vitest";
import { rngFor } from "../../engine/world/rng.js";
import { World } from "../../engine/world/world.js";
import { rebuildJournal as rebuild } from "../helpers/worldFixtures.js";
import { SEATS, baseConfig, drive } from "../helpers/worldFixtures.js";

function run(seed: number, ticks: number, order?: string[]): World {
  const w = World.create(seed, baseConfig());
  drive(w, ticks, order);
  return w;
}

describe("AT-01 determinism", () => {
  it("same seed + same actions -> identical journal head hash and entries", () => {
    const a = run(42, 40);
    const b = run(42, 40);
    expect(a.headHash).toBe(b.headHash);
    expect(a.entries().map((e) => e.hash)).toEqual(b.entries().map((e) => e.hash));
    expect(a.state).toEqual(b.state);
  });

  it("different seed -> different history", () => {
    expect(run(42, 40).headHash).not.toBe(run(43, 40).headHash);
  });

  it("cross-seat submission order confers no advantage (AA8)", () => {
    const forward = run(7, 40, SEATS);
    const reversed = run(7, 40, [...SEATS].reverse());
    const shuffled = run(7, 40, ["charlie", "alpha", "delta", "bravo"]);
    expect(reversed.headHash).toBe(forward.headHash);
    expect(shuffled.headHash).toBe(forward.headHash);
  });

  it("the journal chain verifies and every tick closes with a state-hash commit", () => {
    const w = run(5, 25);
    const entries = w.entries();
    expect(entries[0].type).toBe("WORLD_GENESIS");
    expect(entries[0].payload.seed).toBe(5); // seed is journaled
    expect(entries.filter((e) => e.type === "TICK_COMMIT")).toHaveLength(26); // genesis + 25
    expect(entries[entries.length - 1].type).toBe("TICK_COMMIT");
  });

  it("restore by pure replay reproduces the identical state (journal -> state)", () => {
    const live = run(9, 30);
    const w = World.restore(rebuild(live));
    expect(w.state).toEqual(live.state);
    expect(w.headHash).toBe(live.headHash);
  });

  it("RNG streams are stateless and independent", () => {
    const a = rngFor(1, 3, "x").next();
    expect(rngFor(1, 3, "x").next()).toBe(a);
    expect(rngFor(1, 3, "y").next()).not.toBe(a);
    expect(rngFor(1, 4, "x").next()).not.toBe(a);
    const s = rngFor(2, 2, "s").shuffle([1, 2, 3, 4, 5, 6]);
    expect(s.slice().sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rngFor(2, 2, "s").shuffle([1, 2, 3, 4, 5, 6])).toEqual(s);
  });

  it("submit normalises args so journaled form survives a round-trip", () => {
    const w = World.create(1, baseConfig());
    w.submit("alpha", { verb: "gather", args: { node: "grove", amount: 2, junk: undefined } });
    w.tick();
    const e = w.entries().find((x) => x.type === "ACTION_ACCEPTED");
    expect(e).toBeDefined();
    expect("junk" in (e!.payload.args as object)).toBe(false);
  });
});

