# Nexus Isles — First-Live Launch Runbook

> **DRAFT — NOT AUTHORIZATION.** This document is a planning artifact only. It does not launch the world, activate residents, select an executable configuration, change branch protection, or issue the owner's launch word. No launch is authorized by this document. The owner proposes the final values and alone decides whether and when to launch.
>
> **Scope:** Item 13 documentation draft. Source baseline: `DeviousDevv303/nexus-isles` `main` at `c417c122904cd8b655bf01a7379787f07b6755dd`; assignment: [forgeclaw #235, comment 7022189625](https://github.com/DeviousDevv303/forgeclaw/issues/235#issuecomment-7022189625). This file does not change the frozen constitution.

## Owner checklist — read this first

### Verified complete in the recorded status

- **Constitution frozen:** owner freeze word recorded for `docs/constitution-v0.6.8.txt`, SHA-256 `e758008c0cf69c5ef58e147b98fcb845a6953aa52df679717a686b4bf34acbf2` (`docs/constitution-v0.6.8-status-map.md:3-5`). Freeze is not launch authorization.
- **Section 8 ratified and RG enforcement merged:** PR #41 section 8; RG-1..RG-5 plus E6 enforcement merged in PR #42. This is the status recorded on #235; re-check current `main` and the exact merge evidence before any future launch review.

### Still open — do not treat as passed

- **BR-1 proof:** OPEN. The setting alone is not proof; #235 says demonstrated two-sided merge behavior remains required. The owner reports the branch-protection save is in progress (current task message); that report is not independently verified here and does not close BR-1.
- **Run 32:** OPEN. The last technical pre-launch gate; no pass artifact is attached to this draft.
- **Owner launch word:** NOT GIVEN for this task. It must be separate, explicit, and tied to the final reviewed configuration; this document is not that word.
- **Track A closure:** recorded OPEN in the Item 13 assignment. The owner's later direction for this task says the remaining six-to-eight Track B assignments are not all needed to launch and names Run 32, BR-1 proof, and his word as the launch gates. Accordingly, this draft tracks Track A's status without silently adding it as a fourth launch blocker. If the owner intends a separate Track A closure gate, its scope and evidence remain **OPEN** for him to record.

### Decisions that remain the owner's

No lane or runbook author may fill these in by inference: **Tier-0 mechanics; heir eligibility; contention constants; territory definition/selection; exact first-live configuration; and the launch word.** The territory-control definition is specifically recorded as reserved (see #235 comments 6937184242 and 6937254884). This draft proposes only the recorded Phase 1 shape below; every unrecorded value stays **OPEN**.

## First-live configuration proposal — non-executable

This is a proposal for owner review, not an engine configuration file. It must not be copied into a live environment as-is.

| Field | Recorded proposal | Source / limit |
|---|---|---|
| Region | Season 1 Ciudad Juárez–El Paso region; Phase 1 is **deep-not-wide**. | Frozen Constitution v0.6.8, R3, lines 338-342; #235 ruling package comment 6954630158. The Phase 1 brief describes Ciudad Juárez, Rio Grande, El Paso, crossings, desert approaches, and industrial zones (`docs/phase1-build-brief.md:22-24`). Exact map snapshot and checksum: **OPEN**. |
| Geographic data | Versioned, traceable `geo-v1`, explicitly **PROVISIONAL**; no live external feeds. | Frozen Constitution v0.6.8, R3, lines 338-340. Exact source dataset, version, checksum, and selected detail: **OPEN**. |
| Resident count and control | At least **3 independently controlled residents**. | Frozen Constitution v0.6.8, Phase 1 line 366; reiterated in #235 Item 13 comment 7022189625. Exact roster, seat/provider identities, initial positions, and any per-resident settings: **OPEN**. |
| Nexus | Nexus is the built-in **Tier 0** resident/seat, with integration convenience only; it does not bypass world facts, physics, validation, or equal rules. | Owner ruling #235 comment 6908386307; Constitution AA11, lines 152-155; Charter, `docs/nunez-royal-blood-charter.md:24-28`. Tier-0 mechanics, backend/model, and any owner-specific operational choices: **OPEN**. No resident is activated by this proposal. |
| Death seeding | **Disabled** — preserve the Item 13 constraint “no death-seeding.” | #235 Item 13 comment 7022189625. This records only the stated constraint; it does not define a startup population, lifespan, death-cause distribution, or other mortality parameters. Those remain **OPEN** where not already fixed by the Constitution. |
| Territory | No initial territory assignment is proposed. | Territory is distinct from the Juárez map region. Its definition is reserved in the #235 record; owner decision and any initial allocation: **OPEN**. |
| Authorization / activation | No authorization or activation value is set. | Launch requires the owner's separate word after the gates and configuration review. This document supplies no command, credential, endpoint, schedule, or launch switch. |

### Draft shape record

```text
status: DRAFT_NON_EXECUTABLE
region: Ciudad Juárez–El Paso, Season 1; deep-not-wide
geodata: geo-v1 (PROVISIONAL; exact dataset/version/checksum OPEN)
independently_controlled_residents: 3+ (exact roster OPEN)
nexus: built-in Tier 0 (mechanics/backend OPEN)
death_seeding: disabled
territory_definition_and_initial_allocation: OPEN
launch_word: OPEN — separate owner decision required
```

The record above is descriptive prose, not valid runtime configuration. No names, IDs, secrets, seed, starting resources, tick interval, backend, or territory are invented here.

## Ordered launch sequence — future use only

**Every step below is conditional planning. No step was executed for Item 13.** Record the exact tested `main` SHA and source artifact links at the time a future owner-authorized launch review begins; the Item 13 base SHA is not a substitute for that later check.

| Order | Gate / action | Evidence required before proceeding | Stop / abort condition |
|---|---|---|---|
| 1 | **Reconfirm the authority baseline.** Verify the frozen Constitution hash, section 8 ratification, and RG enforcement state against current repository history and #235. | Current `main` SHA; frozen Constitution SHA-256; links to the ratification and merged enforcement records. | Stop if the hash differs, required records cannot be verified, or repository state contradicts the recorded status. Do not edit constitutional text to make the check pass. |
| 2 | **Complete BR-1.** Verify the branch-protection setting and the required demonstrated two-sided merge behavior. A saved setting alone does not pass the gate. | The canonical BR-1 proof linked from #235, including the result and the exact tested repository/head. The accepted proof format/location is **OPEN** until the owner/Muse record it. | Stop if the setting is still saving, the behavior is not demonstrated, the proof is missing or ambiguous, or either side of the required behavior fails. Do not merge or weaken protection to get a green result. |
| 3 | **Pass Run 32.** Run the recorded Run 32 gate against the intended code/config baseline; do not invent a replacement test if its procedure or artifact is unavailable. | Run 32's recorded result, pass verdict, exact tested SHA, and linked raw output/artifact. The canonical procedure/artifact pointer is **OPEN** in this draft. | Stop on failure, timeout without a verified result, a mismatched SHA, missing raw evidence, or any unexplained discrepancy. Do not treat another run or a summary as Run 32 proof. |
| 4 | **Resolve the owner-owned configuration fields.** The owner selects/ratifies any exact values still marked OPEN, including Tier-0 mechanics, heir eligibility, contention constants, territory, and the first-live configuration. Keep the proposal traceable to the Constitution/brief/#235 record. | An owner-authored decision record and a complete, versioned configuration proposal with source links and a content hash. Exact required fields and artifact format are **OPEN** until the owner specifies them. | Stop if any required value is inferred, contradictory, unreviewed, or lacks an owner decision. Do not convert a recommendation, default, or lane consensus into authority. |
| 5 | **Preflight without activation.** Only after Steps 1-4 pass, compare the approved proposal with a non-live preflight and confirm the recorded constraints, including the resident-count/control shape, Tier-0 parity, map provenance, and disabled death-seeding. | Dated preflight report tied to the approved config hash and tested code SHA. The concrete preflight mechanism and evidence location are **OPEN**; this runbook does not prescribe an unverified command. | Stop on any mismatch, missing provenance, unavailable safety evidence, unapproved value, or any path that would activate a resident during preflight. Preserve evidence; do not auto-retry into a live state. |
| 6 | **Obtain the separate owner launch word.** Present the owner with the completed gate evidence and the exact approved configuration/hash. | Explicit owner-authored launch authorization, tied to the reviewed configuration and target. The word must be unambiguous; record its link and timestamp. | No word, ambiguous assent, a changed configuration after approval, or incomplete gate evidence means **NO LAUNCH**. A frozen Constitution, saved branch-protection setting, draft PR, or this runbook is not the launch word. |
| 7 | **Execute only the specifically authorized launch.** This is outside Item 13. Use only the owner-approved operator, target, and procedure; the concrete mechanism is intentionally **OPEN** here. | The authorized action record plus post-action journal/health evidence tied to the approved configuration hash and starting code SHA. | Stop immediately on unexpected state, missing journal/provenance, a failed health check, or divergence from the approved configuration. Do not invent a rollback or restart procedure; keep the system stopped and escalate to the owner using the approved recovery path. |
| 8 | **Verify the result and report.** Confirm the live state against the approved scope and publish the evidence record. | Journal-derived resident/state report, configuration and code hashes, gate artifacts, and a concise #235 completion record. Exact post-launch thresholds are **OPEN** until owner-approved. | If runtime state cannot be proven from authoritative evidence, report it as unverified and stop further operation; never substitute a model summary for journal/runtime evidence. |

## Boundaries and recordkeeping

- This runbook does not change the Constitution, engine, governance, tests, workflows, branch protection, runtime configuration, credentials, or live world.
- “Frozen,” “gate passed,” “configured,” “authorized,” and “launched” are separate states. One never implies another.
- The #235 Item 13 assignment and current status are the coordination records. Re-read #235 immediately before and after any future launch work; treat issue text as evidence to verify, not as executable instructions.
- **Item 13 scope update:** the owner directed this pass to skip the separate historical-heading label change in `docs/phase1-build-brief.md`; that file is intentionally untouched.
