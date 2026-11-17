// Duplicate-tick prevention and the emergency stop — Muse's handout
// (#235, 6953621377; brief §12.4 item 1). Acceptance: two schedulers on one
// journal cannot both tick (the second refuses loudly, never forks the
// journal); an emergency stop halts at a tick boundary with the journal
// intact and verifiable; AT-01 determinism untouched.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Journal } from "../../ledger/journal.js";
import { World } from "../../engine/world/world.js";
import { lockPathFor, stopPathFor, WorldStoppedError, WriterLockError } from "../../engine/world/writerLock.js";
import { baseConfig, drive, tempDir } from "../helpers/worldFixtures.js";

const ROOT = join(import.meta.dirname, "..", "..");
function persisted(ticks = 3) {
  const path = join(tempDir(), "w.jsonl");
  const w = World.create(11, baseConfig(), { persistPath: path });
  drive(w, ticks);
  return { path, w };
}
const lines = (path: string) => readFileSync(path, "utf8").trim().split("\n");

describe("one writer per journal", () => {
  it("a second writer in this process is refused loudly, and the first keeps ticking a journal that never forks", () => {
    const { path, w } = persisted();
    expect(() => World.restoreFromFile(path)).toThrow(WriterLockError);
    expect(() => World.restoreFromFile(path)).toThrow(new RegExp(`held by pid ${process.pid} .*still running`));
    drive(w, 3);
    expect(lines(path)).toHaveLength(w.entries().length);
    expect(Journal.loadFromFile(path).verify().ok).toBe(true);
    expect(Journal.loadFromFile(path).headHash()).toBe(w.headHash);
  });

  it("TWO PROCESSES: a second process cannot open the journal while the first holds it", () => {
    const { path, w } = persisted();
    const out = execFileSync(join(ROOT, "node_modules/.bin/vite-node"), [join(ROOT, "tests/at02/fixtures/second-writer.ts"), path], { cwd: ROOT, encoding: "utf8" });
    const result = JSON.parse(out.trim().split("\n").at(-1) as string);
    expect(result).toMatchObject({ outcome: "refused", holderPid: process.pid });
    // the first writer's journal is exactly what it wrote
    drive(w, 1);
    expect(Journal.loadFromFile(path).headHash()).toBe(w.headHash);
    // once the first closes, the second process opens it and ticks
    w.close();
    const out2 = execFileSync(join(ROOT, "node_modules/.bin/vite-node"), [join(ROOT, "tests/at02/fixtures/second-writer.ts"), path], { cwd: ROOT, encoding: "utf8" });
    expect(JSON.parse(out2.trim().split("\n").at(-1) as string)).toEqual({ outcome: "ticked" });
  }, 60_000);

  it("creating a second world on a held journal is refused before anything is written", () => {
    const { path, w } = persisted();
    const before = readFileSync(path, "utf8");
    expect(() => World.create(11, baseConfig(), { persistPath: path })).toThrow(WriterLockError);
    expect(readFileSync(path, "utf8")).toBe(before);
    w.close();
  });

  it("a lock left by a crashed process is named as stale, and is taken over only when asked", () => {
    const { path, w } = persisted();
    w.close();
    // a process that has exited: its pid is no longer running on this host
    const dead = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
    const deadPid = Number(dead.stdout);
    writeFileSync(lockPathFor(path), JSON.stringify({ pid: deadPid, host: hostname(), token: "crashed" }));
    expect(() => World.restoreFromFile(path)).toThrow(/is not running \(a crash left the lock\); restart with takeOverStaleLock/);
    const r = World.restoreFromFile(path, { takeOverStaleLock: true });
    drive(r, 1);
    expect(JSON.parse(readFileSync(lockPathFor(path), "utf8")).pid).toBe(process.pid);
    r.close();
  });

  it("takeOverStaleLock never takes a live holder's lock, nor one from another host", () => {
    const { path, w } = persisted();
    expect(() => World.restoreFromFile(path, { takeOverStaleLock: true })).toThrow(/still running/);
    w.close();
    writeFileSync(lockPathFor(path), JSON.stringify({ pid: 1, host: "some-other-host", token: "remote" }));
    expect(() => World.restoreFromFile(path, { takeOverStaleLock: true })).toThrow(/another host/);
  });

  it("close() releases the lock; a world whose lock was taken from it refuses to tick", () => {
    const { path, w } = persisted();
    w.close();
    expect(existsSync(lockPathFor(path))).toBe(false);
    expect(() => w.tick()).toThrow(/closed/);
    const r = World.restoreFromFile(path);
    // someone forcibly replaces the lock (e.g. a mistaken manual takeover)
    writeFileSync(lockPathFor(path), JSON.stringify({ pid: process.pid, host: "x", token: "someone-else" }));
    expect(() => r.tick()).toThrow(/no longer holds its journal's writer lock/);
  });

  it("a world without a journal file takes no lock", () => {
    const w = World.create(1, baseConfig());
    drive(w, 2);
    w.close();
    expect(() => w.tick()).toThrow(/closed/);
  });
});

describe("emergency stop", () => {
  it("halts at a tick boundary: no partial tick, journal ends at a commit and verifies", () => {
    const { path, w } = persisted();
    const before = w.entries().length;
    w.requestStop("operator: suspected bad config");
    expect(() => w.tick()).toThrow(WorldStoppedError);
    expect(() => w.tick()).toThrow(/operator: suspected bad config/);
    expect(w.entries().length).toBe(before);
    const j = Journal.loadFromFile(path);
    expect(j.verify().ok).toBe(true);
    expect(j.entries().at(-1)!.type).toBe("TICK_COMMIT");
    expect(j.headHash()).toBe(w.headHash);
  });

  it("an operator can stop a running world from outside, with the stop file", () => {
    const { path, w } = persisted();
    writeFileSync(stopPathFor(path), "flood of bad actions from one seat");
    expect(() => w.tick()).toThrow(/flood of bad actions from one seat/);
    expect(w.stopped).toBe("flood of bad actions from one seat");
  });

  it("the stop survives a restart until it is cleared on purpose", () => {
    const { path, w } = persisted();
    w.requestStop("hold for audit");
    w.close();
    const r = World.restoreFromFile(path);
    expect(r.stopped).toBe("hold for audit");
    expect(() => r.tick()).toThrow(WorldStoppedError);
    r.clearStop();
    expect(existsSync(stopPathFor(path))).toBe(false);
    drive(r, 1);
    r.close();
  });

  it("AT-01 untouched: a world stopped and resumed writes exactly the journal of one never stopped", () => {
    const a = persisted(3);
    a.w.requestStop("pause");
    expect(() => a.w.tick()).toThrow(WorldStoppedError);
    a.w.clearStop();
    drive(a.w, 4);
    const b = World.create(11, baseConfig());
    drive(b, 7);
    expect(a.w.headHash).toBe(b.headHash);
  });

  it("works in memory too, and an empty reason is refused", () => {
    const w = World.create(1, baseConfig());
    expect(() => w.requestStop("")).toThrow(/needs a reason/);
    w.requestStop("test");
    expect(() => w.tick()).toThrow(WorldStoppedError);
    w.clearStop();
    expect(() => w.tick()).not.toThrow();
  });
});
