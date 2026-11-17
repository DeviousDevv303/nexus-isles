// Duplicate-tick prevention, the six adversarial properties (forgeclaw #235,
// Kimi's charter 6954152936; ChatGPT's ordering 6954157525: evaluate the
// existing evidence first, build only the named gap).
//
// Existing evidence (not repeated here): two processes on one journal
// (writer-lock.test.ts), console redelivery across the crash window
// (console-wal.test.ts), torn-tail and mid-tick recovery
// (journal-durability.test.ts). The gap this file closes: a tick DELIVERY had
// no identity, so the same delivery fired twice ticked twice. Every case below
// ends on the same two assertions: exactly one TICK_COMMIT per tick number,
// contiguous from genesis, and one hash chain that verifies.

import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { juarezConfig } from "../../engine/world/maps/juarez.js";
import { World } from "../../engine/world/world.js";
import { TickDeliveryError } from "../../engine/world/writerLock.js";
import { Journal } from "../../ledger/journal.js";
import { SeatDriver, type SeatBackend } from "../../seats/driver.js";
import type { Action } from "../../seats/seatProvider.js";
import { restartFrom, tempDir } from "../helpers/worldFixtures.js";

const REF = { providerId: "test-double:tick-delivery", version: "tick-delivery-v1" } as const;
const SEAT_IDS = ["alpha", "bravo"];

/** A labeled async test double that counts how often it is asked. */
function countingBackend(delayMs = 0): SeatBackend & { calls: number } {
  const backend = {
    ref: REF,
    calls: 0,
    async propose(): Promise<readonly Action[]> {
      backend.calls += 1;
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return [{ verb: "gather", args: { node: "mercado-centro", amount: 1 } }];
    },
  };
  return backend;
}

function setup(delayMs = 0) {
  const path = join(tempDir(), "journal.jsonl");
  const world = World.create(
    91,
    juarezConfig(
      SEAT_IDS.map((id) => ({ id, satiety: 9, maxSatiety: 10, actionsPerTick: 2, position: "centro", intel: 1, backend: REF })),
    ),
    { persistPath: path },
  );
  world.tick({ expectTick: 1 }); // first observation delivered through the journal
  const backend = countingBackend(delayMs);
  const driver = new SeatDriver(world, SEAT_IDS.map((seatId) => ({ seatId, backend })));
  return { path, world, backend, driver };
}

/** Exactly one commit per tick, contiguous from genesis (tick 0), and a chain that verifies. */
function expectOneTickEach(path: string, lastTick: number): void {
  const journal = Journal.loadFromFile(path);
  expect(journal.verify().ok).toBe(true);
  const commits = journal.entries().filter((e) => e.type === "TICK_COMMIT").map((e) => e.tick);
  expect(commits).toEqual(Array.from({ length: lastTick + 1 }, (_, i) => i));
}

const acceptedAt = (path: string, tick: number) =>
  Journal.loadFromFile(path).entries().filter((e) => e.type === "ACTION_ACCEPTED" && e.tick === tick).length;

