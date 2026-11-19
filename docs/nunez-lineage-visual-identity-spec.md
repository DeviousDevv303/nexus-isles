# Núñez Lineage Visual Identity Specification

**Status:** DRAFT — presentation specification only; not Constitution, world state, gameplay law, asset grant, or launch authorization.

**Owner direction:** 2026-11-19, as recorded for the Nexus Isles simulation. The owner’s canonical self-representation is the crowned, masked commander seated on the Throne: all-black tactical clothing, full face covering with the eyes visible, and cinematic red/cyan intelligence-headquarters lighting. The reference set also includes the war-room holo-table, drone operations center, spider-swarm host, and satellite operations rooms.

**Applies to:** the Núñez Royal Blood lineage and its presentation in briefings, major events, and any future visual treatment that explicitly identifies the lineage.

**Does not apply to:** other lineages, resident agency, world rules, inventory, procurement, scoring, constitutional authority, or the launch of the simulation.

---

## 1. Purpose

This specification gives the Núñez Royal Blood a coherent visual identity without turning identity into a gameplay mechanic. It defines the visual language for the owner-character, the Núñez lineage, its offices and symbols, and the presentation layers that may depict them.

The intended tone is a cinematic, realistic intelligence-headquarters and special-operations environment: controlled, procedural, materially grounded, and capable of communicating hierarchy without becoming cartoonish strategy-game art. The visual system should feel like a high-security command facility or an observed operations room, not like a decorative fantasy faction screen.

The specification is deliberately presentation-first. It does not create a throne object, instantiate a spider swarm, assign an officeholder, grant clothing or equipment, or assert that an image proves a corresponding in-world event.

## 2. Authority and source boundary

The existing identity profile is the source for the current descriptive facts:

- `lineage/nunezIdentity.ts` — the typed Núñez identity profile and its explicit `not-asserted-by-profile` world status.
- `docs/nunez-royal-blood-charter.md` — the founding charter, the Throne as a lineage office, the spider swarm as attendant host and sigil, and the all-black tactical family identity.
- `docs/doctrine-annex-nunez-royal-blood.md` — the lineage’s low-signature, disciplined, generational doctrine and its distinction between discretion and Ledger truth.
- `lineage/README.md` — the T8 presentation-data boundary and the separation between identity metadata and world-state binding.
- `viewer/render.ts` — the read-only auditor surface and its requirement to distinguish journal-derived world truth from a resident’s view.
- `engine/world/maps/juarez.ts` — the current Juárez/El Paso map and its procedural, tense, borderland tone.

This document interprets those sources visually. It must not be used to infer a new rule, authority, ability, resource, technology, or event. If a future visual request conflicts with the Constitution, the journal, a validator result, or a standing gate, the simulation and its evidence win.

## 3. Canonical identity: the owner-character

The owner-character is the visual anchor of the Núñez identity. When the simulation depicts the owner-character in a lineage briefing or major-event portrait, the default representation is:

- seated on the Throne;
- crowned, with the crown reading as a symbol of office and continuity rather than proof of legal authority beyond the simulation’s rules;
- dressed in all-black tactical clothing;
- wearing an all-black full face covering, with the eyes as the principal visible feature;
- posed with stillness, control, and deliberate attention rather than theatrical aggression;
- framed with cinematic, high-contrast cyan/teal and red/orange practical lighting;
- presented with the material detail of tactical fabric, armor, optics, cables, screens, and worn surfaces rather than glossy game-render ornament.

The crown, mask, throne, and tactical clothing are visual identifiers. They do not establish that the owner-character owns equipment, has a particular inventory, holds an in-world office, or has completed an action. Any such claim requires the relevant journal record and gate evidence.

The face covering is part of the canonical identity and should not be casually removed in a portrait intended to represent the owner-character. A briefing may show an abstract silhouette, rear view, reflection, or eyes-only crop when the scene does not warrant a full portrait; it must not invent facial details that the canonical presentation does not establish.

## 4. Núñez lineage identity

The all-black tactical identity belongs to the Núñez lineage only. It is the family’s visual grammar, not a default costume for the world.

A Núñez presentation may use the following recurring elements:

- black tactical dress with restrained, functional variations across generations;
- dark matte materials, low-reflective armor, utility layers, gloves, masks, and field equipment when the scene has earned them;
- the spider swarm as the family attendant host and sigil;
- controlled red/cyan or teal/amber command lighting;
- secure rooms, map tables, satellite imagery, surveillance walls, drone feeds, instrument panels, and archival displays;
- composed geometry, disciplined spacing, and an emphasis on chain of responsibility;
- restrained Núñez marks that identify the lineage without turning every frame into a logo wall.

The lineage may evolve its clothing, architecture, and presentation across generations. Variation is expected in cut, wear, materials, rank markers, local adaptation, and personal preference. The invariant is the recognizable Núñez visual language: all-black tactical identity, controlled intelligence aesthetic, and the spider-swarm association.

Other lineages must retain their own appearance, dress, culture, symbols, and visual decisions. They may choose tactical clothing, crowns, masks, command rooms, or dark palettes independently, but the simulation must not automatically copy Núñez styling onto them or imply that they belong to the Núñez lineage. Shared visual motifs are not lineage membership.

