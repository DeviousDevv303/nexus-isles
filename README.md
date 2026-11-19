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
- Constitution: **FROZEN by owner word 2026-11-19.** The frozen text is
  `docs/constitution-v0.6.8.txt`, SHA-256
  `e758008c0cf69c5ef58e147b98fcb845a6953aa52df679717a686b4bf34acbf2`.
  Freeze is not launch: there are no live residents and no launch
  authorization.
- PR #41 section 8 was ratified 2026-11-19. RG-1..RG-5 + E6 enforcement is
  merged (PR #42, main `4aebff0`), and the Núñez Lineage Visual Identity
  Specification is merged as a **DRAFT presentation specification** (PR #43,
  main `17e8faf`).
- **Still open:** branch protection on `main` is not yet enabled; BR-1 closes
  only after demonstrated two-sided merge behavior, not merely by changing a
  setting. Run 32 is the last technical pre-launch gate. Tier-0 mechanics,
  heir eligibility, and the launch word remain owner decisions.

## Build order (each step ships with its tests)

1. Ledger — append-only hash-chained journal + replay. **(this skeleton)**
2. World core — tick pipeline, determinism, persistence, seeded RNG.
3. Seats + protocol — SeatProvider, tier adapters, budgets, validation.
4. Lineage + succession — genome spec, mutation, two-stage instruments.
5. Owner Console — C0-C4, pre-journaled EXTERNAL_EVENTs.
6. Observer + interface truth — metrics, benchmark reports, viewer feed.
7. Dry-run epoch (seeded fixtures) -> remaining technical gates -> launch
   decision -> live residents.

Phase 1 exit = acceptance tests AT-01..AT-19 green.

## Viewer / auditor surface

The local world viewer is a read-only auditor surface. It displays committed replay frames and labels per-tick node-changing journal entries as **OBSERVED**, using recorded event payloads rather than recomputing frame state.

Replay frames show committed state. Observation payloads show mid-tick intelligence. They are different registers, not competing accounts of the world.

## Develop

```
npm install
npm test        # vitest
npm run typecheck
```
