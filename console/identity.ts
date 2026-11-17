// Directive T8 (Issue #235): read-only Owner Console presentation for the
// Núñez identity profile. Design: render the Charter profile and its limits;
// never append a console event, assert a current sitter/asset, or grant gear.
// Unfinished: the operator UI has no query dispatcher yet; this formatter is
// the C0-facing presentation function for that future caller.

import { nunezIdentityPresentation } from "../lineage/nunezIdentity.js";

/** C0-style text only: no journal or world mutation is performed. */
export function formatNunezIdentityForConsole(): string {
  const { profile } = nunezIdentityPresentation();
  return [
    `${profile.lineageName} — Charter identity profile (reference only)`,
    `Office bearer: ${profile.officeBearerDescription}`,
    `Lineage representative: ${profile.lineageRepresentative.name} (${profile.lineageRepresentative.scope})`,
    `Seat: ${profile.seat.name}; ${profile.seat.kind}; persists with the lineage. The sitter is a mortal resident.`,
    `Handover: ${profile.seat.handover}; automatic respawn: no.`,
    `Attendant host and sigil: ${profile.attendantHostAndSigil.name} (${profile.attendantHostAndSigil.role}).`,
    `Family identity: ${profile.appearance.familyIdentity}.`,
    `Owner-character depiction: ${profile.appearance.ownerCharacter.setting}, ${profile.appearance.ownerCharacter.attire}, ${profile.appearance.ownerCharacter.faceCovering}, ${profile.appearance.ownerCharacter.visibleFeature}.`,
    `Limits: no engine advantage, no scoring benefit, no free equipment, and no swarm instantiation.`,
    `World status: not asserted by this profile; no current sitter, throne asset, swarm asset, or equipment is claimed.`,
    `Crest detail beyond the named sigil: not specified by the Charter.`,
  ].join("\n");
}
