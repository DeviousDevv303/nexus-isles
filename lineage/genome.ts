// Nexus Isles — Lineage: the structured genome (build order step 4).
//
// The genome is a structured inheritance layer — typed fields, never prose,
// and never the underlying model's weights (technical honesty rule, owner's
// dynastic ruling: "we do not pretend to mutate the underlying LLM weights
// when we cannot"). The model remains itself; the genome shapes starting
// tendencies and carries inherited knowledge.
//
// Field set reconciles the owner's ruling (risk tolerance, ambition,
// adaptability, strategic tendencies, technological affinity, social
// tendencies, historical inheritance) with the constitution's motive
// profiles. Historical inheritance is data — achievement and lesson
// REFERENCES — never raw private memory.

export const GENOME_SPEC_VERSION = "genome-spec-v1";

/** Bounded numeric trait in [0, 1]. */
export type TraitValue = number;

export interface MotivationalWeights {
  ambition: TraitValue;
  curiosity: TraitValue;
  dominance: TraitValue;
  loyalty: TraitValue;
  suspicion: TraitValue;
  revenge: TraitValue;
  riskTolerance: TraitValue;
  preservation: TraitValue;
  /** Owner's ruling field: capacity to revise strategy under new evidence. */
  adaptability: TraitValue;
}

export type RiskPosture = "cautious" | "balanced" | "aggressive";

export interface StrategicTendencies {
  riskPosture: RiskPosture;
  expansionism: TraitValue;
}

export interface SocialDisposition {
  trustBaseline: TraitValue;
}

/**
 * Historical inheritance (owner's ruling): the family's achievements and
 * permitted lessons, carried as references. Accrues over a lineage's life;
 * it is NOT a mutation substrate.
 */
export interface HistoricalInheritance {
  achievementRefs: string[];
  permittedLessonRefs: string[];
}

export interface Genome {
  specVersion: string;
  motivationalWeights: MotivationalWeights;
  strategicTendencies: StrategicTendencies;
  /** Per-generation technology bias, keys "0".."5", values in [0, 1]. */
  technologyAffinities: Record<string, TraitValue>;
  socialDisposition: SocialDisposition;
  /** Categorical doctrine preferences (opaque labels; no prose). */
  doctrinePreferences: Record<string, string>;
  historicalInheritance: HistoricalInheritance;
}

/** A neutral standard genesis genome (all mid-range, no doctrine set). */
export function standardGenesisGenome(): Genome {
  const mid: MotivationalWeights = {
    ambition: 0.5,
    curiosity: 0.5,
    dominance: 0.5,
    loyalty: 0.5,
    suspicion: 0.5,
    revenge: 0.5,
    riskTolerance: 0.5,
    preservation: 0.5,
    adaptability: 0.5,
  };
  return {
    specVersion: GENOME_SPEC_VERSION,
    motivationalWeights: mid,
    strategicTendencies: { riskPosture: "balanced", expansionism: 0.5 },
    technologyAffinities: { "0": 0.5, "1": 0.5, "2": 0.5, "3": 0.5, "4": 0.5, "5": 0.5 },
    socialDisposition: { trustBaseline: 0.5 },
    doctrinePreferences: {},
    historicalInheritance: { achievementRefs: [], permittedLessonRefs: [] },
  };
}

const TRAIT_FIELDS: (keyof MotivationalWeights)[] = [
  "ambition",
  "curiosity",
  "dominance",
  "loyalty",
  "suspicion",
  "revenge",
  "riskTolerance",
  "preservation",
  "adaptability",
];

/**
 * The mutable field paths of a genome — the N that mutation percentages
 * range over. Historical inheritance is excluded (it accrues, it does not
 * mutate); specVersion is excluded (it versions, it does not mutate).
 */
export function mutableFieldPaths(genome: Genome): string[] {
  const paths: string[] = [];
  for (const f of TRAIT_FIELDS) paths.push(`motivationalWeights.${f}`);
  paths.push("strategicTendencies.riskPosture");
  paths.push("strategicTendencies.expansionism");
  for (const gen of Object.keys(genome.technologyAffinities).sort()) {
    paths.push(`technologyAffinities.${gen}`);
  }
  paths.push("socialDisposition.trustBaseline");
  for (const key of Object.keys(genome.doctrinePreferences).sort()) {
    paths.push(`doctrinePreferences.${key}`);
  }
  return paths;
}

export function getField(genome: Genome, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = genome;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function withField(genome: Genome, path: string, value: unknown): Genome {
  const parts = path.split(".");
  const clone: Genome = JSON.parse(JSON.stringify(genome)) as Genome;
  let cur: Record<string, unknown> = clone as unknown as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur[parts[i]] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
  return clone;
}

/** Categorical option sets for swap mutation, by field path pattern. */
export function categoricalOptions(path: string): string[] | null {
  if (path === "strategicTendencies.riskPosture") {
    return ["cautious", "balanced", "aggressive"];
  }
  return null;
}

export function isNumericField(genome: Genome, path: string): boolean {
  return typeof getField(genome, path) === "number";
}

/** Erratum E1: the schema guarantees N >= 4 eligible mutable fields. */
export const MIN_ELIGIBLE_FIELDS = 4;

export function eligibleCountIssue(n: number): string | null {
  return n < MIN_ELIGIBLE_FIELDS
    ? `genome has ${n} eligible mutable fields; the schema requires N >= ${MIN_ELIGIBLE_FIELDS}`
    : null;
}

/** Validate a genome against the spec: shape, bounds, categorical sets. */
export function validateGenome(genome: Genome): string[] {
  const issues: string[] = [];
  const countIssue = eligibleCountIssue(mutableFieldPaths(genome).length);
  if (countIssue) issues.push(countIssue);
  if (genome.specVersion !== GENOME_SPEC_VERSION) {
    issues.push(`specVersion must be ${GENOME_SPEC_VERSION}`);
  }
  for (const path of mutableFieldPaths(genome)) {
    const value = getField(genome, path);
    if (value === undefined) {
      issues.push(`missing field ${path}`);
      continue;
    }
    if (isNumericField(genome, path)) {
      const n = value as number;
      if (!(n >= 0 && n <= 1)) issues.push(`field ${path} out of bounds [0,1]: ${n}`);
    } else {
      const options = categoricalOptions(path);
      if (options && !options.includes(value as string)) {
        issues.push(`field ${path} not in categorical options: ${String(value)}`);
      }
    }
  }
  return issues;
}
