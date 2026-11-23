// Survival policy v2 — regression tests for the first live session's hauler
// death (#235 comment 7089299881). hauler stood in zaragoza with intel 1; the
// v1 policy named a node in a NEIGHBOURING region on every tick, the
// validator refused all 7 attempts as not_in_region, and it starved on tick 8.
//
// These tests pin both sides: the v1 defect is reproduced exactly (v1 is
// history — its version is journaled on every action it took — so it is
// kept, not rewritten), and v2 never proposes anything the validator would
// refuse for being out of reach. The dead stay dead: nothing here touches a
// live journal; every world below is a fresh temp world.

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Journal } from "../../ledger/journal.js";
import { juarezMap, juarezNodes } from "../../engine/world/maps/juarez.js";
import { neighbours, regionsWithin } from "../../engine/world/map.js";
import type { Observation } from "../../seats/seatProvider.js";
import {
  createBackend,
  SCRIPTED_SURVIVAL_REF,
  SCRIPTED_SURVIVAL_V2_REF,
  survivalPolicy,
  survivalPolicyV2,
} from "../../runner/backends.js";
import { parseGenesisConfig, type GenesisConfig } from "../../runner/config.js";
import { LaunchRunner } from "../../runner/runner.js";
import { tempDir } from "../helpers/worldFixtures.js";

/** The observation the engine builds for a map world (world.ts: self + position + intel + regions). */
function observationAt(position: string, opts: { satiety?: number; inventory?: number; intel?: number; stock?: Record<string, number> } = {}): Observation {
  const map = juarezMap();
  const intel = opts.intel ?? 1;
  const regions: Record<string, { residents: string[]; nodes: Record<string, number> }> = {};
  for (const reg of regionsWithin(map, position, intel)) {
    const nodes: Record<string, number> = {};
    for (const n of juarezNodes()) if (n.region === reg) nodes[n.id] = opts.stock?.[n.id] ?? n.amount;
    regions[reg] = { residents: [], nodes };
  }
  return {
    tick: 1,
    visible: { satiety: opts.satiety ?? 8, maxSatiety: 10, inventory: opts.inventory ?? 0, position, intel, regions },
  } as unknown as Observation;
}

const nodeRegion = (node: string) => juarezNodes().find((n) => n.id === node)?.region;

describe("the hauler failure shape, reproduced", () => {
  it("v1 from zaragoza names industrial-east's node — the validator's not_in_region on every tick", () => {
    const [action] = survivalPolicy({ observation: observationAt("zaragoza") });
    expect(action).toEqual({ verb: "gather", args: { node: "maquila-commissary", amount: 2 } });
    expect(nodeRegion("maquila-commissary")).toBe("industrial-east");
  });

  it("v2 from zaragoza gathers zaragoza's own market", () => {
    expect(survivalPolicyV2({ observation: observationAt("zaragoza") })).toEqual([
      { verb: "gather", args: { node: "zaragoza-market", amount: 2 } },
    ]);
  });
});

describe("v2 never proposes an action out of reach", () => {
  const regions = juarezMap().regions.map((r) => r.id);
  const cases: Array<{ satiety: number; inventory: number; intel: number; bare: boolean }> = [];
  for (const satiety of [1, 4, 5, 9]) for (const inventory of [0, 2]) for (const intel of [1, 2]) for (const bare of [false, true]) cases.push({ satiety, inventory, intel, bare });

  it.each(regions)("from %s, across hunger, inventory, intel and empty-region cases", (position) => {
    for (const c of cases) {
      const stock = c.bare ? Object.fromEntries(juarezNodes().filter((n) => n.region === position).map((n) => [n.id, 0])) : undefined;
      for (const action of survivalPolicyV2({ observation: observationAt(position, { ...c, stock }) })) {
        if (action.verb === "gather") expect(nodeRegion(action.args.node as string), JSON.stringify({ position, c })).toBe(position)
        if (action.verb === "move") expect(neighbours(juarezMap(), position)).toContain(action.args.to)
        if (action.verb === "eat") expect(c.inventory).toBeGreaterThan(0)
        expect(["gather", "eat", "move", "wait"]).toContain(action.verb)
      }
    }
  });
});

