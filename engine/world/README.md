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

## AA8 contention — `contention-v1` (S2 path a, owner ruling 2026-11-16)

`contention.ts` is the executable AA8 formula. Per node per tick, claims are
ordered by **committed effort (high first) → initiative (high first) → seeded
draw (low first)**, then allocated `min(requested, remaining)` down that
order. Effort is an optional integer `args.effort` (default 1, max
`rules.maxEffort`, default 3); it costs `effort − 1` satiety, spent win or
lose (`EFFORT_SPENT`). Initiative is a resident stat (`initiative`, default
0). The tiebreak draw is a uint32 from `rngFor(seed, tick, "conflict:<node>")`
taken in canonical claim order, journaled with the claim.

Journaled: the formula ID in `WORLD_GENESIS` rules, in every
`CONTENTION_RESOLVED` (all inputs + ranks + grants) and every
`GATHER_GRANTED`. Replay re-runs `resolveContention` on the journaled inputs
and must reproduce the journaled grants (`tests/at15/aa8-formula.test.ts`).
The order never reads request size, seat id, tier, provider, or arrival time.

**Status, stated plainly:** AT-15 is green against `contention-v1` as
proposed here. The constitution states AA8 as a principle only; the numeric
parameters (effort cost, `maxEffort`, initiative source) are this build's
proposal and need the owner's ratification before being called frozen. Grants
are still whole-request in priority order (the last claimant may receive a
remainder); that is a stated property of v1, not a hidden one.

## Map, travel, observation (Phase 1 task T6)

`map.ts` is the graph: regions, edges, optional per-tick crossing capacity.
`maps/juarez.ts` is Phase 1's first environment (Ciudad Juárez and El Paso,
three international bridges and one river crossing as capped chokepoints).
With a map set: residents have a position and an intel radius; `move` goes
one edge per tick; you gather where you stand; blend partners must share a
region; capped crossings are resolved by contention-v1's priority order and
journaled (`CROSSING_RESOLVED`, `MOVED`, `MOVE_DENIED`); observations show
only regions within the resident's radius (AT-06). Without a map the world
keeps the old uniform view. All map numbers (capacities, intel default,
node placement) are Phase 1 proposals.
