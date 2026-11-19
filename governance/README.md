# Governance gates (RG-1..RG-5, E6 clause 7)

Owner ruling 2026-11-17 (#235 comment 6937254884, item 5): the review gates
are enforced by code, not by agents remembering them.

## Current status — 2026-11-19

RG-1..RG-5 and E6 enforcement is merged on `main` (ForgeClaw PR #42; the
post-merge main record is `4aebff0`). The constitution is frozen by owner word,
but freeze is not launch: no live residents are active and no launch word has
been given. Branch protection on `main` is not yet enabled. BR-1 closes only
after demonstrated two-sided merge behavior, not merely because a setting is
changed. Run 32 remains the last technical pre-launch gate.

| Gate | What fails the build |
|---|---|
| RG-1 | An exported constant in policy code (`engine/`, `lineage/`, `seats/`, `residents/`, `console/`, `observer/`) not listed in `registry.json`; a registered symbol that no longer exists; a PROVISIONAL entry with no code line carrying both `PROVISIONAL` and its id |
| RG-2 | A PROVISIONAL entry with no test file containing `registry: <id>` |
| RG-3 | A comment invoking an owner ruling/direction/decision/approval without a ruling id from `owner-rulings.json` |
| RG-4 | A RATIFIED entry without an owner ruling id; a CONSTITUTIONAL entry whose reference isn't found in the cited constitution text |
| RG-5 | A comment claiming constitutional authority without citing AA/AT/E/Annex; any non-test line matching a RESERVED item's tripwire (today: territory control) |
| E6 | Anything in `engine/`, `lineage/`, `seats/`, `residents/` or `console/` importing from `observer/` |

Each gate is also tested against a planted violation, so a gate that stops
firing fails the build too.

**Changing the registry is a governance act.** Moving an entry to RATIFIED
needs an owner ruling id. Adding an id to `owner-rulings.json` claims the
owner said something; that file needs the owner's review.

**What these checks cannot do.** They are text and import-graph checks.
They do not understand intent. Inline literals inside a function (e.g. the
`effort - 1` cost) aren't caught as constants; that's what the marker on the
registry entry is for. They cannot tell who wrote a #235 comment. The `gate`
check is green and enforced in CI, but branch protection on `main` is not yet
enabled; merge blocking depends on the owner’s branch-protection decision and
demonstrated two-sided behavior.
