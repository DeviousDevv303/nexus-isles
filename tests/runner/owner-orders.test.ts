// The owner-orders backend (runner/ownerOrders.ts): the orders file's
// schema, its precedence rules (owner > operator, tick > standing, last
// correction wins), and the backend that proposes the file's orders
// through the seat driver with the author named in the provenance.
//
// Operation (owner directive 2026-11-22 ~21:35 CST): Muse operates the
// lineage until a Nexus run passes the frozen grade and takes the seat;
// the operator is a FIELD on each entry, never code — the handoff to
// "nexus" changes who writes the file, and these tests pin that the
// machinery does not care which operator name an entry carries.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBackend, BUILTIN_BACKEND_FACTORIES } from "../../runner/backends.js";
import {
  loadSeatOrdersFile,
  OwnerOrdersBackend,
  OWNER_ORDERS_REF,
  parseSeatOrdersFile,
  resolveOrdersForTick,
  type SeatOrdersFile,
} from "../../runner/ownerOrders.js";
import type { Observation } from "../../seats/seatProvider.js";
import { tempDir } from "../helpers/worldFixtures.js";

const gather = (amount: number) => ({ verb: "gather", args: { node: "mercado-centro", amount } });
const eat = (amount: number) => ({ verb: "eat", args: { amount } });

function file(entries: SeatOrdersFile["entries"]): SeatOrdersFile {
  return parseSeatOrdersFile({ seat: "cristian", entries });
}

describe("orders file schema", () => {
  it("parses action orders, directives, and standing entries", () => {
    const parsed = file([
      { tick: 23, operator: "muse", orders: [gather(4)] },
      { tick: 24, operator: "owner", directive: "Hold position and eat.", orders: [] },
      { tick: null, operator: "muse", standing: true, orders: [gather(2)] },
    ]);
    expect(parsed.seat).toBe("cristian");
    expect(parsed.entries.length).toBe(3);
    expect(parsed.entries[1].directive).toBe("Hold position and eat.");
  });

  it("rejects malformed entries loudly", () => {
    const bad: unknown[] = [
      { seat: "cristian", entries: [{ tick: null, operator: "muse", orders: [] }] }, // null tick, not standing
      { seat: "cristian", entries: [{ tick: 5, operator: "muse", standing: true, orders: [] }] }, // standing with a tick
      { seat: "cristian", entries: [{ tick: 5, operator: "", orders: [] }] }, // no author
      { seat: "cristian", entries: [{ tick: 5, operator: "muse", orders: [{ args: {} }] }] }, // no verb
      { seat: "cristian", entries: [{ tick: 0, operator: "muse", orders: [] }] }, // tick 0 never resolves orders
      { seat: "cristian", entries: "nope" },
      { entries: [] }, // no seat
    ];
    for (const raw of bad) {
      expect(() => parseSeatOrdersFile(raw), JSON.stringify(raw)).toThrow(/seat orders/);
    }
  });

  it("loads from disk and names the path when it cannot", () => {
    const dir = tempDir();
    const path = join(dir, "seat-orders.json");
    writeFileSync(path, JSON.stringify({ seat: "cristian", entries: [] }), "utf8");
    expect(loadSeatOrdersFile(path).entries).toEqual([]);
    expect(() => loadSeatOrdersFile(join(dir, "missing.json"))).toThrow(/could not read seat orders file/);
  });
});

