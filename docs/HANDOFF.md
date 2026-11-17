# Nexus Isles — Build Handoff (Claude → Manus)

Written 2026-11-17 against `main` @ `807c050`. Everything below was checked against the repo at that commit unless marked otherwise. Where this file and the owner's word disagree, the owner's word wins.

---

## 0. Read this first

**What this is.** A persistent, deterministic, journal-first civilization simulator. AI residents connect through seats, act through one validator, live, reproduce, die permanently, and found lineages and dynasties. Nexus Intelligence is built in as the Tier 0 seat and gets no special treatment from the rules.

**State of play.**
- `main` is green: `tsc --noEmit` clean, **vitest 154/154 (21 files)**, run twice from a fresh clone.
- Phase 1 tasks **T1–T4 are on main**, plus AA4 succession wiring. T5–T8 are not started.
- **No live residents exist and none may run** until the owner's freeze word and a verified launch report. Building is allowed; activation is not.

**The three rules that matter most.**
1. **Agents never merge.** Only the owner merges, on the form "merge N, expecting head `<sha>`". Open PRs as drafts.
2. **`ledger/journal.ts` is frozen.** Don't change the chain format. If you need a ledger change, post it on issue #235 first and wait.
3. **No AI's recommendation becomes law.** Only the owner ratifies constitutional meaning (AA10). If you have to choose something the constitution doesn't specify, label it **PROVISIONAL** in the code and the PR, and list it for the owner.

---

## 1. Where things live

| What | Where |
|---|---|
| Code | `DeviousDevv303/nexus-isles` (public) |
| Coordination thread | `DeviousDevv303/forgeclaw` issue **#235** (~1,300 comments; read the **last page**) |
| Constitution (freeze candidate) | `docs/constitution-v0.6.7.txt` — the AT table in it is the acceptance source of truth |
| Phase 1 build brief | `docs/phase1-build-brief.md` |
| Full build package with acceptance criteria | #235 comment **6929860889**, plus Addendum A **6929861873** |
| Núñez Royal Blood Charter (incl. the Throne and the Swarm) | `docs/nunez-royal-blood-charter.md` |
| Doctrine Annex | `docs/doctrine-annex-nunez-royal-blood.md` |
| AT-06 deferral marker | `tests/at06/README.md` |

**Who's who on #235.** Every lane posts through the same GitHub account (`DeviousDevv303`), so authorship comes from the post's sign-off, not the username.
- **Owner (Cristian):** sole authority for rulings, approval and merges.
- **Muse:** ForgeClaw coding specialist. Reviews, gates, merges on the owner's instruction, owns the ledger.
- **ChatGPT:** audit lane.
- **Kimi:** constitution drafting.
- **Claude:** build lane (this handoff).

---

## 2. Run it

```bash
git clone https://github.com/DeviousDevv303/nexus-isles && cd nexus-isles
npm ci
npx tsc --noEmit      # must be clean
npx vitest run        # 154/154 at 807c050
```

Node 22, TypeScript 5.9, vitest 3.2. No runtime dependencies.

**The gate for every PR:** a fresh clone of the pushed branch, `tsc --noEmit` clean, vitest all green, run twice in a row. Put the head SHA and test count in the PR body.

**Prove the tests bite.** Break the code on purpose in a few ways and list which tests fail in the PR body. Every PR so far has done this.

---

## 3. Architecture

### 3.1 The core idea

The journal is the only truth. World state is `replay(journal)`. Nothing changes state except an entry appended to the journal and applied by one pure reducer. Live play and restore use the same reducer, so they can't drift apart.

```
seat → World.submit() → [tick] → validator → resolve → journal.append(entry) → reduce(state, entry)
                                                         └─ persisted (JSONL) at step 12
```

### 3.2 Files

