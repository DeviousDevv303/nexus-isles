import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Journal } from "../../ledger/journal.js";
import type { WorldConfig } from "../../engine/world/state.js";
import { World } from "../../engine/world/world.js";

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "nexus-isles-"));
}

export const TEST_BACKEND = { providerId: "test-provider", version: "test-v1" };

export const SEATS = ["alpha", "bravo", "charlie", "delta"];

export function baseConfig(overrides: Partial<WorldConfig> = {}): WorldConfig {
  return {
    nodes: [
      { id: "grove", capacity: 12, amount: 12, regen: 2 },
      { id: "shore", capacity: 8, amount: 8, regen: 1 },
    ],
    residents: SEATS.map((id) => ({ id, satiety: 8, maxSatiety: 10, actionsPerTick: 2, backend: TEST_BACKEND })),
    rules: { satietyDecay: 1, maxGatherPerAction: 6, blightPercent: 25, blightMax: 3 },
    ...overrides,
  };
}

/** A deterministic policy that reads only its own observation. */
export function policy(world: World, seat: string, tick: number, seatIndex: number): void {
  const obs = world.observe(seat);
  if (!obs) return;
  const v = obs.visible as { satiety: number; inventory: number };
  if (v.satiety <= 6 && v.inventory > 0) {
    world.submit(seat, { verb: "eat", args: { amount: 3 } });
  }
  world.submit(seat, {
    verb: "gather",
    args: { node: (tick + seatIndex) % 2 === 0 ? "grove" : "shore", amount: 3 },
  });
}

/** Run `ticks` ticks; `order` controls cross-seat submission order only. */
export function drive(world: World, ticks: number, order: string[] = SEATS): void {
  for (let i = 0; i < ticks; i++) {
    for (const seat of order) policy(world, seat, world.tickNumber, SEATS.indexOf(seat));
    world.tick();
  }
}

/** An independent Journal re-appended from a world's entries (pure replay input). */
export function rebuildJournal(w: World): Journal {
  const j = new Journal();
  for (const e of w.entries()) {
    j.append({ tick: e.tick, type: e.type, actor: e.actor, payload: { ...e.payload } });
  }
  return j;
}
