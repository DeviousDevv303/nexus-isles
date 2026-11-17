# Observer (build order step 6 — journal-derived reporting implemented)

report.ts derives every displayed number from the journal and nothing
else (Annex A.1, Truthful Interface): totals, per-type counts, per-actor
action counts, resolved ticks, console events, deaths. Deterministic —
the same journal derives the same report, including after save/load, so
journal replay reproduces the displayed world (tests/at18). The live
viewer feed and benchmark report formats build on this derivation.
