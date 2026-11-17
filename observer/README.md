# Observer (build order step 6 — journal-derived reporting implemented)

report.ts derives every displayed number from the journal and nothing
else (Annex A.1, Truthful Interface): totals, per-type counts, per-actor
action counts, resolved ticks, console events, deaths. Deterministic —
the same journal derives the same report, including after save/load, so
journal replay reproduces the displayed world (tests/at18). The live
viewer feed and benchmark report formats build on this derivation.

## dynasty-score-v1 (Phase 1 task T7)

`dynastyScore.ts` implements constitution v0.6.7 Annex B from journal entries
only. Epochs are opened and closed through the world (`World.openEpoch`,
`World.closeEpoch`); the open entry journals the formula id, weights and the
readings in force; the close entry journals the score, MISSING axes included.
`verifyScores.ts` re-derives every journaled score from validated history.

Weights are the owner-adopted set. PROVISIONAL readings (owner-ratification
items): `control-v0` (territory control), `succession-v0` (successor
continuity), `active-in-epoch-v0`, `zero-max-v0`, `no-improvements-v0`.
MISSING until the engine has them: verified artifacts, wealth-resilience.
