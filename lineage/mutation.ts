// Nexus Isles — Lineage: bounded mutation (build order step 4).
//
// Mutation is bounded and measurable — NOT maximal-difference (owner's
// dynastic ruling). The budget is a RANGE, versioned here:
//   M_min = max(1, ceil(0.03 * N))   (GPT's deterministic rounding — no
//                                     blind copies; a descendant must differ)
//   M_max = max(M_min, floor(0.25 * N))  (the cap: excessive mutation
//                                     destroys successful adaptations)
// over N = the genome's eligible mutable fields. Every inherited change is
// journaled as a MutationRecord: operator, field, magnitude, seed — and the
// whole operation replays deterministically from the seed (AT-14).

import {
  categoricalOptions,
  getField,
  isNumericField,
  mutableFieldPaths,
  withField,
  type Genome,
} from "./genome.js";

export const MUTATION_BUDGET_VERSION = "mutation-budget-v1";

export interface MutationBudget {
  version: string;
  eligibleFields: number;
  minChanged: number;
  maxChanged: number;
}

export function mutationBudget(genome: Genome): MutationBudget {
  const n = mutableFieldPaths(genome).length;
  const minChanged = Math.max(1, Math.ceil(0.03 * n));
  const maxChanged = Math.max(minChanged, Math.floor(0.25 * n));
  return { version: MUTATION_BUDGET_VERSION, eligibleFields: n, minChanged, maxChanged };
}

/** Deterministic PRNG (mulberry32) — same seed, same stream, everywhere. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type MutationOperator =
  | "bounded-perturb"
  | "categorical-swap"
  | "parental-recombine";

export interface FieldChange {
  path: string;
  operator: MutationOperator;
  from: unknown;
  to: unknown;
  /** Absolute numeric delta for bounded-perturb; 1 for swaps/recombines that differ. */
  magnitude: number;
}

export interface MutationRecord {
  budgetVersion: string;
  seed: number;
  changes: FieldChange[];
}

function perturb(value: number, rng: () => number): number {
  const delta = (rng() * 2 - 1) * 0.2; // bounded step: at most ±0.2
  return Math.min(1, Math.max(0, value + delta));
}

/**
 * Fork mutation: mutate one parent's genome under the budget.
 * Deterministic in (parent, seed): replaying reproduces the identical
 * child and the identical record.
 */
export function mutateFork(
  parent: Genome,
  seed: number,
): { child: Genome; record: MutationRecord } {
  const budget = mutationBudget(parent);
  const rng = seededRng(seed);
  const paths = mutableFieldPaths(parent);
  const target =
    budget.minChanged +
    Math.floor(rng() * (budget.maxChanged - budget.minChanged + 1));
  const chosen = new Set<number>();
  while (chosen.size < target) {
    chosen.add(Math.floor(rng() * paths.length));
  }
  let child = parent;
  const changes: FieldChange[] = [];
  for (const idx of [...chosen].sort((a, b) => a - b)) {
    const path = paths[idx];
    const from = getField(child, path);
    if (isNumericField(child, path)) {
      const to = perturb(from as number, rng);
      child = withField(child, path, to);
      changes.push({ path, operator: "bounded-perturb", from, to, magnitude: Math.abs(to - (from as number)) });
    } else {
      const options = categoricalOptions(path) ?? [];
      const alternatives = options.filter((o) => o !== from);
      if (alternatives.length === 0) continue;
      const to = alternatives[Math.floor(rng() * alternatives.length)];
      child = withField(child, path, to);
      changes.push({ path, operator: "categorical-swap", from, to, magnitude: 1 });
    }
  }
  return { child, record: { budgetVersion: budget.version, seed, changes } };
}

/**
 * Blend: recombine two parents field-by-field, then apply fork mutation.
 * Each mutable field is inherited from one parent (seeded choice) before
 * mutation, so the child is a genuine mix, not a copy of either parent.
 */
export function mutateBlend(
  parentA: Genome,
  parentB: Genome,
  seed: number,
): { child: Genome; record: MutationRecord } {
  const rng = seededRng(seed ^ 0x9e3779b9);
  let mixed = parentA;
  const recombineChanges: FieldChange[] = [];
  for (const path of mutableFieldPaths(parentA)) {
    const fromA = getField(parentA, path);
    const fromB = getField(parentB, path);
    if (rng() < 0.5 && fromB !== undefined) {
      mixed = withField(mixed, path, fromB);
      if (fromB !== fromA) {
        recombineChanges.push({ path, operator: "parental-recombine", from: fromA, to: fromB, magnitude: 1 });
      }
    }
  }
  const { child, record } = mutateFork(mixed, seed);
  return {
    child,
    record: { ...record, changes: [...recombineChanges, ...record.changes] },
  };
}

/**
 * Validate a claimed inheritance: the child's differences from the parent
 * must sit inside the budget, and the record must account for every
 * difference. Legitimate convergence is allowed — a descendant is rejected
 * only when the required mutation is absent or the budget is exceeded,
 * never merely for resembling its parent.
 */
export function validateInheritance(
  parent: Genome,
  child: Genome,
  record: MutationRecord,
): string[] {
  const issues: string[] = [];
  const budget = mutationBudget(parent);
  if (record.budgetVersion !== budget.version) {
    issues.push(`budget version mismatch: ${record.budgetVersion} != ${budget.version}`);
  }
  const recordedPaths = new Set(record.changes.map((c) => c.path));
  const differingPaths = mutableFieldPaths(parent).filter(
    (p) => JSON.stringify(getField(parent, p)) !== JSON.stringify(getField(child, p)),
  );
  for (const p of differingPaths) {
    if (!recordedPaths.has(p)) issues.push(`unrecorded change at ${p}`);
  }
  // Mutation-driven differences (excluding recombine, which blend accounts
  // separately) must satisfy the budget's floor and cap.
  const mutationChanges = record.changes.filter((c) => c.operator !== "parental-recombine");
  if (mutationChanges.length < budget.minChanged) {
    issues.push(
      `mutation below floor: ${mutationChanges.length} changed < M_min ${budget.minChanged} (blind copies are refused)`,
    );
  }
  if (mutationChanges.length > budget.maxChanged) {
    issues.push(
      `mutation above cap: ${mutationChanges.length} changed > M_max ${budget.maxChanged} (mutation is bounded, not maximal)`,
    );
  }
  return issues;
}