describe("tick delivery identity: one delivery, one tick", () => {
  it("SEQUENTIAL duplicate delivery: the second is refused, nothing is written", () => {
    const { path, world } = setup();
    world.tick({ expectTick: 2 });
    const bytes = readFileSync(path, "utf8");
    expect(() => world.tick({ expectTick: 2 })).toThrow(TickDeliveryError);
    expect(() => world.tick({ expectTick: 2 })).toThrow(/already committed/);
    expect(() => world.tick({ expectTick: 5 })).toThrow(/not the next tick/); // never skips ahead
    expect(readFileSync(path, "utf8")).toBe(bytes);
    expectOneTickEach(path, 2);
  });

  it("SEQUENTIAL duplicate through the driver: refused before any backend is asked or anything submitted", async () => {
    const { path, backend, driver } = setup();
    await driver.tick({ expectTick: 2 });
    expect(backend.calls).toBe(2);
    const bytes = readFileSync(path, "utf8");
    await expect(driver.tick({ expectTick: 2 })).rejects.toThrow(TickDeliveryError);
    expect(backend.calls).toBe(2);
    expect(readFileSync(path, "utf8")).toBe(bytes);
    await driver.tick({ expectTick: 3 });
    expectOneTickEach(path, 3);
    expect(acceptedAt(path, 2)).toBe(2);
    expect(acceptedAt(path, 3)).toBe(2);
  });

  it("CONCURRENT duplicate delivery: exactly one of two overlapping deliveries ticks", async () => {
    const { path, backend, driver } = setup(20);
    const results = await Promise.allSettled([driver.tick({ expectTick: 2 }), driver.tick({ expectTick: 2 })]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(String((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason)).toMatch(/in flight/);
    expect(backend.calls).toBe(2); // one proposal per seat, not two
    expectOneTickEach(path, 2);
    expect(acceptedAt(path, 2)).toBe(2);
  });

  it("CONCURRENT deliveries without an identity are still single-flight", async () => {
    const { path, driver } = setup(20);
    const results = await Promise.allSettled([driver.tick(), driver.tick()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expectOneTickEach(path, 2);
  });

  it("CRASH between acceptance and journal write: the redelivery after restart ticks once", async () => {
    const first = setup();
    await first.driver.tick({ expectTick: 2 });
    // Tick 3 is accepted (proposals submitted) and the process dies before the
    // world tick writes anything.
    first.world.requestStop("simulated crash after acceptance");
    await expect(first.driver.tick({ expectTick: 3 })).rejects.toThrow(/simulated crash/);
    expect(first.backend.calls).toBe(4);
    const restarted = restartFrom(first.path);
    restarted.clearStop();
    expect(restarted.tickNumber).toBe(2); // nothing of tick 3 is durable
    const backend = countingBackend();
    const driver = new SeatDriver(restarted, SEAT_IDS.map((seatId) => ({ seatId, backend })));
    await driver.tick({ expectTick: 3 });
    await expect(driver.tick({ expectTick: 3 })).rejects.toThrow(TickDeliveryError);
    expectOneTickEach(first.path, 3);
    expect(acceptedAt(first.path, 3)).toBe(2); // the dead process's submissions never land
  });

  it("a failed world tick, redelivered in the same process, never submits the seats twice", async () => {
    const { path, world, backend, driver } = setup();
    world.requestStop("operator pause mid-delivery");
    await expect(driver.tick({ expectTick: 2 })).rejects.toThrow(/operator pause/);
    expect(backend.calls).toBe(2);
    world.clearStop();
    await driver.tick({ expectTick: 2 }); // the redelivery re-runs only the world tick
    expect(backend.calls).toBe(2);
    expectOneTickEach(path, 2);
    expect(acceptedAt(path, 2)).toBe(2);
  });

  it("CRASH after commit, before the scheduler saw it: the redelivery is refused, the next tick proceeds", async () => {
    const first = setup();
    await first.driver.tick({ expectTick: 2 }); // committed and persisted; the "ack" is lost
    const restarted = restartFrom(first.path);
    const backend = countingBackend();
    const driver = new SeatDriver(restarted, SEAT_IDS.map((seatId) => ({ seatId, backend })));
    await expect(driver.tick({ expectTick: 2 })).rejects.toThrow(/already committed/);
    expect(backend.calls).toBe(0);
    await driver.tick({ expectTick: 3 });
    expectOneTickEach(first.path, 3);
  });

  it("RECOVERY after partial failure: a torn tick is discarded, its redelivery lands once", async () => {
    const first = setup();
    await first.driver.tick({ expectTick: 2 });
    appendFileSync(first.path, '{"index":999,"tick":3,"type":"TICK_ST'); // crash mid-append of tick 3
    const restarted = restartFrom(first.path);
    expect(restarted.lastRecovery).not.toBeNull();
    expect(restarted.tickNumber).toBe(2);
    const driver = new SeatDriver(restarted, SEAT_IDS.map((seatId) => ({ seatId, backend: countingBackend() })));
    await driver.tick({ expectTick: 3 });
    await expect(driver.tick({ expectTick: 3 })).rejects.toThrow(TickDeliveryError);
    expectOneTickEach(first.path, 3);
    expect(restartFrom(first.path).headHash).toBe(restarted.headHash);
  });

  it("AT-01 untouched: ticks delivered with an identity journal exactly what plain ticks journal", async () => {
    const a = setup();
    const b = setup();
    for (let t = 2; t <= 5; t++) {
      await a.driver.tick({ expectTick: t });
      await b.driver.tick();
    }
    expect(a.world.headHash).toBe(b.world.headHash);
  });
});
