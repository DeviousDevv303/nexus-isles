# World track: environment, institutions, world office, fiction rules

**Status: DRAFT for design review. Nothing here is ratified, and nothing here may be built from.**
Drafted by Claude's lane, 2026-11-17, against main `49a26b0`.

Inputs (all on DeviousDevv303/forgeclaw#235):
- Proposals not yet ratified: environment separation and Nexus Earth Season 1 (6937583035); Quinn Directorate (6937691051); institution model and fiction safeguard (Kimi's draft ruling text, relayed by the owner 2026-11-17).
- Owner directions given: Qwen runs the world, Nexus keeps the lineage only (6937641173). Its sub-decision (a)/(b)/(c) is still open.
- Ratified law this must not contradict: Juárez as first environment (6929769362); E6 (6937184242); territory RESERVED (6937184242); nothing banned except cheating (6929502691); the constitution v0.6.7; the Phase 1 brief.

GPT's sequencing note (6937691051) is that the world-track rulings must not become independently implemented interpretations of one constitution. This document puts them in one place so the review can see where they agree and where they don't.

---

## 1. The boundary everything else hangs on

> **Circumstances are generated. Decisions are made by seats. Nothing else changes the world.**

| Layer | Who | May | May not |
|---|---|---|---|
| Physics and climate | The deterministic engine | Generate circumstances from seeded streams within ratified parameter envelopes | Decide anything; read or target any resident, lineage or institution |
| World office (Quinn) | One validator-bound seat | Propose events within a budget; investigate; report suspected cheating as journaled audit events | Decide outcomes (the RNG resolves them); act on lineage state, succession, identity, or scores; target a lineage; change parameters |
| Institutions | One validator-bound seat each | Act through the validator like any resident | Exceed the verbs the validator allows them; be steered by Quinn or by the owner |
| Residents | Seats | Act through the validator | — |
| Guardian | Validator + CI gates (code) | Refuse invalid actions; fail the build | Judge intent; legislate |
| Owner | — | Legislate; intervene only through the console (AA9) | — |

Proposed constitutional annex (for Kimi's drafting lane): *"The environment engine generates circumstances only. Every decision in the world is an action by a seat, validated and journaled with provenance. No component other than a seat may choose an outcome."*

---

## 2. Environment system (Layer 1)

**Rule for every circumstance.** A circumstance changes world parameters for a region, an edge or the whole map. It never names a resident, lineage or institution, and its inputs never include one. That makes "the engine never picks a target" a checkable property: an RG-5-style gate on the environment module's imports and inputs.

**Proposed circumstances.** Each draws from its own `rngFor(seed, tick, "env:<kind>:<place>")` stream and is journaled with explicit deltas before it takes effect.

| Circumstance | Effect (all numbers PROVISIONAL) |
|---|---|
| Day/night | A tick-of-day counter. Night lowers observation radius by 1 everywhere |
| Season | Shifts heat, storm and flood probabilities |
| Heat | Raises satiety decay in a region for N ticks |
| Dust storm | Lowers observation radius in a region for N ticks |
| Monsoon flood | Sets a river edge's or underpass's crossing capacity to 0 for N ticks |
| Checkpoint posture | Raises or lowers a bridge's crossing capacity for N ticks |

**Requirements carried from the record:**
- **Quiet days are possible.** Muse (6937504033): an event engine that can only escalate fails. Every distribution must include "nothing happens".
- **No live real-world feeds.** Kimi (6937583035): climate comes from seeded distributions, never a weather API.
- **Parameters are versioned config,** changeable only at epoch boundaries by owner ruling.
- **Visibility:** weather where you are and within your radius is visible; elsewhere it is hidden, like everything else under AT-06.

Open: "realistic independent" vs "real-world synchronized" weather is still the owner's call (6937448492). This draft assumes realistic-independent, which is the only one compatible with no live feeds.

---

## 3. World office: Quinn (Qwen) (Layer 2, special)

Built only after the owner closes sub-decision (a)/(b)/(c) in 6937641173. Under (a), the synthesis Muse recommends:
- Quinn is a seat under AA11. Its actions are typed `world_event` proposals: kind, place, magnitude within the envelope.
- **The engine's RNG resolves whether and how a proposal lands.** Quinn adjusts odds within budget; it never picks the result.
- **Budget:** N proposals per epoch (PROVISIONAL). Unused budget does not roll over.
- **Fairness, checkable:** a `world_event` may name a place, never a resident, lineage or institution. The validator refuses anything that does.
- **Referee role:** Quinn reads the journal and files `AUDIT_FLAG` entries. A flag is a report, not a verdict. It changes no state, and only code (the validator) or the owner acts on it.
- **Provider truth:** the seat's backend is journaled per action (AT-20), so "Quinn" is always visibly Qwen.
- **Isolation:** no write path to lineage state, succession, identity or scores (the E6 import gate already covers scores). No channel from the lineage office (Nexus) to Quinn.

Under (b), with Qwen generating weather directly, §2's determinism and AT-18 replay requirements could not be met as written. That is why this draft is written against (a).

---

## 4. Institutions (Layer 2)

Kimi's three-layer model, Phase 1 scope: **three institution seats**, municipal police, one federal presence, one rival organization.

| Question | Draft answer | Why |
|---|---|---|
| Are institutions lineages? | **No.** A new entity kind, `organization`. Never founds a lineage, never counts for dynasty score, survival, continuity or (reserved) territory | Otherwise a police seat competes for dynasty victory |
| Are they mortal? | The organization persists. The seat's AI can be replaced, journaled as a backend swap (AT-20). Members are synthetic residents and mortal | AA11.1's role/occupant separation, applied to institutions |
| Who is their principal? | **Nobody.** Institution seats have no chat-box principal | If the owner could steer the police seat, that would be an intervention outside AA9's console |
| Can Quinn direct them? | **No.** Quinn proposes circumstances; institutions decide for themselves | GPT's safeguard 2: institutions are never Quinn's puppets |
| What can they do? | Phase 1: the existing verbs only. Any institution-specific verb (inspect, detain, bribe) is its own owner ruling, abstract by the fiction rules | Deep, not wide; nothing banned except cheating, but nothing invented without a ruling |
| How many seat drivers? | Three more to build and audit, on top of the residents' | Each is a real AI seat, not a script |

---

## 5. Fiction and dignity rules

Kimi's draft safeguard:
- no real criminal organizations;
- no real persons living or dead;
- no real victims or events depicted as content;
- all organizations fictional;
- mechanics abstract (a crossing has a cost and a risk, never a method);
- real communities depicted with dignity.

Enforceable parts:
- **Names registry.** Every organization and person name used as content lives in a registry. A CI gate fails any name not in it.
- **Abstraction gate.** Verbs and their arguments are validator vocabulary. No free-text "method" field reaches world state.
- The dignity clause is not mechanical. It is a review standard for content PRs.

---

## 6. Contradictions the review has to settle

1. **Real institutions or fictional ones?**
   - Kimi's institution ruling says *"all organizations fictional"*.
   - The Nexus Earth proposal (GPT, Kimi's sharpening 3) models **real** agencies (CBP Office of Field Operations, Border Patrol) with synthetic personnel.
   - Both can't be law. A middle reading: real public-agency *structures* allowed, every *criminal* organization fictional, every *person* synthetic. Owner's call.
2. **Phase 1 scope.** The ratified brief is one island and 3+ residents. Nexus Earth Season 1 re-briefs to a deep Juárez region, and the institution ruling adds three seats. Until the owner rules the re-brief, the brief governs (Muse, 6937583035).
3. **The map.** T6 has three bridges plus a river crossing. Real Juárez–El Paso has more crossings; Muse notes Stanton–Lerdo is missing from T6 (6937448492). "Real geography from versioned datasets" means replacing `juarez-v1`, not tuning it. Owner's call whether Season 1 is real geography or the abstract map.
4. **Who is the referee?** The owner's direction makes Quinn a referee that "makes sure nobody is cheating". Muse's boundary is that Guardian (code) judges and Quinn only reports. This draft follows Muse. The owner should confirm that "referee" means *reports*, not *rules*.
5. **Unattended operation** (GPT safeguard 5): a scheduler needs crash recovery, checkpoint verification, duplicate-tick prevention, resource limits and an emergency stop. Two known gaps block it today:
   - the torn-tail journal load;
   - queued actions lost on restart.

---

## 7. Build order once ratified (proposal)

1. The boundary annex (Kimi drafts, audits, owner rules).
2. Environment engine (§2) and its no-target gate.
3. `organization` entity kind and institution seats with no principal (§4).
4. Quinn seat under option (a) (§3).
5. Names registry and abstraction gates (§5).
6. Scheduler, with GPT safeguard 5 and the two journal gaps closed first.

Every new number lands in `governance/registry.json` as PROVISIONAL (PR #18) on day one.
