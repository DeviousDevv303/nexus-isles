# Proposal: enforceable RG-1..RG-5 CI checks

**Status: PROPOSAL ONLY — owner ratification required before implementation or enforcement.**

This document proposes how the review gates RG-1 through RG-5, including the E6 observer boundary, should become enforceable CI checks. It does not change the registry, owner-ruling ledger, workflow, gate implementation, or branch protection. No value described below becomes constitutional law merely because it appears in this proposal.

## 1. Authority, scope, and placement

The proposal treats the following as the governing objects, read from the checked-out commit itself:

- `governance/registry.json` — the registry object and each entry's `id`, `status`, symbols, markers, tests, source, and reserved tripwire.
- `governance/owner-rulings.json` — the set of owner ruling objects whose IDs may authorize a claim.
- The cited constitution document named by each `CONSTITUTIONAL` registry entry.
- The source snapshot — every path and file text in the commit, including comments and import specifiers.
- The test snapshot — every test file and its text.

The proposed checks run in the existing single `gate` job in `.github/workflows/ci.yml`, on every pull request and every push to `main`. The intended order is:

1. checkout the exact commit;
2. install dependencies with `npm ci`;
3. run `npx tsc --noEmit`;
4. run the dedicated RG/E6 check with a deterministic repository snapshot;
5. run `npx vitest run`, including the planted-violation tests for RG-1..RG-5 and E6.

The dedicated check and the full test suite are both required: the first gives a direct, attributable failure; the second proves that each checker still detects its planted violation. The owner must require the `gate` status check in `main` branch protection before a failure blocks a merge. CI publication alone is not merge enforcement.

Every failure below is a hard failure of `gate`: the pull request cannot merge while the required status check is required by branch protection. A push to `main` is red and requires an owner-directed correction or revert.

## 2. RG-1 — registry coverage and implementation markers

### Assertion

For the policy-code roots currently named by the governance gate, every exported policy constant that the check defines as registry-covered has a matching `file#name` symbol in `governance/registry.json`; every registered symbol exists in the source object; and every `PROVISIONAL` entry has a marker line in each named marker file containing both `PROVISIONAL` and that exact entry ID.

The check must report the exact entry, file, line when available, and the missing/stale/mismatched object field. It must not silently infer that an unregistered value is ratified.

### Gate location and failure

Run in the dedicated RG/E6 step and again through `tests/governance/rg-gates.test.ts`. Any violation blocks `gate`.

### Evidence read

The check reads the actual `registry.json` object, the actual source file text for policy roots, and the actual marker file text. It does not rely on a PR description, a filename convention, a comment pointing elsewhere, or a reference to a different commit.

### Status-sensitive values

- `PROVISIONAL` and its marker/test requirements: **RATIFIED** as the RG registry protocol by owner ruling `6937254884`.
- Each currently `PROVISIONAL` registry entry and its formula/constant: **PROVISIONAL**; RG-1 records that status and does not promote it.
- `STRUCTURAL` identifiers: **RATIFIED as a registry status vocabulary**, not policy law; they carry no formula authority.
- The set of policy directories and the exact exported-constant syntax are implementation scope, not constitutional formulas: **PROVISIONAL implementation details** until the owner ratifies the final checker contract.

## 3. RG-2 — test evidence for provisional entries

### Assertion

Every `PROVISIONAL` registry entry has at least one existing test file named in its `tests` field, and that test file contains the exact machine-readable marker `registry: <entry-id>`. A missing test object, missing file object, or missing exact marker is a violation.

The check does not accept a README sentence, an untracked local file, or a test that merely mentions a symbol without the exact registry marker.

### Gate location and failure

Run in the dedicated RG/E6 step and through the planted-violation tests. Any violation blocks `gate`.

### Evidence read

The checker reads the `PROVISIONAL` entry object from `governance/registry.json` and the complete text object for every named test file. The evidence is the file content itself, not a link or a claimed test result.

### Status-sensitive values

- The requirement that provisional interpretations have explicit tests: **RATIFIED** by the RG ruling `6937254884`.
- The IDs, formulas, weights, budgets, thresholds, and interpretations currently carrying `PROVISIONAL`: **PROVISIONAL**. RG-2 tests their declared behavior; it does not make that behavior law.
- The literal marker spelling `registry: <id>`: **PROVISIONAL implementation syntax**, not a policy formula.

## 4. RG-3 — cited owner authority

### Assertion

A policy-code comment that invokes an owner ruling, direction, decision, approval, ratification, or equivalent owner authority must contain an owner-ruling ID that exists in the `rulings` object of `governance/owner-rulings.json`. Pending markers such as the BR-1 owner-ratification item are not themselves authority claims.

The check must inspect the comment line itself and match the cited ID against the loaded ruling objects. A numeric-looking ID that is absent from the ledger is not sufficient.

### Gate location and failure

Run in the dedicated RG/E6 step and through planted-violation tests. Any uncited or unknown authority claim blocks `gate`.

### Evidence read

The evidence is the actual comment text in each policy source object plus the actual `rulings` array object in `governance/owner-rulings.json`. The checker must not use issue URLs, PR prose, chat history, or a human assertion as a substitute for the ledger object.

### Status-sensitive values

- Owner-authority citation as a gate requirement: **RATIFIED** by `6937254884`.
- The current owner-ruling IDs in `owner-rulings.json`: **RATIFIED only for the claims explicitly represented by those objects**.
- The numeric shape used by the current parser (ten decimal digits): **PROVISIONAL implementation detail**; it must not be treated as a law about future ruling identifiers.

