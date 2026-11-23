// The 2026-11-22 refounding (AA10 amendment, #235 comment 7090833287):
// a successor Núñez lineage is founded in a world whose lineage:nexus is
// extinct, its founding resident cristian takes the Tier-0 Throne seat at
// genesis norms, and the runner drives him from the orders file.
//
// Fixture worlds are built live-roster-shaped (Juárez, persistent): nexus
// is starved by an empty policy and dies at tick 8 — the same tick the
// real Nexus died in the live world — while scout and hauler run the
// survival policy. The live journal itself is replay-pinned separately
// at the bottom of this file (tests/fixtures, through tick 21).

import { copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Journal, type JournalEntry } from "../../ledger/journal.js";
import {
  buildLineageFoundingPayload,
  reduce,
  type WorldState,
} from "../../engine/world/state.js";
import { World } from "../../engine/world/world.js";
import { ScriptedPolicyBackend, SeatDriver } from "../../seats/driver.js";
import {
  SCRIPTED_SURVIVAL_REF,
  SCRIPTED_SURVIVAL_V2_REF,
  survivalPolicyV2,
} from "../../runner/backends.js";
import { parseGenesisConfig, worldConfigFor } from "../../runner/config.js";
import { OWNER_ORDERS_REF } from "../../runner/ownerOrders.js";
import { LaunchRunner } from "../../runner/runner.js";
import { replayFrames } from "../../viewer/replay.js";
import { tempDir } from "../helpers/worldFixtures.js";

const RULING = "forgeclaw #235 comment 7090833287 (owner ruling, 2026-11-22)";

function liveRosterGenesis() {
  return parseGenesisConfig({
    seed: 1,
    map: "juarez",
    worldClass: "persistent",
    seats: [
      { seatId: "nexus", actionsPerTick: 2, intel: 1, maxSatiety: 10, position: "centro", satiety: 8, backend: { providerId: "scripted-policy:survival", version: "v1" } },
      { seatId: "scout", actionsPerTick: 2, intel: 1, maxSatiety: 10, position: "industrial-east", satiety: 8, backend: { providerId: "scripted-policy:survival", version: "v2" } },
      { seatId: "hauler", actionsPerTick: 2, intel: 1, maxSatiety: 10, position: "zaragoza", satiety: 8, backend: { providerId: "scripted-policy:survival", version: "v2" } },
    ],
  });
}

/** A world at tick 8 whose nexus is dead and whose journal is on disk. */
async function starvedWorld(dir = tempDir()): Promise<string> {
  const journalPath = join(dir, "journal.jsonl");
  const world = World.create(1, worldConfigFor(liveRosterGenesis()), { persistPath: journalPath });
  const driver = new SeatDriver(world, [
    { seatId: "nexus", backend: new ScriptedPolicyBackend(() => [], SCRIPTED_SURVIVAL_REF) },
    { seatId: "scout", backend: new ScriptedPolicyBackend(survivalPolicyV2, SCRIPTED_SURVIVAL_V2_REF) },
    { seatId: "hauler", backend: new ScriptedPolicyBackend(survivalPolicyV2, SCRIPTED_SURVIVAL_V2_REF) },
  ]);
  world.tick(); // prime (tick 1): first observations delivered
  for (let i = 0; i < 7; i++) await driver.tick(); // ticks 2..8
  expect(world.tickNumber).toBe(8);
  expect(world.state.residents["nexus"].alive).toBe(false);
  expect(world.state.residents["nexus"].diedAtTick).toBe(8);
  expect(world.state.residents["scout"].alive).toBe(true);
  world.close();
  return journalPath;
}

function foundingEntry(payload: Record<string, unknown>): JournalEntry {
  return {
    index: 0,
    tick: 9,
    type: "LINEAGE_FOUNDED",
    actor: "owner-console",
    payload,
    prevHash: "x",
    hash: "y",
  } as JournalEntry;
}

