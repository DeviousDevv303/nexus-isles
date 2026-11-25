// Game view — the Resident Game and World Intelligence surfaces.
//
// The viewer renders three surfaces from the same replayed frames: the
// Resident Game (the seat's hero, surroundings, perception), the World
// Intelligence map (schematic, from the journaled map's own data), and
// the Auditor surface. Acceptance pinned here:
//  - the schematic layout covers every region of the Juárez map, and
//    every bridge / river crossing joins anchors on opposite banks of
//    the river band (positions derive from side + edges, not geography);
//  - the per-frame game model carries the committed state exactly as
//    replayed — checked against the live journal fixture (through tick
//    21): scout alive in industrial-east, nexus and hauler dead since
//    tick 8 at their last regions, node stock as committed;
//  - the rendered page carries all three surfaces with the Game surface
//    as the default, the auditor label intact, and the seat's per-frame
//    perception (latest delivered observation at or before each tick).

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { juarezMap } from "../../engine/world/maps/juarez.js";
import { AUDITOR_LABEL, renderViewerHtml } from "../../viewer/render.js";
import { loadJournalForViewing, replayFrames } from "../../viewer/replay.js";
import { gameModelForFrame, layoutForMap } from "../../viewer/gameView.js";
import { latestSeatObservationAt, seatJournalNotesAt } from "../../viewer/residentView.js";

const ROOT = join(import.meta.dirname, "..", "..");
const LIVE_FIXTURE = join(ROOT, "tests", "fixtures", "live-journal-through-tick-21.jsonl");

describe("schematic layout", () => {
  const map = juarezMap();
  const layout = layoutForMap(map);

  it("positions every region of the map, inside the canvas", () => {
    expect(Object.keys(layout.positions).sort()).toEqual(map.regions.map((r) => r.id).sort());
    for (const p of Object.values(layout.positions)) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(layout.width);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(layout.height);
    }
  });

  it("puts each bank on its own side of the river band", () => {
    for (const region of map.regions) {
      const p = layout.positions[region.id];
      if (region.side === "el-paso") expect(p.y).toBeLessThan(layout.riverTop);
      else expect(p.y).toBeGreaterThan(layout.riverBottom);
    }
  });

  it("every bridge and the river crossing straddle the river band", () => {
    const crossings = map.edges.filter((e) => e.kind === "bridge" || e.kind === "river-crossing");
    expect(crossings).toHaveLength(4); // 3 bridges + the Rio Grande crossing
    for (const e of crossings) {
      const ys = [layout.positions[e.a].y, layout.positions[e.b].y].sort((a, b) => a - b);
      expect(ys[0]).toBeLessThan(layout.riverTop);
      expect(ys[1]).toBeGreaterThan(layout.riverBottom);
    }
  });

  it("no two region anchors overlap", () => {
    const pts = Object.values(layout.positions);
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = Math.abs(pts[i].x - pts[j].x);
        const dy = Math.abs(pts[i].y - pts[j].y);
        expect(dx > 100 || dy > 60, `anchors ${i} and ${j} too close`).toBe(true);
      }
    }
  });
});

describe("game model over the live journal fixture", () => {
  const journal = loadJournalForViewing(LIVE_FIXTURE);
  const frames = replayFrames(journal);
  const last = frames[frames.length - 1];
  const model = gameModelForFrame(last.state.map ?? juarezMap(), last.state.nodes, last.state.residents);

  it("ends at tick 21 with scout alive and nexus/hauler dead since tick 8", () => {
    expect(last.tick).toBe(21);
    const byId = new Map(model.residents.map((r) => [r.id, r]));
    expect(byId.get("scout")).toMatchObject({ alive: true, region: "industrial-east", satiety: 5, inventory: 10 });
    expect(byId.get("nexus")).toMatchObject({ alive: false, region: "centro", diedAtTick: 8 });
    expect(byId.get("hauler")).toMatchObject({ alive: false, region: "zaragoza", diedAtTick: 8 });
  });

  it("carries node stock as committed, each node on its region", () => {
    const byId = new Map(model.nodes.map((n) => [n.id, n]));
    expect(byId.get("mercado-centro")).toMatchObject({ region: "centro", amount: 20, capacity: 20 });
    expect(byId.get("maquila-commissary")).toMatchObject({ region: "industrial-east", amount: 23, capacity: 25 });
    expect(byId.get("el-paso-depot")).toMatchObject({ region: "el-paso-downtown", amount: 30, capacity: 30 });
    expect(model.nodes).toHaveLength(6);
  });

  it("the seat (cristian) has no observation in this journal — he is not seated yet", () => {
    expect(latestSeatObservationAt(journal.entries(), "cristian", 21)).toBeNull();
    const scoutObs = latestSeatObservationAt(journal.entries(), "scout", 21);
    expect(scoutObs).not.toBeNull();
    expect(scoutObs?.tick).toBeLessThanOrEqual(21);
  });

  it("per-tick seat journal notes: newest first, capped, and empty for the unseated seat", () => {
    const notes = seatJournalNotesAt(journal.entries(), "scout", 21, 5);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < notes.length; i++) expect(notes[i].tick).toBeLessThanOrEqual(notes[i - 1].tick);
    for (const n of notes) expect(n.tick).toBeLessThanOrEqual(21);
    const early = seatJournalNotesAt(journal.entries(), "scout", 2, 5);
    for (const n of early) expect(n.tick).toBeLessThanOrEqual(2);
    expect(seatJournalNotesAt(journal.entries(), "cristian", 21, 5)).toEqual([]);
  });
});