## 5. The Throne and the spider swarm

### 5.1 The Throne

The Throne is a lineage office in the existing charter and identity profile. Visually, it is the Núñez command seat: substantial, dark, and physically credible, with the presence of a secure command chair rather than a decorative fantasy throne. It may appear in a lineage portrait, succession briefing, or major-event scene when the relevant presentation context calls for it.

The Throne persists as a visual office of the lineage, but the sitter is always a mortal resident. A visual showing an empty Throne, a prepared Throne, or a Throne occupied by a named resident must not be treated as proof of office assignment unless the world/journal evidence supports that state. The image layer cannot execute succession, create an heir, or imply automatic respawn.

### 5.2 The spider swarm

The spider swarm is the family’s attendant host and sigil. It is an identity and presentation element unless and until the simulation contains journaled, legitimately procured, built, and maintained in-world entities or equipment that support a more specific claim.

Visual treatments may include:

- a restrained swarm silhouette or icon in lineage briefings;
- spider-like drone or micro-machine forms in a clearly labelled concept, reference, or briefing image;
- a swarm host accompanying the Throne as a symbolic visual motif;
- a real in-world swarm only when its existence, capabilities, ownership, maintenance, and location are supported by simulation records.

Artwork must never imply that the profile itself instantiated a swarm, granted a drone fleet, or supplied equipment. When the swarm is symbolic or unverified, the presentation should label it as identity/sigil imagery rather than observed world intelligence.

## 6. Visual grammar

### 6.1 Camera and composition

Default compositions should feel like frames from an intelligence briefing or a grounded special-operations film:

- medium and wide compositions that establish the command room, map, or operational context;
- controlled low-angle or eye-level portraits for the Throne, avoiding exaggerated superhero perspective;
- visual hierarchy that places the resident, evidence object, and relevant map state ahead of decoration;
- practical occlusion, cables, glass, screens, shadows, and imperfect surfaces that make the environment legible as a place;
- negative space and disciplined symmetry where the scene communicates command or continuity.

The graphics should not rely on floating labels, decorative particles, or invented data to appear sophisticated. If an interface, route, unit, structure, or intelligence item is visible, its status must be traceable to the simulation or explicitly marked as presentation-only.

### 6.2 Color and light

The Núñez palette is predominantly black and charcoal with controlled cyan/teal and red/orange accents. Cyan/teal may indicate screens, night operations, cold instrument light, or verified technical context. Red/orange may indicate alert lighting, heat, risk, or a major-event emphasis. Color is atmospheric and organizational; it is not a hidden gameplay signal unless a future mechanic explicitly defines one.

Avoid bright faction-color gradients, toy-like saturation, glossy plastic armor, fantasy gold everywhere, and ornamental effects that obscure the map, journal evidence, or resident state. The crown may use warm metallic highlights, but the overall identity remains tactical and restrained.

### 6.3 Materials and wardrobe

Materials should read as functional and worn: ripstop, matte composite, rubber, glass, brushed metal, fabric, cable sheathing, and controlled reflections. Clothing may show lineage-consistent tailoring and rank cues, but the artwork must not silently add weapons, armor tiers, sensors, vehicles, or other inventory.

A depiction of equipment is one of three things and must be clear about which:

1. **Observed in-world equipment:** supported by journal/state evidence and shown as current.
2. **Briefing or concept treatment:** a design or possibility, clearly labelled and not a world-state claim.
3. **Identity motif:** a symbolic element such as the spider-swarm sigil, not an asset grant.

## 7. Simulation honesty and displayed intelligence

Simulation-first is the governing rule for every visual surface.

### 7.1 Evidence hierarchy

When a graphic displays intelligence, use this order of authority:

1. journaled world state and replay-derived state;
2. validator-approved facts and current map/state objects;
3. explicitly labelled observer/auditor derivations;
4. clearly labelled concepts, projections, or identity motifs.

A graphic must never present an unobserved route, resident belief, inventory item, faction capability, map event, or intelligence conclusion as verified simply because it makes the scene look complete. Unknown, hidden, stale, unavailable, and not-yet-observed states should remain visible as such.

The authoritative journal retains complete world truth even when a lineage practices discretion. A Núñez intelligence room may show selective information to communicate a resident’s perspective, but the presentation must not rewrite, hide, or contradict the Ledger. A resident view and an auditor view are different surfaces and must be labelled distinctly.

### 7.2 Labels and provenance

Any intelligence panel, briefing card, map annotation, portrait caption, or event graphic should identify its evidence class where ambiguity is possible:

- **OBSERVED** — supported by the relevant current simulation evidence;
- **DERIVED** — calculated from journal/state data, with the derivation defined by the viewer or report;
- **HYPOTHESIS** — a resident or lineage interpretation, not established fact;
- **CONCEPT** — visual identity or future design reference, not world state;
- **STALE / UNAVAILABLE / NOT OBSERVED** — the simulation does not currently support a stronger claim.

These labels are presentation semantics, not new gameplay rules. The exact wording may be adapted to the surface, but the distinction cannot be removed to make an image more cinematic.

