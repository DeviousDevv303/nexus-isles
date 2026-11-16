// AT-15 against the real AA8 formula (contention-v1): committed effort +
// initiative + seeded tiebreak, formula ID journaled, replay reproduces
// grants, and no seat — Nexus included — receives hidden priority.

import { describe, expect, it } from "vitest";
import {
  CONTENTION_FORMULA_ID,
  priorityOrder,
  resolveContention,
  type Claim,
} from "../../engine/world/contention.js";
import { World } from "../../engine/world/world.js";
import { SEATS, TEST_BACKEND, baseConfig, rebuildJournal } from "../helpers/worldFixtures.js";

function contestedConfig(opts: { initiative?: Record<string, number>; amount?: number } = {}) {
  const cfg = baseConfig();
  cfg.nodes = [{ id: "grove", capacity: 20, amount: opts.amount ?? 4, regen: 0 }];
  cfg.rules.blightPercent = 0;
  cfg.residents = cfg.residents.map((r) => ({ ...r, initiative: opts.initiative?.[r.id] ?? 0 }));
  return cfg;
}

type Bid = { seat: string; amount: number; effort?: number };

function run(seed: number, bids: Bid[], cfg = contestedConfig()): World {
  const w = World.create(seed, cfg);
  for (const b of bids) {
    w.submit(b.seat, {
      verb: "gather",
      args: { node: "grove", amount: b.amount, ...(b.effort ? { effort: b.effort } : {}) },
    });
  }
  w.tick();
  return w;
}

function gotFood(w: World): string[] {
  return Object.entries(w.state.residents)
    .filter(([, r]) => r.inventory > 0)
    .map(([id]) => id);
}

