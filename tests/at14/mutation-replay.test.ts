// AT-14 (replay) — the mutation half: inheritance is reproducible from
// recorded parent profiles and mutation seeds. Same parent + same seed
// -> identical child, identical record. And the budget holds in both
// directions: blind copies refused (floor), excessive mutation refused
// (cap) — bounded and measurable, never maximal-difference.

import { describe, expect, it } from "vitest";
import { standardGenesisGenome, validateGenome } from "../../lineage/genome.js";
import {
  mutateBlend,
  mutateFork,
  mutationBudget,
  validateInheritance,
} from "../../lineage/mutation.js";

describe("mutation determinism and budget (AT-14)", () => {
  it("budget math is the published formula", () => {
    const genome = standardGenesisGenome();
    const budget = mutationBudget(genome);
    // N = 9 traits + 2 strategic + 6 tech affinities + 1 social = 18
    expect(budget.eligibleFields).toBe(18);
    expect(budget.minChanged).toBe(Math.max(1, Math.ceil(0.03 * 18))); // 1
    expect(budget.maxChanged).toBe(Math.max(1, Math.floor(0.25 * 18))); // 4
  });

  it("fork replay: same parent and seed reproduce the identical child and record", () => {
    const parent = standardGenesisGenome();
    const a = mutateFork(parent, 42);
    const b = mutateFork(parent, 42);
    expect(a.child).toEqual(b.child);
    expect(a.record).toEqual(b.record);
  });

  it("a fork child is a valid genome, differs within budget, and validates", () => {
    const parent = standardGenesisGenome();
    const { child, record } = mutateFork(parent, 7);
    expect(validateGenome(child)).toEqual([]);
    expect(record.changes.length).toBeGreaterThanOrEqual(1);
    expect(record.changes.length).toBeLessThanOrEqual(4);
    expect(validateInheritance(parent, child, record)).toEqual([]);
  });

  it("a blind copy is refused: zero-change inheritance fails the floor", () => {
    const parent = standardGenesisGenome();
    const issues = validateInheritance(parent, parent, {
      budgetVersion: "mutation-budget-v1",
      seed: 1,
      changes: [],
    });
    expect(issues.some((i) => i.includes("blind copies are refused"))).toBe(true);
  });

  it("an unrecorded change is refused — every difference must be journaled", () => {
    const parent = standardGenesisGenome();
    const { child, record } = mutateFork(parent, 9);
    const tampered = {
      ...child,
      motivationalWeights: { ...child.motivationalWeights, ambition: 0.99 },
    };
    const issues = validateInheritance(parent, tampered, record);
    expect(issues.some((i) => i.includes("unrecorded change"))).toBe(true);
  });

  it("blend replay is deterministic and the child validates against a parent", () => {
    const a = standardGenesisGenome();
    const b = mutateFork(standardGenesisGenome(), 123).child;
    const first = mutateBlend(a, b, 55);
    const second = mutateBlend(a, b, 55);
    expect(first.child).toEqual(second.child);
    expect(first.record).toEqual(second.record);
    expect(validateGenome(first.child)).toEqual([]);
    expect(validateInheritance(a, first.child, first.record)).toEqual([]);
  });
});
