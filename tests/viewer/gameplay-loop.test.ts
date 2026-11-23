// The gameplay loop (viewer/residentView.ts + the relay contract): the
// owner composes real engine actions in the resident section, the box
// authenticates to the relay with the owner code held only in the
// page, and the outcomes the page reports come from the journal's own
// ACTION_ACCEPTED / ACTION_REJECTED entries — never from the relay's
// answer. The fixture is the founding rehearsal again, extended: at
// tick 10 cristian's gather is accepted and his move to a non-adjacent
// region is rejected by the real validator, in the real journal.

import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { World } from "../../engine/world/world.js";
import { ScriptedPolicyBackend, SeatDriver } from "../../seats/driver.js";
import {
  SCRIPTED_SURVIVAL_REF,
  SCRIPTED_SURVIVAL_V2_REF,
  survivalPolicyV2,
} from "../../runner/backends.js";
import { parseGenesisConfig, worldConfigFor } from "../../runner/config.js";
import { OWNER_ORDERS_REF, parseSeatOrdersFile, resolveOrdersForTick } from "../../runner/ownerOrders.js";
import { renderViewerHtml } from "../../viewer/render.js";
import { loadJournalForViewing, replayFrames } from "../../viewer/replay.js";
import {
  actionOrdersRequestBody,
  composeActionOrder,
  composerModelFromState,
  orderOutcomesFromJournal,
  renderResidentViewHtml,
  residentViewFromJournal,
  type OrderComposerModel,
  type OrderTickOutcome,
  type ResidentView,
} from "../../viewer/residentView.js";
import { tempDir } from "../helpers/worldFixtures.js";

let view: ResidentView;
let finalState: ReturnType<typeof replayFrames>[number]["state"];
let composer: OrderComposerModel | null;
let outcomes: OrderTickOutcome[];
let section: string;
let page: string;
let finalStateRules: number;

beforeAll(async () => {
  const dir = tempDir();
  const journalPath = join(dir, "journal.jsonl");
  const genesis = parseGenesisConfig({
    seed: 1,
    map: "juarez",
    worldClass: "persistent",
    seats: [
      { seatId: "nexus", actionsPerTick: 2, intel: 1, maxSatiety: 10, position: "centro", satiety: 8, backend: { providerId: "scripted-policy:survival", version: "v1" } },
      { seatId: "scout", actionsPerTick: 2, intel: 1, maxSatiety: 10, position: "industrial-east", satiety: 8, backend: { providerId: "scripted-policy:survival", version: "v2" } },
      { seatId: "hauler", actionsPerTick: 2, intel: 1, maxSatiety: 10, position: "zaragoza", satiety: 8, backend: { providerId: "scripted-policy:survival", version: "v2" } },
    ],
  });
  const world = World.create(1, worldConfigFor(genesis), { persistPath: journalPath });
  const driver = new SeatDriver(world, [
    { seatId: "nexus", backend: new ScriptedPolicyBackend(() => [], SCRIPTED_SURVIVAL_REF) },
    { seatId: "scout", backend: new ScriptedPolicyBackend(survivalPolicyV2, SCRIPTED_SURVIVAL_V2_REF) },
    { seatId: "hauler", backend: new ScriptedPolicyBackend(survivalPolicyV2, SCRIPTED_SURVIVAL_V2_REF) },
  ]);
  world.tick(); // prime
  for (let i = 0; i < 7; i++) await driver.tick(); // nexus dies at tick 8
  world.queueLineageFounding("lineage:nexus", OWNER_ORDERS_REF, "forgeclaw #235 comment 7090833287");
  world.tick(); // tick 9: founding
  world.submit("cristian", { verb: "gather", args: { node: "mercado-centro", amount: 4 } });
  world.submit("cristian", { verb: "move", args: { to: "industrial-east" } }); // not adjacent to centro
  world.tick(); // tick 10: gather accepted, move rejected (not_adjacent)
  world.close();

  const journal = loadJournalForViewing(journalPath);
  const frames = replayFrames(journal);
  finalState = frames[frames.length - 1].state;
  finalStateRules = finalState.rules.maxGatherPerAction;
  view = residentViewFromJournal(journal.entries(), finalState, "cristian");
  composer = composerModelFromState(finalState, "cristian", 11);
  outcomes = orderOutcomesFromJournal(journal.entries(), "cristian");
  section = renderResidentViewHtml(view, { nextTick: 11, composer, outcomes });
  page = renderViewerHtml(frames, {
    journalLabel: journalPath,
    journalEntries: journal.length,
    journalHeadHash: journal.headHash(),
  });
});

