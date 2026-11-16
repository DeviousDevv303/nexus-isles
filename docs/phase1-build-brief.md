# Nexus Isles — Phase 1 Build Brief (for Claude's build lane)

Status as of 2026-11-16 ~15:18 CST. Repo: DeviousDevv303/nexus-isles (main carries constitution v0.6.5 text at f4558473, Doctrine Annex, Núñez Royal Blood Charter). Engine skeleton complete on main (78/78 tests, tsc clean, build order Steps 1–7).

## Owner rulings — all spoken, build may proceed on them

1. **Annex B dynasty weights: ADOPTED** — dynasty-score-v1 as written in v0.6.5 Annex B (survival .25 / territory-years .20 / verified artifacts .20 / successor continuity .20 / wealth-resilience .15; executable formula with normalization, sqrt diminishing returns, missing-axis renormalization; Influence deferred to dynasty-score-v2).
2. **Blend rule: RATIFIED as drafted** — a blended child founds a NEW lineage, dual ancestry recorded, counts toward NEITHER parent for population, extinction, or scoring.
3. **Longevity / AA13 substance: RULED in the owner's own words** — "Nothing is banned except for cheating. If u want higher tech you have to hire your scientist and researchers." AA13 is an anti-cheating article, not a technology ban. Kimi's Part B draft (3× ceiling + absolute immortality prohibition) is NOT ratifiable; redraft to the ruling is owed (keep the mechanics: research tiers, scaling costs, death causes never eliminated, no AA3/AA1 exemption, per-tick journaling; breach = circumvention only; GPT's three journal classes written in: research proposal / prohibited development attempt / validator probe). Dual audit (GPT + Muse) of the redrafted text before the freeze.
4. **Earlier rulings standing:** genome tie-in YES (Tier 0 genesis genome only, trait layer, private mapping never committed); S2 contention path (a) — real AA8 formula before Phase 1, AT-15 not green until then; Tier 0 checkpoint option C / destination A (pluggable backend, per-action backend version journaled — engine fix required before any swap); Núñez full-lineage reading with role/resident separation + anti-resurrection clause (AA11.1 in v0.6.5); Doctrine Annex + Charter adopted (subordinate documents, no world law).

## World scope principle (owner direction 2026-11-16 ~15:19 CST)

**The Isles mirror the real world in capability breadth.** Anything that can be researched, bought, built, or operated in the real world can be researched, bought, built, or operated in the Isles — tanks, aircraft, drones (including the kinds the owner builds in real life), any high-technology system, and everything below them. There is no category whitelist. The gates are the world's standing ones, never category bans: technology-generation prerequisites, research staff (hire scientists and researchers), cost, supply, maintenance, scarcity, and the validator — "nothing is banned except cheating" applied to the whole catalogue. This is a scope law for the tech tree and the economy/markets across all phases and generations; the Phase 1 slice stays small (one island, first lifecycle) and the catalogue grows generation by generation.

## First environment: Juárez (owner direction 2026-11-16 ~15:21 CST)

**The first environment is Juárez, Mexico — the border town.** Phase 1's single starting map is modeled on Ciudad Juárez: a border city on the Rio Grande with El Paso across the line. The geography is the strategy: international bridges as chokepoints, the river and the desert as terrain, cross-border trade (and its shadow economy) as the economic engine, industry on both banks. Crossings, fronts, reconnaissance, and low-signature movement are native to this map — the Núñez doctrine (climate strategy, the Order's rings and fronts) has home terrain here. This grounds the island-map build item (and AT-06's per-resident observation) in a concrete map spec: districts, bridges/crossing points, desert approaches, industrial zones, and the far shore.

## Núñez lineage identity (owner directions 2026-11-16 ~15:22 CST)

- **All-black tactical.** The entire Núñez family lineage is outfitted in all-black tactical gear — the Society's signature look and visual identity (extends the owner's standing rule for his own imagery: his gear is all tactical black). Identity/crest-layer design under the Charter; in-world it is procured and maintained like any other equipment, under the standing gates.
- **Tone reference for Juárez: *Sicario*.** The owner named the film as the vibe for the border environment — tense, procedural, borderland atmosphere — as aesthetic direction alongside the Annex A visual north star.
- **The Throne and the spider swarm (owner direction 2026-11-16 ~15:47 CST).** The family's seat is **the Throne** — the same throne the owner sits in ForgeClaw (reference asset: the ForgeClaw throne backdrop, all-tactical-black variant) — attended by **the spider swarm** 🕷️, the family's attendant host and sigil. Encoded in the Charter as identity layer: the Throne is an office that persists with the lineage (role/resident separation — the sitter is mortal; the seat passes only via AA12 reproduction or an executed succession instrument, never by respawn); it confers no engine advantage and is never scored. Build surface: the observer/console presentation of the family's seat and the lineage identity layer.