describe("LINEAGE_FOUNDED — the refounding lands exactly as the amendment names it", () => {
  it("founds cristian at genesis norms, binds the Throne seat, and leaves the dead untouched", async () => {
    const journalPath = await starvedWorld();
    const world = World.restoreFromFile(journalPath);
    world.queueLineageFounding("lineage:nexus", OWNER_ORDERS_REF, RULING);
    world.tick(); // tick 9: the founding tick

    const entry = world.entries().find((e) => e.type === "LINEAGE_FOUNDED");
    expect(entry).toBeDefined();
    expect(entry?.tick).toBe(9);
    expect(entry?.actor).toBe("owner-console");
    expect(entry?.payload).toMatchObject({
      resident: "cristian",
      lineage: "lineage:nunez",
      supersedesLineage: "lineage:nexus",
      seat: "throne",
      tier: 0,
      position: "centro",
      satiety: 8,
      maxSatiety: 10,
      actionsPerTick: 2,
      intel: 1,
      inventory: 0,
      backend: { providerId: "owner-orders", version: "v1" },
      authority: "AA10",
    });

    const cristian = world.state.residents["cristian"];
    expect(cristian.alive).toBe(true);
    expect(cristian.position).toBe("centro");
    expect(cristian.lineage).toBe("lineage:nunez");
    expect(cristian.maxSatiety).toBe(10);
    // Founded at satiety 8 (the journaled norm); the founding tick's own
    // need decay then applies to him exactly as to every resident.
    expect(cristian.satiety).toBe(7);
    expect(cristian.inventory).toBe(0);
    expect(cristian.actionsPerTick).toBe(2);
    expect(cristian.intel).toBe(1);
    expect(cristian.bornTick).toBe(9);
    expect(cristian.backend).toEqual({ providerId: "owner-orders", version: "v1" });
    // He is observed in his founding tick, like any living resident.
    expect(
      world.entries().some((e) => e.type === "OBSERVATION_DELIVERED" && e.payload.seat === "cristian" && e.tick === 9),
    ).toBe(true);
    // The extinct lineage is not revived and its record is untouched.
    expect(world.state.residents["nexus"].alive).toBe(false);
    expect(world.state.residents["nexus"].diedAtTick).toBe(8);
    expect(world.state.residents["nexus"].lineage).toBe("lineage:nexus");
    world.close();

    // Replay from the journal alone reproduces the founded state.
    const restored = World.restore(Journal.loadFromFile(journalPath));
    expect(restored.state.residents["cristian"].lineage).toBe("lineage:nunez");
  });

  it("refuses a second founding, at queue time and at replay", async () => {
    const journalPath = await starvedWorld();
    const world = World.restoreFromFile(journalPath);
    world.queueLineageFounding("lineage:nexus", OWNER_ORDERS_REF, RULING);
    expect(() => world.queueLineageFounding("lineage:nexus", OWNER_ORDERS_REF, RULING)).toThrow(/already queued/);
    world.tick();
    expect(() => world.queueLineageFounding("lineage:nexus", OWNER_ORDERS_REF, RULING)).toThrow(/already exists/);
    const payload = buildLineageFoundingPayload("lineage:nexus", OWNER_ORDERS_REF, RULING);
    expect(() => reduce(world.state, foundingEntry({ ...payload }))).toThrow(/LINEAGE_FOUNDED invariant/);
    world.close();
  });

  it("refuses the founding while the superseded lineage still lives", async () => {
    const dir = tempDir();
    const world = World.create(1, worldConfigFor(liveRosterGenesis()), {
      persistPath: join(dir, "journal.jsonl"),
    });
    expect(() => world.queueLineageFounding("lineage:nexus", OWNER_ORDERS_REF, RULING)).toThrow(
      /LINEAGE_FOUNDED invariant/,
    );
    world.close();
  });

  it("the reducer rejects every deviation from the founding shape", async () => {
    const journalPath = await starvedWorld();
    const world = World.restoreFromFile(journalPath);
    const state: WorldState = world.state;
    const good = buildLineageFoundingPayload("lineage:nexus", OWNER_ORDERS_REF, RULING);
    // The exact shape is accepted.
    expect(reduce(state, foundingEntry({ ...good })).residents["cristian"].satiety).toBe(8);
    const deviations: Record<string, unknown>[] = [
      { ...good, position: "zaragoza" }, // wrong region
      { ...good, satiety: 9 }, // better-than-genesis norms
      { ...good, maxSatiety: 12 },
      { ...good, actionsPerTick: 3 },
      { ...good, intel: 2 },
      { ...good, inventory: 5 }, // a grant dressed as a founding
      { ...good, resident: "nexus" }, // resurrection under the old name
      { ...good, lineage: "lineage:scout" }, // founding for an existing lineage
      { ...good, supersedesLineage: "lineage:scout" }, // superseding a living lineage
      { ...good, supersedesLineage: "lineage:ghost" }, // superseding nothing
      { ...good, seat: "resident" }, // not the Throne
      { ...good, tier: 1 }, // not Tier 0
      { ...good, backend: { providerId: "", version: "v1" } },
      { ...good, authority: "AA9" }, // not the owner's constitutional authority
    ];
    for (const payload of deviations) {
      expect(() => reduce(state, foundingEntry(payload)), JSON.stringify(payload)).toThrow(
        /LINEAGE_FOUNDED invariant/,
      );
    }
    world.close();
  });
});

