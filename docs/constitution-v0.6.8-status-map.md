# v0.6.8 three-status map

Required by ChatGPT's review requirements (forgeclaw #235 comment 6954727096). Every requirement gets
three separate statuses. They are never merged into one green claim:

- **Implemented**: the code or text exists.
- **Tested**: an automated test exercises it.
- **Independently verified**: a lane other than the builder, or CI, checked it on the record.

Base: nexus-isles main `5651670`. "Text" means the requirement is stated in `docs/constitution-v0.6.8.txt`.
Ratification authorizes implementation only. Nothing here claims freeze, deployment or launch readiness.

## A. Constitutional text (this PR)

| Requirement | Implemented | Tested | Independently verified |
|---|---|---|---|
| Every hunk traces to a ruling or erratum (Kimi criterion 1) | Text: 16 hunks, each with a `⟦v0.6.8 · TRACE⟧` line; the Section XIII list matches | Mechanical check: every `-U0` hunk contains a TRACE line (0 untraced) | No (Kimi's pass) |
| Package v1.3 says what it says (Kimi criterion 3) | Text: Section XV is byte-exact from comment 6954630158 (title to closing line) | Mechanical check: the substring matches the comment body (SHA-256 `6e58312c…`) | No (Kimi's pass) |
| E6 carried whole | Text: Section XIV (from 6937172806, typography normalized); Annex B steps 1 and 3 amended | Word-level diff against the ratified draft: typography only | No |
| F-01 exact math | Text: Annex B step 3, plus R1 in Section XV | — | No |
| Directorate tier grants Quinn nothing in validation, scoring, succession or lineage (F-06) | Text: AA11.2 lists four permitted acts and states "nothing else", with explicit zero authority | — | No |
| Two event classes stay distinct (F-10) | Text: Annex C (Section XVI), Safeguard 12, Section XV R2/F-10 | — | No |
| F-11(b) is the active default until the owner taps | Text: status note under Section XV (labelled as not a ruling) | — | No |
| The four v0.6.7 audit items | Text: hunks H2, H4–H7 | — | No |

## B. Code against the rulings

| Requirement | Implemented | Tested | Independently verified |
|---|---|---|---|
| E6 abeyance: no path redistributes missing weight | **Yes**: `observer/dynastyScore.ts:220-227` computes c = Σ present w; s = Σ w·x; average = s/c; subtotal = s. A grep for renormalize or redistribute over every source directory finds only that line | `tests/at21/dynasty-score.test.ts` (MISSING axes kept missing, re-derivation stable) | **Yes**: Muse's F-01 code check, 6954334884 |
| F-01 acceptance: adding a missing axis leaves prior emissions byte-identical | Partial: scores are derived from verified journal prefixes and never stored | `at21` "explicit close boundary stable when later ticks change the world" (a later *tick*, not a later *axis*) | No: **no test adds an axis** |
| F-01 normalization wording | See open item 1 | — | — |
| Directorate seat (Quinn) | **No**: no Quinn or Directorate code exists | — | — |
| Class 1, environmental circumstances engine (climate-v1) | **No**: tick step 2 "environment" is a placeholder; §12.3 gap | — | — |
| Class 2, validated agency actions | Yes: `World.submit` → validator → resolve → journal | AT-07, AT-15, AT-19 suites | CI on main |
| F-11(b): no live research input | Holds by absence: no Qwen or research code exists | — | — |
| R9 provenance: prompt hash and input references | **No**: actions carry backend identity and version only (AT-20); gap disclosed in 6954619011 | — | — |
| R9: replay survives deletion of the deliberation store (F-09) | Yes (inherent) | `tests/aa7/replay-after-deletion.test.ts` (PR #30) | **Yes**: built by Muse, CI run 44129187976; re-run by Claude on `5651670`, passed |
| R6 Fiction Safeguard lint | **No** | — | — |
| R7/F-05 permanent simulation labelling | **No**: no export or label surface audited | — | — |
| R5 / F-07: no institution built before Annex C | Holds by absence: no institution seats exist | — | — |
| R3 Juárez region | Partial: `engine/world/maps/juarez.ts` (map-v1, PROVISIONAL); geo-v1 dataset provenance not built | AT-06 map tests | CI on main |
| Anti-cheating classes (breach, probe) journaled | **No**: invalid actions are refused, but there is no breach or probe class | — | — |
| Defense/counter resolution tests | **No**: no tech tree exists yet | — | — |
| Mixed-cause disease rule | **No**: no disease model exists | — | — |

## C. Duplicate-tick prevention: property-by-property evaluation

These are the six properties from 6954157525. Existing evidence is evaluated first; only the gap gets built.

| # | Property | Evidence | Verdict |
|---|---|---|---|
| 1 | Concurrent duplicate delivery | Across processes: `writer-lock.test.ts` "TWO PROCESSES" (a real child process is refused). Same process, second `World`: "a second writer in this process is refused". Same runner: `runner/runner.ts` `tickOnce` refuses "a tick is already in flight" | **Partial.** The runner guard is untested, and `SeatDriver.tick()` itself has no guard: two overlapping driver ticks would both reach `world.tick()` |
| 2 | Sequential duplicate delivery | None. A tick delivery carries no identity, so a repeated delivery is just another tick | **Gap** |
| 3 | Crash between acceptance and journal write | Console submissions: `console-wal.test.ts` "survives a crash and lands at its tick" and "never lands a submission twice". Seat actions: not persisted before their tick (HANDOFF known flag 3), so they are at most once and never duplicated | **Met** for console. Seat actions can be lost, not doubled (disclosed, by design) |
| 4 | Recovery after partial failure | `journal-durability.test.ts`: torn tail recovered; torn complete line, mid-tick crash and forged recovery record all fail loudly and drop nothing | **Met.** A crash mid-tick needs an operator, by design: loud, not silent |
| 5 | Exactly one durable tick | Indirect: restart and WAL tests compare against an uninterrupted run's journal | **Partial.** No test directly asserts one commit per tick number under duplicate delivery |
| 6 | One consistent hash chain | `restoreFromFile` verifies the full chain before any tick; the chain-break tests | **Met** |

**Named gap (to build next, engine and driver seam, Claude's lane):**
- give each tick delivery an identity, `tick({ expectTick: n })`; a delivery for an already committed tick is refused with nothing written;
- add a single-flight guard in `SeatDriver.tick()`;
- add a fixture that fires the same delivery twice, concurrently and in sequence, plus across a crash window, and asserts exactly one commit per tick number and one verifying chain.

The runner adopting `expectTick` is Muse's call.

## D. Open items for Kimi and ChatGPT (found while folding, not resolved by Claude)

1. **F-01 says x_i is "min-max normalized".** Annex B step 1 and the code both normalize by the maximum (`value / max`, with min taken as 0). Those differ whenever the minimum is above 0. The ruling's wording and the text and code disagree. This needs an owner-visible erratum one way or the other. I left both texts as they are.
2. **Section XV R1 and Section XIV E6 are two ratified wordings of the same law.** R1 has six points and E6 has seven clauses. I found no conflict, but the frozen text carries both.
3. **Title and identity.** The document is still "Nexus Isles"; R3 says "Nexus becomes a living simulation of real Earth" (package title "Nexus Earth"). It is not renamed, because no ruling renames it.
4. **Kept from v0.6.7 because no ruling touches them:** the "AT-01 through AT-19" and "AT-01 through AT-20" tails disagree; Section VIII says "full comment text OWED"; the preamble's "tactical-military … simulator" identity remains.
5. **Anti-cheating enumeration (H7)** is built from Muse's list (6930329180). It is not a ruled text, and I did not have Addendum A block 5. Under Kimi's criterion 1 it traces to a named audit item, not to a ruling's wording.
