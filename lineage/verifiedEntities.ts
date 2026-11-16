// Nexus Isles — entities from VALIDATED history only.
//
// deriveEntities() reads raw entries and applies its own journal-only
// checks. This wrapper is the path status claims must use: it first
// verifies the hash chain, then replays the whole journal through the world
// reducer (which re-validates every record against world state and throws on
// any it cannot justify), and only then derives. If the derivation itself
// rejected any succession record, that is an error too — a validated journal
// contains none. Dynasty and family status therefore come from validated
// history, never from an entry's shape.
//
// What this cannot do (stated plainly): entries are hash-chained, not
// signed. Tampering with or inserting into existing history is detected.
// A party with write access to the journal file who appends a fully
// self-consistent forged tail (authorization, death, succession, and a
// matching state-hash commit) produces history this code cannot tell from
// the engine's. Closing that needs engine-signed entries — a ledger change,
// flagged on #235, not made here.

import type { Journal } from "../ledger/journal.js";
import { World } from "../engine/world/world.js";
import { deriveEntities, type Entities } from "./entities.js";

export function deriveVerifiedEntities(journal: Journal): Entities {
  const v = journal.verify();
  if (!v.ok) {
    throw new Error(`journal failed verification at index ${v.firstBadIndex}: ${v.reason}`);
  }
  World.restore(journal); // throws if any record is not justified by replayed state
  const entities = deriveEntities(journal.entries());
  if (entities.rejectedSuccessions.length > 0) {
    const r = entities.rejectedSuccessions[0];
    throw new Error(`journal carries an invalid succession record at index ${r.journalIndex}: ${r.reason}`);
  }
  return entities;
}
