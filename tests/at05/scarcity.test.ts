// AT-05 foundations: scarcity cannot be double-collected. Total granted from
// a node in a tick never exceeds what it holds; nodes never go negative;
// resources are conserved between node stock, inventories, and meals.

import { describe, expect, it } from "vitest";
import { World } from "../../engine/world/world.js";
import { baseConfig, drive } from "../helpers/worldFixtures.js";

describe("AT-05 scarcity foundations", () => {
  it("two seats demanding the whole node get exactly the node, once", () => {
    const cfg = baseConfig();
    cfg.nodes = [{ id: "grove", capacity: 6, amount: 6, regen: 0 }];
    cfg.rules.blightPercent = 0;
    const w = World.create(1, cfg);
    w.submit("alpha", { verb: "gather", args: { node: "grove", amount: 6 } });
    w.submit("bravo", { verb: "gather", args: { node: "grove", amount: 6 } });
    w.tick();
    const s = w.state;
    expect(s.nodes.grove.amount).toBe(0);
    expect(s.residents.alpha.inventory + s.residents.bravo.inventory).toBe(6);
  });

  it("one seat gathering the same node twice in a tick cannot exceed the stock", () => {
    const cfg = baseConfig();
    cfg.nodes = [{ id: "grove", capacity: 5, amount: 5, regen: 0 }];
    cfg.rules.blightPercent = 0;
    const w = World.create(1, cfg);
    w.submit("alpha", { verb: "gather", args: { node: "grove", amount: 4 } });
    w.submit("alpha", { verb: "gather", args: { node: "grove", amount: 4 } });
    w.tick();
    expect(w.state.residents.alpha.inventory).toBe(5);
    expect(w.state.nodes.grove.amount).toBe(0);
  });

  it("over-budget actions are rejected, with the reason journaled", () => {
    const w = World.create(1, baseConfig()); // actionsPerTick = 2
    for (let i = 0; i < 3; i++) {
      w.submit("alpha", { verb: "gather", args: { node: "grove", amount: 1 } });
    }
    w.tick();
    const rej = w.entries().filter((e) => e.type === "ACTION_REJECTED");
    expect(rej.map((e) => e.payload.reason)).toEqual(["budget_exceeded"]);
  });

  it("invalid actions are rejected loudly (unknown seat/verb/node/amount, dead, nothing to eat)", () => {
    const w = World.create(1, baseConfig());
    w.submit("ghost", { verb: "wait", args: {} });
    w.submit("alpha", { verb: "fly", args: {} });
    w.submit("bravo", { verb: "gather", args: { node: "moon", amount: 1 } });
    w.submit("charlie", { verb: "gather", args: { node: "grove", amount: 0 } });
    w.submit("delta", { verb: "eat", args: { amount: 1 } });
    w.tick();
    const reasons = w.entries().filter((e) => e.type === "ACTION_REJECTED").map((e) => e.payload.reason);
    expect(reasons).toEqual(["unknown_verb", "unknown_node", "invalid_amount", "nothing_to_eat", "unknown_seat"]);
  });

  it("invariants hold over 200 ticks x 12 seeds: stock never negative, never over capacity, food conserved", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const w = World.create(seed, baseConfig());
      drive(w, 200);
      const s = w.state;
      for (const n of Object.values(s.nodes)) {
        expect(n.amount).toBeGreaterThanOrEqual(0);
        expect(n.amount).toBeLessThanOrEqual(n.capacity);
      }
      // gathered = still in inventory + eaten; eaten = satiety gained
      const ent = w.entries();
      const gathered = ent.filter((e) => e.type === "GATHER_GRANTED").reduce((a, e) => a + (e.payload.granted as number), 0);
      const eaten = ent.filter((e) => e.type === "EAT_APPLIED").reduce((a, e) => a + (e.payload.consumed as number), 0);
      const held = Object.values(s.residents).reduce((a, r) => a + r.inventory, 0);
      expect(gathered).toBe(held + eaten);
    }
  });

  it("the dead cannot act", () => {
    const cfg = baseConfig();
    cfg.residents[0].satiety = 1;
    const w = World.create(1, cfg);
    w.tick(); // alpha starves
    expect(w.state.residents.alpha.alive).toBe(false);
    w.submit("alpha", { verb: "wait", args: {} });
    w.tick();
    const last = w.entries().filter((e) => e.type === "ACTION_REJECTED").pop();
    expect(last?.payload.reason).toBe("resident_dead");
  });
});
