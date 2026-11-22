// Scripted-policy residents in a persistent world — the decided first-live
// roster gap.
//
// The owner's decided first-live configuration seats Nexus plus two
// scripted-policy residents in the first live (persistent) world. Before
// this change that roster could not be instantiated at all: the only
// scripted-policy backend in the tree carried the "test-double:" identity,
// which a non-scratch world refuses at genesis (state.ts) and at bind time
// (world.ts) — proven against main by running the runner on a persistent
// genesis naming the decided roster, which died with "a world of class
// persistent cannot seat a test double".
//
// The fix is an identity, not a mechanism: the same deterministic survival
// policy is registered under its production providerId
// ("scripted-policy:survival"), and ScriptedPolicyBackend carries the ref
// it is constructed with. These tests pin all three sides: the production
// backend is constructible and truthfully labelled, a persistent world
// seats and drives scripted-policy residents under that identity, and the
// test-double ban in persistent worlds is unchanged.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Journal } from "../../ledger/journal.js";
import { ScriptedPolicyBackend } from "../../seats/driver.js";
import { TEST_DOUBLE_PREFIX } from "../../engine/world/state.js";
import { createBackend, SCRIPTED_SURVIVAL_REF, survivalPolicy } from "../../runner/backends.js";
import { loadGenesisConfig, parseGenesisConfig, type GenesisConfig } from "../../runner/config.js";
import { LaunchRunner } from "../../runner/runner.js";
import { tempDir } from "../helpers/worldFixtures.js";

function liveGenesis(): GenesisConfig {
  return parseGenesisConfig({
    seed: 4242,
    map: "juarez",
    worldClass: "persistent",
    seats: [
      {
        seatId: "resident-a",
        backend: { providerId: SCRIPTED_SURVIVAL_REF.providerId, version: SCRIPTED_SURVIVAL_REF.version },
        position: "centro",
        satiety: 50,
        maxSatiety: 60,
      },
      {
        seatId: "resident-b",
        backend: { providerId: SCRIPTED_SURVIVAL_REF.providerId, version: SCRIPTED_SURVIVAL_REF.version },
        position: "industrial-east",
        satiety: 50,
        maxSatiety: 60,
      },
      {
        seatId: "resident-c",
        backend: { providerId: SCRIPTED_SURVIVAL_REF.providerId, version: SCRIPTED_SURVIVAL_REF.version },
        position: "zaragoza",
        satiety: 50,
        maxSatiety: 60,
      },
    ],
  });
}

describe("scripted-policy residents in a persistent world", () => {
  it("the production registration is constructible and is not a test double", () => {
    const backend = createBackend({
      seatId: "resident-a",
      backend: { providerId: SCRIPTED_SURVIVAL_REF.providerId, version: SCRIPTED_SURVIVAL_REF.version },
      position: "centro",
      satiety: 8,
      maxSatiety: 10,
      actionsPerTick: 2,
      intel: 1,
    });
    expect(backend.ref).toEqual(SCRIPTED_SURVIVAL_REF);
    expect(backend.ref.providerId.startsWith(TEST_DOUBLE_PREFIX)).toBe(false);
  });

  it("the default ScriptedPolicyBackend identity is still the labeled test double", () => {
    expect(new ScriptedPolicyBackend(survivalPolicy).ref).toEqual({
      providerId: "test-double:scripted-policy",
      version: "test-v1",
    });
  });

  it("a persistent world seats, drives and journals scripted-policy residents", async () => {
    const dir = tempDir();
    const r = new LaunchRunner({ dataDir: dir, genesis: liveGenesis(), log: () => {} });
    await r.start();
    expect(r.startMode).toBe("genesis");
    await r.tickOnce();
    await r.tickOnce();
    await r.stop();

    const journal = Journal.loadFromFile(join(dir, "journal.jsonl"));
    expect(journal.verify().ok).toBe(true);
    const genesisEntry = journal.entries()[0];
    expect(genesisEntry.type).toBe("WORLD_GENESIS");
    const config = genesisEntry.payload.config as {
      worldClass?: string;
      residents: { backend: { providerId: string } }[];
    };
    expect(config.worldClass).toBe("persistent");
    // Every resident is journaled under the production identity (AT-20);
    // no test double wrote any part of this history.
    expect(config.residents.map((x) => x.backend.providerId)).toEqual([
      "scripted-policy:survival",
      "scripted-policy:survival",
      "scripted-policy:survival",
    ]);
    expect(JSON.stringify(journal.entries())).not.toContain("test-double");
    // The scripted residents really acted through the validator.
    expect(journal.entries().some((e) => e.type === "ACTION_ACCEPTED")).toBe(true);
  });

  it("the shipped live example expresses the decided roster and parses", () => {
    const path = join(process.cwd(), "runner", "genesis.live.example.json");
    const genesis = loadGenesisConfig(path);
    expect(genesis.worldClass).toBe("persistent");
    expect(genesis.seats.map((s) => s.backend.providerId)).toEqual([
      "nexus:run25-local",
      "scripted-policy:survival",
      "scripted-policy:survival",
    ]);
    // The example file itself carries no test-double identity anywhere.
    expect(readFileSync(path, "utf8")).not.toContain("test-double");
  });
});