describe("the seat driver and the dead seat", () => {
  it("still refuses to drive the dead nexus seat, and drives cristian once founded", async () => {
    const journalPath = await starvedWorld();
    const world = World.restoreFromFile(journalPath);
    expect(
      () =>
        new SeatDriver(world, [
          { seatId: "nexus", backend: new ScriptedPolicyBackend(() => [], SCRIPTED_SURVIVAL_REF) },
        ]),
    ).toThrow(/dead/);
    world.queueLineageFounding("lineage:nexus", OWNER_ORDERS_REF, RULING);
    world.tick();
    const driver = new SeatDriver(world, [
      { seatId: "cristian", backend: new ScriptedPolicyBackend(() => [], OWNER_ORDERS_REF) },
    ]);
    await driver.tick();
    // Binding the already-bound orders backend is a no-op: no rebind entry.
    expect(world.entries().some((e) => e.type === "SEAT_BACKEND_BOUND" && e.payload.seat === "cristian")).toBe(false);
    world.close();
  });
});

describe("the seating session — runner with foundLineage and the orders file", () => {
  it("founds him at the first tick and drives him from the operator's orders", async () => {
    const dir = tempDir();
    const journalPath = await starvedWorld(dir);
    writeFileSync(
      join(dir, "seat-orders.json"),
      JSON.stringify({
        seat: "cristian",
        entries: [
          // Gather first: an eat is validated against the inventory held
          // at validation time, so food gathered this tick can only be
          // eaten from the next tick on (validator + step order).
          { tick: 10, operator: "muse", orders: [{ verb: "gather", args: { node: "mercado-centro", amount: 4 } }] },
          {
            tick: 11,
            operator: "muse",
            orders: [
              { verb: "eat", args: { amount: 3 } },
              { verb: "gather", args: { node: "mercado-centro", amount: 4 } },
            ],
          },
        ],
      }),
      "utf8",
    );
    const lines: string[] = [];
    const runner = new LaunchRunner({ dataDir: dir, foundLineage: true, log: (l) => lines.push(l) });
    await runner.start();
    expect(lines.some((l) => l.includes("founding-queued resident=cristian"))).toBe(true);
    await runner.tickOnce(); // tick 9: founding lands
    await runner.tickOnce(); // tick 10: gather
    await runner.tickOnce(); // tick 11: eat + gather
    await runner.stop();

    const journal = Journal.loadFromFile(journalPath);
    const founding = journal.entries().find((e) => e.type === "LINEAGE_FOUNDED");
    expect(founding?.tick).toBe(9);
    const accepted = journal
      .entries()
      .filter((e) => e.type === "ACTION_ACCEPTED" && e.payload.seat === "cristian");
    expect(accepted.map((e) => e.tick)).toEqual([10, 11, 11]);
    for (const e of accepted) {
      expect(e.payload.backend).toEqual({ providerId: "owner-orders", version: "v1" });
      expect(e.payload.inputReferences).toContain("orders:operator:muse");
    }
    expect(accepted[0].payload.inputReferences).toContain("orders:tick:10");
    const granted = journal
      .entries()
      .filter((e) => e.type === "GATHER_GRANTED" && e.payload.resident === "cristian");
    expect(granted.map((e) => e.payload.granted)).toEqual([4, 4]);
    const restored = World.restore(journal);
    const cristian = restored.state.residents["cristian"];
    expect(cristian.alive).toBe(true);
    expect(cristian.satiety).toBe(8); // 8 founded, decays and the tick-10 eat applied
    expect(cristian.inventory).toBe(5); // gathered 4 + 4, ate 3
    expect(cristian.position).toBe("centro");
  });

  it("an ordinary session (no foundLineage) never founds anything", async () => {
    const dir = tempDir();
    const journalPath = await starvedWorld(dir);
    const runner = new LaunchRunner({ dataDir: dir, log: () => {} });
    await runner.start();
    await runner.tickOnce();
    await runner.stop();
    const journal = Journal.loadFromFile(journalPath);
    expect(journal.entries().some((e) => e.type === "LINEAGE_FOUNDED")).toBe(false);
    expect(World.restore(journal).state.residents["cristian"]).toBeUndefined();
  });

  it("a second seating session finds him already founded and changes nothing", async () => {
    const dir = tempDir();
    const journalPath = await starvedWorld(dir);
    const first = new LaunchRunner({ dataDir: dir, foundLineage: true, log: () => {} });
    await first.start();
    await first.tickOnce();
    await first.stop();
    const lines: string[] = [];
    const second = new LaunchRunner({ dataDir: dir, foundLineage: true, log: (l) => lines.push(l) });
    await second.start();
    expect(lines.some((l) => l.includes("founding-skipped"))).toBe(true);
    await second.tickOnce();
    await second.stop();
    const journal = Journal.loadFromFile(journalPath);
    expect(journal.entries().filter((e) => e.type === "LINEAGE_FOUNDED").length).toBe(1);
  });
});