describe("rendered page: three surfaces", () => {
  const journal = loadJournalForViewing(LIVE_FIXTURE);
  const frames = replayFrames(journal);
  const html = renderViewerHtml(frames, {
    journalLabel: LIVE_FIXTURE,
    journalEntries: journal.length,
    journalHeadHash: journal.headHash(),
    verification: null,
  });

  it("carries the tab bar with Game as the default surface", () => {
    expect(html).toContain('data-surface="game"');
    expect(html).toContain('data-surface="world"');
    expect(html).toContain('data-surface="auditor"');
    expect(html).toContain('id="surface-game"');
    expect(html).toContain('id="surface-world"');
    expect(html).toContain('id="surface-auditor"');
    // Game is the landing surface: it is the one not hidden.
    expect(html).toMatch(/id="surface-game" class="surface" aria-label="Resident game">/);
    expect(html).toMatch(/id="surface-world" class="surface" aria-label="World intelligence" hidden>/);
    expect(html).toMatch(/id="surface-auditor" class="surface" aria-label="Auditor" hidden>/);
  });

  it("keeps the auditor surface intact: label, evidence legend, verification", () => {
    expect(html).toContain(AUDITOR_LABEL);
    expect(html).toContain('id="evidence-legend"');
    expect(html).toContain('id="verification"');
    expect(html).toContain('id="juarez"');
    expect(html).toContain('id="residents"');
  });

  it("embeds the game model: layout, marks, and the seat identity", () => {
    expect(html).toContain('"gameSeat":"cristian"');
    expect(html).toContain('"seatBornTick":null'); // not seated in this journal
    expect(html).toContain('"riverTop":292');
    expect(html).toContain("renderGame");
    expect(html).toContain("renderWorld");
    expect(html).toContain('id="world-map"');
    expect(html).toContain('id="game-hero"');
  });

  it("carries the happening-vs-observed machinery: mode banner, LIVE/REPLAY, return to present", () => {
    expect(html).toContain('id="mode-banner"');
    expect(html).toContain("renderMode");
    expect(html).toContain("LIVE — tick ");
    expect(html).toContain("REPLAY — you are observing history at tick ");
    expect(html).toContain("Return to the present");
  });

  it("classifies state-bearing graphics in the §5 vocabulary: DERIVED live, STALE in replay, NOT OBSERVED for an undelivered perception", () => {
    // The mode banner classifies every frame the page can show.
    expect(html).toContain("DERIVED · committed journal state");
    expect(html).toContain("STALE · replayed history — not the present");
    // The World surface's whole-world graphics are DERIVED, never a resident's knowledge.
    expect(html).toContain("Classification: DERIVED · whole-world committed state");
    // The scene classifies its own projected frame, live or historical.
    expect(html).toContain("Classification: DERIVED · committed state.");
    expect(html).toContain("Classification: STALE · this frame is history, not the present.");
    // An undelivered perception is labeled, never silently absent.
    expect(html).toContain("NOT OBSERVED — no observation had been delivered");
    expect(html).toContain("NOT OBSERVED — no perception: nothing had been delivered");
  });

  it("carries the region scene and the Núñez identity portrait", () => {
    expect(html).toContain('id="game-scene"');
    expect(html).toContain('id="game-events"');
    expect(html).toContain("renderScene");
    expect(html).toContain("drawThronePortrait");
    expect(html).toContain("spiderInsignia");
    expect(html).toContain("Holographic operational display");
  });

  it("embeds per-frame seat events (empty here — the seat is not in this journal)", () => {
    const m = html.match(/<script type="application\/json" id="viewer-data">([\s\S]*?)<\/script>/);
    expect(m).not.toBeNull();
    const data = JSON.parse((m as RegExpMatchArray)[1].replace(/\\u003c/g, "<")) as {
      frames: Array<{ tick: number; seatEvents: unknown[]; game: { residents: unknown[] } }>;
    };
    const lastFrame = data.frames[data.frames.length - 1];
    expect(lastFrame.tick).toBe(21);
    expect(lastFrame.seatEvents).toEqual([]);
    expect(lastFrame.game.residents).toHaveLength(3);
  });

  it("the page's browser script keeps its quoted strings valid (regression: a bare quote inside a double-quoted JS string killed the whole script)", () => {
    // The wording carries double quotes, so the emitted JS string must
    // be single-quoted: with a double-quoted string the inner quotes
    // end the string, the script block fails to parse, and NO surface
    // renders in the browser. The displayed wording is unchanged.
    expect(html).toContain("el(\"div\", 'Zero OBSERVED");
    expect(html).not.toContain("el(\"div\", \"Zero OBSERVED");
    expect(html).toContain('(This is "no activity," not "evidence missing"');
  });
});
