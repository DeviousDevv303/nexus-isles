// World viewer — the read-only auditor's surface over a journal.
//
// Fixture: no seed-424242 maneuver-benchmark journal ships in the repo,
// so the fixture journal is generated deterministically in setup — a
// scratch world on the runner's own genesis example (seed 424242,
// Juárez, the two scripted test-double seats), primed and driven
// through the real SeatDriver, exactly as the launch runner drives it.
//
// Acceptance pinned here:
//  - state at three ticks differs on concrete fields;
//  - the viewer's replayed hash at the final tick equals the engine's
//    hashState for that tick (and the hash journaled in TICK_COMMIT);
//  - the rendered page carries the auditor-surface label;
//  - viewer sources import only the read/replay surfaces on an explicit
//    allowlist — no World, no seat driver, no write path of any kind.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { hashState } from "../../engine/world/state.js";
import { World } from "../../engine/world/world.js";
import { ScriptedPolicyBackend, SeatDriver } from "../../seats/driver.js";
import { survivalPolicy } from "../../runner/backends.js";
import { parseGenesisConfig, worldConfigFor } from "../../runner/config.js";
import { AUDITOR_LABEL, renderViewerHtml, TWO_REGISTERS_SENTENCE } from "../../viewer/render.js";
import { loadJournalForViewing, replayFrames, type TickFrame } from "../../viewer/replay.js";
import { tempDir } from "../helpers/worldFixtures.js";

const ROOT = join(import.meta.dirname, "..", "..");
const AUDITED_JOURNAL_HEAD = "467dd2e69d0564f372c7cf7b8c3957b3b4dd7221474b4a929e7708d8a3b2099c";
const AUDITED_STATE_HASHES = [
  "21aff89ae91081bd41567bb53481b34311d7950fc9eda5a0aa3e2fcbf2bc1eb1",
  "3209ff212c231ba57a793de820b8061026417854f5ad0508749261c1cea3bb08",
  "4fa7228acb11cea79f0f107ce467bcd3b196a9a8014c6b8c6308ce0697bf9513",
  "c53c0e9036625de3e178dedab598cbbbb70be0ba210e379d5a20a3564cf2e4a0",
  "5a57884ea3bf12dbfc9b35afa65d5b24ec8ddd8c14cf1b10fe2aa137d9e039ff",
  "945278946568d26c75b9b7c5ff854d2e2e7dce284e7d986095c145d109d69876",
  "11cd289eea8a543382d6c8392802f7bdea48f86598246555dd36b7b5fb7495ee",
  "8ff2c0221b1d2401df69b5b0f9379bba5976ce6cd515813976121b20ac000029",
];

type RenderedNodeEvent = {
  tick: number;
  journalIndex: number;
  type: string;
  node: string;
  amountField: string;
  amount: number;
  resident?: string;
};

type RenderedPayload = {
  journalHeadHash: string;
  frames: Array<{ tick: number; stateHash: string; nodeEvents: RenderedNodeEvent[] }>;
};

let journalPath: string;
let frames: TickFrame[];
let engineFinalHash: string;

beforeAll(async () => {
  const dir = tempDir();
  journalPath = join(dir, "journal.jsonl");
  const genesis = parseGenesisConfig(
    JSON.parse(readFileSync(join(ROOT, "runner", "genesis.example.json"), "utf8")),
  );
  const world = World.create(genesis.seed, worldConfigFor(genesis), { persistPath: journalPath });
  world.tick(); // prime, as the launch runner does
  const driver = new SeatDriver(
    world,
    genesis.seats.map((s) => ({ seatId: s.seatId, backend: new ScriptedPolicyBackend(survivalPolicy) })),
  );
  for (let i = 0; i < 6; i++) await driver.tick();
  engineFinalHash = hashState(world.state);
  world.close();

  frames = replayFrames(loadJournalForViewing(journalPath));
});

const frameAt = (tick: number): TickFrame => {
  const f = frames.find((x) => x.tick === tick);
  if (!f) throw new Error(`no frame at tick ${tick}`);
  return f;
};

function renderFixture(): { journal: ReturnType<typeof loadJournalForViewing>; html: string } {
  const journal = loadJournalForViewing(journalPath);
  const html = renderViewerHtml(frames, {
    journalLabel: journalPath,
    journalEntries: journal.length,
    journalHeadHash: journal.headHash(),
  });
  return { journal, html };
}

function renderedPayload(html: string): RenderedPayload {
  const match = html.match(/<script type="application\/json" id="viewer-data">([\s\S]*?)<\/script>/);
  if (!match) throw new Error("rendered viewer has no embedded data payload");
  return JSON.parse(match[1]) as RenderedPayload;
}

