// AT-09 (historical record) — the console half: interventions exist only
// as journaled EXTERNAL_EVENTs, recorded before the tick they affect,
// with the owner's words verbatim. C3's double-confirm + typed reason is
// enforced in code, and there is no rollback path.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Journal } from "../../ledger/journal.js";
import { submitConsoleEvent, type ConsoleSubmission } from "../../console/console.js";

function submission(overrides: Partial<ConsoleSubmission> = {}): ConsoleSubmission {
  return {
    consoleClass: "C1",
    intent: "raise storm frequency",
    diff: "weather.stormRate: 0.10 -> 0.15",
    verbatim: "make storms a bit more common",
    confirmed: true,
    affectsTick: 3,
    ...overrides,
  };
}

describe("owner console EXTERNAL_EVENT pipeline (AT-09)", () => {
  it("a confirmed intervention journals verbatim and the chain verifies", () => {
    const journal = new Journal();
    const index = submitConsoleEvent(journal, submission());
    const entry = journal.entries()[index];
    expect(entry?.type).toBe("EXTERNAL_EVENT");
    expect(entry?.actor).toBe("owner-console");
    expect((entry?.payload as { verbatim: string }).verbatim).toBe(
      "make storms a bit more common",
    );
    expect(journal.verify()).toEqual({ ok: true, length: 1 });
  });

  it("unconfirmed input is a draft — it never becomes an event", () => {
    const journal = new Journal();
    expect(() => submitConsoleEvent(journal, submission({ confirmed: false }))).toThrow(
      /draft/,
    );
    expect(journal.length).toBe(0);
  });

  it("C3 demands double confirmation and a typed reason", () => {
    const journal = new Journal();
    const c3 = submission({ consoleClass: "C3", intent: "zero a tombstone archive" });
    expect(() => submitConsoleEvent(journal, c3)).toThrow(/double confirmation/);
    expect(() =>
      submitConsoleEvent(journal, { ...c3, doubleConfirmed: true }),
    ).toThrow(/typed reason/);
    const index = submitConsoleEvent(journal, {
      ...c3,
      doubleConfirmed: true,
      reason: "owner-directed cleanup",
    });
    expect(journal.entries()[index]?.type).toBe("EXTERNAL_EVENT");
  });

  it("there is no rollback, whatever the intent calls itself", () => {
    const journal = new Journal();
    expect(() =>
      submitConsoleEvent(journal, submission({ intent: "rollback to tick 2" })),
    ).toThrow(/no rollback/);
  });

  it("an event cannot target an already-resolved tick", () => {
    const journal = new Journal();
    journal.append({ tick: 3, actor: "engine", type: "TICK_COMMIT", payload: {} });
    expect(() => submitConsoleEvent(journal, submission({ affectsTick: 3 }))).toThrow(
      /already resolved/,
    );
    // The next tick is still open to intervention.
    expect(submitConsoleEvent(journal, submission({ affectsTick: 4 }))).toBe(1);
  });

  it("console events survive save/load with the chain intact", () => {
    const dir = mkdtempSync(join(tmpdir(), "nexus-isles-console-"));
    const path = join(dir, "journal.jsonl");
    const journal = new Journal();
    submitConsoleEvent(journal, submission());
    journal.saveToFile(path);
    const loaded = Journal.loadFromFile(path);
    expect(loaded.verify()).toEqual({ ok: true, length: 1 });
    expect(loaded.entries()[0]?.type).toBe("EXTERNAL_EVENT");
  });
});