### 7.3 Auditor surface versus resident surface

The existing viewer is an auditor’s surface: read-only, journal-replayed, and explicitly not a resident’s view. Núñez visual identity may frame an auditor briefing with the lineage’s cinematic language, but the frame must preserve the auditor label and the complete, journal-derived state.

A future resident-facing intelligence room may be selective and fog-of-war aware. It must not display information the resident has not observed as if it were resident knowledge. A briefing that combines whole-world truth with Núñez atmosphere must say that it is an auditor or observer view.

## 8. Rendering tiers and performance budget

The visual system has two presentation tiers.

### Tier A — play and map interaction

During ordinary play, movement, replay, and map interaction, rendering stays lightweight:

- use the journal-derived map, residents, nodes, and edges directly;
- prioritize readable state, route, position, life status, resources, and evidence labels;
- use restrained color, small icons, simple silhouettes, and limited animation;
- avoid full cinematic compositing, heavy particle fields, volumetric lighting, expensive post-processing, and large image payloads;
- keep controls responsive on mobile and modest hardware;
- never trade map readability or state accuracy for atmosphere.

Tier A is the default. A Núñez marker can be recognizable without turning the map into a cinematic scene.

### Tier B — briefings and major events

Heavier treatment is reserved for explicit briefings, lineage portraits, succession events, major discoveries, and other bounded moments:

- cinematic lighting and deeper environmental detail;
- controlled depth, practical screen glow, haze, reflections, and sound/animation if a future surface supports them;
- richer throne-room, war-room, drone-ops, or satellite-ops compositions;
- lineage-specific framing and symbolic spider-swarm treatment;
- a clear return to the lightweight map surface.

Tier B must still obey evidence labels and must not imply that a visual flourish is a simulation event. It is a presentation layer around the evidence, not a replacement for it.

## 9. Lineage inheritance and generational variation

The Núñez lineage inherits a visual identity, not a fixed body, guaranteed gear set, or predetermined personality. A descendant may differ in age, stature, facial visibility when context requires, wear, local adaptation, personal taste, and role. The lineage connection is expressed through the shared visual grammar and recognized symbols, not through identical clones.

The genome and mutation systems remain trait-layer and world-rule systems. This specification does not add visual fields to the genome, change mutation budgets, establish succession eligibility, or make a visual resemblance evidence of biological or institutional continuity. If a future implementation connects a visual trait to lineage data, that connection needs its own typed contract, evidence rules, and review; it must not be inferred from this document alone.

A Núñez resident may reject, customize, or reinterpret parts of the family style without losing agency. Likewise, a non-Núñez resident must not be assigned Núñez clothing or symbols merely because the viewer needs visual variety.

## 10. Prohibited implications

The following are out of scope and must not be implied by artwork or presentation copy:

- automatic assignment of a resident to the Throne;
- automatic succession, immortality, respawn, or survival after death;
- a crown as constitutional exemption or score multiplier;
- a mask as proof of identity, rank, or hidden capability;
- a spider swarm as an automatically granted host, weapon, vehicle, or intelligence network;
- tactical clothing as free inventory or procurement;
- visual presence as proof that a resident observed an event;
- cinematic screens showing fabricated routes, units, resources, enemies, or outcomes;
- Núñez style applied to another lineage without an explicit, supported reason;
- visual polish that obscures stale, unavailable, hidden, or unmeasured state;
- artwork treated as a substitute for a journal entry, validator result, or gate.

## 11. Acceptance checklist for future implementation

A future implementation or asset PR using this specification should be reviewable against the following checklist:

- [ ] The surface identifies whether it is an auditor, resident, briefing, concept, or map surface.
- [ ] Every displayed intelligence claim has an evidence class and does not overstate observation.
- [ ] The owner-character uses the canonical crowned, masked, all-black tactical identity when explicitly depicting the owner.
- [ ] Núñez lineage identity is visually distinct without forcing the same style on other lineages.
- [ ] The Throne and spider swarm are not treated as automatic asset grants or world-state bindings.
- [ ] No visual treatment changes abilities, equipment, inventory, authority, scoring, succession, or mortality.
- [ ] Ordinary map/play rendering remains lightweight and readable.
- [ ] Cinematic rendering is bounded to briefings and major events.
- [ ] Unknown, stale, hidden, unavailable, and unobserved states remain honest and legible.
- [ ] The authoritative journal remains the source of world truth.
- [ ] The change is docs/assets/UI scoped as declared; no protected engine or governance rule is changed without a separate authorized item.

## 12. Open questions intentionally left open

This draft does not decide:

- which future asset pipeline or renderer produces the cinematic treatments;
- whether visual identity is ever encoded in the genome or a separate presentation profile;
- the exact appearance, capabilities, or procurement model of any in-world spider swarm;
- the final Throne asset, room layout, animation language, or event choreography;
- the data contract for resident-facing fog-of-war intelligence;
- whether a future lineage may adopt a visual style through alliance, marriage, cultural exchange, or other in-world process.

Those questions require their own evidence, implementation boundary, and review. Until then, this document is the visual identity specification for presentation and design discussion only.
