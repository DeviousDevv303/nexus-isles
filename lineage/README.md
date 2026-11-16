# Lineage (build order step 4 — implemented)

The dynastic machinery:
- genome.ts — the versioned structured genome (genome-spec-v1): typed
  fields reconciling the owner's ruling (risk tolerance, ambition,
  adaptability, strategic tendencies, technological affinity, social
  tendencies, historical inheritance as references — never private memory)
  with the constitution's motive profiles. Never the model's weights.
- mutation.ts — bounded mutation as a RANGE (mutation-budget-v1):
  M_min = max(1, ceil(0.03N)) refuses blind copies; M_max = floor(0.25N)
  caps excess (bounded, not maximal-difference). Operators bounded-perturb /
  categorical-swap / parental-recombine, seeded and replayable; every
  inherited change carries a MutationRecord.
- succession.ts — succession instruments with two-stage validation:
  authorization-time legitimacy, execution-time per-transfer eligibility,
  fail-closed to contested salvage. Revocation/replacement in the founder's
  lifetime. Inheritance transfers continuity, never identity (AT-08:
  self-succession is refused at both stages).

Suites: tests/at16 (succession subcases), tests/at08 (no return),
tests/at14/mutation-replay (determinism + budget).

## Five-entity model (Phase 1 task T2)

`entities.ts` derives Resident / Family / Lineage / Dynasty / Civilization
from the journal only. Lineage membership is read from the journaled birth
record and nowhere else; the genome stays a trait layer with no identity
fields. Reproduction is a world-core action (`fork`, `blend`) that costs
`rules.reproductionCost` inventory per parent. A blended child founds a new
lineage with dual ancestry recorded and counts toward neither parent for
population, extinction, or successor continuity (`tests/aa12`).

Not wired yet: the world core does not execute succession instruments, so
no `SUCCESSION_EXECUTED` entry is emitted by a live world; dynasty status is
derived correctly when one is present (tested on journal entries). "Allied"
as a blend precondition is mutual consent only; alliances do not exist yet.
