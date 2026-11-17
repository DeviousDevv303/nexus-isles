// AT-18 (Interface Truth) — the reporting half: every displayed number
// is a deterministic derivation from the journal. Same journal in, same
// report out — including after the journal is saved and reloaded, so a
// replayed world displays identically to the live one.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Journal } from "../../ledger/journal.js";
import { submitConsoleEvent } from "../../console/console.js";
import { deriveReport } from "../../observer/report.js";

function sampleJournal(): Journal {
  const journal = new Journal();
  journal.append({ tick: 0, actor: "engine", type: "WORLD_INIT", payload: {} });
  journal.append({ tick: 1, actor: "resident-a", type: "ACTION_ACCEPTED", payload: { verb: "gather" } });
  journal.append({ tick: 1, actor: "resident-b", type: "ACTION_ACCEPTED", payload: { verb: "gather" } });
  journal.append({ tick: 1, actor: "resident-a", type: "ACTION_ACCEPTED", payload: { verb: "build" } });
  journal.append({ tick: 1, actor: "engine", type: "TICK_COMMIT", payload: {} });
  journal.append({ tick: 2, actor: "resident-b", type: "DEATH", payload: { cause: "starvation" } });
  submitConsoleEvent(journal, {
    consoleClass: "C4",
    intent: "extend the epoch",
    diff: "epoch.ticks: 40 -> 48",
    verbatim: "give them more time",
    confirmed: true,
    affectsTick: 5,
  });
  return journal;
}

describe("journal-derived reporting (AT-18)", () => {
  it("the report matches the journal exactly — nothing off-ledger", () => {
    const report = deriveReport(sampleJournal());
    expect(report.totalEntries).toBe(7);
    expect(report.resolvedTicks).toBe(1);
    expect(report.externalEvents).toBe(1);
    expect(report.actionsByActor).toEqual({ "resident-a": 2, "resident-b": 1 });
    expect(report.deaths).toEqual(["resident-b"]);
    expect(report.byType.ACTION_ACCEPTED).toBe(3);
  });

  it("derivation is deterministic: same journal, same report, twice", () => {
    const journal = sampleJournal();
    expect(deriveReport(journal)).toEqual(deriveReport(journal));
  });

  it("a reloaded journal derives the identical report (replay = display)", () => {
    const dir = mkdtempSync(join(tmpdir(), "nexus-isles-observer-"));
    const path = join(dir, "journal.jsonl");
    const journal = sampleJournal();
    journal.saveToFile(path);
    const loaded = Journal.loadFromFile(path);
    expect(deriveReport(loaded)).toEqual(deriveReport(journal));
  });

  it("an empty journal derives an empty report — no invented state", () => {
    const report = deriveReport(new Journal());
    expect(report.totalEntries).toBe(0);
    expect(report.deaths).toEqual([]);
    expect(report.actionsByActor).toEqual({});
  });
});
