// AT-02 Persistence: restart preserves world state and historical truth.
// Journal-first: the file is the truth; snapshots are verified caches.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { World } from "../../engine/world/world.js";
import { baseConfig, drive, tempDir } from "../helpers/worldFixtures.js";

describe("AT-02 persistence", () => {
  it("run -> restart -> continue equals one uninterrupted run", () => {
    const dir = tempDir();
    const path = join(dir, "world.jsonl");
    const first = World.create(77, baseConfig(), { persistPath: path });
    drive(first, 20);

    const restarted = World.restoreFromFile(path); // simulated process restart
    expect(restarted.headHash).toBe(first.headHash);
    expect(restarted.state).toEqual(first.state);
    drive(restarted, 20);

    const straight = World.create(77, baseConfig());
    drive(straight, 40);
    expect(restarted.headHash).toBe(straight.headHash);
    expect(restarted.state).toEqual(straight.state);
  });

  it("the persisted file after restart equals the in-memory journal (no loss, no dup)", () => {
    const path = join(tempDir(), "w.jsonl");
    const w = World.create(3, baseConfig(), { persistPath: path });
    drive(w, 10);
    const r = World.restoreFromFile(path);
    drive(r, 10);
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(r.entries().length);
    expect(JSON.parse(lines[lines.length - 1]).hash).toBe(r.headHash);
  });

  it("historical truth survives: a dead resident stays dead after restart", () => {
    const path = join(tempDir(), "w.jsonl");
    const cfg = baseConfig();
    cfg.residents[0].satiety = 2; // alpha will starve if it never eats
    const w = World.create(1, cfg, { persistPath: path });
    for (let i = 0; i < 5; i++) w.tick();
    expect(w.state.residents.alpha.alive).toBe(false);
    const r = World.restoreFromFile(path);
    expect(r.state.residents.alpha.alive).toBe(false);
    expect(r.state.residents.alpha.diedAtTick).toBe(w.state.residents.alpha.diedAtTick);
    expect(r.observe("alpha")).toBeNull();
  });

  it("valid snapshot is used as a cache; result equals full replay", () => {
    const dir = tempDir();
    const path = join(dir, "w.jsonl");
    const snapPath = join(dir, "snap.json");
    const w = World.create(11, baseConfig(), { persistPath: path });
    drive(w, 15);
    w.writeSnapshot(snapPath);
    drive(w, 10);
    const viaSnap = World.restoreFromFile(path, { snapshotPath: snapPath });
    const viaReplay = World.restoreFromFile(path);
    expect(viaSnap.state).toEqual(viaReplay.state);
    expect(viaSnap.headHash).toBe(w.headHash);
  });

  it("a tampered snapshot is ignored, never trusted", () => {
    const dir = tempDir();
    const path = join(dir, "w.jsonl");
    const snapPath = join(dir, "snap.json");
    const w = World.create(11, baseConfig(), { persistPath: path });
    drive(w, 15);
    w.writeSnapshot(snapPath);
    const snap = JSON.parse(readFileSync(snapPath, "utf8"));
    snap.state.residents.alpha.inventory = 9999; // forged wealth
    writeFileSync(snapPath, JSON.stringify(snap));
    drive(w, 5);
    const r = World.restoreFromFile(path, { snapshotPath: snapPath });
    expect(r.state.residents.alpha.inventory).toBe(w.state.residents.alpha.inventory);
    expect(r.state).toEqual(w.state);
  });

  it("garbage snapshot file is a cache miss", () => {
    const dir = tempDir();
    const path = join(dir, "w.jsonl");
    const snapPath = join(dir, "snap.json");
    const w = World.create(2, baseConfig(), { persistPath: path });
    drive(w, 5);
    writeFileSync(snapPath, "not json");
    expect(World.restoreFromFile(path, { snapshotPath: snapPath }).state).toEqual(w.state);
  });

  it("a tampered journal file refuses to load (ledger chain)", () => {
    const path = join(tempDir(), "w.jsonl");
    const w = World.create(4, baseConfig(), { persistPath: path });
    drive(w, 5);
    const raw = readFileSync(path, "utf8").replace('"grove"', '"grovf"');
    writeFileSync(path, raw);
    expect(() => World.restoreFromFile(path)).toThrow(/verification/);
  });

  it("refuses to create over an existing journal (the concatenation hazard)", () => {
    const path = join(tempDir(), "w.jsonl");
    World.create(4, baseConfig(), { persistPath: path });
    expect(() => World.create(4, baseConfig(), { persistPath: path })).toThrow(/existing journal/);
  });

  it("refuses to restore a journal that ends mid-tick", () => {
    const path = join(tempDir(), "w.jsonl");
    const w = World.create(4, baseConfig(), { persistPath: path });
    drive(w, 3);
    const lines = readFileSync(path, "utf8").trim().split("\n");
    writeFileSync(path, lines.slice(0, -1).join("\n") + "\n"); // drop final commit
    expect(() => World.restoreFromFile(path)).toThrow(/mid-tick/);
  });
});
