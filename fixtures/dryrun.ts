// Nexus Isles — the scripted dry-run epoch (build order step 7 prep).
//
// A deterministic, seed-driven mini-epoch at the journal level: WORLD_INIT,
// then per tick a seeded number of scripted resident ACTIONs and a
// TICK_RESOLVED. It exists to prove the harness property the dry run is
// graded on — same seed, byte-identical journal — before the world core's
// full pipeline drives a real epoch. When the world core drives it, this
// script is the fixture the epoch is checked against, not a second engine.

import { Journal } from "../ledger/journal.js";
import { seededRng } from "../lineage/mutation.js";

const ROSTER = ["resident-a", "resident-b", "resident-c"];
const VERBS = ["gather", "build", "observe", "trade"];

export function runScriptedEpoch(seed: number, ticks = 8): Journal {
  const journal = new Journal();
  const rng = seededRng(seed);
  journal.append({ tick: 0, actor: "engine", type: "WORLD_INIT", payload: { seed } });
  for (let tick = 1; tick <= ticks; tick++) {
    const actionCount = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < actionCount; i++) {
      const actor = ROSTER[Math.floor(rng() * ROSTER.length)];
      const verb = VERBS[Math.floor(rng() * VERBS.length)];
      journal.append({ tick, actor, type: "ACTION", payload: { verb } });
    }
    journal.append({ tick, actor: "engine", type: "TICK_RESOLVED", payload: {} });
  }
  return journal;
}
