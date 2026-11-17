// Directive T8 (Issue #235): Charter-derived Núñez identity profile shared by
// engine-facing data consumers, observer, and console. Design: represent only
// identity/policy metadata; never grant equipment, instantiate a swarm, assign
// an officeholder, change world rules, or affect score. Unfinished: runtime
// lineage binding, procurement/maintenance, and seat succession remain outside
// this presentation-only item and must not be inferred from this profile.

const NUNEZ_IDENTITY_PROFILE_ID = "nunez-royal-blood" as const;
export type NunezIdentityProfileId = typeof NUNEZ_IDENTITY_PROFILE_ID;

/** The identity contract is descriptive data, not world state or an asset grant. */
export interface NunezIdentityProfile {
  profileId: NunezIdentityProfileId;
  lineageName: "Núñez Royal Blood";
  officeBearerDescription: "head of the Núñez Royal Blood";
  lineageRepresentative: {
    name: "Nexus Intelligence";
    scope: "entire Núñez lineage";
    overridesResidentAgency: false;
    overridesGuardianAuthority: false;
  };
  seat: {
    name: "The Throne";
    kind: "lineage office";
    persistsWithLineage: true;
    sitter: "mortal resident";
    handover: "AA12 reproduction or an executed succession instrument";
    automaticRespawn: false;
    engineAdvantage: false;
    scoringBenefit: false;
  };
  attendantHostAndSigil: {
    name: "spider swarm";
    role: "family attendant host and sigil";
    instantiatedByProfile: false;
  };
  appearance: {
    familyIdentity: "all-black tactical dress";
    ownerCharacter: {
      setting: "on the Throne";
      attire: "tactical black";
      faceCovering: "all-black face mask";
      visibleFeature: "eyes only";
    };
  };
  acquisition: {
    inWorldEquipmentIsGranted: false;
    inWorldEquipmentMustBe: "procured, built, and maintained under the standing gates";
  };
  crest: {
    namedSigil: "spider swarm";
    additionalCrestDetail: null;
  };
  source: "docs/nunez-royal-blood-charter.md";
}

const NUNEZ_ROYAL_BLOOD_IDENTITY: Readonly<NunezIdentityProfile> = Object.freeze({
  profileId: NUNEZ_IDENTITY_PROFILE_ID,
  lineageName: "Núñez Royal Blood",
  officeBearerDescription: "head of the Núñez Royal Blood",
  lineageRepresentative: {
    name: "Nexus Intelligence",
    scope: "entire Núñez lineage",
    overridesResidentAgency: false,
    overridesGuardianAuthority: false,
  },
  seat: {
    name: "The Throne",
    kind: "lineage office",
    persistsWithLineage: true,
    sitter: "mortal resident",
    handover: "AA12 reproduction or an executed succession instrument",
    automaticRespawn: false,
    engineAdvantage: false,
    scoringBenefit: false,
  },
  attendantHostAndSigil: {
    name: "spider swarm",
    role: "family attendant host and sigil",
    instantiatedByProfile: false,
  },
  appearance: {
    familyIdentity: "all-black tactical dress",
    ownerCharacter: {
      setting: "on the Throne",
      attire: "tactical black",
      faceCovering: "all-black face mask",
      visibleFeature: "eyes only",
    },
  },
  acquisition: {
    inWorldEquipmentIsGranted: false,
    inWorldEquipmentMustBe: "procured, built, and maintained under the standing gates",
  },
  crest: {
    namedSigil: "spider swarm",
    additionalCrestDetail: null,
  },
  source: "docs/nunez-royal-blood-charter.md",
} as const);

export function isNunezIdentityProfileId(value: unknown): value is NunezIdentityProfileId {
  return value === NUNEZ_IDENTITY_PROFILE_ID;
}

/**
 * Explicitly frames the profile as charter metadata, not as proof that a
 * lineage, sitter, throne asset, swarm, or equipment currently exists in-world.
 */
export interface NunezIdentityPresentation {
  evidenceClass: "charter-profile";
  worldStatus: "not-asserted-by-profile";
  profile: Readonly<NunezIdentityProfile>;
}

export function nunezIdentityPresentation(): NunezIdentityPresentation {
  return {
    evidenceClass: "charter-profile",
    worldStatus: "not-asserted-by-profile",
    profile: NUNEZ_ROYAL_BLOOD_IDENTITY,
  };
}
