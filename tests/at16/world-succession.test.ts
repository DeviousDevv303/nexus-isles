// AT-16 in the live world: succession instruments are authorized by the
// living, executed by the engine at death against death-tick state, and are
// the ONLY way a dynasty can come to exist. No heir label, no automatic
// inheritance, no engine default.

import { describe, expect, it } from "vitest";
import { deriveEntities } from "../../lineage/entities.js";
import { deriveVerifiedEntities } from "../../lineage/verifiedEntities.js";
import { standardGenesisGenome } from "../../lineage/genome.js";
import type { WorldConfig } from "../../engine/world/state.js";
import { World } from "../../engine/world/world.js";
import { TEST_BACKEND, rebuildJournal } from "../helpers/worldFixtures.js";

function cfg(): WorldConfig {
  return {
    nodes: [{ id: "grove", capacity: 500, amount: 500, regen: 50 }],
    residents: ["alpha", "bravo", "charlie"].map((id) => ({
      id, satiety: id === "alpha" ? 6 : 10, maxSatiety: 10, actionsPerTick: 3,
      genome: standardGenesisGenome(), backend: TEST_BACKEND,
    })),
    rules: { satietyDecay: 1, maxGatherPerAction: 6, blightPercent: 0, blightMax: 0 },
  };
}
const act = (w: World, seat: string, verb: string, args: Record<string, unknown> = {}) =>
  w.submit(seat, { verb, args });
const of = (w: World, type: string) => w.entries().filter((e) => e.type === type);
const rejected = (w: World) => of(w, "ACTION_REJECTED").map((e) => e.payload.reason);

/**
 * alpha (satiety 6, never eats) gathers 12 on tick 1, forks res-1 on tick 2
 * (inventory 8 left), and starves on tick 6. `during(tick)` runs before each
 * tick from 3 on. Everyone else is kept fed.
 */
function story(during: (w: World, tick: number) => void = () => {}, seed = 1): World {
  const w = World.create(seed, cfg());
  act(w, "alpha", "gather", { node: "grove", amount: 6 });
  act(w, "alpha", "gather", { node: "grove", amount: 6 });
  w.tick();
  act(w, "alpha", "fork");
  w.tick();
  w.bindBackend("res-1", TEST_BACKEND);
  for (let t = 3; t <= 8; t++) {
    during(w, t);
    for (const s of ["bravo", "charlie", "res-1"]) {
      if (!w.state.residents[s].alive) continue;
      act(w, s, "gather", { node: "grove", amount: 3 });
      if (w.state.residents[s].inventory > 0) act(w, s, "eat", { amount: 3 });
    }
    w.tick();
  }
  return w;
}
const authorize = (successor: string, extra: Record<string, unknown> = {}) => (w: World, t: number) => {
  if (t === 3) act(w, "alpha", "authorize_succession", { successor, ...extra });
};

