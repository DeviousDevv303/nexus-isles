# Fixtures (build order step 7 prep — implemented)

Seeded edge cases for the dry run, as data:
- edge-cases.json — succession cases (valid, fortress-lost-before-death,
  revoked, expired, dead successor) with serialized contexts and expected
  outcomes, executed by tests/at16/fixtures.test.ts; mutation-budget
  rounding cases at three genome sizes, executed by
  tests/at14/mutation-fixtures.test.ts.
- dryrun.ts — the scripted epoch: a seed-driven 8-tick journal used to
  prove byte-identical determinism (tests/at01/dryrun-determinism.test.ts)
  before the world core drives a real epoch against the same property.
