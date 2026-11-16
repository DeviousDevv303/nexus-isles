// AA12 five-entity model + the blend rule, end to end through the world
// core: action -> validator -> journal -> derived entities.

import { describe, expect, it } from "vitest";
import {
  continuityHeirs,
  deriveEntities,
  isExtinct,
  lineagePopulation,
} from "../../lineage/entities.js";
import {
  MIN_ELIGIBLE_FIELDS,
  eligibleCountIssue,
  mutableFieldPaths,
  standardGenesisGenome,
  validateGenome,
  type Genome,
} from "../../lineage/genome.js";
import { validateInheritance, type MutationRecord } from "../../lineage/mutation.js";
import type { JournalEntry } from "../../ledger/journal.js";
import type { WorldConfig } from "../../engine/world/state.js";
import { World } from "../../engine/world/world.js";
import { rebuildJournal } from "../helpers/worldFixtures.js";

function cfg(): WorldConfig {
  return {
    nodes: [{ id: "grove", capacity: 200, amount: 200, regen: 20 }],
    residents: ["alpha", "bravo", "charlie"].map((id) => ({
      id, satiety: 8, maxSatiety: 10, actionsPerTick: 3, genome: standardGenesisGenome(),
    })),
    rules: { satietyDecay: 1, maxGatherPerAction: 6, blightPercent: 0, blightMax: 0 },
  };
}
const gather = (w: World, seat: string, amount = 4) =>
  w.submit(seat, { verb: "gather", args: { node: "grove", amount } });
const born = (w: World) => w.entries().filter((e) => e.type === "RESIDENT_BORN");

/** alpha + bravo blend at tick 2 -> res-1. */
function blendedWorld(seed = 1, order = ["alpha", "bravo"]): World {
  const w = World.create(seed, cfg());
  for (const s of order) gather(w, s);
  w.tick();
  for (const s of order) {
    w.submit(s, { verb: "blend", args: { partner: s === "alpha" ? "bravo" : "alpha" } });
  }
  w.tick();
  return w;
}
/** Keep one seat fed for n ticks; everyone else idles (and starves). */
function sustain(w: World, seat: string, n: number): void {
  for (let i = 0; i < n; i++) {
    gather(w, seat, 3);
    w.submit(seat, { verb: "eat", args: { amount: 3 } });
    w.tick();
  }
}

describe("AA12 entities — genesis and fork", () => {
  it("every genesis resident founds its own lineage (a journal fact, not genome content)", () => {
    const w = World.create(1, cfg());
    const e = deriveEntities(w.entries());
    expect(Object.keys(e.lineages).sort()).toEqual(["lineage:alpha", "lineage:bravo", "lineage:charlie"]);
    expect(e.lineages["lineage:alpha"].foundingGenomeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(standardGenesisGenome())).not.toMatch(/lineage|family|resident/i);
    expect(e.dynasties).toEqual([]);
  });

  it("fork: costly, mutated under budget, child joins the parent's lineage", () => {
    const w = World.create(3, cfg());
    gather(w, "alpha");
    w.tick();
    w.submit("alpha", { verb: "fork", args: {} });
    w.tick();
    const b = born(w);
    expect(b).toHaveLength(1);
    expect(b[0].payload.resident).toBe("res-1");
    expect(b[0].payload.lineage).toBe("lineage:alpha");
    expect(w.state.residents.alpha.inventory).toBe(0); // paid 4
    const issues = validateInheritance(
      standardGenesisGenome(),
      b[0].payload.genome as Genome,
      b[0].payload.mutation as MutationRecord,
    );
    expect(issues).toEqual([]);
    const e = deriveEntities(w.entries());
    expect(e.lineages["lineage:alpha"].members).toEqual(["alpha", "res-1"]);
    expect(lineagePopulation(e, "lineage:alpha", w.tickNumber)).toEqual(["alpha", "res-1"]);
    expect(Object.keys(e.lineages)).toHaveLength(3); // no new lineage
  });

  it("reproduction is never free: no resources / no genome / dead -> refused, journaled", () => {
    const c = cfg();
    delete c.residents[2].genome;
    const w = World.create(1, c);
    w.submit("alpha", { verb: "fork", args: {} }); // inventory 0
    w.submit("charlie", { verb: "fork", args: {} }); // no genome
    w.submit("bravo", { verb: "blend", args: { partner: "bravo" } }); // self
    w.tick();
    const reasons = w.entries().filter((e) => e.type === "ACTION_REJECTED").map((e) => e.payload.reason);
    expect(reasons).toEqual(["insufficient_resources", "invalid_partner", "no_genome"]);
    expect(born(w)).toHaveLength(0);
  });

  it("two forks on one tranche: the second fails closed at apply time", () => {
    const w = World.create(1, cfg());
    gather(w, "alpha", 5);
    w.tick();
    w.submit("alpha", { verb: "fork", args: {} });
    w.submit("alpha", { verb: "fork", args: {} });
    w.tick();
    expect(born(w)).toHaveLength(1);
    const failed = w.entries().filter((e) => e.type === "REPRODUCTION_FAILED");
    expect(failed.map((e) => e.payload.reason)).toEqual(["insufficient_resources"]);
    expect(w.state.residents.alpha.inventory).toBe(1);
  });
});