## 5. RG-4 — no silent promotion and valid constitutional citation

### Assertion

For every registry entry:

1. `RATIFIED` requires a `source.ruling` whose ID exists in the owner-rulings object.
2. `CONSTITUTIONAL` requires a `source.doc` and `source.ref`, and the cited reference must occur in the actual cited constitution text object.
3. A `PROVISIONAL` entry is never treated as `RATIFIED` merely because code or tests use it.

### Gate location and failure

Run in the dedicated RG/E6 step and through planted-violation tests. Any missing, stale, or mismatched source blocks `gate`.

### Evidence read

The check reads the complete registry entry object, the complete owner-rulings object, and the complete cited constitution document object. It must compare the values in those objects, not a reference to a document or an issue comment.

### Status-sensitive values

- The statuses `RATIFIED` and `CONSTITUTIONAL` and their source requirements: **RATIFIED** as the governance protocol by `6937254884`.
- `dynasty-score-v1` and other entries currently marked `RATIFIED`: **RATIFIED** only with their recorded ruling IDs; the gate does not broaden their meaning.
- Current `CONSTITUTIONAL` references such as AA1, AA12, and E1: **RATIFIED as citations to the current constitution object**, while any formula text not itself ratified remains **PROVISIONAL**.
- Any proposed new status promotion: **RESERVED for owner action** until a new ruling is recorded.

## 6. RG-5 — constitutional claim citations and reserved tripwires

### Assertion

Two independent assertions run under RG-5:

1. A policy-code comment claiming that the constitution requires, mandates, or otherwise constitutionally compels a rule must cite an AA, AT, E, or Annex reference.
2. No non-test, non-tool implementation source may match the `tripwire` of a `RESERVED` registry entry. The current reserved territory-control tripwire remains prohibited from implementation.

The checker must report the source object and line for both classes of violation. It must not infer permission from a nearby comment or from a proposal document.

### Gate location and failure

Run in the dedicated RG/E6 step and through planted-violation tests. Either violation blocks `gate`.

### Evidence read

The checker reads the actual policy source comments, the registry's `RESERVED` entry and tripwire object, and every eligible implementation source text object. Tests and the checker implementation itself are excluded only where the existing gate contract explicitly excludes them so the planted-violation harness can test the rule.

### Status-sensitive values

- Citation requirement: **RATIFIED** by RG ruling `6937254884`.
- `territory-control`: **RESERVED** by owner ruling `6937184242`; its tripwire is not permission to implement anything.
- The exact regular-expression tripwire: **PROVISIONAL implementation mechanism** for detecting a reserved concept; it must not be treated as the constitutional definition of territory control.
- No territory-control formula, threshold, or constant is proposed here; all such values remain **RESERVED**.

## 7. E6 — observer-to-validator import-graph restriction

E6 is proposed as a separately named sub-check reported by the RG gate, because an import boundary is easier to audit when its failure is not hidden under a general text rule.

### Assertion

No module in the validation side — `engine/`, `lineage/`, `seats/`, `residents/`, or `console/` — may reach any module under `observer/` through relative imports. The observer is read-only and journal-derived; validation and action authority must not depend on it. The check must detect both a direct import and a transitive path such as `engine/a.ts → lineage/b.ts → observer/report.ts`.

The proposed implementation should resolve each relative import from the source object, normalize `.js`/`.ts` and index paths, build a directed import graph from the commit snapshot, and compute reachability from each guarded root to `observer/`. A violation should include the source file, the resolved target, and the complete shortest import path. Bare package imports are not evidence of an observer edge; unresolved relative imports are themselves a separate deterministic error rather than a pass.

### Gate location and failure

Run in the dedicated RG/E6 step and through a planted direct-edge and planted transitive-edge test. Any reachable observer edge blocks `gate`.

### Evidence read

The evidence is the actual path→text source snapshot and the import specifiers parsed from those file objects. The checker must not rely on a README statement, an allowlist copied from the PR description, or a reference to a module that was not present in the checked-out commit.

### Status-sensitive values

- E6 Option 1 observer boundary and the no-ranking/coverage-disclosed ruling: **RATIFIED** by `6937184242` and `6937295727`.
- The guarded directory set and the observer target namespace: **RATIFIED scope for the E6 boundary**; changing it is a governance change requiring owner review.
- The graph resolver's extension/index normalization and shortest-path reporting: **PROVISIONAL implementation details**, not constitutional formulas.
- No observer score, weight, threshold, or territory formula is introduced by this proposal. Existing dynasty-score axis definitions remain **PROVISIONAL** where the registry says so; territory control remains **RESERVED**.

## 8. Acceptance and ratification checklist

Before this proposal becomes implementation work, the owner must ratify:

- that RG-1..RG-5 and E6 are required status checks, not merely advisory test cases;
- the exact policy roots and the transitive E6 boundary above;
- whether the current implementation details marked **PROVISIONAL** are accepted as checker mechanics or need revision;
- that no proposal wording changes any current `PROVISIONAL` formula/constant to law and no `RESERVED` item is implemented;
- that branch protection requires the `gate` check for merges to `main`.

After ratification, a separate implementation PR may add or revise the checker, planted-violation tests, and workflow wiring. This proposal intentionally contains none of those changes.