describe("AT-16 world-core succession", () => {
  it("END TO END: authorize while alive -> die -> engine executes -> the lineage becomes a dynasty", () => {
    const w = story(authorize("res-1"));
    expect(w.state.residents.alpha.alive).toBe(false);
    expect(w.state.residents.alpha.diedAtTick).toBe(6);
    const ex = of(w, "SUCCESSION_EXECUTED");
    expect(ex).toHaveLength(1);
    expect(ex[0].tick).toBe(6);
    expect(ex[0].payload).toMatchObject({ deceased: "alpha", successor: "res-1", instrumentId: "inst-1", inventoryTransferred: 8 });
    expect(w.state.residents.alpha.inventory).toBe(0);
    const e = deriveEntities(w.entries());
    expect(e.rejectedSuccessions).toEqual([]);
    expect(e.dynasties).toEqual(["lineage:alpha"]);
    expect(e.familyOf["res-1"]).toBe("alpha");
    // the DEATH is journaled before the succession it triggers
    expect(of(w, "DEATH").find((d) => d.payload.resident === "alpha")!.index).toBeLessThan(ex[0].index);
  });

  it("the dynasty also derives through the validated-history path (chain + reducer replay)", () => {
    const w = story(authorize("res-1"));
    const e = deriveVerifiedEntities(rebuildJournal(w));
    expect(e.dynasties).toEqual(["lineage:alpha"]);
    expect(e.successions[0].instrumentId).toBe("inst-1");
    expect(deriveVerifiedEntities(rebuildJournal(story())).dynasties).toEqual([]);
  });

  it("the successor actually receives the estate", () => {
    const withWill = story(authorize("res-1"));
    const without = story();
    expect(withWill.state.residents["res-1"].inventory - without.state.residents["res-1"].inventory).toBe(8);
  });

  it("NO INSTRUMENT, NO SUCCESSION: a living fork child inherits nothing and no dynasty forms", () => {
    const w = story();
    expect(w.state.residents.alpha.alive).toBe(false);
    expect(w.state.residents["res-1"].alive).toBe(true);
    expect(of(w, "SUCCESSION_EXECUTED")).toHaveLength(0);
    expect(of(w, "SUCCESSION_FAILED")).toHaveLength(0);
    expect(w.state.residents.alpha.inventory).toBe(8); // unclaimed: salvage, not auto-inherited
    expect(deriveEntities(w.entries()).dynasties).toEqual([]);
  });

  it("revoked while alive -> nothing executes", () => {
    const w = story((w, t) => {
      if (t === 3) act(w, "alpha", "authorize_succession", { successor: "res-1" });
      if (t === 4) act(w, "alpha", "revoke_succession");
    });
    expect(of(w, "SUCCESSION_REVOKED")).toHaveLength(1);
    expect(of(w, "SUCCESSION_EXECUTED")).toHaveLength(0);
    expect(deriveEntities(w.entries()).dynasties).toEqual([]);
  });

  it("a replacement instrument governs; the old one is gone", () => {
    const w = story((w, t) => {
      if (t === 3) act(w, "alpha", "authorize_succession", { successor: "res-1" });
      if (t === 4) act(w, "alpha", "authorize_succession", { successor: "bravo" });
    });
    const ex = of(w, "SUCCESSION_EXECUTED");
    expect(ex).toHaveLength(1);
    expect(ex[0].payload).toMatchObject({ successor: "bravo", instrumentId: "inst-2" });
    // valid succession, but out of the lineage: no dynasty
    const e = deriveEntities(w.entries());
    expect(e.successions).toHaveLength(1);
    expect(e.dynasties).toEqual([]);
  });

  it("successor already dead at the founder's death -> fails closed, journaled, no dynasty", () => {
    const c = cfg();
    c.residents[1].satiety = 4; // bravo starves on tick 4 if never fed
    const w = World.create(1, c);
    act(w, "alpha", "gather", { node: "grove", amount: 6 });
    w.tick();
    act(w, "alpha", "authorize_succession", { successor: "bravo" });
    for (let t = 2; t <= 7; t++) w.tick();
    expect(w.state.residents.bravo.alive).toBe(false);
    expect(of(w, "SUCCESSION_EXECUTED")).toHaveLength(0);
    const f = of(w, "SUCCESSION_FAILED");
    expect(f).toHaveLength(1);
    expect(f[0].payload.reason).toMatch(/successor is dead/);
    expect(w.state.residents.alpha.inventory).toBe(6);
  });

  it("founder and successor dying in the same tick -> no transfer to the dead", () => {
    const c = cfg();
    c.residents[1].satiety = 6; // bravo dies with alpha on tick 6
    const w = World.create(1, c);
    act(w, "alpha", "gather", { node: "grove", amount: 6 });
    act(w, "alpha", "authorize_succession", { successor: "bravo" });
    for (let t = 1; t <= 6; t++) w.tick();
    expect(w.state.residents.alpha.diedAtTick).toBe(6);
    expect(w.state.residents.bravo.diedAtTick).toBe(6);
    expect(of(w, "SUCCESSION_EXECUTED")).toHaveLength(0);
    expect(of(w, "SUCCESSION_FAILED")).toHaveLength(1);
  });

  it("an expired instrument does not execute", () => {
    const w = story(authorize("res-1", { expiresTick: 5 }));
    expect(of(w, "SUCCESSION_EXECUTED")).toHaveLength(0);
    expect(of(w, "SUCCESSION_FAILED")[0].payload.reason).toMatch(/expired/);
  });

  it("the validator refuses illegitimate instruments", () => {
    const w = World.create(1, cfg());
    act(w, "alpha", "authorize_succession", { successor: "alpha" }); // self = resurrection
    act(w, "alpha", "authorize_succession", { successor: "nobody" });
    act(w, "alpha", "authorize_succession", {});
    act(w, "bravo", "authorize_succession", { successor: "alpha", transfers: [{ kind: "asset", ref: "inventory:charlie" }] });
    act(w, "bravo", "authorize_succession", { successor: "alpha", transfers: [{ kind: "command-authority", ref: "x" }] });
    act(w, "bravo", "authorize_succession", { successor: "alpha", transfers: [] });
    act(w, "charlie", "revoke_succession");
    w.tick();
    expect(rejected(w)).toEqual([
      "invalid_instrument", "invalid_instrument", "malformed_instrument",
      "invalid_instrument", "unsupported_transfer", "malformed_instrument",
      "no_instrument",
    ]);
    expect(of(w, "SUCCESSION_AUTHORIZED")).toHaveLength(0);
  });

  it("the dead exercise no agency: they cannot authorize or revoke", () => {
    const w = story(authorize("res-1"));
    act(w, "alpha", "revoke_succession");
    act(w, "alpha", "authorize_succession", { successor: "bravo" });
    w.tick();
    expect(rejected(w).slice(-2)).toEqual(["resident_dead", "resident_dead"]);
    expect(of(w, "SUCCESSION_EXECUTED")).toHaveLength(1); // unchanged
  });

  it("succession is not resurrection: the deceased stays dead, the successor keeps its own identity", () => {
    const w = story(authorize("res-1"));
    const s = w.state.residents;
    expect(s.alpha.alive).toBe(false);
    expect(s["res-1"].lineage).toBe("lineage:alpha");
    expect(s["res-1"].bornTick).toBe(2);
    expect(s["res-1"].genome).not.toEqual(s.alpha.genome);
    expect(Object.keys(s).sort()).toEqual(["alpha", "bravo", "charlie", "res-1"]); // nobody respawned
  });

  it("an instrument executes at most once, and restore reproduces it", () => {
    const w = story(authorize("res-1"));
    for (let i = 0; i < 3; i++) w.tick();
    expect(of(w, "SUCCESSION_EXECUTED")).toHaveLength(1);
    expect(w.state.residents.alpha.instrument).toBeNull();
    const r = World.restore(rebuildJournal(w));
    expect(r.state).toEqual(w.state);
  });

  it("a fabricated succession record is refused by the reducer on restore", () => {
    const base = story(); // alpha died with NO instrument
    const j = rebuildJournal(base);
    const t = base.tickNumber;
    j.append({ tick: t, type: "SUCCESSION_EXECUTED", actor: "engine", payload: { deceased: "alpha", successor: "res-1", instrumentId: "inst-1", inventoryTransferred: 8 } });
    j.append({ tick: t, type: "TICK_COMMIT", actor: "engine", payload: {} });
    expect(() => World.restore(j)).toThrow(/invariant violated/);
  });

  it("deterministic: same seed, same history", () => {
    expect(story(authorize("res-1"), 4).headHash).toBe(story(authorize("res-1"), 4).headHash);
  });
});