describe("v2 eats and moves sensibly", () => {
  it("eats when carrying food and satiety has fallen, never more than fits", () => {
    expect(survivalPolicyV2({ observation: observationAt("zaragoza", { satiety: 4, inventory: 5 }) })).toEqual([{ verb: "eat", args: { amount: 3 } }]);
    const tight = { ...observationAt("zaragoza", { satiety: 4, inventory: 5 }) } as Observation;
    (tight.visible as Record<string, unknown>).maxSatiety = 5;
    expect(survivalPolicyV2({ observation: tight })).toEqual([{ verb: "eat", args: { amount: 1 } }]);
  });

  it("eats what it carries when its own region is bare", () => {
    const stock = { "zaragoza-market": 0 };
    expect(survivalPolicyV2({ observation: observationAt("zaragoza", { satiety: 8, inventory: 2, stock }) })).toEqual([{ verb: "eat", args: { amount: 2 } }]);
  });

  it("moves to a stocked neighbour only when every visible region is a neighbour (intel 1)", () => {
    const stock = { "zaragoza-market": 0 };
    expect(survivalPolicyV2({ observation: observationAt("zaragoza", { stock }) })).toEqual([{ verb: "move", args: { to: "industrial-east" } }]);
    // intel 2 shows regions two hops out; v2 cannot tell them from neighbours, so it does not guess.
    expect(survivalPolicyV2({ observation: observationAt("zaragoza", { stock, intel: 2 }) })).toEqual([{ verb: "wait", args: {} }]);
  });
});

describe("registration: v1 stays as journaled, v2 is its own version", () => {
  const seat = (version: string) => ({
    seatId: "hauler",
    backend: { providerId: SCRIPTED_SURVIVAL_REF.providerId, version },
    position: "zaragoza",
    satiety: 8,
    maxSatiety: 10,
    actionsPerTick: 2,
    intel: 1,
  });

  it("each version is constructible and labelled truthfully", () => {
    expect(createBackend(seat("v1")).ref).toEqual(SCRIPTED_SURVIVAL_REF);
    expect(createBackend(seat("v2")).ref).toEqual(SCRIPTED_SURVIVAL_V2_REF);
  });

  it("an unknown version is refused, not served by some other policy", () => {
    expect(() => createBackend(seat("v3"))).toThrow(/no scripted-policy:survival version "v3"/);
  });
});

/** The first live session's scripted roster and starting values (runner/genesis.live.example.json), Nexus seat omitted. */
function sessionOneScripted(haulerVersion: string): GenesisConfig {
  return parseGenesisConfig({
    seed: 1,
    map: "juarez",
    worldClass: "persistent",
    seats: [
      { seatId: "scout", actionsPerTick: 2, intel: 1, maxSatiety: 10, position: "industrial-east", satiety: 8, backend: { providerId: "scripted-policy:survival", version: "v1" } },
      { seatId: "hauler", actionsPerTick: 2, intel: 1, maxSatiety: 10, position: "zaragoza", satiety: 8, backend: { providerId: "scripted-policy:survival", version: haulerVersion } },
    ],
  });
}

async function run(genesis: GenesisConfig, ticks: number) {
  const dir = tempDir();
  const runner = new LaunchRunner({ dataDir: dir, genesis, log: () => {} });
  await runner.start();
  for (let i = 0; i < ticks; i++) await runner.tickOnce();
  await runner.stop();
  const journal = Journal.loadFromFile(join(dir, "journal.jsonl"));
  expect(journal.verify().ok).toBe(true);
  const entries = journal.entries() as unknown as Array<{ type: string; tick: number; actor?: string; payload: Record<string, unknown> }>;
  const of = (seat: string, type: string) => entries.filter((e) => e.type === type && (e.actor === seat || e.payload.resident === seat || e.payload.seat === seat));
  return { entries, of };
}

describe("a fresh world with the session-one roster", () => {
  it("v1 hauler reproduces the live outcome: only not_in_region rejections, then starvation", async () => {
    const { of } = await run(sessionOneScripted("v1"), 10);
    const rejected = of("hauler", "ACTION_REJECTED");
    // The live journal's numbers: 7 rejected gathers, all not_in_region, none accepted, death on tick 8.
    expect(rejected).toHaveLength(7);
    expect(rejected.every((e) => e.payload.reason === "not_in_region")).toBe(true);
    expect(of("hauler", "ACTION_ACCEPTED")).toHaveLength(0);
    expect(of("hauler", "DEATH").map((e) => e.tick)).toEqual([8]);
  });

  it("v2 hauler gathers, eats and is alive well past tick 8, with no out-of-reach proposal", async () => {
    const { of } = await run(sessionOneScripted("v2"), 20);
    expect(of("hauler", "DEATH")).toHaveLength(0);
    expect(of("hauler", "ACTION_REJECTED").filter((e) => e.payload.reason === "not_in_region" || e.payload.reason === "not_adjacent")).toHaveLength(0);
    expect(of("hauler", "GATHER_GRANTED").length).toBeGreaterThan(0);
    expect(of("hauler", "EAT_APPLIED").length).toBeGreaterThan(0);
  });
});