describe("AT-15 / AA8 contention-v1", () => {
  it("higher committed effort wins, regardless of seed, seat id, or submission order", () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const order of [["alpha", "delta"], ["delta", "alpha"]]) {
        const bids = order.map((seat) => ({ seat, amount: 4, effort: seat === "delta" ? 3 : 1 }));
        expect(gotFood(run(seed, bids))).toEqual(["delta"]);
      }
    }
  });

  it("committed effort is accounted: spent win or lose, and journaled", () => {
    const w = run(1, [
      { seat: "alpha", amount: 4, effort: 3 },
      { seat: "bravo", amount: 4, effort: 2 },
    ]);
    const s = w.state;
    // satiety 8 -> decay 1 -> 7; alpha pays 2, bravo pays 1 (loser pays too)
    expect(s.residents.alpha.satiety).toBe(5);
    expect(s.residents.bravo.satiety).toBe(6);
    expect(s.residents.bravo.inventory).toBe(0);
    const spent = w.entries().filter((e) => e.type === "EFFORT_SPENT");
    expect(spent.map((e) => [e.payload.resident, e.payload.cost])).toEqual([
      ["alpha", 2],
      ["bravo", 1],
    ]);
  });

  it("initiative breaks equal-effort ties — every seed; effort still outranks initiative", () => {
    const cfg = () => contestedConfig({ initiative: { charlie: 5, alpha: 1 } });
    for (let seed = 1; seed <= 40; seed++) {
      const tie = run(seed, SEATS.map((seat) => ({ seat, amount: 4, effort: 2 })), cfg());
      expect(gotFood(tie)).toEqual(["charlie"]);
      const effortBeatsInitiative = run(
        seed,
        [
          { seat: "charlie", amount: 4, effort: 1 },
          { seat: "delta", amount: 4, effort: 2 },
        ],
        cfg(),
      );
      expect(gotFood(effortBeatsInitiative)).toEqual(["delta"]);
    }
  });

  it("seeded tiebreak is reproducible and fair when effort and initiative tie", () => {
    const winners = new Map<string, number>();
    for (let seed = 1; seed <= 400; seed++) {
      const a = gotFood(run(seed, SEATS.map((seat) => ({ seat, amount: 4 }))));
      const b = gotFood(run(seed, [...SEATS].reverse().map((seat) => ({ seat, amount: 4 }))));
      expect(b).toEqual(a); // same seed -> same winner, any submission order
      expect(a).toHaveLength(1);
      winners.set(a[0], (winners.get(a[0]) ?? 0) + 1);
    }
    for (const seat of SEATS) {
      const n = winners.get(seat) ?? 0;
      expect(n).toBeGreaterThan(60); // fair share 100 of 400
      expect(n).toBeLessThan(140);
    }
  });

  it("request size confers no priority (smaller requests gain nothing)", () => {
    let smallFirst = 0;
    const N = 400;
    for (let seed = 1; seed <= N; seed++) {
      const w = run(seed, [
        { seat: "alpha", amount: 1 },
        { seat: "bravo", amount: 6 },
      ], contestedConfig({ amount: 4 }));
      const c = w.entries().find((e) => e.type === "CONTENTION_RESOLVED")!;
      const claims = c.payload.claims as { seat: string; rank: number }[];
      if (claims.find((x) => x.seat === "alpha")!.rank === 0) smallFirst++;
    }
    expect(smallFirst).toBeGreaterThan(N * 0.4);
    expect(smallFirst).toBeLessThan(N * 0.6);
  });

  it("Tier-0 parity: a seat named nexus gets no hidden priority", () => {
    const seats = ["nexus", "alpha", "bravo", "charlie"];
    let nexusWins = 0;
    const N = 400;
    for (let seed = 1; seed <= N; seed++) {
      const cfg = contestedConfig();
      cfg.residents = seats.map((id) => ({ id, satiety: 8, maxSatiety: 10, actionsPerTick: 2, initiative: 0, backend: TEST_BACKEND }));
      const w = World.create(seed, cfg);
      for (const seat of seats) w.submit(seat, { verb: "gather", args: { node: "grove", amount: 4 } });
      w.tick();
      if (w.state.residents.nexus.inventory > 0) nexusWins++;
    }
    expect(nexusWins).toBeGreaterThan(N * 0.15);
    expect(nexusWins).toBeLessThan(N * 0.35); // fair share 25%
  });

  it("the priority order is invariant to claim arrival order (pure function)", () => {
    const claims: Claim[] = [
      { seatId: "a", seq: 0, requested: 3, effort: 2, initiative: 0, draw: 50 },
      { seatId: "b", seq: 0, requested: 1, effort: 2, initiative: 4, draw: 90 },
      { seatId: "c", seq: 0, requested: 6, effort: 1, initiative: 9, draw: 1 },
      { seatId: "d", seq: 0, requested: 2, effort: 2, initiative: 0, draw: 10 },
    ];
    const expected = priorityOrder(claims).map((c) => c.seatId);
    expect(expected).toEqual(["b", "d", "a", "c"]);
    for (let k = 0; k < 20; k++) {
      const shuffled = [...claims].sort(() => Math.random() - 0.5);
      expect(priorityOrder(shuffled).map((c) => c.seatId)).toEqual(expected);
    }
  });

  it("formula ID is journaled at genesis and on every contention and grant", () => {
    const w = run(3, SEATS.map((seat) => ({ seat, amount: 4 })));
    const entries = w.entries();
    const genesis = entries[0].payload.config as { rules: { contentionFormula: string; maxEffort: number } };
    expect(genesis.rules.contentionFormula).toBe(CONTENTION_FORMULA_ID);
    expect(genesis.rules.maxEffort).toBeGreaterThanOrEqual(1);
    const resolved = entries.filter((e) => e.type === "CONTENTION_RESOLVED");
    expect(resolved).toHaveLength(1);
    expect(resolved[0].payload.formulaId).toBe(CONTENTION_FORMULA_ID);
    for (const g of entries.filter((e) => e.type === "GATHER_GRANTED")) {
      expect(g.payload.formulaId).toBe(CONTENTION_FORMULA_ID);
    }
  });

  it("an unknown formula ID is refused at creation", () => {
    const cfg = contestedConfig();
    cfg.rules.contentionFormula = "contention-v999";
    expect(() => World.create(1, cfg)).toThrow(/unknown contention formula/);
  });

  it("replay reproduces grants: re-running the formula on journaled inputs equals the journaled outcome", () => {
    const cfg = baseConfig();
    cfg.residents = cfg.residents.map((r, i) => ({ ...r, initiative: i % 2, actionsPerTick: 4 }));
    cfg.rules.satietyDecay = 0; // keep everyone alive and contending for all 40 ticks
    const w = World.create(21, cfg);
    for (let t = 0; t < 40; t++) {
      for (const [i, seat] of SEATS.entries()) {
        w.submit(seat, { verb: "gather", args: { node: "grove", amount: 3, effort: 1 + ((t + i) % 3) } });
        w.submit(seat, { verb: "gather", args: { node: "shore", amount: 2 } });
        w.submit(seat, { verb: "eat", args: { amount: 2 } });
      }
      w.tick();
    }
    const resolved = w.entries().filter((e) => e.type === "CONTENTION_RESOLVED");
    expect(resolved.length).toBeGreaterThan(40);
    for (const e of resolved) {
      const rows = e.payload.claims as {
        seat: string; seq: number; requested: number; effort: number;
        initiative: number; draw: number; rank: number; granted: number;
      }[];
      const inputs: Claim[] = rows.map((r) => ({
        seatId: r.seat, seq: r.seq, requested: r.requested,
        effort: r.effort, initiative: r.initiative, draw: r.draw,
      }));
      const redo = resolveContention(e.payload.available as number, inputs);
      expect(redo.map((o) => [o.seatId, o.seq, o.rank, o.granted])).toEqual(
        rows.map((r) => [r.seat, r.seq, r.rank, r.granted]),
      );
    }
    // and a full restore from the journal lands on the identical state
    const restored = World.restore(rebuildJournal(w));
    expect(restored.state).toEqual(w.state);
    expect(restored.headHash).toBe(w.headHash);
  });

  it("validator rejects bad effort and exhausting effort", () => {
    const w = World.create(1, contestedConfig());
    w.submit("alpha", { verb: "gather", args: { node: "grove", amount: 1, effort: 99 } });
    w.submit("bravo", { verb: "gather", args: { node: "grove", amount: 1, effort: 0 } });
    w.submit("charlie", { verb: "gather", args: { node: "grove", amount: 1, effort: 1.5 } });
    w.tick();
    const rej = w.entries().filter((e) => e.type === "ACTION_REJECTED").map((e) => e.payload.reason);
    expect(rej).toEqual(["invalid_effort", "invalid_effort", "invalid_effort"]);

    const cfg = contestedConfig();
    cfg.residents[0].satiety = 3; // alpha: decays to 2; effort 3 costs 2 -> would exhaust
    cfg.rules.maxEffort = 5;
    const w2 = World.create(1, cfg);
    w2.submit("alpha", { verb: "gather", args: { node: "grove", amount: 1, effort: 3 } });
    w2.tick();
    expect(w2.entries().filter((e) => e.type === "ACTION_REJECTED").map((e) => e.payload.reason)).toEqual([
      "insufficient_stamina",
    ]);
  });

  it("default effort is 1 and costs nothing", () => {
    const w = run(1, [{ seat: "alpha", amount: 2 }]);
    expect(w.entries().some((e) => e.type === "EFFORT_SPENT")).toBe(false);
    expect(w.state.residents.alpha.inventory).toBe(2);
  });
});
