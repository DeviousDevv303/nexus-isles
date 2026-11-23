// Live-world sessions on GitHub Actions (.github/workflows/world-session.yml)
// and the read-only status report it publishes (runner/worldStatus.ts).
//
// The workflow's safety properties are pinned as text, the way the RG gates
// pin governance: it may only RESUME the one live world (no --config, so the
// runner cannot create one), never force-push, never run on pull requests,
// and never run two sessions at once.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Journal } from "../../ledger/journal.js";
import { parseGenesisConfig } from "../../runner/config.js";
import { LaunchRunner } from "../../runner/runner.js";
import { statusMarkdown, worldStatus } from "../../runner/worldStatus.js";
import { tempDir } from "../helpers/worldFixtures.js";

const WORKFLOW = readFileSync(join(process.cwd(), ".github", "workflows", "world-session.yml"), "utf8");
const code = WORKFLOW.split("\n").filter((line) => !line.trimStart().startsWith("#")).join("\n");

const genesis = () =>
  parseGenesisConfig({
    seed: 7,
    map: "juarez",
    worldClass: "persistent",
    seats: [
      { seatId: "scout", actionsPerTick: 2, intel: 1, maxSatiety: 10, position: "industrial-east", satiety: 8, backend: { providerId: "scripted-policy:survival", version: "v1" } },
      { seatId: "hauler", actionsPerTick: 2, intel: 1, maxSatiety: 10, position: "zaragoza", satiety: 8, backend: { providerId: "scripted-policy:survival", version: "v1" } },
    ],
  });

async function world(ticks: number, dir = tempDir()) {
  const runner = new LaunchRunner({ dataDir: dir, genesis: genesis(), log: () => {} });
  await runner.start();
  for (let i = 0; i < ticks; i++) await runner.tickOnce();
  await runner.stop();
  return dir;
}

describe("the world-session workflow can only resume the one live world", () => {
  it("runs the runner without --config, so it cannot create or reseed a world", () => {
    const runs = code.split("\n").filter((line) => line.includes("runner/main.ts"));
    expect(runs.length).toBe(1);
    expect(runs[0]).not.toMatch(/--config/);
    expect(code).toMatch(/RUNNER start mode=resumed/);
  });

  it("stops when the live journal is missing instead of creating one", () => {
    expect(code).toMatch(/git ls-remote --exit-code --heads origin live-world/);
    expect(code).toMatch(/test -s live\/world-data\/journal\.jsonl/);
  });

  it("never force-pushes, never runs on pull requests, never overlaps", () => {
    expect(code).not.toMatch(/push[^\n]*(?:--force|\s-f\b|\+HEAD)/);
    expect(code).not.toMatch(/pull_request/);
    expect(code).toMatch(/concurrency:\s*\n\s*group: nexus-isles-live-world\s*\n\s*cancel-in-progress: false/);
  });

  it("verifies before and after the session, and supports pinning the expected head", () => {
    expect(code.match(/runner\/status\.ts/g)?.length).toBe(2);
    expect(code).toMatch(/--expect-head "\$EXPECT_HEAD"/);
  });
});

describe("the runner refuses to create a world without a genesis config", () => {
  it("an empty data directory with no config is a refusal, not a new world", async () => {
    const runner = new LaunchRunner({ dataDir: tempDir(), log: () => {} });
    await expect(runner.start()).rejects.toThrow(/nothing to resume, nothing to create/);
  });

  it("an existing world resumes without a config, skipping the dead", async () => {
    const dir = await world(10);
    const lines: string[] = [];
    const runner = new LaunchRunner({ dataDir: dir, log: (l) => lines.push(l) });
    await runner.start();
    await runner.tickOnce();
    await runner.stop();
    expect(lines.some((l) => l.startsWith("RUNNER start mode=resumed"))).toBe(true);
    expect(lines).toContain("RUNNER seat-skipped seat=hauler reason=dead");
  });
});

describe("worldStatus", () => {
  it("reports the head, tick and residents from the verified, replayed journal", async () => {
    const dir = await world(10);
    const journal = Journal.loadFromFile(join(dir, "journal.jsonl"));
    const status = worldStatus(journal);
    expect(status.head).toBe(journal.headHash());
    expect(status.entries).toBe(journal.length);
    expect(status.tick).toBe(11);
    expect(status.chainVerified).toBe(true);
    const hauler = status.residents.find((r) => r.id === "hauler");
    expect(hauler).toMatchObject({ alive: false, diedAtTick: 8, backend: "scripted-policy:survival@v1" });
    expect(status.residents.find((r) => r.id === "scout")?.alive).toBe(true);
    const md = statusMarkdown(status);
    expect(md).toContain(status.head);
    expect(md).toContain("DEAD (tick 8)");
  });

  it("a tampered journal is refused, never reported", async () => {
    const dir = await world(3);
    const path = join(dir, "journal.jsonl");
    const lines = readFileSync(path, "utf8").split("\n");
    lines[2] = lines[2].replace(/"tick":\d+/, '"tick":99');
    writeFileSync(path, lines.join("\n"), "utf8");
    expect(() => worldStatus(Journal.loadFromFile(path))).toThrow();
  });
});
