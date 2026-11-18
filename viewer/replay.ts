// Nexus Isles — world viewer: journal replay (read-only).
//
// The viewer derives every displayed state by replaying the journal from
// genesis through the engine's own reducer — the same `reduce` fold that
// World.restore performs — and snapshots the state at each TICK_COMMIT.
// It never reads a snapshot file, never reads stored world state, and
// never opens the journal for writing: the file is loaded with the plain
// Journal.loadFromFile (no repair, no writer lock), so a viewing can
// leave no trace on the world it views.
//
// Every frame is cross-checked against the state hash the engine itself
// journaled in that tick's TICK_COMMIT. A frame whose replayed hash does
// not match the journaled hash is not displayed: replay aborts instead.

import { Journal } from "../ledger/journal.js";
import { hashState, reduce, type WorldState } from "../engine/world/state.js";

/** World state at one committed tick, derived purely by journal replay. */
export interface TickFrame {
  /** World tick this frame shows (the tick the TICK_COMMIT sealed). */
  tick: number;
  /** Journal index of the TICK_COMMIT entry that sealed this tick. */
  commitIndex: number;
  /** Hash of the journal entry at the commit (the chain head at this tick). */
  commitHash: string;
  /** hashState of the replayed state. */
  stateHash: string;
  /** The state hash the engine journaled in the TICK_COMMIT payload. */
  journaledStateHash: string;
  /** The replayed world state at this tick. */
  state: WorldState;
}

/**
 * Load a journal JSONL file for viewing. Read-only: no repair is applied
 * and no lock is taken, so the file's bytes are exactly as found.
 */
export function loadJournalForViewing(path: string): Journal {
  return Journal.loadFromFile(path);
}

/**
 * Replay a journal into one frame per committed tick, genesis first.
 * Mirrors World.restore's discipline: a journal that ends mid-tick (no
 * closing TICK_COMMIT) is refused, never silently half-shown.
 */
export function replayFrames(journal: Journal): TickFrame[] {
  const frames: TickFrame[] = [];
  let state: WorldState | null = null;
  const entries = journal.entries();
  for (const entry of entries) {
    state = reduce(state, entry);
    if (entry.type !== "TICK_COMMIT") continue;
    const journaled = entry.payload.stateHash;
    if (typeof journaled !== "string") {
      throw new Error(`TICK_COMMIT at index ${entry.index} carries no stateHash to check the replay against`);
    }
    const replayed = hashState(state);
    if (replayed !== journaled) {
      throw new Error(
        `replay diverged at tick ${entry.tick} (journal index ${entry.index}): ` +
          `replayed state hash ${replayed} != journaled state hash ${journaled}`,
      );
    }
    frames.push({
      tick: entry.tick,
      commitIndex: entry.index,
      commitHash: entry.hash,
      stateHash: replayed,
      journaledStateHash: journaled,
      state: structuredClone(state),
    });
  }
  const last = entries[entries.length - 1];
  if (!last || last.type !== "TICK_COMMIT") {
    throw new Error(
      "journal ends mid-tick (no closing TICK_COMMIT): the uncommitted tail is not viewable state. Nothing was dropped.",
    );
  }
  return frames;
}