describe("viewer replay of the seed-424242 Juárez fixture", () => {
  it("replays one frame per committed tick, genesis through the final tick", () => {
    expect(frames.map((f) => f.tick)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("keeps the audited journal head and per-tick replay hashes unchanged", () => {
    const journal = loadJournalForViewing(journalPath);
    expect(journal.length).toBe(87);
    expect(journal.headHash()).toBe(AUDITED_JOURNAL_HEAD);
    expect(frames.map((f) => f.stateHash)).toEqual(AUDITED_STATE_HASHES);
  });

  it("state at three ticks differs on concrete fields", () => {
    const t1 = frameAt(1);
    const t4 = frameAt(4);
    const t7 = frameAt(7);
    // The node nexus gathers from, and what nexus is carrying: both move.
    expect(t1.state.nodes["mercado-centro"].amount).toBe(20);
    expect(t4.state.nodes["mercado-centro"].amount).toBe(17);
    expect(t7.state.nodes["mercado-centro"].amount).toBe(18);
    expect(t1.state.residents["nexus"].inventory).toBe(0);
    expect(t4.state.residents["nexus"].inventory).toBe(6);
    expect(t7.state.residents["nexus"].inventory).toBe(2);
    expect(t1.state.residents["nexus"].satiety).toBe(7);
    expect(t4.state.residents["nexus"].satiety).toBe(4);
    const hashes = new Set([t1.stateHash, t4.stateHash, t7.stateHash]);
    expect(hashes.size).toBe(3);
  });

  it("viewer state hash at the final tick equals the engine's hashState", () => {
    const last = frameAt(7);
    expect(last.stateHash).toBe(engineFinalHash);
    expect(last.stateHash).toBe(last.journaledStateHash);
    // The engine's own restore path agrees with the viewer's replay.
    const restored = World.restore(loadJournalForViewing(journalPath));
    expect(hashState(restored.state)).toBe(last.stateHash);
  });

  it("every frame's replayed hash matches the hash journaled in its TICK_COMMIT", () => {
    for (const f of frames) expect(f.stateHash).toBe(f.journaledStateHash);
  });
});

describe("rendered page", () => {
  it("carries the auditor-surface label, final hash, and audited journal head", () => {
    const { journal, html } = renderFixture();
    const payload = renderedPayload(html);
    expect(html).toContain(AUDITOR_LABEL);
    expect(html).toContain("AUDITOR'S SURFACE");
    expect(html).toContain("NOT a resident's view");
    expect(html).toContain(engineFinalHash);
    expect(html).toContain('id="scrub"'); // the tick scrubber
    expect(html).toContain("mercado-centro");
    expect(payload.journalHeadHash).toBe(AUDITED_JOURNAL_HEAD);
    expect(payload.frames.map((f) => f.stateHash)).toEqual(AUDITED_STATE_HASHES);
    expect(journal.headHash()).toBe(AUDITED_JOURNAL_HEAD);
  });

  it("shows each requested OBSERVED node event from its raw journal entry per tick", () => {
    const { journal, html } = renderFixture();
    const payload = renderedPayload(html);
    const rawEvents = journal.entries().filter((entry) =>
      entry.type === "ENV_BLIGHT" || entry.type === "RESOURCE_REGEN" || entry.type === "GATHER_GRANTED",
    );
    const displayedEvents = payload.frames.flatMap((frame) => frame.nodeEvents);

    expect(displayedEvents).toHaveLength(rawEvents.length);
    for (const frame of payload.frames) {
      const sourceEntries = rawEvents.filter((entry) => entry.tick === frame.tick);
      expect(frame.nodeEvents.map((event) => event.journalIndex)).toEqual(sourceEntries.map((entry) => entry.index));
    }
    for (const entry of rawEvents) {
      const amountField = entry.type === "ENV_BLIGHT" ? "loss" : entry.type === "RESOURCE_REGEN" ? "gained" : "granted";
      const event = displayedEvents.find((item) => item.journalIndex === entry.index);
      expect(event).toMatchObject({
        tick: entry.tick,
        journalIndex: entry.index,
        type: entry.type,
        node: entry.payload.node,
        amountField,
        amount: entry.payload[amountField],
      });
      if (entry.type === "GATHER_GRANTED") expect(event?.resident).toBe(entry.payload.resident);
    }
    expect(html).toContain("OBSERVED journal event");
    expect(html).toContain("Zero OBSERVED node events for this node this tick");
  });

  it("places the exact two-registers sentence in the page legend and README", () => {
    const { html } = renderFixture();
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    expect(html).toContain('id="evidence-legend"');
    expect(html).toContain(TWO_REGISTERS_SENTENCE);
    expect(readme).toContain(TWO_REGISTERS_SENTENCE);
  });
});

describe("read-only by construction", () => {
  // The scan: every import in viewer/ sources is resolved to a repo path
  // and must land on the allowlist of read/replay surfaces below. (The
  // repo's RG helper, checkObserverImports, guards the reverse direction
  // — validation code importing the observer — so the viewer's own
  // boundary is pinned here directly, as an allowlist, not a denylist.)
  const ALLOWED = new Set([
    "ledger/journal",
    "engine/world/state",
    "engine/world/map",
    "engine/world/maps/juarez",
    "viewer/replay",
    "viewer/render",
    "viewer/residentView",
    "viewer/main",
    "viewer/verificationReceipt",
  ]);

  it("viewer sources import only allowlisted read/replay surfaces", () => {
    const viewerDir = join(ROOT, "viewer");
    const files = readdirSync(viewerDir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(join(viewerDir, file), "utf8");
      for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
        const spec = m[1];
        if (spec.startsWith("node:")) continue;
        const parts = ["viewer"];
        for (const seg of spec.split("/")) {
          if (seg === "..") parts.pop();
          else if (seg !== ".") parts.push(seg);
        }
        const target = parts.join("/").replace(/\.js$/, "");
        expect(ALLOWED.has(target), `${file} imports ${spec} -> ${target}, which is not an allowlisted read surface`).toBe(true);
      }
    }
  });

  it("viewer sources never name a write path", () => {
    const viewerDir = join(ROOT, "viewer");
    for (const file of readdirSync(viewerDir).filter((f) => f.endsWith(".ts"))) {
      const text = readFileSync(join(viewerDir, file), "utf8");
      for (const banned of ["world.js", "driver.js", "validator.js", "wal.js", "writerLock.js", "restoreFromFile", ".submit(", ".tick("]) {
        expect(text.includes(banned), `${file} must not reference ${banned}`).toBe(false);
      }
    }
  });
});
