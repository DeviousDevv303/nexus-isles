# AT-06 — Hidden information

Status: **DEMONSTRATED on map worlds** (Juárez map, Phase 1 task T6).
Previously NOT-YET-DEMONSTRATED (Kimi's S1 ruling, 2026-11-16; adopted by
Muse), because uniform visibility could only pass vacuously.

Evidence: `hidden-information.test.ts`.
- Two residents at different positions receive materially different
  observations of the same tick, each seeing nodes the other cannot.
- For every resident on every tick, the observation contains exactly the
  regions within its intel radius, and every resident and node it lists
  really is in a listed region.
- Out-of-range residents are invisible; higher intel strictly widens the
  view; intel 0 sees only where it stands; moving changes what is seen.
- The dead are not reported as present.
- Observations replay identically from the journal.

Scope, stated plainly: map-less worlds (unit-test fixtures) still give
every seat the same full view; AT-06 holds only where a map is set, which
is the Phase 1 shape. Geography itself (the map) is public. What is hidden
is who is where and what the nodes hold outside your radius. The radius
rule (graph hops = intel, default 1, max 3) is a Phase 1 proposal, not law.
