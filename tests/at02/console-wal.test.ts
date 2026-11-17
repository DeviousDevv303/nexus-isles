// Journal durability part 2 — Muse's Ruling 1 (#235, 6950678244): queued
// console submissions live in a separate durable write-ahead log, not the
// journal; they cross into the journal only when a tick processes them.
// Chat is never WAL'd. AT-01's submission-order determinism is untouched.

import { appendFileSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ConsoleSubmission } from "../../console/console.js";
import { readWal, walPathFor } from "../../engine/world/wal.js";
import { World } from "../../engine/world/world.js";
import { baseConfig, drive, tempDir } from "../helpers/worldFixtures.js";

const sub = (affectsTick: number, o: Partial<ConsoleSubmission> = {}): ConsoleSubmission => ({
  consoleClass: "C1", intent: "raise blight", diff: "rules.blightPercent: 25 -> 30",
  verbatim: "make blight a bit worse", confirmed: true, affectsTick, ...o,
});
function persisted(ticks = 3) {
  const path = join(tempDir(), "w.jsonl");
  const w = World.create(5, baseConfig(), { persistPath: path });
  drive(w, ticks);
  return { path, wal: walPathFor(path), w };
}
const ext = (w: World) => w.entries().filter((e) => e.type === "EXTERNAL_EVENT");
const rej = (w: World) => w.entries().filter((e) => e.type === "OWNER_SUBMISSION_REJECTED");

describe("console write-ahead log (Ruling 1)", () => {
  it("a queued intervention survives a crash and lands at its tick — journal identical to an uninterrupted run", () => {
    const a = persisted();
    a.w.submitConsoleEvent(sub(6)); // waiting for tick 6
    expect(readWal(a.wal).records.map((r) => r.kind)).toEqual(["console"]);
    // crash: the World object is gone; restart from disk
    const r = World.restoreFromFile(a.path);
    drive(r, 3);
    expect(ext(r).map((e) => e.tick)).toEqual([6]);

    const b = persisted();
    b.w.submitConsoleEvent(sub(6));
    drive(b.w, 3); // never crashed
    expect(r.headHash).toBe(b.w.headHash);
  });

  it("a refusal waiting for its boundary survives a crash too", () => {
    const { path, w } = persisted();
    expect(() => w.submitConsoleEvent(sub(1))).toThrow(/already resolved/);
    const r = World.restoreFromFile(path);
    drive(r, 1);
    expect(rej(r).map((e) => e.payload.code)).toEqual(["tick_already_resolved"]);
  });

  it("a crash between the journal write and the WAL rewrite never lands a submission twice", () => {
    const { path, wal, w } = persisted();
    w.submitConsoleEvent(sub(4));
    const staleWal = `${wal}.stale`;
    copyFileSync(wal, staleWal); // the WAL as it was before the tick landed the record
    drive(w, 1); // tick 4 lands it, journal persisted, WAL compacted
    copyFileSync(staleWal, wal); // simulate the crash: the compaction never happened
    const r = World.restoreFromFile(path);
    drive(r, 3);
    expect(ext(r)).toHaveLength(1);
    expect(readWal(wal).records).toEqual([]); // and the stale record was cleared
  });

  it("the WAL holds exactly what is waiting, and empties as things land", () => {
    const { wal, w } = persisted();
    w.submitConsoleEvent(sub(4));
    w.submitConsoleEvent(sub(6));
    expect(() => w.submitConsoleEvent(sub(0))).toThrow();
    expect(readWal(wal).records.map((r) => [r.walId, r.kind])).toEqual([
      ["w1", "console"], ["w2", "console"], ["w3", "console-rejection"],
    ]);
    drive(w, 1); // tick 4: w1 and the refusal land
    expect(readWal(wal).records.map((r) => r.walId)).toEqual(["w2"]);
    drive(w, 2); // tick 6: w2 lands
    expect(readWal(wal).records).toEqual([]);
    expect(ext(w).map((e) => e.payload.walId)).toEqual(["w1", "w2"]);
  });

  it("ids keep counting across a restart, so a landed id is never reused", () => {
    const { path, w } = persisted();
    w.submitConsoleEvent(sub(4));
    drive(w, 1);
    const r = World.restoreFromFile(path);
    r.submitConsoleEvent(sub(6));
    drive(r, 2);
    expect(ext(r).map((e) => e.payload.walId)).toEqual(["w1", "w2"]);
  });

  it("the journal is unchanged by queueing: submission order across seats still gives an identical journal (AT-01)", () => {
    const run = (order: string[]) => {
      const path = join(tempDir(), "w.jsonl");
      const w = World.create(9, baseConfig(), { persistPath: path });
      w.submitConsoleEvent(sub(2));
      for (const seat of order) w.submit(seat, { verb: "gather", args: { node: "grove", amount: 2 } });
      drive(w, 3);
      return w.headHash;
    };
    expect(run(["alpha", "bravo", "charlie", "delta"])).toBe(run(["delta", "charlie", "bravo", "alpha"]));
  });

  it("a torn WAL fragment is discarded; a corrupt complete WAL line fails loudly", () => {
    const a = persisted();
    a.w.submitConsoleEvent(sub(6));
    appendFileSync(a.wal, '{"walId":"w2","ki');
    const r = World.restoreFromFile(a.path);
    drive(r, 3);
    expect(ext(r)).toHaveLength(1);

    const b = persisted();
    b.w.submitConsoleEvent(sub(6));
    appendFileSync(b.wal, '{"walId":"w2","ki\n');
    expect(() => World.restoreFromFile(b.path)).toThrow(/WAL line 2 is complete but unparseable/);
  });

  it("a WAL record that can no longer land where it says fails loudly instead of vanishing", () => {
    const { path, wal } = persisted();
    writeFileSync(wal, JSON.stringify({ walId: "w9", kind: "console", payload: { walId: "w9", affectsTick: 2, verbatim: "x" } }) + "\n");
    expect(() => World.restoreFromFile(path)).toThrow(/targets tick 2, already resolved, and never landed/);
  });

  it("a stale WAL blocks creating a fresh world over it; no persistence means no WAL", () => {
    const { path, wal, w } = persisted();
    w.submitConsoleEvent(sub(6));
    const fresh = join(tempDir(), "x.jsonl");
    copyFileSync(wal, walPathFor(fresh));
    expect(() => World.create(1, baseConfig(), { persistPath: fresh })).toThrow(/existing write-ahead log/);
    const mem = World.create(1, baseConfig());
    mem.submitConsoleEvent(sub(2));
    drive(mem, 2);
    expect(ext(mem)).toHaveLength(1);
    expect(existsSync(walPathFor(path))).toBe(true);
  });

  it("chat is never written ahead (AA7): the WAL carries console submissions only", () => {
    const { wal, w } = persisted();
    w.submitConsoleEvent(sub(6));
    const text = readFileSync(wal, "utf8");
    for (const line of text.trim().split("\n")) expect(["console", "console-rejection"]).toContain(JSON.parse(line).kind);
  });
});

describe("one buffered append per tick (Ruling 2)", () => {
  it("each tick reaches the file in one append: the file only ever ends at a commit", () => {
    const path = join(tempDir(), "w.jsonl");
    const w = World.create(3, baseConfig(), { persistPath: path });
    for (let t = 0; t < 6; t++) {
      drive(w, 1);
      const ls = readFileSync(path, "utf8").trim().split("\n");
      expect(JSON.parse(ls.at(-1) as string).type).toBe("TICK_COMMIT");
      expect(ls).toHaveLength(w.entries().length);
    }
  });
});
