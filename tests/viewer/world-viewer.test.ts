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
import { AUDITOR_LABEL, renderViewerHtml } from "../../viewer/render.js";
import { loadJournalForViewing, replayFrames, type TickFrame } from "../../viewer/replay.js";
import { tempDir } from "../helpers/worldFixtures.js";

const ROOT = join(import.meta.dirname, "..", "..");

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

describe("viewer replay of the seed-424242 Juárez fixture", () => {
  it("replays one frame per committed tick, genesis through the final tick", () => {
    expect(frames.map((f) => f.tick)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
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
  it("carries the auditor-surface label and the final tick's hash", () => {
    const journal = loadJournalForViewing(journalPath);
    const html = renderViewerHtml(frames, {
      journalLabel: "fixture journal.jsonl",
      journalEntries: journal.length,
      journalHeadHash: journal.headHash(),
    });
    expect(html).toContain(AUDITOR_LABEL);
    expect(html).toContain("AUDITOR'S SURFACE");
    expect(html).toContain("NOT a resident's view");
    expect(html).toContain(engineFinalHash);
    expect(html).toContain('id="scrub"'); // the tick scrubber
    expect(html).toContain("mercado-centro");
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
    "viewer/main",
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
