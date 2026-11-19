# Nexus Isles launch-readiness evidence

**Evidence snapshot:** 2026-11-19T22:07:36Z. This is a documentation-only snapshot, not launch authorization or a configuration proposal.

## Authority baseline

The verified `main` base is `5b410d1efcfba8985094cd1b19fc72a83aa9386c`. At that exact commit, `docs/constitution-v0.6.8.txt` recomputes to SHA-256 `e758008c0cf69c5ef58e147b98fcb845a6953aa52df679717a686b4bf34acbf2`, matching the required frozen digest. [1] [2]

Section 8 ratification is recorded in #235 comment 7021993986. PR #41 merged at `acb44cd5f579fe396c1580f22690d26a9b84b425`. RG-1 through RG-5 and E6 enforcement merged in PR #42 at `4aebff0fd45d3003be6dcf978ee6a6396780de32`. [3] [4] [5]

## BR-1 — branch protection evidence

The owner-authored #235 record says the `main` rule (rule 86610381) requires a pull request and a passing status check with context exactly `gate`; it records one required approval, no up-to-date requirement, and “do-not-bypass OFF.” This section reports the issue record; it does not claim a separate settings-API read. [6]

The green side is recorded for PR #41 (`gate` passed; merge `acb44cd5f579fe396c1580f22690d26a9b84b425`) and PR #46 (`gate` passed; merge `7231a879aff19320329214f19536076a3832e792`). The record says the administrator bypass applied only to the one-approval requirement; `gate` was not bypassed. [6] [7]

The red-side probe, PR #47, had head `7236b955ec82b180f03836e1a0a5639ff13d47ee`; its `gate` failed, the merge UI blocked merging because the required check was failing, and the probe was closed unmerged. [6] [8] A later owner correction confirms BR-1 is closed and points back to the two-sided evidence. [13]

## Viewer and audit reconciliation

The viewer fixture audit reports 70/70 event-level identity checks passing across six nodes, two residents, and ticks 1–7. It records no resident births or transfers and reconciles the resource ledger using journaled events. The follow-up gives the complete three-entry `ENV_BLIGHT` stream and confirms event-level closure; the remaining viewer note is display attribution, not an accounting gap. [9] [10]

The owner-authored Item 14 record states that the full journal chain was verified and gives its head as `467dd2e69d0564f372c7cf7b8c3957b3b4dd7221474b4a929e7708d8a3b2099c`. This is recorded here as the authoritative #235-reported head. The scratch journal itself is not tracked in this repository, so this document does not claim an independent repository-side recomputation of that digest. [11]

## Remaining OPEN items

- **Run 32:** OPEN. It is in Muse’s lane; the current record says there is no pass artifact yet. [11]
- **Track A close chain:** OPEN. Kimi’s K-1 review is next. [11]
- **Owner-decided configuration fields:** OPEN, as listed in the runbook. These include Tier-0 mechanics/backend/model, heir eligibility, contention constants, territory definition and initial allocation, and the exact first-live configuration. The exact map/geodata source and checksum, resident roster and identities, positions, and per-resident settings are not filled in here. [11] [12]
- **Launch word:** NOT GIVEN. No launch is authorized by this evidence pack. [11] [12]

## Requested repository checks

`npx tsc --noEmit` passed with exit code 0 and no diagnostics. `npx vitest run` passed 43/43 test files and 339/339 tests, with 0 failures.

This file records evidence only. It does not select configuration values, change a gate, activate residents, or launch the world.

## References

[1]: https://github.com/DeviousDevv303/nexus-isles/commit/5b410d1efcfba8985094cd1b19fc72a83aa9386c "Verified Nexus Isles main commit"
[2]: https://github.com/DeviousDevv303/nexus-isles/blob/5b410d1efcfba8985094cd1b19fc72a83aa9386c/docs/constitution-v0.6.8.txt "Frozen Constitution v0.6.8 at verified main"
[3]: https://github.com/DeviousDevv303/nexus-isles/pull/41 "PR 41 Section 8 governance proposal and merged implementation record"
[4]: https://github.com/DeviousDevv303/nexus-isles/pull/42 "PR 42 RG-1 through RG-5 and E6 enforcement"
[5]: https://github.com/DeviousDevv303/forgeclaw/issues/235#issuecomment-7021993986 "Owner record of Section 8 ratification and RG enforcement"
[6]: https://github.com/DeviousDevv303/forgeclaw/issues/235#issuecomment-7022560226 "BR-1 branch-protection rule and two-sided proof"
[7]: https://github.com/DeviousDevv303/nexus-isles/pull/46 "PR 46 green-side BR-1 proof"
[8]: https://github.com/DeviousDevv303/nexus-isles/pull/47 "PR 47 deliberately failing BR-1 red-side probe"
[9]: https://github.com/DeviousDevv303/forgeclaw/issues/235#issuecomment-7022797420 "Viewer fixture resource-accounting reconciliation"
[10]: https://github.com/DeviousDevv303/forgeclaw/issues/235#issuecomment-7023048838 "Viewer fixture event-level ledger closure"
[11]: https://github.com/DeviousDevv303/forgeclaw/issues/235#issuecomment-7023412341 "Owner Item 14 assignment and current open status"
[12]: https://github.com/DeviousDevv303/nexus-isles/blob/5b410d1efcfba8985094cd1b19fc72a83aa9386c/docs/launch-runbook.md "Merged launch runbook and OPEN configuration fields"
[13]: https://github.com/DeviousDevv303/forgeclaw/issues/235#issuecomment-7023532074 "Owner correction confirming BR-1 closed"