describe("precedence — whose orders govern a tick", () => {
  it("the owner's entry beats the operator's for the same tick", () => {
    const f = file([
      { tick: 24, operator: "muse", orders: [gather(4)] },
      { tick: 24, operator: "owner", orders: [eat(2)] },
    ]);
    const resolved = resolveOrdersForTick(f, 24);
    expect(resolved?.operator).toBe("owner");
    expect(resolved?.orders).toEqual([eat(2)]);
  });

  it("an owner directive with no orders displaces the operator's plan for that tick", () => {
    const f = file([
      { tick: 24, operator: "muse", orders: [gather(4)] },
      { tick: 24, operator: "owner", directive: "Stay in centro. Do not cross the bridge.", orders: [] },
    ]);
    const resolved = resolveOrdersForTick(f, 24);
    expect(resolved?.operator).toBe("owner");
    expect(resolved?.orders).toEqual([]);
    expect(resolved?.directive).toBe("Stay in centro. Do not cross the bridge.");
  });

  it("a tick-specific entry beats a standing one; standing covers the rest", () => {
    const f = file([
      { tick: null, operator: "muse", standing: true, orders: [gather(2)] },
      { tick: 24, operator: "muse", orders: [eat(1)] },
    ]);
    expect(resolveOrdersForTick(f, 24)?.orders).toEqual([eat(1)]);
    const standing = resolveOrdersForTick(f, 25);
    expect(standing?.source).toBe("standing");
    expect(standing?.orders).toEqual([gather(2)]);
  });

  it("an owner standing entry beats an operator standing entry", () => {
    const f = file([
      { tick: null, operator: "muse", standing: true, orders: [gather(2)] },
      { tick: null, operator: "owner", standing: true, directive: "Hold.", orders: [] },
    ]);
    expect(resolveOrdersForTick(f, 30)?.operator).toBe("owner");
  });

  it("within one author class the last entry wins — corrections are appended", () => {
    const f = file([
      { tick: 24, operator: "muse", orders: [gather(4)] },
      { tick: 24, operator: "muse", orders: [gather(2)] },
    ]);
    expect(resolveOrdersForTick(f, 24)?.orders).toEqual([gather(2)]);
  });

  it("the operator is a parameter: a nexus-authored entry resolves exactly like a muse one", () => {
    const f = file([{ tick: 24, operator: "nexus", orders: [gather(3)] }]);
    const resolved = resolveOrdersForTick(f, 24);
    expect(resolved?.operator).toBe("nexus");
    expect(resolved?.orders).toEqual([gather(3)]);
    // …and the owner still outranks the future operator.
    const withOwner = file([
      { tick: 24, operator: "nexus", orders: [gather(3)] },
      { tick: 24, operator: "owner", orders: [eat(1)] },
    ]);
    expect(resolveOrdersForTick(withOwner, 24)?.operator).toBe("owner");
  });

  it("no governing entry resolves to null — the resident receives no orders", () => {
    expect(resolveOrdersForTick(file([]), 24)).toBeNull();
    expect(resolveOrdersForTick(file([{ tick: 9, operator: "muse", orders: [gather(1)] }]), 24)).toBeNull();
  });
});

describe("OwnerOrdersBackend", () => {
  function backendWith(entries: SeatOrdersFile["entries"], seatId = "cristian") {
    const dir = tempDir();
    const path = join(dir, "seat-orders.json");
    writeFileSync(path, JSON.stringify({ seat: "cristian", entries }), "utf8");
    return new OwnerOrdersBackend({ ordersPath: path, seatId });
  }
  const observation = (tick: number): Observation => ({ tick, visible: {} });

  it("proposes the orders for the tick being delivered (observation tick + 1)", () => {
    const backend = backendWith([{ tick: 10, operator: "muse", orders: [gather(4)] }]);
    expect(backend.propose({ observation: observation(9) })).toEqual([gather(4)]);
    expect(backend.propose({ observation: observation(10) })).toEqual([]);
  });

  it("names the author in the provenance the journal will carry", () => {
    const backend = backendWith([
      { tick: 10, operator: "muse", orders: [gather(4)] },
      { tick: 10, operator: "owner", directive: "Wait.", orders: [] },
    ]);
    const provenance = backend.provenance({ observation: observation(9) });
    expect(provenance.inputReferences).toContain("orders:tick:10");
    expect(provenance.inputReferences).toContain("orders:operator:owner");
    expect(provenance.inputReferences).toContain("orders:directive");
    // The owner directive governs, so nothing is proposed.
    expect(backend.propose({ observation: observation(9) })).toEqual([]);
  });

  it("refuses a file written for another seat, and a missing file, loudly", () => {
    const backend = backendWith([], "scout");
    expect(() => backend.propose({ observation: observation(9) })).toThrow(/not scout/);
    const missing = new OwnerOrdersBackend({ ordersPath: join(tempDir(), "nope.json"), seatId: "cristian" });
    expect(() => missing.propose({ observation: observation(9) })).toThrow(/could not read seat orders file/);
  });

  it("is registered in the runner's backend registry under its journaled identity", () => {
    const dir = tempDir();
    const backend = createBackend(
      {
        seatId: "cristian",
        backend: { providerId: "owner-orders", version: "v1" },
        position: "centro",
        satiety: 8,
        maxSatiety: 10,
        actionsPerTick: 2,
        intel: 1,
      },
      BUILTIN_BACKEND_FACTORIES,
      { dataDir: dir },
    );
    expect(backend.ref).toEqual(OWNER_ORDERS_REF);
    expect(() =>
      createBackend(
        {
          seatId: "cristian",
          backend: { providerId: "owner-orders", version: "v9" },
          position: "centro",
          satiety: 8,
          maxSatiety: 10,
          actionsPerTick: 2,
          intel: 1,
        },
        BUILTIN_BACKEND_FACTORIES,
        { dataDir: dir },
      ),
    ).toThrow(/no owner-orders version "v9"/);
  });
});
