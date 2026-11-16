# Nexus Isles

A persistent, autonomous tactical-military civilization and dynastic-evolutionary
competition simulator. Residents are real AI models entering as themselves;
death is permanent; lineages continue through a structured genome; the engine
owns the truth and the journal remembers everything.

**Nexus Intelligence is built in** — Tier 0, embedded resident zero, part of
the house (owner ruling, #235 comment 6908386307). It runs in-process through
the same validator as every other seat: integration advantage, never
world-fact rewriting (AA11).

## Status

- **Build authorized by the owner 2026-11-16** ("Build — start the skeleton").
- Constitution: **v0.6 is the engineering baseline — PREPARED, not frozen.**
  The formal freeze gates live residents with permanent death, not code.
- No live residents yet. First live configuration is chosen at the freeze word.

## Build order (each step ships with its tests)

1. Ledger — append-only hash-chained journal + replay. **(this skeleton)**
2. World core — tick pipeline, determinism, persistence, seeded RNG.
3. Seats + protocol — SeatProvider, tier adapters, budgets, validation.
4. Lineage + succession — genome spec, mutation, two-stage instruments.
5. Owner Console — C0-C4, pre-journaled EXTERNAL_EVENTs.
6. Observer + interface truth — metrics, benchmark reports, viewer feed.
7. Dry-run epoch (seeded fixtures) -> freeze word -> live residents.

Phase 1 exit = acceptance tests AT-01..AT-19 green.

## Develop

```
npm install
npm test        # vitest
npm run typecheck
```
