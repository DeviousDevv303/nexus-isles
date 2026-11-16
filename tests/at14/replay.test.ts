// AT-14 (replay) foundations: folding the same journal through the same
// reducer always reproduces the same state — including after a save/load
// round-trip. This is the property every benchmark report and every
// interface-truth rendering stands on (Annex A.1).

import { describe, expect, it } from "vitest";
import { Journal, replay, type JournalEntry } from "../../ledger/journal.js";

interface Counters {
  gathers: number;
  deaths: number;
}

function reducer(state: Counters, entry: JournalEntry): Counters {
  if (entry.type === "ACTION" && entry.payload.verb === "gather") {
    return { ...state, gathers: state.gathers + Number(entry.payload.n ?? 0) };
  }
  if (entry.type === "DEATH") {
    return { ...state, deaths: state.deaths + 1 };
  }
  return state;
}

function sampleJournal(): Journal {
  const j = new Journal();
  j.append({ tick: 0, type: "WORLD_GENESIS", actor: "engine", payload: { seed: 11 } });
  j.append({ tick: 1, type: "ACTION", actor: "resident-a", payload: { verb: "gather", n: 3 } });
  j.append({ tick: 1, type: "ACTION", actor: "resident-b", payload: { verb: "gather", n: 5 } });
  j.append({ tick: 2, type: "DEATH", actor: "engine", payload: { resident: "resident-b", cause: "starvation" } });
  return j;
}

describe("replay determinism (AT-14 foundations)", () => {
  it("folds the journal to the expected state", () => {
    const state = replay(sampleJournal(), { gathers: 0, deaths: 0 }, reducer);
    expect(state).toEqual({ gathers: 8, deaths: 1 });
  });

  it("two replays of the same journal are identical", () => {
    const j = sampleJournal();
    const a = replay(j, { gathers: 0, deaths: 0 }, reducer);
    const b = replay(j, { gathers: 0, deaths: 0 }, reducer);
    expect(a).toEqual(b);
  });

  it("replay after save/load reproduces the identical state", () => {
    const j = sampleJournal();
    const path = "/tmp/nexus-isles-test-replay.jsonl";
    j.saveToFile(path);
    const loaded = Journal.loadFromFile(path);
    const a = replay(j, { gathers: 0, deaths: 0 }, reducer);
    const b = replay(loaded, { gathers: 0, deaths: 0 }, reducer);
    expect(b).toEqual(a);
  });
});
