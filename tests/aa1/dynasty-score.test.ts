// T7 — dynasty-score-v1 (Annex B), on synthetic journals with hand-computed
// expected values, including a missing-axis case and a blended-lineage case
// (counts toward neither parent). Plus territory control (control-v0).

import { describe, expect, it } from "vitest";
import { juarezConfig } from "../../engine/world/maps/juarez.js";
import type { ResidentConfig } from "../../engine/world/state.js";
import { World } from "../../engine/world/world.js";
import { standardGenesisGenome } from "../../lineage/genome.js";
import { DYNASTY_SCORE_V1_WEIGHTS, scoreEpoch, type EpochScore } from "../../observer/dynastyScore.js";
import { verifyEpochScores } from "../../observer/verifyScores.js";
import { TEST_BACKEND, baseConfig, rebuildJournal } from "../helpers/worldFixtures.js";

const res = (id: string, position: string, o: Partial<ResidentConfig> = {}): ResidentConfig => ({
  id, position, satiety: 10, maxSatiety: 10, actionsPerTick: 3, backend: TEST_BACKEND, ...o,
});
const scored = (w: World, epoch = "e1"): EpochScore =>
  w.entries().find((e) => e.type === "EPOCH_SCORED" && e.payload.epoch === epoch)!.payload as unknown as EpochScore;
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 12);

/** Epoch over ticks 1..4. b walks Zaragoza -> eastern industrial zone on tick 2. */
function threeLineages(): World {
  const w = World.create(1, juarezConfig([res("a", "centro"), res("b", "zaragoza"), res("c", "zaragoza")]));
  w.openEpoch("e1");
  w.tick(); // 1: EPOCH_OPENED, startTick 1
  w.submit("b", { verb: "move", args: { to: "industrial-east" } });
  w.tick(); // 2
  w.tick(); // 3
  w.tick(); // 4
  w.closeEpoch("e1");
  w.tick(); // 5: EPOCH_SCORED over ticks 1..4
  return w;
}

describe("territory control (control-v0, PROVISIONAL)", () => {
  it("control is journaled: alone controls, a tie controls nothing, and it moves with the residents", () => {
    const w = threeLineages();
    const changes = w.entries().filter((e) => e.type === "CONTROL_CHANGED").map((e) => [e.tick, e.payload.region, e.payload.to]);
    expect(changes).toEqual([
      [0, "centro", "lineage:a"], // genesis; zaragoza is a b/c tie -> nobody
      [2, "industrial-east", "lineage:b"],
      [2, "zaragoza", "lineage:c"],
    ]);
    expect(w.state.control).toMatchObject({ centro: "lineage:a", zaragoza: "lineage:c", "industrial-east": "lineage:b", pronaf: null });
  });

  it("a death flips control: the dead hold nothing", () => {
    const w = World.create(2, juarezConfig([res("a", "centro"), res("b", "centro", { satiety: 2 })]));
    expect(w.state.control.centro).toBeNull(); // 1 v 1
    w.tick();
    w.tick(); // b starves on tick 2
    expect(w.state.residents.b.alive).toBe(false);
    expect(w.state.control.centro).toBe("lineage:a");
    expect(w.entries().filter((e) => e.type === "CONTROL_CHANGED").at(-1)).toMatchObject({ tick: 2, payload: { region: "centro", to: "lineage:a" } });
  });

  it("more living members beat fewer", () => {
    const genome = standardGenesisGenome();
    const w = World.create(2, juarezConfig([res("a", "centro", { genome }), res("b", "centro", { satiety: 4 })]));
    expect(w.state.control.centro).toBeNull(); // 1 v 1
    w.submit("a", { verb: "gather", args: { node: "mercado-centro", amount: 4 } });
    w.tick();
    w.submit("a", { verb: "fork", args: {} });
    w.tick(); // a's lineage now 2 v 1
    expect(w.state.control.centro).toBe("lineage:a");
    expect(w.entries().filter((e) => e.type === "CONTROL_CHANGED").at(-1)!.tick).toBe(2);
  });

  it("unjournaled territory never appears controlled (AT-18 i): forged or missing control entries fail restore", () => {
    const w = threeLineages();
    const forged = rebuildJournal(w);
    forged.append({ tick: 5, type: "CONTROL_CHANGED", actor: "engine", payload: { region: "pronaf", from: null, to: "lineage:a" } });
    forged.append({ tick: 5, type: "TICK_COMMIT", actor: "engine", payload: {} });
    expect(() => World.restore(forged)).toThrow(/CONTROL_CHANGED invariant violated/);
    // drop one real change: the next commit's completeness check refuses it
    const dropped = rebuildJournal({ entries: () => w.entries().filter((e) => !(e.type === "CONTROL_CHANGED" && e.tick === 2 && e.payload.region === "zaragoza")) } as unknown as World);
    expect(() => World.restore(dropped)).toThrow(/control picture out of date/);
  });
});

