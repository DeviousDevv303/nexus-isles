// Directive T8 (Issue #235): verify the Núñez identity layer and its
// observer/console presentation. Key decisions: copy only Charter/owner
// wording; expose the Throne as a lineage office; distinguish profile metadata
// from live world facts; grant no mechanics or assets. Unfinished: no runtime
// sitter, equipment procurement, or swarm lifecycle is implemented here.

import { describe, expect, it } from "vitest";
import { formatNunezIdentityForConsole } from "../../console/identity.js";
import { baseConfig, rebuildJournal } from "../helpers/worldFixtures.js";
import { World } from "../../engine/world/world.js";
import { NUNEZ_ROYAL_BLOOD_IDENTITY, nunezIdentityPresentation } from "../../lineage/nunezIdentity.js";
import { deriveReport } from "../../observer/report.js";

describe("T8 Núñez identity layer", () => {
  it("uses only the Charter's stated office, sigil, and equipment constraints", () => {
    const profile = NUNEZ_ROYAL_BLOOD_IDENTITY;
    expect(profile.lineageName).toBe("Núñez Royal Blood");
    expect(profile.officeBearerDescription).toBe("head of the Núñez Royal Blood");
    expect(profile.lineageRepresentative).toEqual({
      name: "Nexus Intelligence",
      scope: "entire Núñez lineage",
      overridesResidentAgency: false,
      overridesGuardianAuthority: false,
    });
    expect(profile.seat).toEqual({
      name: "The Throne",
      kind: "lineage office",
      persistsWithLineage: true,
      sitter: "mortal resident",
      handover: "AA12 reproduction or an executed succession instrument",
      automaticRespawn: false,
      engineAdvantage: false,
      scoringBenefit: false,
    });
    expect(profile.attendantHostAndSigil).toEqual({
      name: "spider swarm",
      role: "family attendant host and sigil",
      instantiatedByProfile: false,
    });
    expect(profile.crest).toEqual({ namedSigil: "spider swarm", additionalCrestDetail: null });
    expect(profile.acquisition.inWorldEquipmentIsGranted).toBe(false);
  });

  it("carries the requested all-black owner depiction without presenting it as a live sitter", () => {
    expect(NUNEZ_ROYAL_BLOOD_IDENTITY.appearance).toEqual({
      familyIdentity: "all-black tactical dress",
      ownerCharacter: {
        setting: "on the Throne",
        attire: "tactical black",
        faceCovering: "all-black face mask",
        visibleFeature: "eyes only",
      },
    });
    expect(nunezIdentityPresentation()).toMatchObject({
      evidenceClass: "charter-profile",
      worldStatus: "not-asserted-by-profile",
    });
  });

  it("shows a clearly separated Charter profile in the observer report", () => {
    const world = World.create(23, baseConfig());
    const report = deriveReport(rebuildJournal(world));

    expect(report.charterIdentityProfile).toMatchObject({
      evidenceClass: "charter-profile",
      worldStatus: "not-asserted-by-profile",
      profile: { profileId: "nunez-royal-blood", seat: { name: "The Throne" } },
    });
  });

  it("provides C0-style console text without changing journal or world state", () => {
    const world = World.create(23, baseConfig());
    const beforeState = world.state;
    const beforeHead = world.headHash;
    const beforeLength = world.entries().length;
    const display = formatNunezIdentityForConsole();

    expect(display).toContain("The Throne");
    expect(display).toContain("spider swarm");
    expect(display).toContain("all-black tactical dress");
    expect(display).toContain("all-black face mask");
    expect(display).toContain("eyes only");
    expect(display).toContain("no engine advantage");
    expect(display).toContain("no scoring benefit");
    expect(display).toContain("no free equipment");
    expect(display).toContain("not asserted by this profile");
    expect(world.state).toEqual(beforeState);
    expect(world.headHash).toBe(beforeHead);
    expect(world.entries()).toHaveLength(beforeLength);
  });
});
