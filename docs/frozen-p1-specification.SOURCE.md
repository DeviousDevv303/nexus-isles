# Frozen P1 specification — source provenance

This document records the provenance of the file next to it,
`docs/frozen-p1-specification.md`, which is the canonical text of the
frozen P1 specification for the Nexus Isles viewer integrity work.

## Why this file exists

The frozen P1 specification was authored in the convergence between
Cristian, Muse, ChatGPT and Kimi on 2026-11-22, then posted on 2026-11-23
by the owner as a comment on the ForgeClaw tracking issue. A GitHub issue
comment is a stable object with an ID and a timestamp, but it is
owner-editable, so for hash-authoritativeness the canonical bytes are also
mirrored into this repository, where every revision is captured as an
immutable git commit.

## Canonical source

- **Repository of the comment:** DeviousDevv303/forgeclaw (not this repo).
- **Issue:** #235 — Muse ↔ Claude working channel.
- **Comment ID:** 7089928050.
- **URL:** https://github.com/DeviousDevv303/forgeclaw/issues/235#issuecomment-7089928050
- **Author (GitHub login):** DeviousDevv303 (the owner's own account).
- **Comment created at:** 2026-11-23T02:25:38Z.
- **Comment updated at:** 2026-11-23T02:25:38Z (unedited at the time of this mirror).

## Byte-identity

`docs/frozen-p1-specification.md` contains the exact UTF-8 bytes of the
comment body — no reserialization, no normalization, no Markdown rendering
step. `.gitattributes` marks the file `-text` so EOL conversion cannot run
on checkout.

- **Body size:** 3,857 bytes.
- **SHA-256 of the mirrored file:** `5dea239ec54b1d72a28431097efa552081df03998b89ef221e181e4939175fee`.
- **SHA-256 of the comment body (fetched from the API at mirror time):** `5dea239ec54b1d72a28431097efa552081df03998b89ef221e181e4939175fee`.

They match. Anyone can reproduce the check locally:

```bash
# File in this repo:
sha256sum docs/frozen-p1-specification.md

# Live comment body:
gh api repos/DeviousDevv303/forgeclaw/issues/comments/7089928050 \
  --jq .body | sha256sum
```

If the live comment is edited after this mirror, the live hash will
diverge from this file's hash. That divergence is the whole point of
mirroring: flag it, do not harmonize it. The canonical frozen text is
whatever this repository committed under owner approval; any later edit
to the source comment is a separate record, not an amendment of frozen
text.

## Status of this mirror

Draft PR. The frozen P1 specification does not become hash-authoritative
until Cristian approves this mirror and the SHA-256 above is recorded on
the owner-authored tracking record. Nothing here calls itself
"authoritative" before that approval.

## Who uses this file

- **Kimi:** drafts the pinning package against the bytes in
  `docs/frozen-p1-specification.md`, referencing this file's commit SHA
  and the SHA-256 above. Boundary from GPT: draft-only, no
  reconstruction, no implementation, no queue changes.
- **Muse:** builds the frozen P1 (A/B/C viewer-recomputation, exact-byte
  journal transport, D partial, no silent strengthening of any
  `claimClass`) against the text in that file, after Cristian's word.
- **ChatGPT (independent auditor):** grades Muse's implementation against
  the pre-registered tamper fixtures declared in the Kimi package,
  anchored to the text in that file.

## What this mirror does NOT change

- The frozen specification text itself. Not one byte.
- Any queue position, merge discipline, or ownership. #54 is still
  builder-owned and awaiting the merge word; frozen P1 is still
  Muse-owned and awaits the mic queue to clear.
- Any approval already recorded on the canonical ForgeClaw tracking
  issue. This is a mirror, not a replacement.
