// AT-01 (determinism) — the dry-run harness property: a scripted epoch
// run twice from the same seed produces a byte-identical journal (same
// entries, same hash chain head). This is the assertion the seeded
// dry-run epoch (1h x 8, SIM-marked) is graded on.

import { describe, expect, it } from "vitest";
import { runScriptedEpoch } from "../../fixtures/dryrun.js";

describe("scripted epoch determinism (AT-01)", () => {
  it("same seed: identical entries and identical chain head, twice", () => {
    const a = runScriptedEpoch(2026);
    const b = runScriptedEpoch(2026);
    expect(JSON.stringify(a.entries())).toBe(JSON.stringify(b.entries()));
    expect(a.headHash()).toBe(b.headHash());
    expect(a.verify()).toEqual({ ok: true, length: a.length });
  });

  it("different seed: a different history", () => {
    const a = runScriptedEpoch(2026);
    const b = runScriptedEpoch(2027);
    expect(a.headHash()).not.toBe(b.headHash());
  });

  it("the epoch covers 8 resolved ticks by default", () => {
    const journal = runScriptedEpoch(7);
    const resolved = journal.entries().filter((e) => e.type === "TICK_COMMIT");
    expect(resolved).toHaveLength(8);
  });
});
