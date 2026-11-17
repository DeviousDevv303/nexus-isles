// Nexus Isles — Observer: journal-derived reporting (build step 6).
//
// Annex A.1 (the Truthful Interface) applied to reporting: every number
// the observer shows is a deterministic derivation from the journal —
// never an off-ledger tally, never a score the engine did not record.
// Same journal in -> same report out, including after a save/load cycle
// (AT-18: journal replay reproduces the same displayed world).

import type { Journal } from "../ledger/journal.js";

// Two vocabularies reach the observer: the world core's (TICK_COMMIT,
// ACTION_ACCEPTED / ACTION_REJECTED, actor = seat) and the journal-level
// dry-run fixture's (TICK_RESOLVED, ACTION). Both are counted. The world
// core also writes a TICK_COMMIT for genesis at tick 0; that is not a
// resolved tick of play and is not counted.

export interface WorldReport {
  totalEntries: number;
  resolvedTicks: number;
  externalEvents: number;
  byType: Record<string, number>;
  actionsByActor: Record<string, number>;
  /** Rejected actions by seat (world core only; the fixture has none). */
  rejectedByActor: Record<string, number>;
  /** Actors with a journaled DEATH entry, in journal order. */
  deaths: string[];
}

export function deriveReport(journal: Journal): WorldReport {
  const byType: Record<string, number> = {};
  const actionsByActor: Record<string, number> = {};
  const rejectedByActor: Record<string, number> = {};
  const deaths: string[] = [];
  let resolvedTicks = 0;
  let externalEvents = 0;

  for (const entry of journal.entries()) {
    byType[entry.type] = (byType[entry.type] ?? 0) + 1;
    if (entry.type === "TICK_RESOLVED") resolvedTicks += 1;
    if (entry.type === "TICK_COMMIT" && entry.tick > 0) resolvedTicks += 1;
    if (entry.type === "EXTERNAL_EVENT") externalEvents += 1;
    if (entry.type === "ACTION" || entry.type === "ACTION_ACCEPTED") {
      actionsByActor[entry.actor] = (actionsByActor[entry.actor] ?? 0) + 1;
    }
    if (entry.type === "ACTION_REJECTED") {
      rejectedByActor[entry.actor] = (rejectedByActor[entry.actor] ?? 0) + 1;
    }
    if (entry.type === "DEATH") {
      // The world core journals DEATH with actor "engine" and the deceased
      // in payload.resident; older fixtures used the actor. Take the
      // resident when present, else the actor.
      const resident = (entry.payload as { resident?: unknown }).resident;
      deaths.push(typeof resident === "string" ? resident : entry.actor);
    }
  }

  return {
    totalEntries: journal.length,
    resolvedTicks,
    externalEvents,
    byType,
    actionsByActor,
    rejectedByActor,
    deaths,
  };
}
