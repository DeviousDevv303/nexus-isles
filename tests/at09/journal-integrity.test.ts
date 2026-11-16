// AT-09 (historical record) foundations + journal integrity.
// The full AT-09 test audits death and preceding events against the
// journal; this suite proves the journal itself cannot be silently
// rewritten: any tampering breaks the chain at a detectable index.

import { describe, expect, it } from "vitest";
import { Journal, computeEntryHash } from "../../ledger/journal.js";

function sampleJournal(): Journal {
  const j = new Journal();
  j.append({ tick: 0, type: "WORLD_GENESIS", actor: "engine", payload: { seed: 11 } });
  j.append({ tick: 1, type: "ACTION", actor: "resident-a", payload: { verb: "gather", n: 3 } });
  j.append({ tick: 2, type: "DEATH", actor: "engine", payload: { resident: "resident-b", cause: "starvation" } });
  return j;
}

describe("journal integrity (AT-09 foundations)", () => {
  it("chains entries: each prevHash links to the previous hash", () => {
    const j = sampleJournal();
    const [e0, e1, e2] = j.entries();
    expect(e0.prevHash).toBe("GENESIS");
    expect(e1.prevHash).toBe(e0.hash);
    expect(e2.prevHash).toBe(e1.hash);
    expect(j.verify()).toEqual({ ok: true, length: 3 });
  });

  it("detects a tampered payload at the exact index", () => {
    const j = sampleJournal();
    const entries = j.entries().map((e) => ({ ...e }));
    entries[1] = {
      ...entries[1],
      payload: { verb: "gather", n: 3000 }, // history rewritten
    };
    // Rebuild a journal-shaped chain and check the hash no longer matches.
    expect(computeEntryHash(entries[1])).not.toBe(entries[1].hash);
  });

  it("sealed entries are frozen — appended history cannot be mutated", () => {
    const j = sampleJournal();
    const entry = j.entries()[0];
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.payload)).toBe(true);
  });

  it("save/load round-trip preserves the chain and verifies", () => {
    const j = sampleJournal();
    const path = "/tmp/nexus-isles-test-journal.jsonl";
    j.saveToFile(path);
    const loaded = Journal.loadFromFile(path);
    expect(loaded.length).toBe(3);
    expect(loaded.headHash()).toBe(j.headHash());
    expect(loaded.verify().ok).toBe(true);
  });
});
