# World core (build order step 2)

Deterministic tick pipeline on compressed asynchronous ticks (the owner's
dynastic ruling's governing model). Time is the integer tick; no wall-clock
value enters the journal.

| File | Role |
|---|---|
| `world.ts` | The 12-step tick pipeline, restart/restore, snapshot cache |
| `state.ts` | `WorldState` + the pure reducer. Journal entries record outcomes (deltas); state = `replay(journal)` |
| `validator.ts` | The single action validator every seat passes through (AA11) |
| `rng.ts` | Stateless seeded streams keyed by (seed, tick, name); seed is journaled in `WORLD_GENESIS` |

Rules: `ledger/journal.ts` is untouched. Cross-seat submission order never
matters (AA8): actions are canonicalised by (seatId, per-seat sequence) and
contention is a seeded shuffle. Snapshots are caches, verified against the
journal's own `TICK_COMMIT` state hash and ignored on any mismatch.

Known limits (by design, this step): placeholder economy (food/satiety),
uniform observation view (fog/geography land with the island map), queued
but un-ticked actions are not history and are lost on restart, `tokensPerTick`
is a seat-side budget not yet enforced by the engine.
