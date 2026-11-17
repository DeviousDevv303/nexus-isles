# Observer (build order step 6 — journal-derived reporting implemented)

report.ts derives every displayed number from the journal and nothing
else (Annex A.1, Truthful Interface): totals, per-type counts, per-actor
action counts, resolved ticks, console events, deaths. Deterministic —
the same journal derives the same report, including after save/load, so
journal replay reproduces the displayed world (tests/at18). The live
viewer feed and benchmark report formats build on this derivation.

## T8 — Núñez identity presentation

`WorldReport.charterIdentityProfile` carries the fixed profile from
`lineage/nunezIdentity.ts` with `evidenceClass: "charter-profile"` and
`worldStatus: "not-asserted-by-profile"`. This is a separate identity card,
not journal-derived evidence that a Núñez lineage, sitter, Throne asset, spider
swarm, or tactical equipment exists in-world. The report makes no score or
mechanics claim from the profile.
