# Quinn Directorate seat — implementation design

**Author:** Claude Opus 4.7, under the owner's assignment to build the World
Director (forgeclaw #235 comment 7089299881 directive, relayed 2026-11-22).
**Status:** DESIGN DRAFT for Muse's code review and owner ratification.
**Nothing in this document authorizes implementation.** It is a shape proposal.
No engine code, no validator rule, and no live-world seat is added by this PR.

## Governing text, verbatim

From the frozen constitution `docs/constitution-v0.6.8.txt` (SHA-256
`e758008c…`), AA11.2 and Annex C and Ruling 4:

> AA11.2 — Directorate tier (Quinn). A new residency tier under AA11. The
> Directorate seat may do exactly the following, and nothing else: (i)
> submit world-event proposals, exclusively through the validator as
> structured actions, journaled with provenance, within a strict per-epoch
> budget; (ii) propose process-parameter adjustments, effective only at
> epoch boundaries via versioned ratified config (Quinn adjusts the dice,
> never picks results); (iii) coordinate simulation time and propose
> environmental circumstances; (iv) investigate anomalies and report. It
> holds zero authority over validation, scoring, succession, or lineage.
> …Quinn never writes world-truth: the environment engine resolves every
> accepted Quinn proposal using the seeded RNG and ratified parameters;
> the journal records the resolved event and its provenance. Proposal,
> validation, resolution, and recording are four distinct stages and Quinn
> appears in exactly one of them. …Budget mechanics are defined by the
> integrated spec (finding F-08), with the validator owning the accounting.

> Annex C: Two event classes exist in the world, and they never merge.
> Class 1 (ENVIRONMENTAL CIRCUMSTANCES) is generated exclusively by the
> deterministic environment engine; NO seat, AI, or backend generates or
> modifies them. Class 2 (VALIDATED AGENCY ACTIONS) is proposed by seats,
> accepted/rejected by the validator, resolved by the engine, journaled
> as world-truth.

The implication is strict and non-negotiable: Quinn's proposals are Class 2
agency actions. The outcomes they trigger (a blight pulse, a bridge
closure) are Class 1 circumstances resolved by the engine. Quinn never
authors a Class 1 event body.

## Shape of one proposal → resolution

Four journal-visible stages, in this order, each a separate entry:

| Stage | Journal entry | Actor | Payload |
|---|---|---|---|
| Proposal | `ACTION_ACCEPTED` or `ACTION_REJECTED` | Directorate seat | `{verb: "propose_circumstance", kind, region, intensity, prompt_hash, input_refs}` |
| Resolution | `DIRECTORATE_RESOLVED` *(new)* | engine | `{proposal_id, accepted: bool, roll, severity, applied: bool}` |
| Circumstance | existing `ENV_*` event (e.g. `ENV_BLIGHT`) | engine | the resulting world-truth event body |
| Lifecycle | existing `NEED_DECAY` etc. | engine | unchanged |

`ACTION_ACCEPTED` carries only the proposal. `DIRECTORATE_RESOLVED` carries
the engine's roll under the seeded RNG against ratified parameters. The
resulting `ENV_*` event, if any, is the existing shape — the engine owns
its body. Replay from the journal must reproduce the chain exactly.

The `prompt_hash` is the SHA-256 of the exact bytes the Directorate backend
received (observation + system prompt + policy). Raw prompts live in the
AA7 deliberation store, never the journal. `input_refs` are the journal
indices the backend read (its own prior observations, prior DIRECTORATE
resolutions). This matches AA11 provenance for every seat.

## Verb catalog (initial — ratifiable)

The Directorate may propose **only** kinds in a ratified catalog. Unknown
kinds are a validator rejection with reason `unknown_circumstance_kind`.

| Kind | Target | Engine resolution |
|---|---|---|
| `blight_pulse` | region id | Roll vs. `blightPercent` ± severity; if applied, a standard `ENV_BLIGHT` with the proposed region or a clamped neighbour |
| `weather_shift` | region id | Clamp intensity; roll under climate-v1 parameters; may raise `satietyDecay` for a bounded number of ticks |
| `bridge_strain` | edge id | Reduce `crossingCapacity` by 1 for a bounded window; refused if the edge is already at 0 |
| `investigate` | region id | **Reports only.** No circumstance applied; journals `DIRECTORATE_RESOLVED` with `applied:false, report_only:true`. This covers AA11.2(iv) without touching world truth. |

The catalog starts here; extension is an owner decision at an epoch
boundary, per AA11.2(ii) ("process-parameter adjustments, effective only at
epoch boundaries").

## Budget — PROVISIONAL defaults

AA11.2 requires a "strict per-epoch budget" owned by the validator.
F-08's accounting mechanism is cited but not numbered in the frozen text.
Defaults proposed for ratification:

| Parameter | Proposed default | Rationale |
|---|---|---|
| `directorateProposalsPerTick` | **3** | Muse's recommendation on this thread: enough to matter per tick, small enough to watch. |
| `directorateProposalsPerEpoch` | **30** | 10 ticks × 3; one session's worth. Epoch = session until an epoch mechanic lands. |
| Proposal excess | validator rejects with `directorate_budget_exceeded`; the proposal is not applied, no RNG is rolled | Mirrors every other per-seat budget check. |

Both numbers are **PROVISIONAL** per RG-1: they will carry a registry entry
and a test referencing its id when they land as constants in code. Ratifying
or overriding them is an owner decision; nothing in this doc ratifies.

## The Qwen backend — PROVISIONAL path

Also per Muse's recommendation, and recorded here pending owner nod:

- The Directorate seat's backend calls **ForgeClaw's existing Qwen workflow**
  (`.github/workflows/qwen3-8b.yml` on `DeviousDevv303/forgeclaw`), not an
  in-job Qwen. Reasons: the workflow is already built, Qwen's CPU workflow
  is 9–23 minutes per hop and running it inside the Isles session would blow
  the 20-minute job timeout, and the Isles job stays self-contained.
- The backend passes the Directorate observation + the ratified prompt +
  the proposal catalog; the workflow returns one structured proposal.
- The backend journals `prompt_hash` (SHA-256 of what it sent) and
  `input_refs` (journal indices read). The raw prompt never enters the
  Isles journal. AA7 scrub applies to the AA7 deliberation store, not the
  Isles journal.
- No ForgeClaw credential is embedded in the Isles repository. The backend
  reads a workflow URL from `runner/config.ts` and a dispatch token from a
  secret the owner adds (`ISLES_FORGECLAW_DISPATCH_TOKEN`). Without the
  secret, the backend refuses to start — exactly like the Nexus checkpoint
  adapter refuses to start without its sidecar.

**Not decided here.** The Qwen workflow's response shape is ForgeClaw's;
pinning it is work for the PR that builds the backend.

## Not in this design

- **Who seats a Directorate resident.** AA11.2 makes it a tier; seating
  one in the live world is an owner decision at an epoch boundary. The
  mechanism for seating mid-world without reseeding is open and not
  addressed here.
- **Epoch boundaries.** The word appears in the constitution but has no
  implementation. For now, "epoch = session" is a provisional equivalence,
  used only by the budget. A proper epoch mechanic is a separate design.
- **AA7 deliberation store.** Raw-prompt storage outside the journal.
  Scoped out; this PR assumes the prompt_hash is enough until that store
  lands.
- **Guardian audit of Directorate proposals.** AA11.2 says Guardian watches
  Directorate like any resident. Current Guardian code audits residents;
  no new rule needed, but a specific audit test for Directorate proposals
  should land with the engine PR.

## Implementation plan

Four PRs, each with its own gate:

1. **This PR — design only.** docs/directorate-design.md and this note.
   No code changes.
2. **Engine scaffold.** Resident tier field, `propose_circumstance` verb in
   `engine/world/validator.ts`, `DIRECTORATE_RESOLVED` journal event,
   catalog, budget constants with registry entries. A deterministic
   test-double backend drives the engine in tests. No live-world seating.
3. **Qwen backend.** A backend that dispatches the ForgeClaw Qwen
   workflow, parses one structured proposal, hashes the prompt. Still no
   live-world seating.
4. **Owner authorization & live-world seating.** Separate PR under the
   owner's named OK: an operation to seat a Directorate at the next epoch
   boundary, journaled as a process-parameter adjustment per AA11.2(ii).

Steps 2–3 do not change the live world. A Directorate seat exists in the
world only after step 4, which is the owner's taps.

## Open questions for the owner

1. Ratify or override the two budget numbers (3/tick, 30/session).
2. Ratify or override the Qwen-via-ForgeClaw backend path.
3. Ratify or override the initial verb catalog (blight_pulse,
   weather_shift, bridge_strain, investigate).
4. Who seats the first Directorate, and when. This document seats nothing.
