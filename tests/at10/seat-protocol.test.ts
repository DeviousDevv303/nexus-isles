// AT-10 (protocol) — the embedded Nexus seat end-to-end through the
// SeatProvider interface, against the real world core. The AA11 proof is
// the point: Tier 0 gets no second path — its invalid actions are
// rejected by the same validator, its budget is the validator's budget,
// and its observations are the journal-delivered ones.

import { describe, expect, it } from "vitest";
import { World } from "../../engine/world/world.js";
import type { WorldConfig } from "../../engine/world/state.js";
import type { SeatSpec } from "../../seats/seatProvider.js";
import { NexusEmbeddedSeat } from "../../residents/nexus/embeddedSeat.js";
import { baseConfig } from "../helpers/worldFixtures.js";

function nexusConfig(): WorldConfig {
  const config = baseConfig();
  config.residents = [
    { id: "nexus", satiety: 8, maxSatiety: 10, actionsPerTick: 2 },
    { id: "alpha", satiety: 8, maxSatiety: 10, actionsPerTick: 2 },
  ];
  return config;
}

function nexusSpec(overrides: Partial<SeatSpec> = {}): SeatSpec {
  return {
    seatId: "nexus",
    tier: 0,
    providerId: "nexus-intelligence",
    backendVersion: "run25",
    budget: { tokensPerTick: 4096, actionsPerTick: 2 },
    ...overrides,
  };
}

describe("embedded Nexus seat (AT-10)", () => {
  it("connect enforces Tier 0, world residency, and the validator's budget ceiling", async () => {
    const seat = new NexusEmbeddedSeat(World.create(1, nexusConfig()));
    await expect(seat.connect(nexusSpec({ tier: 1 }))).rejects.toThrow(/Tier 0/);
    await expect(seat.connect(nexusSpec({ seatId: "ghost" }))).rejects.toThrow(
      /not a resident/,
    );
    await expect(
      seat.connect(nexusSpec({ budget: { tokensPerTick: 4096, actionsPerTick: 3 } })),
    ).rejects.toThrow(/validator's budget/);
    await expect(seat.connect(nexusSpec())).resolves.toBeDefined();
  });

  it("observe returns the journal-delivered observation — and nothing before the first tick", async () => {
    const world = World.create(2, nexusConfig());
    const seat = new NexusEmbeddedSeat(world);
    const handle = await seat.connect(nexusSpec());
    await expect(seat.observe(handle)).rejects.toThrow(/no observation/);
    world.tick();
    const observation = await seat.observe(handle);
    expect(observation.tick).toBe(1);
    expect(observation.visible.satiety).toBe(7); // 8 - 1 decay at step 4
  });

  it("submit flows through the world's path: gather is granted and journaled", async () => {
    const world = World.create(3, nexusConfig());
    const seat = new NexusEmbeddedSeat(world);
    const handle = await seat.connect(nexusSpec());
    const receipt = await seat.submit(handle, {
      verb: "gather",
      args: { node: "grove", amount: 3 },
    });
    expect(receipt.accepted).toBe(true);
    world.tick();
    const accepted = world
      .entries()
      .find((e) => e.type === "ACTION_ACCEPTED" && e.actor === "nexus");
    expect(accepted).toBeDefined();
    expect(world.state.residents["nexus"].inventory).toBe(3);
  });

  it("AA11: the same validator rejects Nexus — unknown verb, and the per-tick budget", async () => {
    const world = World.create(4, nexusConfig());
    const seat = new NexusEmbeddedSeat(world);
    const handle = await seat.connect(nexusSpec());
    await seat.submit(handle, { verb: "teleport", args: {} });
    await seat.submit(handle, { verb: "gather", args: { node: "grove", amount: 1 } });
    await seat.submit(handle, { verb: "gather", args: { node: "grove", amount: 1 } });
    world.tick();
    const rejected = world
      .entries()
      .filter((e) => e.type === "ACTION_REJECTED" && e.actor === "nexus")
      .map((e) => (e.payload as { reason?: string }).reason);
    expect(rejected).toEqual(["unknown_verb", "budget_exceeded"]);
  });

  it("a dead resident observes nothing — death closes the seat", async () => {
    const config = nexusConfig();
    config.residents = config.residents.map((r) =>
      r.id === "nexus" ? { ...r, satiety: 1 } : r,
    );
    const world = World.create(5, config);
    const seat = new NexusEmbeddedSeat(world);
    const handle = await seat.connect(nexusSpec());
    world.tick(); // satiety 1 - 1 decay = 0 -> starvation at step 10
    expect(world.state.residents["nexus"].alive).toBe(false);
    await expect(seat.observe(handle)).rejects.toThrow(/no observation/);
  });
});
