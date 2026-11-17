// AT-22 — seat driver acceptance tests.
// The driver receives only the journal-delivered, intel-scoped observation and
// private directives, then submits candidates through World's validator.

import { describe, expect, it } from "vitest";
import { Journal } from "../../ledger/journal.js";
import { World } from "../../engine/world/world.js";
import { juarezConfig } from "../../engine/world/maps/juarez.js";
import { RawOutputBackend, ScriptedPolicyBackend, SeatDriver, parseBackendActions } from "../../seats/driver.js";

function makeConfig(satiety = 8) {
  return juarezConfig([
    {
      id: "nexus",
      satiety,
      maxSatiety: 10,
      actionsPerTick: 2,
      position: "centro",
      intel: 1,
      backend: { providerId: "nexus-intelligence", version: "run25" },
    },
    {
      id: "scout",
      satiety: 8,
      maxSatiety: 10,
      actionsPerTick: 2,
      position: "industrial-east",
      intel: 1,
      backend: { providerId: "test-double:scripted-policy", version: "test-v1" },
    },
  ]);
}

function rebuild(world: World): Journal {
  const journal = new Journal();
  for (const entry of world.entries()) {
    journal.append({ tick: entry.tick, type: entry.type, actor: entry.actor, payload: { ...entry.payload } });
  }
  return journal;
}

async function runScript(seed: number): Promise<World> {
  const world = World.create(seed, makeConfig());
  const driver = new SeatDriver(world, [
    {
      seatId: "nexus",
      backend: new ScriptedPolicyBackend(({ observation }) => [
        { verb: "move", args: { to: observation.visible.position === "centro" ? "pronaf" : "centro" } },
      ]),
    },
    {
      seatId: "scout",
      backend: new ScriptedPolicyBackend(() => [{ verb: "gather", args: { node: "maquila-commissary", amount: 1 } }]),
    },
  ]);
  world.tick(); // bind backends and deliver the first observation
  await driver.tick();
  await driver.tick();
  await driver.tick();
  return world;
}

describe("Nexus seat driver (AT-22)", () => {
  it("passes only an intel-scoped observation and private directives to the backend", async () => {
    const world = World.create(31, makeConfig());
    let received: { observation: unknown; directives: unknown } | undefined;
    const driver = new SeatDriver(world, [{
      seatId: "nexus",
      backend: new RawOutputBackend(
        { providerId: "nexus-intelligence", version: "run25" },
        (input) => {
          received = input;
          return [];
        },
        parseBackendActions,
      ),
      directives: () => [
        { tick: world.tickNumber, kind: "set_approach", body: "observe before acting" },
        { tick: world.tickNumber, kind: "message", body: "protect the bridge" },
      ],
    }]);

    world.tick();
    await driver.tick();

    expect(received?.directives).toEqual([
      { tick: 1, kind: "set_approach", body: "observe before acting" },
      { tick: 1, kind: "message", body: "protect the bridge" },
    ]);
    const visible = received?.observation as { visible: { regions: Record<string, unknown> } };
    expect(visible.visible.regions).toHaveProperty("centro");
    expect(visible.visible.regions).not.toHaveProperty("samalayuca");
    expect(world.entries().some((entry) => JSON.stringify(entry.payload).includes("protect the bridge"))).toBe(false);
  });

  it("records malformed backend output as a refusal and still commits the tick", async () => {
    const world = World.create(32, makeConfig());
    const driver = new SeatDriver(world, [{
      seatId: "nexus",
      backend: new RawOutputBackend(
        { providerId: "nexus-intelligence", version: "run25" },
        () => null,
        parseBackendActions,
      ),
    }]);
    world.tick();
    const before = world.state;
    const report = await driver.tick();

    expect(report.refused).toBe(1);
    expect(world.state.residents.nexus.inventory).toBe(before.residents.nexus.inventory);
    const refusal = world.entries().find((entry) => entry.type === "DRIVER_ACTION_REJECTED");
    expect(refusal).toMatchObject({
      actor: "seat-driver",
      payload: {
        seat: "nexus",
        backend: { providerId: "nexus-intelligence", version: "run25" },
      },
    });
    expect(world.entries().at(-1)?.type).toBe("TICK_COMMIT");
    expect(World.restore(rebuild(world)).state).toEqual(world.state);
  });

  it("routes semantic candidates through the validator and journals backend provenance", async () => {
    const world = World.create(33, makeConfig());
    const driver = new SeatDriver(world, [{
      seatId: "nexus",
      backend: new ScriptedPolicyBackend(() => [
        { verb: "gather", args: { node: "mercado-centro", amount: 1 } },
        { verb: "not-a-real-verb", args: {} },
      ]),
    }]);
    world.tick();
    await driver.tick();

    const actionEntries = world.entries().filter((entry) =>
      (entry.type === "ACTION_ACCEPTED" || entry.type === "ACTION_REJECTED") && entry.actor === "nexus",
    );
    expect(actionEntries).toHaveLength(2);
    expect(actionEntries[0].type).toBe("ACTION_ACCEPTED");
    expect(actionEntries[1]).toMatchObject({
      type: "ACTION_REJECTED",
      payload: { reason: "unknown_verb", backend: { providerId: "test-double:scripted-policy", version: "test-v1" } },
    });
  });

  it("is deterministic and replayable for two identical scripted runs", async () => {
    const left = await runScript(34);
    const right = await runScript(34);
    expect(left.headHash).toBe(right.headHash);
    expect(left.state).toEqual(right.state);
    expect(World.restore(rebuild(left)).state).toEqual(left.state);
    expect(rebuild(left).verify().ok).toBe(true);
  });

  it("closes a driven seat permanently after death with no post-death backend call or rebind", async () => {
    const world = World.create(35, makeConfig(1));
    let calls = 0;
    const driver = new SeatDriver(world, [{
      seatId: "nexus",
      backend: new ScriptedPolicyBackend(() => {
        calls += 1;
        return [{ verb: "wait", args: {} }];
      }),
    }]);
    world.tick(); // starvation kills nexus before the driver can act
    expect(world.state.residents.nexus.alive).toBe(false);
    const report = await driver.tick();
    expect(report.closedSeats).toEqual(["nexus"]);
    expect(calls).toBe(0);
    const afterDeathBinds = world.entries().filter((entry) => entry.type === "SEAT_BACKEND_BOUND" && entry.tick > 1);
    expect(afterDeathBinds).toHaveLength(0);
    expect(() => world.bindBackend("nexus", { providerId: "test-double:scripted-policy", version: "test-v2" })).not.toThrow();
    world.tick();
    expect(world.entries().filter((entry) => entry.type === "BACKEND_BIND_REJECTED").at(-1)).toMatchObject({
      type: "BACKEND_BIND_REJECTED",
      payload: { reason: "resident_dead" },
    });
  });
});
