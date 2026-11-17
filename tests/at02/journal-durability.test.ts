// Journal durability — Muse's ledger ruling (#235, 6938908225).
// Per-entry flush; the loader discards ONLY a torn final fragment and
// reports it; corruption of any complete line still fails loudly; no
// complete entry is ever dropped. Acceptance pair: a torn COMPLETE-looking
// line must fail, beside a torn fragment that must recover.

import { appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Journal } from "../../ledger/journal.js";
import { World } from "../../engine/world/world.js";
import { baseConfig, drive, restartFrom, tempDir } from "../helpers/worldFixtures.js";

function persisted(ticks = 5) {
  const path = join(tempDir(), "w.jsonl");
  const w = World.create(7, baseConfig(), { persistPath: path });
  drive(w, ticks);
  return { path, w };
}
const lines = (path: string) => readFileSync(path, "utf8").split("\n");

describe("journal durability", () => {
  it("ACCEPTANCE (recover): a torn final fragment is discarded, reported, and the world resumes", () => {
    const { path, w } = persisted();
    const intact = statSync(path).size;
    const FRAGMENT = '{"index":999,"tick":6,"type":"TICK_ST';
    appendFileSync(path, FRAGMENT); // crash mid-append: no newline, not JSON
    const r = restartFrom(path);
    expect(r.headHash).toBe(w.headHash); // every complete entry kept
    expect(r.state).toEqual(w.state);
    expect(r.lastRecovery).toEqual({
      tornTail: { offset: intact, bytes: FRAGMENT.length, sha256: createHash("sha256").update(FRAGMENT).digest("hex") },
      unterminatedFinalEntry: false,
    });
    expect(statSync(path).size).toBe(intact); // repaired: next append starts clean
    drive(r, 3); // resumes, journals the recovery, persists cleanly
    const rec = r.entries().filter((e) => e.type === "JOURNAL_TAIL_RECOVERED");
    expect(rec).toHaveLength(1);
    expect(rec[0].tick).toBe(6);
    expect(restartFrom(path).headHash).toBe(r.headHash); // reloads with nothing torn
  });

  it("ACCEPTANCE (fail): a torn COMPLETE-looking line fails loudly — never discarded", () => {
    const { path } = persisted();
    // newline-terminated, so it is a complete line — but its content is cut off
    appendFileSync(path, '{"index":999,"tick":6,"type":"TICK_ST\n');
    expect(() => restartFrom(path)).toThrow(/complete but unparseable/);
    expect(lines(path).at(-2)).toContain("TICK_ST"); // and nothing was truncated
  });

  it("a complete line that parses but breaks the chain fails loudly, wherever it is", () => {
    const { path } = persisted();
    const ls = lines(path);
    const tampered = JSON.parse(ls[4]);
    tampered.payload = { ...tampered.payload, forged: true };
    ls[4] = JSON.stringify(tampered);
    writeFileSync(path, ls.join("\n"));
    expect(() => restartFrom(path)).toThrow(/verification/);
    // last line too
    const p2 = persisted().path;
    const l2 = lines(p2);
    const last = JSON.parse(l2.at(-2) as string);
    last.payload = { ...last.payload, stateHash: "0".repeat(64) };
    l2[l2.length - 2] = JSON.stringify(last);
    writeFileSync(p2, l2.join("\n"));
    expect(() => restartFrom(p2)).toThrow(/verification/);
  });

  it("a blank complete line in the middle is corruption, not a torn write", () => {
    const { path } = persisted();
    const ls = lines(path);
    ls.splice(3, 0, "");
    writeFileSync(path, ls.join("\n"));
    expect(() => Journal.loadFromFile(path)).toThrow(/complete but unparseable/);
  });

  it("a final entry that is whole but lost only its newline is KEPT, terminated, and reported", () => {
    const { path, w } = persisted();
    writeFileSync(path, readFileSync(path, "utf8").replace(/\n$/, "")); // strip the last newline only
    const r = restartFrom(path);
    expect(r.headHash).toBe(w.headHash); // the final entry (a TICK_COMMIT) was not dropped
    expect(r.lastRecovery).toMatchObject({ tornTail: null, unterminatedFinalEntry: true });
    expect(readFileSync(path, "utf8").endsWith("\n")).toBe(true);
    drive(r, 1);
    expect(restartFrom(path).headHash).toBe(r.headHash);
  });

  it("a crash mid-tick (complete lines, no commit) fails loudly and names what is uncommitted — nothing dropped", () => {
    const { path } = persisted(3);
    const extra = World.create(7, baseConfig());
    drive(extra, 4); // the same world one tick further, in memory
    const tick4 = extra.entries().filter((e) => e.tick === 4 && e.type !== "TICK_COMMIT");
    appendFileSync(path, tick4.slice(0, 3).map((e) => JSON.stringify(e) + "\n").join("") + '{"index":');
    expect(() => restartFrom(path)).toThrow(/entries \d+\.\.\d+ \(tick 4\) are uncommitted\. Nothing was dropped\./);
    // the torn fragment was removed; the three complete tick-4 lines were kept
    const after = readFileSync(path, "utf8");
    expect(after.endsWith("\n")).toBe(true);
    expect(after.trim().split("\n").filter((l) => JSON.parse(l).tick === 4)).toHaveLength(3);
  });

  it("per-entry flush: every persisted entry is its own newline-terminated line", () => {
    const { path, w } = persisted(4);
    const raw = readFileSync(path, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    const ls = raw.slice(0, -1).split("\n");
    expect(ls).toHaveLength(w.entries().length);
    ls.forEach((l, i) => expect(JSON.parse(l).index).toBe(i));
  });

  it("a clean file reports nothing and changes nothing", () => {
    const { path } = persisted();
    const before = readFileSync(path, "utf8");
    const r = restartFrom(path);
    expect(r.lastRecovery).toBeNull();
    expect(readFileSync(path, "utf8")).toBe(before);
    drive(r, 1);
    expect(r.entries().some((e) => e.type === "JOURNAL_TAIL_RECOVERED")).toBe(false);
  });

  it("a forged recovery record is refused on restore", () => {
    const { w } = persisted();
    const j = new Journal();
    for (const e of w.entries()) j.append({ tick: e.tick, type: e.type, actor: e.actor, payload: { ...e.payload } });
    j.append({ tick: 5, type: "JOURNAL_TAIL_RECOVERED", actor: "engine", payload: { tornTail: null, unterminatedFinalEntry: false } });
    j.append({ tick: 5, type: "TICK_COMMIT", actor: "engine", payload: {} });
    expect(() => World.restore(j)).toThrow(/JOURNAL_TAIL_RECOVERED invariant violated/);
  });
});