describe("AA12 blend rule — end to end", () => {
  it("a blended child founds a NEW lineage with dual ancestry; both parents pay", () => {
    const w = blendedWorld();
    const b = born(w);
    expect(b).toHaveLength(1);
    expect(b[0].payload).toMatchObject({
      resident: "res-1", mode: "blend", parents: ["alpha", "bravo"],
      lineage: "lineage:res-1", ancestry: ["lineage:alpha", "lineage:bravo"],
    });
    expect(w.state.residents.alpha.inventory).toBe(0);
    expect(w.state.residents.bravo.inventory).toBe(0);
    const e = deriveEntities(w.entries());
    expect(e.lineages["lineage:res-1"]).toMatchObject({
      founder: "res-1", ancestry: ["lineage:alpha", "lineage:bravo"], members: ["res-1"],
    });
    expect(e.residents["res-1"].parents).toEqual(["alpha", "bravo"]); // ancestry preserved as record
  });

  it("POPULATION: the child counts toward neither parent's lineage", () => {
    const w = blendedWorld();
    const e = deriveEntities(w.entries());
    const t = w.tickNumber;
    expect(lineagePopulation(e, "lineage:alpha", t)).toEqual(["alpha"]);
    expect(lineagePopulation(e, "lineage:bravo", t)).toEqual(["bravo"]);
    expect(lineagePopulation(e, "lineage:res-1", t)).toEqual(["res-1"]);
  });

  it("EXTINCTION: both parent lineages go extinct while the blended child lives", () => {
    const w = blendedWorld();
    sustain(w, "res-1", 12); // parents and charlie starve
    const s = w.state;
    expect(s.residents.alpha.alive).toBe(false);
    expect(s.residents.bravo.alive).toBe(false);
    expect(s.residents["res-1"].alive).toBe(true);
    const e = deriveEntities(w.entries());
    expect(isExtinct(e, "lineage:alpha")).toBe(true);
    expect(isExtinct(e, "lineage:bravo")).toBe(true);
    expect(isExtinct(e, "lineage:res-1")).toBe(false);
    expect(e.civilization.activeLineages).toEqual(["lineage:res-1"]);
    expect(e.civilization.archive.map((a) => a.lineage).sort()).toEqual([
      "lineage:alpha", "lineage:bravo", "lineage:charlie",
    ]);
  });

  it("DYNASTY SCORING: the child is no parent's heir; a fork child is its parent's heir", () => {
    const w = blendedWorld();
    // charlie forks so we have a same-lineage heir to contrast with
    gather(w, "charlie");
    w.tick();
    w.submit("charlie", { verb: "fork", args: {} });
    w.tick(); // res-2, lineage:charlie
    for (let i = 0; i < 11; i++) {
      for (const seat of ["alpha", "bravo", "charlie", "res-1", "res-2"]) {
        gather(w, seat, 3);
        w.submit(seat, { verb: "eat", args: { amount: 3 } });
      }
      w.tick();
    }
    const e = deriveEntities(w.entries());
    const t = w.tickNumber;
    expect(continuityHeirs(e, "lineage:alpha", t)).toEqual([]);
    expect(continuityHeirs(e, "lineage:bravo", t)).toEqual([]);
    expect(continuityHeirs(e, "lineage:res-1", t)).toEqual([]); // founder is not its own heir
    expect(continuityHeirs(e, "lineage:charlie", t)).toEqual(["res-2"]);
    expect(continuityHeirs(e, "lineage:charlie", e.residents["res-2"].bornTick + 9)).toEqual([]); // < 10 ticks
  });

  it("one-sided blend: no consent, no child, no cost", () => {
    const w = World.create(1, cfg());
    gather(w, "alpha");
    gather(w, "bravo");
    w.tick();
    w.submit("alpha", { verb: "blend", args: { partner: "bravo" } });
    w.tick();
    expect(born(w)).toHaveLength(0);
    const f = w.entries().filter((e) => e.type === "REPRODUCTION_FAILED");
    expect(f.map((e) => e.payload.reason)).toEqual(["no_mutual_consent"]);
    expect(w.state.residents.alpha.inventory).toBe(4);
  });

  it("deterministic: same seed -> same child, any submission order; restore reproduces it", () => {
    const a = blendedWorld(9, ["alpha", "bravo"]);
    const b = blendedWorld(9, ["bravo", "alpha"]);
    expect(b.headHash).toBe(a.headHash);
    expect(blendedWorld(10).headHash).not.toBe(a.headHash);
    const restored = World.restore(rebuildJournal(a));
    expect(restored.state).toEqual(a.state);
    expect(restored.state.residents["res-1"].lineage).toBe("lineage:res-1");
  });
});

