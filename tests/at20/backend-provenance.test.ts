// AT-20 Backend provenance: every action is journaled with the backend
// identity and version that produced it; actions on both sides of a backend
// swap carry their correct versions; no path skips the stamp; a swap never
// replaces the resident.

import { describe, expect, it } from "vitest";
import { NexusEmbeddedSeat } from "../../residents/nexus/embeddedSeat.js";
import type { SeatSpec } from "../../seats/seatProvider.js";
import { World } from "../../engine/world/world.js";
import { TEST_BACKEND, baseConfig, drive, rebuildJournal } from "../helpers/worldFixtures.js";

const V1 = { providerId: "hosted-strongest", version: "2026-11-a" };
const V2 = { providerId: "nexus-intelligence", version: "run32" };
const gather = (w: World, seat: string) =>
  w.submit(seat, { verb: "gather", args: { node: "grove", amount: 1 } });
const actions = (w: World, seat?: string) =>
  w.entries().filter(
    (e) => (e.type === "ACTION_ACCEPTED" || e.type === "ACTION_REJECTED") && (!seat || e.payload.seat === seat),
  );

function world(): World {
  const cfg = baseConfig();
  cfg.residents[0].backend = V1; // alpha
  return World.create(1, cfg);
}

describe("AT-20 backend provenance", () => {
  it("every action record — accepted and rejected — carries a backend stamp", () => {
    const w = World.create(5, baseConfig());
    drive(w, 30);
    w.submit("alpha", { verb: "teleport", args: {} });
    w.tick();
    const all = actions(w);
    expect(all.length).toBeGreaterThan(100);
    expect(all.some((e) => e.type === "ACTION_REJECTED")).toBe(true);
    for (const e of all) expect(e.payload.backend).toEqual(TEST_BACKEND);
  });

  it("actions on both sides of a swap carry their correct versions", () => {
    const w = world();
    for (let i = 0; i < 3; i++) { gather(w, "alpha"); w.tick(); }
    w.bindBackend("alpha", V2);
    for (let i = 0; i < 3; i++) { gather(w, "alpha"); w.tick(); }
    const stamps = actions(w, "alpha").map((e) => [e.tick, (e.payload.backend as typeof V1).version]);
    expect(stamps).toEqual([
      [1, "2026-11-a"], [2, "2026-11-a"], [3, "2026-11-a"],
      [4, "run32"], [5, "run32"], [6, "run32"],
    ]);
    const swaps = w.entries().filter((e) => e.type === "SEAT_BACKEND_BOUND");
    expect(swaps).toHaveLength(1);
    expect(swaps[0].tick).toBe(4);
    expect(swaps[0].payload).toEqual({ seat: "alpha", backend: V2, previous: V1 });
    // the swap is journaled BEFORE the first action it governs
    const firstV2 = actions(w, "alpha").find((e) => e.tick === 4)!;
    expect(swaps[0].index).toBeLessThan(firstV2.index);
  });

  it("an action queued before the swap but resolved after it is stamped with the acting backend at resolution", () => {
    const w = world();
    gather(w, "alpha");
    w.bindBackend("alpha", V2);
    w.tick();
    expect(actions(w, "alpha")[0].payload.backend).toEqual(V2);
  });

  it("no path skips the stamp: a seat with no bound backend cannot act", () => {
    const cfg = baseConfig();
    delete cfg.residents[0].backend;
    const w = World.create(1, cfg);
    gather(w, "alpha");
    w.tick();
    const a = actions(w, "alpha");
    expect(a).toHaveLength(1);
    expect(a[0].type).toBe("ACTION_REJECTED");
    expect(a[0].payload.reason).toBe("no_backend_bound");
    expect(a[0].payload.backend).toBeNull();
    expect(w.state.residents.alpha.inventory).toBe(0);
    // across a long mixed run, no accepted action ever lacks a stamp
    const w2 = World.create(3, baseConfig());
    drive(w2, 40);
    for (const e of w2.entries().filter((x) => x.type === "ACTION_ACCEPTED")) {
      expect(e.payload.backend).toMatchObject({ providerId: expect.any(String), version: expect.any(String) });
    }
  });

  it("a swap replaces the brain, never the resident: identity, state and history are untouched", () => {
    const w = world();
    for (let i = 0; i < 3; i++) { gather(w, "alpha"); w.tick(); }
    const before = w.state.residents.alpha;
    const hashesBefore = w.entries().map((e) => e.hash);
    w.bindBackend("alpha", V2);
    w.tick();
    const after = w.state.residents.alpha;
    expect({ ...after, backend: null, satiety: 0 }).toEqual({ ...before, backend: null, satiety: 0 });
    expect(after.backend).toEqual(V2);
    expect(Object.keys(w.state.residents)).toEqual(Object.keys(world().state.residents)); // no new resident
    expect(w.entries().slice(0, hashesBefore.length).map((e) => e.hash)).toEqual(hashesBefore);
    expect(actions(w, "alpha").slice(0, 3).every((e) => (e.payload.backend as typeof V1).version === "2026-11-a")).toBe(true);
  });

  it("re-binding the same backend journals nothing; binding the dead or unknown is rejected and journaled", () => {
    const cfg = baseConfig();
    cfg.residents[1].satiety = 1; // bravo dies on tick 1
    const w = World.create(1, cfg);
    w.bindBackend("alpha", TEST_BACKEND);
    w.tick();
    expect(w.entries().filter((e) => e.type === "SEAT_BACKEND_BOUND")).toHaveLength(0);
    w.bindBackend("bravo", V2);
    w.bindBackend("ghost", V2);
    w.tick();
    const rej = w.entries().filter((e) => e.type === "BACKEND_BIND_REJECTED");
    expect(rej.map((e) => [e.payload.seat, e.payload.reason])).toEqual([
      ["bravo", "resident_dead"], ["ghost", "unknown_seat"],
    ]);
    expect(() => w.bindBackend("alpha", { providerId: "x", version: "" })).toThrow(/non-empty/);
  });

  it("the stamp and the swap survive restore", () => {
    const w = world();
    gather(w, "alpha"); w.tick();
    w.bindBackend("alpha", V2);
    gather(w, "alpha"); w.tick();
    const r = World.restore(rebuildJournal(w));
    expect(r.state).toEqual(w.state);
    expect(r.state.residents.alpha.backend).toEqual(V2);
    gather(r, "alpha"); r.tick();
    expect(actions(r, "alpha").pop()!.payload.backend).toEqual(V2);
  });

  it("the Nexus seat binds its backend on connect and refuses a spec with no version", async () => {
    const cfg = baseConfig();
    delete cfg.residents[0].backend;
    const w = World.create(1, cfg);
    const seat = new NexusEmbeddedSeat(w);
    const spec: SeatSpec = {
      seatId: "alpha", tier: 0, providerId: "nexus-intelligence",
      budget: { tokensPerTick: 1000, actionsPerTick: 2 },
    };
    await expect(seat.connect(spec)).rejects.toThrow(/backendVersion/);
    const handle = await seat.connect({ ...spec, backendVersion: "run25" });
    await seat.submit(handle, { verb: "gather", args: { node: "grove", amount: 1 } });
    w.tick();
    expect(actions(w, "alpha")[0].payload.backend).toEqual({ providerId: "nexus-intelligence", version: "run25" });
  });
});
