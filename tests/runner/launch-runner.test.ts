// Launch runner — infrastructure acceptance tests.
//
// (a) create + N ticks + restart resumes at the right head hash;
// (b) a second runner against the same data directory is refused;
// (c) clean shutdown mid-run leaves a journal that verifies;
// (d) a stale lock (dead pid) is taken over, and the takeover is logged;
// (e) a genesis config that disagrees with the journal is refused.

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Journal } from "../../ledger/journal.js";
import { World } from "../../engine/world/world.js";
import { TickDeliveryError } from "../../engine/world/writerLock.js";
import { parseGenesisConfig, type GenesisConfig } from "../../runner/config.js";
import { LaunchRunner } from "../../runner/runner.js";
import { tempDir } from "../helpers/worldFixtures.js";

function genesis(seed = 777, worldClass: string | null = "scratch"): GenesisConfig {
  return parseGenesisConfig({
    seed,
    map: "juarez",
    // These seats are labeled test doubles, so the config must declare the
    // scratch class explicitly — an omitted class defaults fail-closed to
    // persistent, which refuses test doubles (see the world-class tests).
    ...(worldClass ? { worldClass } : {}),
    seats: [
      {
        seatId: "nexus",
        backend: { providerId: "test-double:scripted-policy", version: "test-v1" },
        position: "centro",
        satiety: 50,
        maxSatiety: 60,
      },
      {
        seatId: "scout",
        backend: { providerId: "test-double:scripted-policy", version: "test-v1" },
        position: "industrial-east",
        satiety: 50,
        maxSatiety: 60,
      },
    ],
  });
}

function collector(): { lines: string[]; log: (line: string) => void } {
  const lines: string[] = [];
  return { lines, log: (line: string) => lines.push(line) };
}