describe("replay invariant — the live journal through tick 21", () => {
  // The actual live world's journal, copied from the live-world branch at
  // head c2631a3d… (220 entries, ticks 0..21). The journaled TICK_COMMIT
  // hashes were produced by the pre-founding engine; replayFrames throws
  // if the new reducer replays any of them differently, so a green run
  // here is the byte-identity proof for pre-founding history.
  const LIVE_JOURNAL = join(process.cwd(), "tests", "fixtures", "live-journal-through-tick-21.jsonl");

  it("replays byte-identically under the new engine, head and hashes unchanged", () => {
    const journal = Journal.loadFromFile(LIVE_JOURNAL);
    expect(journal.length).toBe(220);
    expect(journal.headHash()).toBe("c2631a3d88120d341c67a77467a7e67637da0bd8fa7f2e2f16078bd5bbbbb542");
    const frames = replayFrames(journal);
    expect(frames.length).toBe(22);
    const last = frames[frames.length - 1];
    expect(last.tick).toBe(21);
    expect(last.stateHash).toBe("a9ee9b5331e6a84342d101e7e3dd01856b56099717263b73779ddb97541f8623");
    for (const frame of frames) expect(frame.stateHash).toBe(frame.journaledStateHash);
    const restored = World.restore(journal);
    expect(restored.state.residents["nexus"].alive).toBe(false);
    expect(restored.state.residents["cristian"]).toBeUndefined();
  });

  it("the live journal founds cleanly when the amendment is applied to it", () => {
    // A scratch copy of the live journal: the founding the seating
    // session will land, rehearsed against real history.
    const dir = tempDir();
    const copy = join(dir, "journal.jsonl");
    copyFileSync(LIVE_JOURNAL, copy);
    const world = World.restoreFromFile(copy);
    world.queueLineageFounding("lineage:nexus", OWNER_ORDERS_REF, RULING);
    world.tick(); // tick 22
    const cristian = world.state.residents["cristian"];
    expect(cristian.alive).toBe(true);
    expect(cristian.position).toBe("centro");
    expect(cristian.lineage).toBe("lineage:nunez");
    expect(world.state.residents["scout"].alive).toBe(true);
    world.close();
    // And the extended journal still restores from its own record.
    const restored = World.restore(Journal.loadFromFile(copy));
    expect(restored.state.residents["cristian"].alive).toBe(true);
  });
});
