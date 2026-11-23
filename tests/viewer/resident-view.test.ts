// The resident's view (viewer/residentView.ts): cristian's playable
// window onto the world — his own state and his latest delivered
// observation, nothing beyond his observation model — plus the owner's
// orders chat box and the exact orders-file entry it composes.
//
// The fixture world is the founding rehearsal: live-roster-shaped
// Juárez, nexus starved dead at tick 8, the refounding landed at tick 9,
// then two hand-submitted ticks so the journal holds entries concerning
// cristian (an accepted gather among them).

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { regionsWithin } from "../../engine/world/map.js";
import { juarezMap } from "../../engine/world/maps/juarez.js";
import { World } from "../../engine/world/world.js";
import { Journal } from "../../ledger/journal.js";
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
  composeOwnerOrder,
  ORDERS_ENDPOINT,
  ordersRequestBody,
  renderResidentViewHtml,
  RESIDENT_LABEL,
  residentViewFromJournal,
  type ResidentView,
} from "../../viewer/residentView.js";
import { tempDir } from "../helpers/worldFixtures.js";

let journalPath: string;
let view: ResidentView;
let html: string;

beforeAll(async () => {
  const dir = tempDir();
  journalPath = join(dir, "journal.jsonl");
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
  world.tick(); // tick 10: the gather lands
  world.close();

  const journal = loadJournalForViewing(journalPath);
  const frames = replayFrames(journal);
  view = residentViewFromJournal(journal.entries(), frames[frames.length - 1].state, "cristian");
  html = renderViewerHtml(frames, {
    journalLabel: journalPath,
    journalEntries: journal.length,
    journalHeadHash: journal.headHash(),
  });
});

describe("the resident's view is scoped to what the resident may perceive", () => {
  it("shows the founding, his lineage, and his own state", () => {
    expect(view.founded).toBe(true);
    expect(view.foundingTick).toBe(9);
    expect(view.lineage).toBe("lineage:nunez");
    expect(view.alive).toBe(true);
    expect(view.position).toBe("centro");
    expect(view.positionName).toBe("Centro Histórico");
    expect(view.inventory).toBe(4); // the tick-10 gather landed
  });

  it("his observation covers exactly the regions within his intel of centro — no more", () => {
    expect(view.observation).not.toBeNull();
    const seen = view.observation?.regions.map((r) => r.region) ?? [];
    expect(seen).toEqual(regionsWithin(juarezMap(), "centro", 1));
    expect(seen).not.toContain("industrial-east"); // two hops: outside his perception
    expect(seen).not.toContain("zaragoza");
    const centro = view.observation?.regions.find((r) => r.region === "centro");
    expect(centro?.nodes["mercado-centro"]).toBeGreaterThan(0);
  });

  it("the journal notes are only the entries that concern him", () => {
    const types = view.recent.map((n) => n.type);
    expect(types).toContain("LINEAGE_FOUNDED");
    expect(types).toContain("GATHER_GRANTED");
    expect(types).toContain("OBSERVATION_DELIVERED");
    for (const note of view.recent) {
      expect(["cristian", "owner-console", "engine"]).toContain(note.actor);
    }
  });

  it("before the founding there is no resident's view to show", () => {
    const dir = tempDir();
    const path = join(dir, "journal.jsonl");
    const genesis = parseGenesisConfig({
      seed: 1,
      map: "juarez",
      worldClass: "persistent",
      seats: [
        { seatId: "scout", actionsPerTick: 2, intel: 1, maxSatiety: 10, position: "industrial-east", satiety: 8, backend: { providerId: "scripted-policy:survival", version: "v2" } },
      ],
    });
    const world = World.create(1, worldConfigFor(genesis), { persistPath: path });
    world.tick();
    world.close();
    const journal = Journal.loadFromFile(path);
    const frames = replayFrames(journal);
    const unseated = residentViewFromJournal(journal.entries(), frames[frames.length - 1].state, "cristian");
    expect(unseated.founded).toBe(false);
    expect(renderResidentViewHtml(unseated, { nextTick: 2 })).toContain("Not yet seated");
  });
});

describe("the rendered page carries the resident section, labelled, beside the auditor's surface", () => {
  it("renders his view, his label, and nothing of the far side of his perception", () => {
    expect(html).toContain('id="resident-view"');
    expect(html).toContain(RESIDENT_LABEL);
    // His section is the resident-view element itself. (It used to be
    // the last thing on the page, so a slice to end-of-page was the
    // section; the section now lives inside the Game surface with the
    // World and Auditor surfaces after it, so the slice is bounded by
    // the section's own close tag — the assertion is unchanged: nothing
    // beyond his perception appears in HIS section.)
    const start = html.indexOf('id="resident-view"');
    const section = html.slice(start, html.indexOf("</section>", start));
    expect(section).toContain("Centro Histórico");
    expect(section).toContain("lineage:nunez");
    // industrial-east is outside his observation: its node and its
    // resident's business do not appear in HIS section of the page.
    expect(section).not.toContain("maquila-commissary");
    expect(section).not.toContain("industrial-east");
  });
});

describe("the orders chat box", () => {
  it("composes an owner order in the exact orders-file entry shape", () => {
    const entry = composeOwnerOrder("Gather at the market, then eat.", 24);
    expect(entry).toEqual({
      tick: 24,
      operator: "owner",
      directive: "Gather at the market, then eat.",
      orders: [],
    });
    // The real orders-file parser accepts the composed entry as-is.
    const parsed = parseSeatOrdersFile({ seat: "cristian", entries: [entry] });
    expect(parsed.entries[0].operator).toBe("owner");
    expect(parsed.entries[0].directive).toBe("Gather at the market, then eat.");
  });

  it("the composed owner entry overrides the operator's orders where orders are consumed", () => {
    const file = parseSeatOrdersFile({
      seat: "cristian",
      entries: [
        { tick: 24, operator: "muse", orders: [{ verb: "gather", args: { node: "mercado-centro", amount: 4 } }] },
        composeOwnerOrder("Stay in centro and eat first.", 24),
      ],
    });
    const resolved = resolveOrdersForTick(file, 24);
    expect(resolved?.operator).toBe("owner");
    expect(resolved?.orders).toEqual([]);
    expect(resolved?.directive).toBe("Stay in centro and eat first.");
  });

  it("the request body is the seat plus the composed entry", () => {
    expect(ordersRequestBody("cristian", "Hold position.", 24)).toEqual({
      seat: "cristian",
      entry: { tick: 24, operator: "owner", directive: "Hold position.", orders: [] },
    });
  });

  it("the box posts to the named relay endpoint and fails visibly, never silently", () => {
    const section = html.slice(html.indexOf('id="resident-view"'));
    expect(section).toContain('id="orders-text"');
    expect(section).toContain('id="orders-send"');
    expect(section).toContain(`const ORDERS_ENDPOINT = ${JSON.stringify(ORDERS_ENDPOINT)}`);
    expect(section).toContain('ORDERS_ENDPOINT + "/seat-orders"');
    expect(section).toContain('method: "POST"');
    // Legible failure: the failure path says the order was NOT recorded
    // and keeps the composed entry on screen for copy-paste.
    expect(section).toContain("FAILED — the order did not reach the relay");
    expect(section).toContain("It has NOT been recorded");
    expect(section).toContain('id="orders-composed"');
  });
});