describe("launch runner", () => {
  it("(a) creates, ticks, and a restart resumes at the same head hash", async () => {
    const dir = tempDir();
    const c1 = collector();
    const r1 = new LaunchRunner({ dataDir: dir, genesis: genesis(), log: c1.log });
    await r1.start();
    expect(r1.startMode).toBe("genesis");
    // Tick 1 is the priming engine tick; three driver ticks follow.
    await r1.tickOnce();
    await r1.tickOnce();
    await r1.tickOnce();
    expect(r1.currentTick).toBe(4);
    const headBefore = r1.currentHead;
    await r1.stop();

    const onDisk = Journal.loadFromFile(join(dir, "journal.jsonl"));
    expect(onDisk.verify().ok).toBe(true);
    expect(onDisk.headHash()).toBe(headBefore);
    // The scripted seats really acted through the validator.
    expect(onDisk.entries().some((e) => e.type === "ACTION_ACCEPTED")).toBe(true);

    const c2 = collector();
    const r2 = new LaunchRunner({ dataDir: dir, genesis: genesis(), log: c2.log });
    await r2.start();
    expect(r2.startMode).toBe("resumed");
    expect(r2.currentTick).toBe(4);
    expect(r2.currentHead).toBe(headBefore);
    expect(c2.lines.some((l) => l.startsWith("RUNNER start mode=resumed"))).toBe(true);

    await r2.tickOnce();
    expect(r2.currentTick).toBe(5);
    expect(r2.currentHead).not.toBe(headBefore);
    const headAfter = r2.currentHead;
    await r2.stop();

    const restored = World.restoreFromFile(join(dir, "journal.jsonl"));
    expect(restored.headHash).toBe(headAfter);
    expect(restored.tickNumber).toBe(5);
  });

  it("(b) refuses a second runner on the same data directory", async () => {
    const dir = tempDir();
    const r1 = new LaunchRunner({ dataDir: dir, genesis: genesis(), log: () => {} });
    await r1.start();
    const r2 = new LaunchRunner({ dataDir: dir, genesis: genesis(), log: () => {} });
    await expect(r2.start()).rejects.toThrow(/already held/);
    await r1.stop();
    // The lock was released on stop: a fresh runner may take the directory.
    const r3 = new LaunchRunner({ dataDir: dir, genesis: genesis(), log: () => {} });
    await r3.start();
    expect(r3.startMode).toBe("resumed");
    await r3.stop();
  });

  it("(c) clean shutdown mid-run leaves a journal that verifies", { timeout: 20000 }, async () => {
    const dir = tempDir();
    const c = collector();
    const r = new LaunchRunner({ dataDir: dir, genesis: genesis(), tickIntervalMs: 5, log: c.log });
    await r.start();
    r.run();
    await vi.waitFor(
      () => {
        expect(c.lines.filter((l) => l.startsWith("TICK ")).length).toBeGreaterThanOrEqual(4);
      },
      { timeout: 10000, interval: 10 },
    );
    await r.stop("test-shutdown");

    expect(c.lines.some((l) => l.startsWith("RUNNER stop reason=test-shutdown"))).toBe(true);
    expect(existsSync(join(dir, "runner.lock"))).toBe(false);
    const journal = Journal.loadFromFile(join(dir, "journal.jsonl"));
    expect(journal.verify().ok).toBe(true);
    // Shutdown never leaves a half-tick: the journal ends at a commit and a
    // plain restore (which refuses mid-tick tails) succeeds.
    expect(journal.entries().at(-1)?.type).toBe("TICK_COMMIT");
    const restored = World.restoreFromFile(join(dir, "journal.jsonl"));
    expect(restored.tickNumber).toBeGreaterThanOrEqual(4);
    expect(restored.headHash).toBe(journal.headHash());
  });

  it("(d) takes over a stale lock from a dead pid and logs the takeover", async () => {
    const dir = tempDir();
    const child = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
    const deadPid = child.pid as number;
    writeFileSync(
      join(dir, "runner.lock"),
      JSON.stringify({ pid: deadPid, host: "old-host", startedAt: "2026-01-01T00:00:00.000Z" }) + "\n",
    );
    const c = collector();
    const r = new LaunchRunner({ dataDir: dir, genesis: genesis(), log: c.log });
    await r.start();
    expect(c.lines.some((l) => l.startsWith("RUNNER lock-takeover") && l.includes(`pid=${deadPid}`))).toBe(true);
    expect(r.startMode).toBe("genesis");
    await r.stop();
  });

  it("(e) refuses a genesis config whose seed disagrees with the journal", async () => {
    const dir = tempDir();
    const r1 = new LaunchRunner({ dataDir: dir, genesis: genesis(777), log: () => {} });
    await r1.start();
    await r1.stop();

    const wrong = new LaunchRunner({ dataDir: dir, genesis: genesis(999), log: () => {} });
    await expect(wrong.start()).rejects.toThrow(/does not match the journal's genesis seed/);

    // The failed start released its lock: the right config starts cleanly.
    const right = new LaunchRunner({ dataDir: dir, genesis: genesis(777), log: () => {} });
    await right.start();
    expect(right.startMode).toBe("resumed");
    await right.stop();
  });
});

describe("launch runner — world class (the PR #32 guard on the launcher)", () => {
  it("(f) a scratch genesis seats the test doubles and journals the class", async () => {
    const dir = tempDir();
    const c = collector();
    const r = new LaunchRunner({ dataDir: dir, genesis: genesis(777, "scratch"), log: c.log });
    await r.start();
    expect(r.startMode).toBe("genesis");
    expect(c.lines.some((l) => l === "RUNNER world-class config=scratch effective=scratch")).toBe(true);
    expect(
      c.lines.some((l) => l.startsWith("RUNNER start mode=genesis") && l.includes("worldClass=scratch")),
    ).toBe(true);
    await r.tickOnce();
    await r.stop();

    const journal = Journal.loadFromFile(join(dir, "journal.jsonl"));
    const genesisEntry = journal.entries()[0];
    expect(genesisEntry.type).toBe("WORLD_GENESIS");
    expect((genesisEntry.payload.config as { worldClass?: string }).worldClass).toBe("scratch");
  });

  it("(g) a persistent genesis refuses the test doubles", async () => {
    const dir = tempDir();
    const r = new LaunchRunner({ dataDir: dir, genesis: genesis(777, "persistent"), log: () => {} });
    await expect(r.start()).rejects.toThrow(/cannot seat a test double/);
    // The refusal happened at genesis validation: no journal was created.
    expect(existsSync(join(dir, "journal.jsonl"))).toBe(false);
  });

  it("(h) an omitted worldClass defaults fail-closed to persistent — and the log says so", async () => {
    const dir = tempDir();
    const c = collector();
    const r = new LaunchRunner({ dataDir: dir, genesis: genesis(777, null), log: c.log });
    // Same refusal as the declared-persistent case: test doubles never run
    // under an undeclared class.
    await expect(r.start()).rejects.toThrow(/cannot seat a test double/);
    expect(c.lines.some((l) => l === "RUNNER world-class config=omitted effective=persistent")).toBe(true);
    expect(existsSync(join(dir, "journal.jsonl"))).toBe(false);
  });

  it("(i) resume with a mismatched worldClass is refused", async () => {
    const dir = tempDir();
    const r1 = new LaunchRunner({ dataDir: dir, genesis: genesis(777, "scratch"), log: () => {} });
    await r1.start();
    await r1.stop();

    // Declared persistent against a scratch journal: refused by the
    // engine's expectWorldClass check before any load or repair.
    const declared = new LaunchRunner({ dataDir: dir, genesis: genesis(777, "persistent"), log: () => {} });
    await expect(declared.start()).rejects.toThrow(/refusing to open a scratch journal as persistent/);

    // Omitted class (fail-closed persistent) against the same scratch
    // journal: refused the same way — silence never reclasses a world.
    const omitted = new LaunchRunner({ dataDir: dir, genesis: genesis(777, null), log: () => {} });
    await expect(omitted.start()).rejects.toThrow(/refusing to open a scratch journal as persistent/);
  });

  it("(j) resume with the matching worldClass works", async () => {
    const dir = tempDir();
    const r1 = new LaunchRunner({ dataDir: dir, genesis: genesis(777, "scratch"), log: () => {} });
    await r1.start();
    await r1.tickOnce();
    const headBefore = r1.currentHead;
    await r1.stop();

    const c2 = collector();
    const r2 = new LaunchRunner({ dataDir: dir, genesis: genesis(777, "scratch"), log: c2.log });
    await r2.start();
    expect(r2.startMode).toBe("resumed");
    expect(r2.currentHead).toBe(headBefore);
    expect(
      c2.lines.some((l) => l.startsWith("RUNNER start mode=resumed") && l.includes("worldClass=scratch")),
    ).toBe(true);
    await r2.tickOnce();
    expect(r2.currentHead).not.toBe(headBefore);
    await r2.stop();
  });

  it("(k) an unknown worldClass in the config is refused at parse", () => {
    expect(() =>
      parseGenesisConfig({
        seed: 1,
        map: "juarez",
        worldClass: "demo",
        seats: [
          {
            seatId: "nexus",
            backend: { providerId: "test-double:scripted-policy", version: "test-v1" },
            position: "centro",
          },
        ],
      }),
    ).toThrow(/worldClass must be one of scratch, persistent/);
  });
});

describe("launch runner — tick delivery identity (the PR #35 wiring on the launcher)", () => {
  it("(l) a sequential redelivery of a runner tick is refused — exactly one commit per tick", async () => {
    const dir = tempDir();
    const c = collector();
    const r = new LaunchRunner({ dataDir: dir, genesis: genesis(), log: c.log });
    await r.start();
    // start() delivered the priming engine tick under its identity (tick 1).
    expect(r.currentTick).toBe(1);
    const commits = () =>
      Journal.loadFromFile(join(dir, "journal.jsonl"))
        .entries()
        .filter((e) => e.type === "TICK_COMMIT")
        .map((e) => e.tick);

    // A delivery through the runner, named with its tick identity.
    await r.tickOnce({ expectTick: 2 });
    expect(r.currentTick).toBe(2);
    const headAfterTick2 = r.currentHead;

    // The same delivery arrives again (a supervisor retry, a doubled
    // timer): refused with the PR #35 shape, before anything is written —
    // the head, the tick and the commit list do not move.
    await expect(r.tickOnce({ expectTick: 2 })).rejects.toThrow(TickDeliveryError);
    await expect(r.tickOnce({ expectTick: 2 })).rejects.toThrow(/already committed/);
    // A delivery that skips ahead is refused the same way.
    await expect(r.tickOnce({ expectTick: 9 })).rejects.toThrow(/not the next tick/);
    expect(r.currentTick).toBe(2);
    expect(r.currentHead).toBe(headAfterTick2);
    expect(commits()).toEqual([0, 1, 2]);

    // The runner's own unnamed sequence is unaffected and continues.
    await r.tickOnce();
    expect(r.currentTick).toBe(3);
    expect(commits()).toEqual([0, 1, 2, 3]);
    await r.stop();

    const journal = Journal.loadFromFile(join(dir, "journal.jsonl"));
    expect(journal.verify().ok).toBe(true);
  });
});
