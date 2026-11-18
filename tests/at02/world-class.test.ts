// Demo/persistent separation, in the record rather than the folder
// (forgeclaw #235 6954063385, Kimi's form; demo condition 6953774034:
// scratch world, scratch journal, labeled doubles, nothing enters a
// persistent record). The class is fixed in WORLD_GENESIS. A scratch history
// is never advanced as persistent ("just keep this one"), a persistent one is
// never opened as scratch, and a persistent world never seats a test double.
// registry: world-class-v1

import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { juarezConfig } from "../../engine/world/maps/juarez.js";
import type { BackendRef, WorldClass } from "../../engine/world/state.js";
import { World } from "../../engine/world/world.js";
import { WorldClassError } from "../../engine/world/writerLock.js";
import { tempDir } from "../helpers/worldFixtures.js";

const DOUBLE: BackendRef = { providerId: "test-double:world-class", version: "v1" };
const REAL: BackendRef = { providerId: "provider-under-test", version: "v1" };

function config(worldClass: WorldClass | undefined, backend: BackendRef) {
  return {
    ...juarezConfig([{ id: "alpha", satiety: 9, maxSatiety: 10, actionsPerTick: 2, position: "centro", intel: 1, backend }]),
    ...(worldClass ? { worldClass } : {}),
  };
}

function journalOf(worldClass: WorldClass | undefined, backend: BackendRef) {
  const path = join(tempDir(), "journal.jsonl");
  const w = World.create(5, config(worldClass, backend), { persistPath: path });
  w.tick();
  w.close();
  return path;
}

describe("world class: scratch and persistent histories never mix", () => {
  it("the class is fixed in WORLD_GENESIS and read back", () => {
    for (const c of ["scratch", "persistent"] as const) {
      const path = journalOf(c, c === "scratch" ? DOUBLE : REAL);
      expect(JSON.parse(readFileSync(path, "utf8").split("\n")[0]).payload.config.worldClass).toBe(c);
      const w = World.restoreFromFile(path, { expectWorldClass: c });
      expect(w.worldClass).toBe(c);
      w.close();
    }
  });

  it("'just keep this one': a scratch journal opened as persistent is refused, with nothing written", () => {
    const path = journalOf("scratch", DOUBLE);
    appendFileSync(path, '{"index":99,"tick":2,"type":"TICK_ST'); // a torn tail the load would repair
    const bytes = readFileSync(path, "utf8");
    expect(() => World.restoreFromFile(path, { expectWorldClass: "persistent" })).toThrow(WorldClassError);
    expect(readFileSync(path, "utf8")).toBe(bytes); // refused before any load or repair
    // The refusal released the lock: the right expectation opens it.
    const w = World.restoreFromFile(path, { expectWorldClass: "scratch" });
    expect(w.worldClass).toBe("scratch");
    w.close();
  });

  it("a persistent journal opened as scratch is refused", () => {
    const path = journalOf("persistent", REAL);
    expect(() => World.restoreFromFile(path, { expectWorldClass: "scratch" })).toThrow(/persistent journal as scratch/);
  });

  it("an unclassified journal (older than the field) is history: never opened as scratch", () => {
    const path = journalOf(undefined, REAL);
    expect(() => World.restoreFromFile(path, { expectWorldClass: "scratch" })).toThrow(WorldClassError);
    const w = World.restoreFromFile(path, { expectWorldClass: "persistent" });
    expect(w.worldClass).toBe("unclassified");
    w.close();
  });

  it("a persistent world never seats a test double, at genesis or by a later bind", () => {
    expect(() => World.create(5, config("persistent", DOUBLE))).toThrow(/cannot seat a test double/);
    const w = World.create(5, config("persistent", REAL));
    expect(() => w.bindBackend("alpha", DOUBLE)).toThrow(/cannot bind a test double/);
    expect(() => w.bindBackend("alpha", { providerId: "provider-under-test", version: "v2" })).not.toThrow();
  });

  it("scratch worlds take labeled test doubles", () => {
    const w = World.create(5, config("scratch", DOUBLE));
    expect(() => w.bindBackend("alpha", { ...DOUBLE, version: "v2" })).not.toThrow();
    w.tick();
    expect(w.worldClass).toBe("scratch");
  });

  it("no class declared: genesis is byte-identical to before the field existed", () => {
    const w = World.create(5, config(undefined, REAL));
    expect("worldClass" in (w.entries()[0].payload.config as object)).toBe(false);
    expect(w.worldClass).toBe("unclassified");
  });

  it("an unknown class is refused at genesis", () => {
    expect(() => World.create(5, { ...config(undefined, REAL), worldClass: "demo" as WorldClass })).toThrow(/worldClass must be one of/);
  });
});

// Regression: the test-double ban is fail-closed. Only a world DECLARED
// scratch may seat or bind a test double; an undeclared class is treated as
// persistent (Kimi's spec: undeclared = persistent). Before this fix both
// guards keyed on `=== "persistent"` only, so an undeclared world could seat
// and bind test doubles and evade the ban.
describe("world class: undeclared is barred for test doubles (fail-closed)", () => {
  it("(a) genesis: an undeclared world cannot seat a test double", () => {
    expect(() => World.create(5, config(undefined, DOUBLE))).toThrow(/class unclassified cannot seat a test double/);
  });

  it("(b) bind: an undeclared world cannot bind a test double, live or restored", () => {
    const w = World.create(5, config(undefined, REAL));
    expect(w.worldClass).toBe("unclassified");
    expect(() => w.bindBackend("alpha", DOUBLE)).toThrow(/class unclassified cannot bind a test double/);
    expect(() => w.bindBackend("alpha", { providerId: "provider-under-test", version: "v2" })).not.toThrow();
    w.close();

    const path = journalOf(undefined, REAL);
    const restored = World.restoreFromFile(path);
    expect(restored.worldClass).toBe("unclassified");
    expect(() => restored.bindBackend("alpha", DOUBLE)).toThrow(/class unclassified cannot bind a test double/);
    restored.close();
  });

  it("(c) declared scratch still seats and binds test doubles", () => {
    const w = World.create(5, config("scratch", DOUBLE));
    expect(() => w.bindBackend("alpha", { ...DOUBLE, version: "v2" })).not.toThrow();
    w.tick();
    expect(w.worldClass).toBe("scratch");
    w.close();
  });

  it("(d) declared persistent refusals still hold, at genesis and by bind", () => {
    expect(() => World.create(5, config("persistent", DOUBLE))).toThrow(/class persistent cannot seat a test double/);
    const w = World.create(5, config("persistent", REAL));
    expect(() => w.bindBackend("alpha", DOUBLE)).toThrow(/class persistent cannot bind a test double/);
    w.close();
  });

  it("an undeclared world with a real backend is unaffected", () => {
    const w = World.create(5, config(undefined, REAL));
    w.tick();
    expect(w.worldClass).toBe("unclassified");
    w.close();
  });
});