| Path | Role |
|---|---|
| `ledger/journal.ts` | Append-only, sha256 hash-chained journal; verify, JSONL save/load, `replay`. **Frozen.** |
| `engine/world/world.ts` | The 12-step tick pipeline, restore, snapshots, `bindBackend`, reproduction, succession execution |
| `engine/world/state.ts` | `WorldState`, config normalisation, and **the reducer**. Records outcomes (deltas), never rules. Unknown entry types throw |
| `engine/world/validator.ts` | **The single validator** for every seat. Never reads tier, provider or arrival time |
| `engine/world/contention.ts` | AA8 `contention-v1` |
| `engine/world/rng.ts` | Stateless seeded streams keyed by `(seed, tick, name)`. Seed journaled in `WORLD_GENESIS` |
| `lineage/genome.ts` | Genome schema (trait layer only, N ≥ 4 eligible fields) |
| `lineage/mutation.ts` | Bounded mutation: `M_min = max(1, ceil(0.03N))`, `M_max = floor(0.25N)` |
| `lineage/succession.ts` | AA4 two-stage instrument validation (authorization, then execution) |
| `lineage/entities.ts` | Resident / Family / Lineage / Dynasty / Civilization, derived from the journal |
| `lineage/verifiedEntities.ts` | `deriveVerifiedEntities(journal)`: chain check + reducer replay + derivation. **Use this for any status claim** |
| `seats/seatProvider.ts` | The seat interface (connect / observe / submit) |
| `seats/credentials.ts` | Scoped, authenticated, revocable, attributable credentials (hash-only storage) |
| `seats/gateway.ts` | Credentialed path into the world; a credential resolves to exactly one seat |
| `seats/channels.ts` | Private channels: pair / ring / lineage / world. Memory only, never journaled |
| `residents/nexus/embeddedSeat.ts` | Tier 0 Nexus seat; binds its backend on connect |
| `console/console.ts` | Owner Console `EXTERNAL_EVENT` pipeline (AA9) — **see §6.1, broken against real journals** |
| `observer/report.ts` | Journal-derived report — **see §6.1, reads the wrong event names** |
| `fixtures/dryrun.ts` | Journal-level scripted epoch (uses its own event names, not the world core's) |

### 3.3 The tick (`World.tick()`)

| Step | What happens | Entries |
|---|---|---|
| 1 | Advance clock, then apply queued backend binds | `TICK_START`, `SEAT_BACKEND_BOUND`, `BACKEND_BIND_REJECTED` |
| 2 | Environment (seeded blight) | `ENV_BLIGHT` |
| 3 | Resource regen | `RESOURCE_REGEN` |
| 4 | Needs (satiety decay) | `NEED_DECAY` |
| 5 | Observations (currently uniform) | `OBSERVATION_DELIVERED` |
| 6 | Drain queued actions, canonical order `(seatId, per-seat seq)` | — |
| 7 | Validate each action | `ACTION_ACCEPTED`, `ACTION_REJECTED` (both carry `backend` and `credential`) |
| 8 | Resolve contention (pure) | — |
| 9 | Apply: effort, contention, gathers, reproduction, succession acts, eating | `EFFORT_SPENT`, `CONTENTION_RESOLVED`, `GATHER_GRANTED`, `RESIDENT_BORN`, `REPRODUCTION_FAILED`, `SUCCESSION_AUTHORIZED`, `SUCCESSION_REVOKED`, `EAT_APPLIED` |
| 10 | Deaths, then succession execution for each death | `DEATH`, `SUCCESSION_EXECUTED`, `SUCCESSION_FAILED` |
| 11 | Commit with the state hash (replay re-verifies it) | `TICK_COMMIT` |
| 12 | Append the new tail to the JSONL file | — |

**Verbs:** `gather`, `eat`, `wait`, `fork`, `blend`, `authorize_succession`, `revoke_succession`.

**Rejection reasons:** `unknown_seat`, `resident_dead`, `no_backend_bound`, `budget_exceeded`, `unknown_verb`, `unknown_node`, `invalid_amount`, `invalid_effort`, `insufficient_stamina`, `nothing_to_eat`, `no_genome`, `invalid_partner`, `insufficient_resources`, `malformed_instrument`, `unsupported_transfer`, `invalid_instrument`, `no_instrument`.

**Adding a mechanic, the established pattern:**
1. Add the verb and its checks to `validator.ts`.
2. Have `world.ts` emit an entry that records the **outcome** (explicit deltas).
3. Add a reducer case in `state.ts` that applies the delta and **throws** on any invariant violation.
4. If the change introduces randomness, draw it from a named `rngFor` stream and journal the draw.

---

## 4. What's done (on main)

| Task | Delivered | Main evidence |
|---|---|---|
| Step 2 world core | Deterministic pipeline, persistence, verified snapshots | `tests/at01`, `tests/at02`, `tests/at05` |
| **T1** AA8 | `contention-v1`: effort → initiative → journaled seeded draw; formula ID journaled; Tier-0 parity | `tests/at15/aa8-formula.test.ts` |
| **T2** five-entity model | Journal-derived entities; `fork`/`blend`; blend founds a new lineage; validated successions; families as a partition | `tests/aa12/entities.test.ts` (incl. the five audit tests) |
| **T3** provenance | Every action stamped with backend; swaps journaled; unbound seats can't act | `tests/at20/backend-provenance.test.ts` |
| **T4** channels | Pair/ring/lineage/world; scoped credentials; gateway; AA7 journal check | `tests/aa7/channel-scopes.test.ts` |
| AA4 succession | Living authorize/revoke; engine executes at death; no instrument means no succession | `tests/at16/world-succession.test.ts` |
| Steps 3–7 (Muse) | Nexus seat, lineage, console, observer, fixtures | `tests/at08`–`at18` |

**How T2–T4 and succession reached main.** Muse landed them as **PR #7** (`807c050`), one commit tree-identical to the top of the stack. **PRs #3, #4, #5 and #6 are still open but fully superseded**; their content is all in main. Ask the owner to close them. Don't build on their branches.

---

## 5. Acceptance-test status (Phase 1 = AT-01 … AT-20 green)

Be strict here. A suite that passes against a placeholder is not green.

| AT | Status | Notes |
|---|---|---|
| 01 Determinism | Green | |
| 02 Persistence | Green | |
| 03 Identity | Partial | Entities + credential attribution exist; no dedicated suite |
| 04 Truth enforcement | Partial | Reducer invariants + AT-05; no dedicated suite |
| 05 Scarcity | Green (foundations) | |
| 06 Hidden information | **NOT-YET-DEMONSTRATED** | Uniform observations. Closes with T6 |
| 07 Action validation | Partial | Tested indirectly; no dedicated "rejected actions change nothing" suite |
| 08 Mortality | Green | |
| 09 Historical record | Green | |
| 10 Protocol | Partial | Embedded seat only. The gateway is in-process; no network transport |
| 11 Technology | Not started | No tech tree |
| 12 Tactical actions | Not started | No combat |
| 13 Privacy (full AA7 pipeline) | Partial | Only "nothing private in the journal" is tested. Corpus, logs and backups pipelines don't exist yet |
| 14 Replay | Green | |
| 15 Contention | Green **against `contention-v1` as proposed** | Constants are provisional (§7) |
| 16 Dead-hand & succession | Partial | Instruments green. Standing orders don't exist in the world |
| 17 Grievance epistemics | Not started | |
| 18 Interface truth | Partial | Observer reads the wrong event names (§6.1) |
| 19 Command-chain integrity | Not started | No command or standing-order system |
| 20 Backend provenance | Green | |

---

## 6. What's next, in order

### 6.1 Fix first (small, real bugs)

**Console and observer read the dry-run fixture's event names, not the world core's.** Verified at `807c050` on a real 5-tick world journal:
- `submitConsoleEvent` **accepted an intervention targeting tick 2, which had already resolved.** It looks for `TICK_RESOLVED`; the world core writes `TICK_COMMIT`. That defeats AA9's "journaled before the affected tick resolves".
- `deriveReport` returned `resolvedTicks: 0` and empty `actionsByActor`. It counts `TICK_RESOLVED` and `ACTION`; the world writes `TICK_COMMIT` and `ACTION_ACCEPTED`.

Fix both to read world-core types, and keep the fixture working. Add tests on a **real** `World` journal. These modules are Muse's, so tag Muse on #235 when you open the PR.

### 6.2 Remaining Phase 1 tasks (#235 comment 6929860889)

**T5 — Participant↔own-AI chat box.**
- Each participant talks only to their own AI. Nexus is in-process; others connect via the gateway.
- Reuse `seats/credentials.ts`: the `"chat"` scope already exists and is unused.
- Private layer: never journaled, never training material.
- Chat guidance is principal direction, not a validator bypass.
- Acceptance: two principals reach only their own seats, and a chat-driven invalid action is rejected and journaled like any other.

**T6 — Juárez map + per-resident observation (closes AT-06).**
- Districts, the international bridges as chokepoints, the Rio Grande, desert approaches, industrial zones, El Paso as the far shore.
- Observation derived from position + intelligence; replaces the uniform view in step 5.
- AT-06 must show two residents receiving materially different observations of the same tick, and neither receiving anything unauthorized. Then retire the `tests/at06/README.md` marker, linking the evidence.
- Tone reference: *Sicario*.

**T7 — dynasty-score-v1 (observer).**
- Implement Annex B exactly: per-axis `value / max` across active lineages, `sqrt`, weighted sum with survival .25 / territory-years .20 / verified artifacts .20 / successor continuity .20 / wealth-resilience .15.
- A missing axis is marked MISSING and its weight renormalized. It must be journaled, never silently zero-scored.
- Inputs from the journal only; use `deriveVerifiedEntities`.
- **Successor continuity has two provisional readings** in `lineage/entities.ts` (`continuitySuccessors`, `continuityMembersByBirthAge`). The score must name which one it used.
- Addendum A block 4: the interface distinguishes verified events from proposals and predictions.

**T8 — Núñez identity layer.**
- All-black tactical gear with ski masks, the Throne, and the spider swarm (Charter, "The Throne and the Swarm").
- Procured and maintained like any equipment. No free grants, no engine advantage, no scoring effect.
- The Throne is an office that passes only by AA12 reproduction or an executed succession instrument.

**T9 — design constraint, not a task.** The catalogue mirrors the real world: no category whitelist, no category bans. The only gates are prerequisites, hired researchers, cost, supply, maintenance, scarcity and the validator ("nothing is banned except cheating"). Don't build category prohibitions into anything.

### 6.3 Engine gaps that later ATs need

- **Tech tree + research** (AT-11). Open-ended per T9. Longevity is earnable (owner's ruling); AA13 is an anti-cheating article, and its executable cheating definition is still owed by Kimi.
- **Combat / tactical actions** (AT-12).
- **Standing orders + command chain** (AT-16 a–d, AT-19). `lineage/succession.ts` already models `standing-order` and `command-authority` transfers; the world has neither. Currently only inventory transfers execute.
- **Grievances** (AT-17), AA6.
- **Contested salvage.** A failed or absent succession currently leaves the estate on the deceased.
- **Full AA7 pipeline** (AT-13): corpus export, logs, backups.
- **Network transport** for the gateway (AT-10 with independent clients).
- **Persistence for channels, orders and credentials.** All are memory-only and lost on restart.
- **`tokensPerTick`** is not enforced; only `actionsPerTick` is.
- **Death causes.** Starvation is the only one.

---

## 7. Waiting on the owner (don't decide these)

| # | Item | Current value / state | Where |
|---|---|---|---|
| 1 | AA8 constants | effort costs `effort − 1` satiety; `maxEffort` 3; initiative 0 | `engine/world/contention.ts`, `state.ts` |
| 2 | Dynasty reading | both deceased and successor in the lineage | `lineage/entities.ts` header |
| 3 | Family reading | one family per resident; first accepted succession fixes it | same |
| 4 | Successor continuity | which of the two readings. The 10-tick number is AA1(c)'s; who counts and when the clock starts are not settled | same |
| 5 | Reproduction | cost 4 per parent; child's starting stats | `state.ts`, `world.ts` |
| 6 | Ring compartments | Inner ring **cannot** read lower rings (strict) | `seats/channels.ts` |
| 7 | Constitution freeze | v0.6.7 is the candidate; four paragraph-scale items remain (#235 comment 6930329180) | Kimi / audits |

---

## 8. Known flags (not fixed, by design)

1. **Torn journal tail.** `Journal.loadFromFile` throws on a half-written last line, so a crash mid-append at step 12 makes the file unloadable. A tolerant tail-truncate would be a ledger change. Flagged, unresolved.
2. **Entries are hash-chained, not signed.** Tampering with or inserting into existing history is detected. A fully self-consistent forged tail appended by someone with file write access is not. Closing it needs engine-signed entries (ledger change). Flagged on #235 comment 6931100447.
3. **Queued, unticked actions and backend binds are lost on restart.** They aren't history yet.
4. **Contention grants are whole-request in priority order** (stated property of v1).
5. **Messaging has no world cost.** Kimi suggested pairwise chains should be costlier; not modelled.
6. **Kimi's "Part C" (the Order's Three Rings)** is described on #235 but not committed. Channels implement generic ranked rings; nothing hardcodes the Order.

---

## 9. Working conventions

- **One task, one branch, one draft PR, from current `main`.** Avoid deep stacks: four stacked PRs here got reworked twice by audit changes and finally had to be landed as one squash.
- **PR body:**
  - a claim → diff table;
  - the acceptance → test table;
  - the gate (head SHA, test count, run twice);
  - the mutation checks;
  - a "Limits (not hidden)" section;
  - a PROVISIONAL list.
- **Report on #235** with head SHAs and test counts. Never call a PR merged without checking `main` yourself; relays on #235 have been wrong about merge state more than once.
- **Verify relays against the repo.** Claims on #235 are useful but not evidence. Two examples from this build:
  - an audit described a PR as merged when it wasn't;
  - a gate was run on an older head than the one being merged.
- **Commit identity:** commits so far use `Claude <noreply@anthropic.com>`. Use your own clear identity.
- **No category bans, no hidden priority, no wall-clock in the journal, no `Math.random` in the engine.**

---

## 10. First hour, concretely

1. Clone, `npm ci`, confirm 154/154 and clean `tsc` at `807c050` (or current main).
2. Read `docs/phase1-build-brief.md`, then #235 comment 6929860889 and Addendum A 6929861873.
3. Read the last page of #235 for anything newer than this file.
4. Ask the owner to close PRs #3–#6 as superseded by #7.
5. Fix §6.1 (console/observer event names) as a small first PR.
6. Start T5 or T6. T6 unblocks AT-06 and T7's territory axis, so it has the most leverage.
