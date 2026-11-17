// AT-06 Hidden information — DEMONSTRATED on the Juárez map.
// "Unauthorized observations reveal no secrets": residents at different
// positions / with different intel receive materially different
// observations of the same tick, and no observation contains anything
// outside the resident's own radius.

import { describe, expect, it } from "vitest";
import { regionsWithin } from "../../engine/world/map.js";
import { juarezConfig, juarezMap } from "../../engine/world/maps/juarez.js";
import type { ResidentConfig } from "../../engine/world/state.js";
import { World } from "../../engine/world/world.js";
import { TEST_BACKEND, rebuildJournal } from "../helpers/worldFixtures.js";

const res = (id: string, position: string, intel?: number): ResidentConfig => ({
  id, position, ...(intel !== undefined ? { intel } : {}),
  satiety: 10, maxSatiety: 10, actionsPerTick: 2, backend: TEST_BACKEND,
});

type Visible = {
  position: string;
  intel: number;
  regions: Record<string, { residents: string[]; nodes: Record<string, number> }>;
};
const view = (w: World, seat: string) => w.observe(seat)!.visible as unknown as Visible;

function world() {
  const w = World.create(1, juarezConfig([
    res("nunez", "centro"),
    res("cartel-b", "zaragoza"),
    res("watcher", "industrial-east", 2),
    res("shore", "el-paso-downtown"),
  ]));
  w.tick();
  return w;
}

describe("AT-06 hidden information (Juárez map)", () => {
  it("two residents at different positions receive materially different observations of the same tick", () => {
    const w = world();
    const a = view(w, "nunez");
    const b = view(w, "cartel-b");
    expect(w.observe("nunez")!.tick).toBe(w.observe("cartel-b")!.tick);
    expect(Object.keys(a.regions).sort()).toEqual(["anapra", "centro", "el-paso-downtown", "industrial-south", "pronaf"]);
    expect(Object.keys(b.regions).sort()).toEqual(["industrial-east", "ysleta", "zaragoza"]);
    // each sees a node the other cannot
    expect(a.regions.centro.nodes).toHaveProperty("mercado-centro");
    expect(JSON.stringify(b)).not.toContain("mercado-centro");
    expect(b.regions.zaragoza.nodes).toHaveProperty("zaragoza-market");
    expect(JSON.stringify(a)).not.toContain("zaragoza-market");
  });

  it("no observation contains anything outside the resident's own radius — for every resident, every tick", () => {
    const w = world();
    for (let t = 0; t < 5; t++) {
      for (const seat of ["nunez", "cartel-b", "watcher", "shore"]) {
        const v = view(w, seat);
        const allowed = new Set(regionsWithin(juarezMap(), v.position, v.intel));
        expect(Object.keys(v.regions).every((r) => allowed.has(r))).toBe(true);
        expect(Object.keys(v.regions).length).toBe(allowed.size);
        // every resident and node listed really is in a listed region
        const s = w.state;
        for (const [reg, info] of Object.entries(v.regions)) {
          for (const o of info.residents) expect(s.residents[o].position).toBe(reg);
          for (const n of Object.keys(info.nodes)) expect(s.nodes[n].region).toBe(reg);
        }
      }
      w.tick();
    }
  });

  it("residents out of range are invisible; residents in range are seen", () => {
    const w = world();
    expect(view(w, "nunez").regions["el-paso-downtown"].residents).toEqual(["shore"]); // across Paso del Norte, 1 hop
    expect(JSON.stringify(view(w, "nunez"))).not.toContain("cartel-b");
    expect(JSON.stringify(view(w, "cartel-b"))).not.toContain("nunez");
    expect(view(w, "cartel-b").regions["industrial-east"].residents).toEqual(["watcher"]);
  });

  it("intel matters: same position, higher intel, strictly wider view", () => {
    const w = World.create(2, juarezConfig([res("low", "industrial-east", 1), res("high", "industrial-east", 2)]));
    w.tick();
    const low = Object.keys(view(w, "low").regions);
    const high = Object.keys(view(w, "high").regions);
    expect(low.every((r) => high.includes(r))).toBe(true);
    expect(high.length).toBeGreaterThan(low.length);
    expect(high).toContain("centro");
    expect(low).not.toContain("centro");
  });

  it("the dead are not reported as present (AT-18 iii: dead residents never operational)", () => {
    const w = World.create(4, juarezConfig([res("watcher", "centro"), { ...res("doomed", "centro"), satiety: 1 }]));
    w.tick(); // doomed starves at the end of tick 1; tick 1's view was taken before that
    expect(view(w, "watcher").regions.centro.residents).toEqual(["doomed"]);
    expect(w.state.residents.doomed.alive).toBe(false);
    w.tick();
    expect(view(w, "watcher").regions.centro.residents).toEqual([]);
  });

  it("intel 0 sees only where it stands", () => {
    const w = World.create(3, juarezConfig([res("blind", "samalayuca", 0)]));
    w.tick();
    expect(Object.keys(view(w, "blind").regions)).toEqual(["samalayuca"]);
  });

  it("moving changes what you can see", () => {
    const w = world();
    expect(JSON.stringify(view(w, "nunez"))).not.toContain("maquila-commissary");
    w.submit("nunez", { verb: "move", args: { to: "pronaf" } });
    w.tick(); // moves at end of tick 2
    w.tick(); // tick 3 observation from pronaf
    expect(view(w, "nunez").position).toBe("pronaf");
    expect(view(w, "nunez").regions["industrial-east"].nodes).toHaveProperty("maquila-commissary");
  });

  it("observations replay identically from the journal", () => {
    const w = world();
    w.submit("nunez", { verb: "move", args: { to: "pronaf" } });
    w.tick();
    w.tick();
    const r = World.restore(rebuildJournal(w));
    for (const seat of ["nunez", "cartel-b", "watcher", "shore"]) {
      expect(r.observe(seat)).toEqual(w.observe(seat));
    }
  });
});
