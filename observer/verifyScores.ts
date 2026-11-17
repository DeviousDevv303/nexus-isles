// Re-derive every journaled dynasty score from validated history and refuse
// any that doesn't match. A score in the journal is a claim; this checks it.

import { canonicalStringify, type Journal } from "../ledger/journal.js";
import { World } from "../engine/world/world.js";
import { scoreEpoch } from "./dynastyScore.js";

export function verifyEpochScores(journal: Journal): number {
  World.restore(journal); // chain + reducer replay: history itself is valid
  const entries = journal.entries();
  let checked = 0;
  entries.forEach((e, i) => {
    if (e.type !== "EPOCH_SCORED") return;
    const again = scoreEpoch(entries.slice(0, i), e.payload.epoch as string, e.payload.endTick as number);
    if (canonicalStringify(again) !== canonicalStringify(e.payload)) {
      throw new Error(`journaled score for epoch ${String(e.payload.epoch)} at index ${i} does not match the journal`);
    }
    checked++;
  });
  return checked;
}
