// Retained regression test (GPT evidence audit, 2026-11-23): engine
// precedence over relay-recorded seat orders, exercised against the REAL
// runner (loadSeatOrdersFile + resolveOrdersForTick) on files written in
// the relay's exact output shape.
//
// The scenario files below are byte-shaped the way the ForgeClaw relay's
// /seat-orders route writes them: entries normalized by the relay's
// parser (args always present, standing omitted unless true), serialized
// as JSON.stringify({seat, entries}, null, 2) + "\n". The relay's half of
// the contract — authentication, validation, deduplication — is tested
// in the forgeclaw suite; this file pins the half that lives here: given
// a file the relay could have written, the runner's precedence is
//   (a) within the owner class, the LAST entry governs (a correction
//       supersedes the order it corrects);
//   (b) an operator entry appended after an owner entry never overrides
//       it (class beats append order);
//   (c) an owner entry appended after an operator entry governs
//       (the same rule from the other side).
// The stale-retry case needs no fourth file: after the relay suppresses
// a retry of A, the persisted file is exactly case (a)'s [A, B] — so
// (a) is also the proof that the engine resolves the correction, not
// the resurrected original.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSeatOrdersFile, resolveOrdersForTick } from "../../runner/ownerOrders.js";
import { tempDir } from "../helpers/worldFixtures.js";

function writeScenario(name: string, entries: unknown[]): string {
  const path = join(tempDir(), name);
  writeFileSync(path, `${JSON.stringify({ seat: "cristian", entries }, null, 2)}\n`, "utf8");
  return path;
}

// Relay-normalized spellings: args filled with {}, no standing key on
// non-standing entries, directive omitted when absent.
const A = { tick: 40, operator: "owner", orders: [{ verb: "gather", args: {} }] };
const B = { tick: 40, operator: "owner", orders: [{ verb: "eat", args: {} }] };
const C = { tick: 40, operator: "muse", orders: [{ verb: "move", args: { to: "pronaf" } }] };

describe("seat-orders precedence under the real runner (relay-shaped files)", () => {
  it("(a) owner correction governs: the changed owner entry resolves the tick", () => {
    const file = loadSeatOrdersFile(writeScenario("correction.json", [A, B]));
    const resolved = resolveOrdersForTick(file, 40);
    expect(resolved?.operator).toBe("owner");
    expect(resolved?.orders).toEqual([{ verb: "eat", args: {} }]);
    expect(resolved?.source).toBe("tick");
  });

  it("(b) operator cannot override: an operator entry appended after the owner entry does not govern", () => {
    const file = loadSeatOrdersFile(writeScenario("operator-cannot-override.json", [A, C]));
    const resolved = resolveOrdersForTick(file, 40);
    expect(resolved?.operator).toBe("owner");
    expect(resolved?.orders).toEqual([{ verb: "gather", args: {} }]);
  });

  it("(c) owner wins regardless of append order: an owner entry appended after the operator entry governs", () => {
    const file = loadSeatOrdersFile(writeScenario("owner-any-order.json", [C, A]));
    const resolved = resolveOrdersForTick(file, 40);
    expect(resolved?.operator).toBe("owner");
    expect(resolved?.orders).toEqual([{ verb: "gather", args: {} }]);
  });
});
