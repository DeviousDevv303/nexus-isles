// AT-15 foundations: contention is resolved by the seeded RNG and replays
// identically — never by arrival order or seat identity.

import { describe, expect, it } from "vitest";
import { World } from "../../engine/world/world.js";
import { SEATS, baseConfig, rebuildJournal as rebuild } from "../helpers/worldFixtures.js";

function contested(seed: number, order: string[]): World {
  const cfg = baseConfig();
  cfg.nodes = [{ id: "grove", capacity: 4, amount: 4, regen: 0 }];
  cfg.rules.blightPercent = 0;
  const w = World.create(seed, cfg);
  for (const seat of order) w.submit(seat, { verb: "gather", args: { node: "grove", amount: 4 } });
  w.tick();
  return w;
}

function winner(w: World): string {
  const r = Object.entries(w.state.residents).find(([, v]) => v.inventory > 0);
  return r![0];
}

describe("AT-15 contention replay", () => {
  it("same seed -> same winner, regardless of submission order", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const a = winner(contested(seed, SEATS));
      expect(winner(contested(seed, [...SEATS].reverse()))).toBe(a);
      expect(winner(contested(seed, ["charlie", "alpha", "delta", "bravo"]))).toBe(a);
    }
  });

  it("restore from the journal reproduces the contention outcome", () => {
    const live = contested(5, SEATS);
    const restored = World.restore(rebuild(live));
    expect(winner(restored)).toBe(winner(live));
    expect(restored.state).toEqual(live.state);
  });

  it("no seat is structurally favoured: across seeds every seat wins sometimes", () => {
    const wins = new Map<string, number>();
    for (let seed = 1; seed <= 200; seed++) {
      const w = winner(contested(seed, SEATS));
      wins.set(w, (wins.get(w) ?? 0) + 1);
    }
    for (const seat of SEATS) {
      expect(wins.get(seat) ?? 0).toBeGreaterThan(20); // fair share = 50; wide margin
    }
  });

  it("every denial is on the record with requested vs granted", () => {
    const w = contested(3, SEATS);
    const grants = w.entries().filter((e) => e.type === "GATHER_GRANTED");
    expect(grants).toHaveLength(4);
    expect(grants.filter((g) => g.payload.granted === 4)).toHaveLength(1);
    expect(grants.filter((g) => g.payload.granted === 0)).toHaveLength(3);
  });
});