describe("the action composer composes entries the real orders pipeline consumes", () => {
  it("composeActionOrder produces the exact seat-orders entry shape", () => {
    const entry = composeActionOrder(
      [
        { verb: "gather", args: { node: "mercado-centro", amount: 4 } },
        { verb: "eat", args: { amount: 1 } },
      ],
      24,
    );
    expect(entry).toEqual({
      tick: 24,
      operator: "owner",
      orders: [
        { verb: "gather", args: { node: "mercado-centro", amount: 4 } },
        { verb: "eat", args: { amount: 1 } },
      ],
    });
    const parsed = parseSeatOrdersFile({ seat: "cristian", entries: [entry] });
    expect(parsed.entries[0].orders).toEqual(entry.orders);
    expect(actionOrdersRequestBody("cristian", entry.orders, 24)).toEqual({ seat: "cristian", entry });
  });

  it("an owner action entry governs over the operator's entry for the same tick", () => {
    const file = parseSeatOrdersFile({
      seat: "cristian",
      entries: [
        { tick: 24, operator: "muse", orders: [{ verb: "wait", args: {} }] },
        composeActionOrder([{ verb: "eat", args: { amount: 1 } }], 24),
      ],
    });
    const resolved = resolveOrdersForTick(file, 24);
    expect(resolved?.operator).toBe("owner");
    expect(resolved?.orders).toEqual([{ verb: "eat", args: { amount: 1 } }]);
  });
});

describe("the composer model offers only what the engine will entertain", () => {
  it("nodes are his region's, exits are one edge away, budget and caps are the world's own", () => {
    expect(composer).not.toBeNull();
    expect(composer?.nodesHere).toEqual([{ id: "mercado-centro", amount: 16 }]); // 20 − the tick-10 gather of 4
    expect(composer?.exits.map((e) => e.id)).toEqual(["anapra", "el-paso-downtown", "industrial-south", "pronaf"]);
    expect(composer?.actionsPerTick).toBe(2);
    expect(composer?.maxGatherPerAction).toBe(finalStateRules);
    expect(composer?.inventory).toBe(4);
  });

  it("a dead or unknown resident gets no composer", () => {
    expect(composerModelFromState(finalState, "nexus", 11)).toBeNull(); // nexus died at tick 8
    expect(composerModelFromState(finalState, "no-such-resident", 11)).toBeNull();
  });
});

describe("outcomes are the journal's verdicts, not the relay's", () => {
  it("tick 10 shows the accepted gather and the rejected move with the validator's reason", () => {
    const tick10 = outcomes.find((o) => o.tick === 10);
    expect(tick10).toBeDefined();
    expect(tick10?.accepted).toEqual([{ verb: "gather", args: { node: "mercado-centro", amount: 4 } }]);
    expect(tick10?.rejected).toEqual([{ verb: "move", args: { to: "industrial-east" }, reason: "not_adjacent" }]);
  });

  it("no outcome is invented for ticks where the engine journaled nothing for him", () => {
    expect(outcomes.every((o) => o.tick === 10)).toBe(true);
  });
});

describe("the rendered box: code field, composer, honest feedback states", () => {
  it("carries the family-code field as a password input and the composer controls", () => {
    expect(section).toContain('id="orders-code"');
    expect(section).toContain('type="password"');
    expect(section).toContain('id="action-verb"');
    expect(section).toContain('id="action-node"');
    expect(section).toContain("mercado-centro · stock 16");
    expect(section).toContain('id="action-exit"');
    expect(section).toContain('id="actions-send"');
    expect(section).toContain("Engine outcomes");
    expect(section).toContain("not_adjacent");
    expect(section).toContain("OBSERVED");
    expect(section).toContain("DERIVED");
  });

  it("sends the code as a bearer header and keeps every feedback state honest", () => {
    expect(section).toContain('"Authorization": "Bearer " + code');
    expect(section).toContain("Recorded for tick ");
    expect(section).toContain("Recorded is not accepted");
    expect(section).toContain("Already recorded");
    expect(section).toContain("the relay rejected the owner code (401)");
    expect(section).toContain("not configured for seat orders yet (503)");
    expect(section).toContain("FAILED — the order did not reach the relay");
    expect(section).toContain("Enter your owner code first");
  });

  it("never persists the code: no storage API appears anywhere in the section", () => {
    expect(section).not.toContain("localStorage");
    expect(section).not.toContain("sessionStorage");
    expect(section).not.toContain("document.cookie");
  });

  it("the full page wires the composer and outcomes into the resident section", () => {
    expect(page).toContain('id="orders-code"');
    expect(page).toContain('id="actions-send"');
    expect(page).toContain("Engine outcomes");
  });
});