describe("AA12 dynasty, family, genome schema", () => {
  const succession = (base: readonly JournalEntry[], deceased: string, successor: string): JournalEntry[] => [
    ...base,
    { index: base.length, tick: 99, type: "SUCCESSION_EXECUTED", actor: "engine",
      payload: { deceased, successor }, prevHash: "x", hash: "y" },
  ];

  it("dynasty status derives from an executed succession inside the lineage — never a flag", () => {
    const w = World.create(3, cfg());
    gather(w, "alpha");
    w.tick();
    w.submit("alpha", { verb: "fork", args: {} });
    w.tick();
    expect(deriveEntities(w.entries()).dynasties).toEqual([]);
    const within = deriveEntities(succession(w.entries(), "alpha", "res-1"));
    expect(within.dynasties).toEqual(["lineage:alpha"]);
    expect(within.families.find((f) => f.head === "alpha")?.members).toEqual(["alpha", "res-1"]);
    // succession to another lineage's resident does not make either a dynasty
    expect(deriveEntities(succession(w.entries(), "alpha", "bravo")).dynasties).toEqual([]);
  });

  it("a succession to a blended child makes NEITHER parent lineage a dynasty", () => {
    const w = blendedWorld();
    const e = deriveEntities(succession(w.entries(), "alpha", "res-1"));
    expect(e.dynasties).toEqual([]);
  });

  it("genome schema enforces N >= 4 eligible fields (erratum E1)", () => {
    expect(MIN_ELIGIBLE_FIELDS).toBe(4);
    expect(eligibleCountIssue(3)).toMatch(/N >= 4/);
    expect(eligibleCountIssue(4)).toBeNull();
    expect(mutableFieldPaths(standardGenesisGenome()).length).toBeGreaterThanOrEqual(4);
    expect(validateGenome(standardGenesisGenome())).toEqual([]);
  });

  it("an invalid genesis genome is refused at world creation", () => {
    const c = cfg();
    c.residents[0].genome!.motivationalWeights.ambition = 7;
    expect(() => World.create(1, c)).toThrow(/invalid genome/);
  });
});
