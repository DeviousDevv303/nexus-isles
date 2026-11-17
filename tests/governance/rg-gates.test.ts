// RG-1..RG-5 and the E6 observer boundary, enforced on every test run.
// Owner ruling 2026-11-17 (#235, 6937254884, item 5).
//
// Part 1 runs every gate on the real repo and requires zero violations.
// Part 2 plants one violation per gate in a synthetic repo and requires the
// gate to fire — so a gate that silently stops working fails here too.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkAll,
  checkObserverImports,
  checkProvisional,
  checkRg1Constants,
  checkRg3,
  checkRg4,
  checkRg5,
  type OwnerRulings,
  type Registry,
} from "../../tools/governance/rg.js";

const ROOT = join(import.meta.dirname, "..", "..");
function snapshot(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|json|txt|md)$/.test(name)) out.set(relative(ROOT, p).split("\\").join("/"), readFileSync(p, "utf8"));
    }
  };
  walk(ROOT);
  return out;
}
const repo = snapshot();
const registry = JSON.parse(repo.get("governance/registry.json") as string) as Registry;
const rulings = JSON.parse(repo.get("governance/owner-rulings.json") as string) as OwnerRulings;

describe("review gates on the real repo", () => {
  it("zero violations across RG-1..RG-5 and E6", () => {
    const v = checkAll(repo, registry, rulings);
    expect(v.map((x) => `${x.gate} ${x.file ?? ""}${x.line ? ":" + x.line : ""} ${x.message}`)).toEqual([]);
  });
});

describe("each gate fires on a planted violation", () => {
  const reg = (entries: Registry["entries"]): Registry => ({ entries });

  it("RG-1: an unregistered exported constant, and a stale registry symbol", () => {
    const r = new Map([["engine/world/x.ts", "export const MAGIC_LIMIT = 7;\n"]]);
    expect(checkRg1Constants(r, reg([])).map((v) => v.gate)).toEqual(["RG-1"]);
    const stale = reg([{ id: "a", status: "STRUCTURAL", symbols: [{ file: "engine/world/x.ts", name: "GONE" }] }]);
    expect(checkRg1Constants(new Map([["engine/world/x.ts", ""]]), stale)[0].message).toMatch(/stale/);
  });

  it("RG-1: a PROVISIONAL entry with no marker naming its id", () => {
    const r = new Map([["seats/x.ts", "// PROVISIONAL something else\n"], ["tests/t.test.ts", "// registry: p\n"]]);
    const v = checkProvisional(r, reg([{ id: "p", status: "PROVISIONAL", markers: ["seats/x.ts"], tests: ["tests/t.test.ts"] }]));
    expect(v.map((x) => x.gate)).toEqual(["RG-1"]);
  });

  it("RG-2: a PROVISIONAL entry no test references", () => {
    const r = new Map([["seats/x.ts", "// PROVISIONAL (p)\n"], ["tests/t.test.ts", "it('x', () => {})\n"]]);
    const v = checkProvisional(r, reg([{ id: "p", status: "PROVISIONAL", markers: ["seats/x.ts"], tests: ["tests/t.test.ts"] }]));
    expect(v.map((x) => x.gate)).toEqual(["RG-2"]);
    expect(checkProvisional(r, reg([{ id: "p", status: "PROVISIONAL", markers: ["seats/x.ts"] }])).map((x) => x.gate)).toEqual(["RG-2"]);
  });

  it("RG-3: a comment invoking an owner ruling with no listed ruling id", () => {
    const r = new Map([["engine/world/x.ts", "// per the owner ruling, effort costs 2\nconst a = 1; // owner direction 6908386307\n"]]);
    const v = checkRg3(r, { rulings: [{ id: "6908386307" }] });
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(1);
  });

  it("RG-3 does not mistake BR-1's pending marker for an authority claim", () => {
    const r = new Map([["seats/x.ts", "// PROVISIONAL — owner-ratification item (registry: x)\n"]]);
    expect(checkRg3(r, { rulings: [] })).toEqual([]);
  });

  it("RG-4: RATIFIED without an owner ruling, CONSTITUTIONAL without a found reference", () => {
    const r = new Map([["docs/c.txt", "AA1 text"]]);
    const v = checkRg4(r, reg([
      { id: "a", status: "RATIFIED" },
      { id: "b", status: "RATIFIED", source: { ruling: "1234567890" } },
      { id: "c", status: "CONSTITUTIONAL", source: { doc: "docs/c.txt", ref: "AA99" } },
      { id: "d", status: "CONSTITUTIONAL", source: { doc: "docs/c.txt", ref: "AA1" } },
    ]), { rulings: [] });
    expect(v.map((x) => x.message.split(":")[0])).toEqual(["a", "b", "c"]);
  });

  it("RG-5: an uncited constitutional claim, and a RESERVED item implemented", () => {
    const r = new Map([
      ["lineage/x.ts", "// the constitution requires this\n// constitutionally required by AA4\n"],
      ["engine/world/y.ts", "export function computeControl() {}\n"],
      ["tests/z.test.ts", "computeControl\n"],
    ]);
    const v = checkRg5(r, reg([{ id: "territory-control", status: "RESERVED", tripwire: "\\bcomputeControl\\b" }]));
    expect(v.map((x) => `${x.file}:${x.line}`)).toEqual(["lineage/x.ts:1", "engine/world/y.ts:1"]);
  });

  it("E6: the engine importing the observer (this is exactly what superseded PR #16 did)", () => {
    const r = new Map([
      ["engine/world/world.ts", 'import { scoreEpoch } from "../../observer/dynastyScore.js";\n'],
      ["observer/report.ts", 'import { World } from "../engine/world/world.js";\n'],
    ]);
    const v = checkObserverImports(r);
    expect(v.map((x) => x.file)).toEqual(["engine/world/world.ts"]);
  });
});
