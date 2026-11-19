# v0.6.8 three-status map

Required by ChatGPT's review requirements (forgeclaw #235 comment 6954727096). Every requirement gets
three separate statuses. They are never merged into one green claim:

- **Implemented**: the code or text exists.
- **Tested**: an automated test exercises it.
- **Independently verified**: a lane other than the builder, or a named CI run, checked it against this requirement on the record. A status of "verified" always names its evidence (a #235 comment id or a CI run id); otherwise the cell says No.

Base: nexus-isles main `5651670`. As of the E8 re-cut, this PR also changes code (`observer/dynastyScore.ts`) and adds a test. Section C's gap is built in nexus-isles#31 (head `56c0b3f`, unmerged); this map is not updated for it until #31 merges. "Text" means the requirement is stated in `docs/constitution-v0.6.8.txt`.
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
| F-11 election (a) recorded (owner decision 6955334277) | Text: H17 under Section XV, replacing the interim (b) note; F-11a restated | — | No |
| The four v0.6.7 audit items | Text: hunks H2, H4–H7 | — | No |

## B. Code against the rulings

| Requirement | Implemented | Tested | Independently verified |
|---|---|---|---|
| E6 abeyance: no path redistributes missing weight | **Yes**: `observer/dynastyScore.ts:220-227` computes c = Σ present w; s = Σ w·x; average = s/c; subtotal = s. A grep for renormalize or redistribute over every source directory finds only that line | `tests/at21/dynasty-score.test.ts` (MISSING axes kept missing, re-derivation stable) | **Yes**: Muse's F-01 code check, 6954334884 |
| F-01 acceptance: adding a missing axis leaves prior emissions byte-identical | Partial: scores are derived from verified journal prefixes and never stored | `at21` "explicit close boundary stable when later ticks change the world" (a later *tick*, not a later *axis*) | No: **no test adds an axis** |
| E7: normalization by the maximum (owner decision 6955334277) | Text: Section XVII. Code: **Yes**, `scoreAxes` in `observer/dynastyScore.ts` (`rawValue / maxRaw`) | **Yes**: `tests/at21/zero-means-zero.test.ts` "E7 with real values" (4/2/1 → 1/0.5/0.25; a min-max mutation fails it) | No |
| E8 zero means zero (6955932914): (1) E6 text, (2) normalization text | Text: H19a (Section XIV), H19b (Annex B step 1), H19c (Section XVII), H19d (Section XVIII, the clause verbatim) | — | No |
| E8 (3) implementation | **Yes**: `scoreAxes` keeps a measured all-zero axis available, normalized 0, with full weight in coverage; only unmeasured evidence is MISSING. The normalize/combine step was extracted into the exported pure `scoreAxes` with no behavior change (existing AT-21 and AT-18 suites unchanged and green) | — | No |
| E8 (4) regression pair: measured-zero vs unmeasured give different coverage | — | **Yes**: `tests/at21/zero-means-zero.test.ts` (coverage 0.25 vs 0; average 0 vs null). A "zero becomes missing" mutation fails 2 of its 4 tests | No |
| Directorate seat (Quinn) | **No**: no Quinn or Directorate code exists | — | — |
| Class 1, environmental circumstances engine (climate-v1) | **No**: tick step 2 "environment" is a placeholder; §12.3 gap | — | — |
| Class 2, validated agency actions | Yes: `World.submit` → `engine/world/validator.ts` → resolve → journal (`engine/world/world.ts` tick steps 6–11) | AT-07, AT-15, AT-19 suites | **No**: CI runs these on every merge, but no named run or reviewer has checked them against R2/F-10 |
| F-11(a) live research as evidence only; F-11a: no research-derived config change without owner ratification | **No**: no Qwen, research, or research-config code exists. The F-11a gate must exist before any research-derived change can be proposed | — | — |
| R9 provenance: prompt hash and input references | **No**: actions carry backend identity and version only (AT-20); gap disclosed in 6954619011 | — | — |
| R9: replay survives deletion of the deliberation store (F-09) | Yes (inherent) | `tests/aa7/replay-after-deletion.test.ts` (PR #30) | **Yes**: built by Muse, CI run 44129187976; re-run by Claude on `5651670`, passed |
| R6 Fiction Safeguard lint | **No** | — | — |
| R7/F-05 permanent simulation labelling | **No**: no export or label surface audited | — | — |
| R5 / F-07: no institution built before Annex C | Holds by absence: no institution seats exist | — | — |
| R3 Juárez region | Partial: `engine/world/maps/juarez.ts` (map-v1, PROVISIONAL); geo-v1 dataset provenance not built | AT-06 map tests | **No**: no named review against R3 |
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

1. **Resolved:** "min-max" vs `value / max` is settled by owner decision 6955334277 (Erratum E7). The max = 0 case is settled by Erratum E8 (6955932914), in text, code and tests. **For reviewers:** E8 was decided by Muse under the owner's delegation, as recorded in 6955932914, not posted in the owner's own words. Whether that meets the "owner-posted rulings only" standard is the reviewers' and the owner's call.
2. **Section XV R1 and Section XIV E6 are two ratified wordings of the same law.** R1 has six points and E6 has seven clauses. I found no conflict, but the frozen text carries both.
3. **Title and identity.** The document is still "Nexus Isles"; R3 says "Nexus becomes a living simulation of real Earth" (package title "Nexus Earth"). It is not renamed, because no ruling renames it.
4. **Kept from v0.6.7 because no ruling touches them:** the "AT-01 through AT-19" and "AT-01 through AT-20" tails disagree; Section VIII says "full comment text OWED"; the preamble's "tactical-military … simulator" identity remains.
5. **Anti-cheating enumeration (H7)** is built from Muse's list (6930329180). It is not a ruled text, and I did not have Addendum A block 5. Under Kimi's criterion 1 it traces to a named audit item, not to a ruling's wording.
