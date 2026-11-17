// registry: map-v1
// The Juárez map: positions, travel, chokepoints. Bridges and the river
// are capped crossings resolved by contention-v1's priority order.

import { describe, expect, it } from "vitest";
import { validateMap } from "../../engine/world/map.js";
import { juarezConfig, juarezMap } from "../../engine/world/maps/juarez.js";
import type { ResidentConfig } from "../../engine/world/state.js";
import { World } from "../../engine/world/world.js";
import { standardGenesisGenome } from "../../lineage/genome.js";
import { TEST_BACKEND, baseConfig, rebuildJournal } from "../helpers/worldFixtures.js";

const res = (id: string, position: string, o: Partial<ResidentConfig> = {}): ResidentConfig => ({
  id, position, satiety: 10, maxSatiety: 10, actionsPerTick: 3, backend: TEST_BACKEND, ...o,
});
const move = (w: World, seat: string, to: string, effort?: number) =>
  w.submit(seat, { verb: "move", args: { to, ...(effort ? { effort } : {}) } });
const rejected = (w: World) => w.entries().filter((e) => e.type === "ACTION_REJECTED").map((e) => e.payload.reason);

describe("Juárez map", () => {
  it("the map is valid: real regions, three bridges, the river, El Paso as the far shore", () => {
    const m = juarezMap();
    expect(() => validateMap(m)).not.toThrow();
    const bridges = m.edges.filter((e) => e.kind === "bridge").map((e) => e.name).sort();
    expect(bridges).toEqual(["Bridge of the Americas", "Paso del Norte", "Ysleta–Zaragoza"]);
    expect(m.edges.filter((e) => e.kind === "river-crossing")).toHaveLength(1);
    // every border edge is capped; every cap is on a border edge
    for (const e of m.edges) {
      const side = (id: string) => m.regions.find((r) => r.id === id)!.side;
      const border = side(e.a) !== side(e.b);
      expect(border).toBe(e.crossingCapacity !== undefined);
    }
    expect(m.regions.filter((r) => r.side === "el-paso").map((r) => r.id).sort()).toEqual(["chamizal", "el-paso-downtown", "ysleta"]);
  });

  it("move goes one edge per tick, along real edges only", () => {
    const w = World.create(1, juarezConfig([res("a", "centro")]));
    move(w, "a", "zaragoza"); // not adjacent
    move(w, "a", "atlantis");
    w.tick();
    expect(rejected(w)).toEqual(["not_adjacent", "unknown_region"]);
    move(w, "a", "pronaf");
    move(w, "a", "anapra"); // also adjacent to centro, but a second move this tick
    w.tick();
    expect(rejected(w).slice(-1)).toEqual(["one_move_per_tick"]);
    expect(w.state.residents.a.position).toBe("pronaf");
  });

  it("you gather where you stand", () => {
    const w = World.create(1, juarezConfig([res("a", "centro")]));
    w.submit("a", { verb: "gather", args: { node: "el-paso-depot", amount: 2 } });
    w.submit("a", { verb: "gather", args: { node: "mercado-centro", amount: 2 } });
    w.tick();
    expect(rejected(w)).toEqual(["not_in_region"]);
    expect(w.state.residents.a.inventory).toBe(2);
  });

  it("a bridge is a chokepoint: at most its capacity crosses per tick, the rest are denied and journaled", () => {
    const people = ["p1", "p2", "p3", "p4"].map((id) => res(id, "centro"));
    const w = World.create(5, juarezConfig(people));
    for (const p of people) move(w, p.id, "el-paso-downtown"); // Paso del Norte, capacity 2
    w.tick();
    const across = people.filter((p) => w.state.residents[p.id].position === "el-paso-downtown");
    expect(across).toHaveLength(2);
    const cr = w.entries().filter((e) => e.type === "CROSSING_RESOLVED");
    expect(cr).toHaveLength(1);
    expect(cr[0].payload).toMatchObject({ edge: "centro|el-paso-downtown", capacity: 2, formulaId: "contention-v1" });
    expect(w.entries().filter((e) => e.type === "MOVE_DENIED").map((e) => e.payload.reason)).toEqual(["crossing_full", "crossing_full"]);
  });

  it("capacity counts both directions together", () => {
    const w = World.create(2, juarezConfig([res("north", "centro"), res("south", "el-paso-downtown"), res("x", "centro")]));
    move(w, "north", "el-paso-downtown");
    move(w, "x", "el-paso-downtown");
    move(w, "south", "centro");
    w.tick();
    expect(w.entries().filter((e) => e.type === "MOVED")).toHaveLength(2);
    expect(w.entries().filter((e) => e.type === "MOVE_DENIED")).toHaveLength(1);
  });

  it("crossing priority is contention-v1: committed effort wins, and effort is spent win or lose", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const w = World.create(seed, juarezConfig([res("eager", "anapra"), res("calm", "anapra")]));
      move(w, "eager", "el-paso-downtown", 3); // river crossing, capacity 1
      move(w, "calm", "el-paso-downtown");
      w.tick();
      expect(w.state.residents.eager.position).toBe("el-paso-downtown");
      expect(w.state.residents.calm.position).toBe("anapra");
      expect(w.state.residents.eager.satiety).toBe(10 - 1 - 2);
    }
  });

  it("open roads have no cap", () => {
    const people = ["r1", "r2", "r3", "r4", "r5"].map((id) => res(id, "centro"));
    const w = World.create(1, juarezConfig(people));
    for (const p of people) move(w, p.id, "pronaf");
    w.tick();
    expect(people.every((p) => w.state.residents[p.id].position === "pronaf")).toBe(true);
    expect(w.entries().some((e) => e.type === "CROSSING_RESOLVED")).toBe(false);
  });

  it("crossings are fair across seeds and independent of submission order", () => {
    const wins = new Map<string, number>();
    for (let seed = 1; seed <= 200; seed++) {
      const ids = ["a", "b", "c"];
      const run = (order: string[]) => {
        const w = World.create(seed, juarezConfig(ids.map((id) => res(id, "anapra"))));
        for (const id of order) move(w, id, "el-paso-downtown");
        w.tick();
        return ids.find((id) => w.state.residents[id].position === "el-paso-downtown")!;
      };
      const winner = run(ids);
      expect(run([...ids].reverse())).toBe(winner);
      wins.set(winner, (wins.get(winner) ?? 0) + 1);
    }
    for (const id of ["a", "b", "c"]) expect(wins.get(id) ?? 0).toBeGreaterThan(40); // fair share ~67
  }, 30_000);

  it("blend needs both parents in the same place", () => {
    const genome = standardGenesisGenome();
    const w = World.create(1, juarezConfig([res("a", "centro", { genome }), res("b", "pronaf", { genome })]));
    for (const id of ["a", "b"]) w.submit(id, { verb: "gather", args: { node: "mercado-centro", amount: 4 } });
    w.tick(); // only a can gather here (b is in pronaf)
    w.submit("a", { verb: "blend", args: { partner: "b" } });
    w.submit("b", { verb: "blend", args: { partner: "a" } });
    w.tick();
    expect(rejected(w)).toEqual(["not_in_region", "partner_not_present", "partner_not_present"]);
    expect(w.entries().some((e) => e.type === "RESIDENT_BORN")).toBe(false);
  });

  it("a child is born where its parent stands, with the parent's intel", () => {
    const genome = standardGenesisGenome();
    const w = World.create(1, juarezConfig([res("a", "zaragoza", { genome, intel: 2 })]));
    w.submit("a", { verb: "gather", args: { node: "zaragoza-market", amount: 4 } });
    w.tick();
    w.submit("a", { verb: "fork", args: {} });
    w.tick();
    expect(w.state.residents["res-1"]).toMatchObject({ position: "zaragoza", intel: 2 });
    expect(World.restore(rebuildJournal(w)).state).toEqual(w.state);
  });

  it("map worlds and map-less worlds don't mix their fields", () => {
    const bad = juarezConfig([res("a", "centro")]);
    delete bad.residents[0].position;
    expect(() => World.create(1, bad)).toThrow(/starting position/);
    const nodeless = juarezConfig([res("a", "centro")]);
    delete nodeless.nodes[0].region;
    expect(() => World.create(1, nodeless)).toThrow(/known region/);
    const plain = baseConfig();
    plain.residents[0].position = "centro";
    expect(() => World.create(1, plain)).toThrow(/no map/);
    const w = World.create(1, baseConfig());
    w.submit("alpha", { verb: "move", args: { to: "centro" } });
    w.tick();
    expect(rejected(w)).toEqual(["no_map"]);
  });

  it("travel is deterministic and replays", () => {
    const run = () => {
      const w = World.create(9, juarezConfig(["a", "b", "c"].map((id) => res(id, "anapra"))));
      for (const id of ["a", "b", "c"]) move(w, id, "el-paso-downtown");
      w.tick();
      move(w, "a", "chamizal");
      w.tick();
      return w;
    };
    const w = run();
    expect(run().headHash).toBe(w.headHash);
    expect(World.restore(rebuildJournal(w)).state).toEqual(w.state);
  });

  it("a forged MOVED (not along an edge) is refused on restore", () => {
    const w = World.create(1, juarezConfig([res("a", "centro")]));
    w.tick();
    const j = rebuildJournal(w);
    j.append({ tick: 1, type: "MOVED", actor: "a", payload: { resident: "a", seq: 0, from: "centro", to: "ysleta" } });
    j.append({ tick: 1, type: "TICK_COMMIT", actor: "engine", payload: {} });
    expect(() => World.restore(j)).toThrow(/MOVED invariant violated/);
  });
});