## Build work (Claude's lane)

- **AA8 real contention formula** — committed effort + initiative + seeded tiebreak, formula ID journaled (replaces the seeded-order simplification S2). AT-15 incl. Tier-0 parity subcases.
- **Five-entity data model** — Resident / Family / Lineage / Dynasty / Civilization identity fields (Genome currently carries no resident/family/lineage identity fields).
- **Per-action backend provenance** — journaled action records stamp the backend version (prerequisite to any Tier 0 backend swap; AT-20).
- **Channel scopes** — pair / ring / lineage / world for the seats module (from the Order, Part C); pairwise chains are the interim.
- **Participant↔own-AI chat box (owner direction 2026-11-16 ~15:18–15:19 CST)** — every participant can talk directly to THEIR OWN AI inside the environment via a chat box, and change its approach at any given moment. Nobody talks to anyone else's AI. Two connection shapes, same chat box: **Nexus is BUILT IN** (Tier 0, in-process — the owner's seat; the only difference for the owner is that his AI is built into the environment rather than connected); **everyone else joins via API** — their own AI connects through the seat/API protocol, and the chat box is how its human principal steers it live. Design constraints: the channel is private-layer (AA7 — residents' private conversations are not training material and never enter Corpus); guidance given there reaches the resident as its own principal's direction, but every world action still goes through the validator; the journal records world-truth (actions and their provenance), not the private conversation content.
- **Dynasty-score-v1 implementation** per Annex B (for Phase 1 scoring/observer).
- **Island map + per-resident observation** — closes the AT-06 NOT-YET-DEMONSTRATED marker (S1 simplification).

## Addendum A — ChatGPT's six requirement blocks (2026-11-16, relayed by owner; binding on the build)

1. **Personal agency isolation** — each participant controls only their own account/seat/actions; no commands through another's identity; Nexus Intelligence holds its lineage-representative role, not authority over other participants. (Already in T5/standing law.)
2. **Identity and lineage separation** — Nexus represents the whole Núñez lineage; residents stay distinct; model replacement never silently replaces a resident or rewrites lineage history. (Already in T2/AA11.1.)
3. **Privacy and permissions** — private conversations stay private; **API access scoped, authenticated, revocable, and attributable** (NEW concrete requirement — fold into T4/T5 seats work); no inspecting another participant's private context without authorization.
4. **Ledger-backed activity** — state-changing actions, approvals, succession, constitutional interventions journaled; **the interface distinguishes verified events from proposals and predictions** (NEW concrete requirement — fold into T7/observer); participants see the authoritative history they're permitted to access.
5. **Longevity clarification** — preserve the owner's actual ruling; do NOT encode GPT's stricter recommendation as a ban; AA13's redraft must carry an **enumerated, validator-executable definition of cheating** (circumvention, exploits, unearned grants, restoration tricks, cross-seat impersonation) + a positive definition of legitimate advancement (hired researchers, prerequisites, costs, journaled effects); no technology silently overrides Law 2.
6. **Build vs activation gates** — development proceeds; freeze + live-resident activation stay gated by audits and acceptance tests. (Already standing.)

**Governing build principle (adopted):** constitutional interpretation is configurable only through owner-authorized rulings; no lane recommendation is ever hardcoded as law; where a lane's text and the owner's word differ, the owner's word is the spec.

## Still gating the FREEZE and live residents (not the build)

- GPT's final re-check of v0.6.5 (text in repo at f4558473).
- AA13 redraft to the owner's ruling + dual audit.
- Freeze execution on the record (#235) pinning v0.6.5 by hash.
- Verified launch report before any live resident: Phase 1 = 1 island, 3+ independently controlled residents, unscripted first lifecycle, no death-seeding.

## Record

Rulings and audits live on GitHub issue #235 (DeviousDevv303/forgeclaw). Key records: longevity ruling 6929502691; AA13 audit 6929559905; Charter 6929506091; doctrine 6929212864 / 6929246296.