describe("dynasty-score-v1 (Annex B)", () => {
  it("formula, weights and every provisional reading are journaled at epoch open", () => {
    const w = threeLineages();
    const open = w.entries().find((e) => e.type === "EPOCH_OPENED")!;
    expect(open.tick).toBe(1);
    expect(open.payload).toMatchObject({
      epoch: "e1", startTick: 1, formulaId: "dynasty-score-v1", weights: DYNASTY_SCORE_V1_WEIGHTS,
      readings: { control: "control-v0", successorContinuity: "succession-v0" },
    });
  });

  it("HAND-COMPUTED: three lineages on the Juárez map", () => {
    const s = scored(threeLineages());
    expect(s).toMatchObject({ status: "derived-from-journal", startTick: 1, endTick: 4 });
    // MISSING: artifacts (.20) and wealth (.15) -> available .25 + .20 + .20 = .65
    expect(Object.keys(s.missingAxes).sort()).toEqual(["verifiedArtifacts", "wealthResilience"]);
    close(s.availableWeight, 0.65);
    // survival: each lineage 1 member alive at the end of each of 4 ticks -> 1
    // territory: a holds centro 4 ticks; b, c hold one region each for ticks 2-4 -> 3
    // continuity: no successions -> 0 for all (norm 0, not MISSING)
    expect(s.lineages["lineage:a"].axes.territoryYears!.raw).toBe(4);
    expect(s.lineages["lineage:b"].axes.territoryYears!.raw).toBe(3);
    expect(s.lineages["lineage:c"].axes.territoryYears!.raw).toBe(3);
    close(s.lineages["lineage:a"].score, (0.25 * 1 + 0.2 * 1 + 0.2 * 0) / 0.65);
    close(s.lineages["lineage:b"].score, (0.25 * 1 + 0.2 * Math.sqrt(3 / 4)) / 0.65);
    close(s.lineages["lineage:c"].score, s.lineages["lineage:b"].score);
  });

  it("MISSING-AXIS CASE: a map-less world has no territory; weight renormalizes over survival + continuity", () => {
    const c = baseConfig();
    c.residents[0].satiety = 2; // alpha dies on tick 2
    const w = World.create(1, c);
    w.openEpoch("e1");
    for (let t = 0; t < 4; t++) w.tick();
    w.closeEpoch("e1");
    w.tick();
    const s = scored(w);
    expect(Object.keys(s.missingAxes).sort()).toEqual(["territoryYears", "verifiedArtifacts", "wealthResilience"]);
    close(s.availableWeight, 0.45);
    expect(s.lineages["lineage:alpha"].axes.territoryYears).toBeUndefined(); // never silently zero-scored
    // alpha alive at the end of tick 1 only -> 1/4; the others 4/4
    close(s.lineages["lineage:alpha"].axes.survival!.raw, 0.25);
    close(s.lineages["lineage:alpha"].score, (0.25 / 0.45) * Math.sqrt(0.25));
    close(s.lineages["lineage:bravo"].score, 0.25 / 0.45);
  });

  it("BLENDED-LINEAGE CASE: the child is its own lineage and counts toward neither parent", () => {
    const genome = standardGenesisGenome();
    const w = World.create(3, juarezConfig([res("a", "centro", { genome }), res("b", "centro", { genome })]));
    w.openEpoch("e1");
    for (const id of ["a", "b"]) w.submit(id, { verb: "gather", args: { node: "mercado-centro", amount: 4 } });
    w.tick(); // 1
    w.submit("a", { verb: "blend", args: { partner: "b" } });
    w.submit("b", { verb: "blend", args: { partner: "a" } });
    w.tick(); // 2: res-1 born, lineage:res-1
    w.tick(); // 3
    w.closeEpoch("e1");
    w.tick();
    const s = scored(w);
    expect(Object.keys(s.lineages).sort()).toEqual(["lineage:a", "lineage:b", "lineage:res-1"]);
    close(s.lineages["lineage:a"].axes.survival!.raw, 1); // a alone, every tick — the child adds nothing
    close(s.lineages["lineage:b"].axes.survival!.raw, 1);
    close(s.lineages["lineage:res-1"].axes.survival!.raw, 2 / 3); // alive at end of ticks 2 and 3
    // centro is a three-way tie all epoch: nobody holds territory
    for (const l of Object.values(s.lineages)) expect(l.axes.territoryYears!.raw).toBe(0);
  });

  it("successor continuity scores an in-lineage successor 10 ticks after the succession (succession-v0)", () => {
    const c = baseConfig();
    c.residents = [
      { id: "alpha", satiety: 6, maxSatiety: 10, actionsPerTick: 3, genome: standardGenesisGenome(), backend: TEST_BACKEND },
      { id: "bravo", satiety: 10, maxSatiety: 10, actionsPerTick: 3, backend: TEST_BACKEND },
    ];
    const w = World.create(1, c);
    w.openEpoch("e1");
    w.submit("alpha", { verb: "gather", args: { node: "grove", amount: 6 } });
    w.tick(); // 1
    w.submit("alpha", { verb: "fork", args: {} });
    w.tick(); // 2: res-1
    w.bindBackend("res-1", TEST_BACKEND);
    w.submit("alpha", { verb: "authorize_succession", args: { successor: "res-1" } });
    for (let t = 3; t <= 18; t++) {
      for (const s of ["bravo", "res-1"]) {
        w.submit(s, { verb: "gather", args: { node: "grove", amount: 3 } });
        if ((w.state.residents[s]?.inventory ?? 0) > 0) w.submit(s, { verb: "eat", args: { amount: 3 } });
      }
      w.tick();
    }
    const exec = w.entries().find((e) => e.type === "SUCCESSION_EXECUTED")!;
    expect(exec.tick).toBeLessThanOrEqual(8);
    w.closeEpoch("e1");
    w.tick();
    const s = scored(w);
    expect(s.lineages["lineage:alpha"].axes.successorContinuity!.raw).toBe(1);
    expect(s.lineages["lineage:bravo"].axes.successorContinuity!.raw).toBe(0);
    close(s.lineages["lineage:alpha"].axes.successorContinuity!.score, 1);
    // the clock starts at the succession, not at birth: 9 ticks after it, res-1 does not count yet
    const before = scoreEpoch(w.entries(), "e1", exec.tick + 9);
    expect(before.lineages["lineage:alpha"].axes.successorContinuity!.raw).toBe(0);
    expect(exec.tick + 9 - 2).toBeGreaterThanOrEqual(10); // ...though it is past 10 ticks of age
  });

  it("the journaled score re-derives exactly from the journal; a tampered score is refused", () => {
    const w = threeLineages();
    expect(verifyEpochScores(rebuildJournal(w))).toBe(1);
    const tampered = rebuildJournal({
      entries: () =>
        w.entries().map((e) =>
          e.type === "EPOCH_SCORED"
            ? { ...e, payload: { ...e.payload, lineages: { ...(e.payload.lineages as object), "lineage:c": { score: 0.99, axes: {} } } } }
            : e,
        ),
    } as unknown as World);
    expect(() => verifyEpochScores(tampered)).toThrow(/does not match the journal/);
  });

  it("scoring is deterministic and pure: same journal, same score; restore reproduces it", () => {
    const a = threeLineages();
    const b = threeLineages();
    expect(b.headHash).toBe(a.headHash);
    const entries = a.entries();
    const i = entries.findIndex((e) => e.type === "EPOCH_SCORED");
    expect(scoreEpoch(entries.slice(0, i), "e1", 4)).toEqual(scored(a));
    expect(World.restore(rebuildJournal(a)).state).toEqual(a.state);
  });

  it("epochs open once, close once, and always cover at least one committed tick", () => {
    const w = World.create(1, baseConfig());
    expect(() => w.closeEpoch("nope")).toThrow(/not open/);
    w.openEpoch("e1");
    expect(() => w.openEpoch("e1")).toThrow(/already opened/);
    expect(() => w.closeEpoch("e1")).toThrow(/not open/); // its open isn't journaled until the next tick
    w.tick();
    w.closeEpoch("e1");
    w.tick();
    expect(scored(w)).toMatchObject({ startTick: 1, endTick: 1 });
    expect(() => w.closeEpoch("e1")).toThrow(/not open/);
    const j = rebuildJournal(w);
    const again = w.entries().find((e) => e.type === "EPOCH_SCORED")!;
    j.append({ tick: 3, type: "TICK_START", actor: "engine", payload: { tick: 3 } });
    j.append({ tick: 3, type: "EPOCH_SCORED", actor: "engine", payload: { ...again.payload, endTick: 2 } });
    j.append({ tick: 3, type: "TICK_COMMIT", actor: "engine", payload: {} });
    expect(() => World.restore(j)).toThrow(/EPOCH_SCORED invariant violated/);
    expect(() => scoreEpoch(w.entries(), "e1", 0)).toThrow(/no committed ticks/);
  });
});
