// Nexus Isles — launch runner: genesis + runner configuration.
//
// The genesis config is the ONLY place a new world's shape is declared for
// the runner: seed, map (Juarez — the one Phase 1 environment), the world
// class (scratch | persistent), and the seat list with the backend identity
// (providerId + version) that will act through each seat. On a resume the
// journal is authoritative for the world's shape; the config, when
// supplied, is cross-checked against it (seed + seat roster + world class)
// so a runner can never silently drive the wrong world.

import { readFileSync } from "node:fs";
import { JUAREZ_MAP_ID, juarezConfig } from "../engine/world/maps/juarez.js";
import {
  WORLD_CLASSES,
  type BackendRef,
  type ResidentConfig,
  type WorldClass,
  type WorldConfig,
} from "../engine/world/state.js";

export interface RunnerSeatSpec {
  seatId: string;
  /** The backend that acts through this seat (AT-20 provenance identity). */
  backend: BackendRef;
  /** Starting region on the map. */
  position: string;
  satiety: number;
  maxSatiety: number;
  actionsPerTick: number;
  intel: number;
}

export interface GenesisConfig {
  seed: number;
  /** "juarez" (or the map id "juarez-v1"). The only map the runner ships. */
  map: string;
  /**
   * The world class declared for this world (world-class-v1, PR #32):
   * "scratch" for disposable worlds that may seat labeled test doubles,
   * "persistent" for real history. Absent = undeclared in the config; the
   * runner resolves that fail-closed to "persistent" (see
   * effectiveWorldClass) and says so in its log — it never silently picks.
   */
  worldClass?: WorldClass;
  seats: RunnerSeatSpec[];
}

/** The class an undeclared config is treated as: fail-closed toward real. */
export const FAIL_CLOSED_WORLD_CLASS: WorldClass = "persistent";

/**
 * The world class the runner acts on for a genesis config: the declared
 * class, or — when the config omits the field — "persistent". An omitted
 * class therefore never yields a scratch world, and a config that seats
 * test doubles must declare "scratch" explicitly.
 */
export function effectiveWorldClass(genesis: GenesisConfig): WorldClass {
  return genesis.worldClass ?? FAIL_CLOSED_WORLD_CLASS;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function intField(obj: Record<string, unknown>, key: string, fallback: number, where: string): number {
  const v = obj[key] ?? fallback;
  if (!Number.isSafeInteger(v) || (v as number) < 0) {
    throw new Error(`genesis config: ${where}.${key} must be an integer >= 0`);
  }
  return v as number;
}

function parseSeat(raw: unknown, index: number): RunnerSeatSpec {
  const where = `seats[${index}]`;
  if (!isRecord(raw)) throw new Error(`genesis config: ${where} must be an object`);
  if (typeof raw.seatId !== "string" || raw.seatId.length === 0) {
    throw new Error(`genesis config: ${where}.seatId must be a non-empty string`);
  }
  if (!isRecord(raw.backend)) {
    throw new Error(`genesis config: ${where}.backend must be an object { providerId, version }`);
  }
  const { providerId, version } = raw.backend;
  if (typeof providerId !== "string" || providerId.length === 0) {
    throw new Error(`genesis config: ${where}.backend.providerId must be a non-empty string`);
  }
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`genesis config: ${where}.backend.version must be a non-empty string`);
  }
  const position = raw.position ?? "centro";
  if (typeof position !== "string" || position.length === 0) {
    throw new Error(`genesis config: ${where}.position must be a non-empty string`);
  }
  const satiety = intField(raw, "satiety", 8, where);
  const maxSatiety = intField(raw, "maxSatiety", 10, where);
  if (satiety > maxSatiety) {
    throw new Error(`genesis config: ${where}.satiety must be <= maxSatiety`);
  }
  return {
    seatId: raw.seatId,
    backend: { providerId, version },
    position,
    satiety,
    maxSatiety,
    actionsPerTick: intField(raw, "actionsPerTick", 2, where),
    intel: intField(raw, "intel", 1, where),
  };
}

/** Parse and validate a genesis config object (already JSON-parsed). */
export function parseGenesisConfig(raw: unknown): GenesisConfig {
  if (!isRecord(raw)) throw new Error("genesis config must be a JSON object");
  if (!Number.isSafeInteger(raw.seed) || (raw.seed as number) < 0) {
    throw new Error("genesis config: seed must be an integer >= 0");
  }
  const map = raw.map ?? "juarez";
  if (map !== "juarez" && map !== JUAREZ_MAP_ID) {
    throw new Error(`genesis config: unsupported map ${JSON.stringify(map)} — the runner ships the Juarez map only`);
  }
  if (!Array.isArray(raw.seats) || raw.seats.length === 0) {
    throw new Error("genesis config: seats must be a non-empty array");
  }
  const seats = raw.seats.map(parseSeat);
  const seen = new Set<string>();
  for (const s of seats) {
    if (seen.has(s.seatId)) throw new Error(`genesis config: duplicate seat ${s.seatId}`);
    seen.add(s.seatId);
  }
  let worldClass: WorldClass | undefined;
  if (raw.worldClass !== undefined) {
    if (typeof raw.worldClass !== "string" || !(WORLD_CLASSES as readonly string[]).includes(raw.worldClass)) {
      throw new Error(`genesis config: worldClass must be one of ${WORLD_CLASSES.join(", ")}`);
    }
    worldClass = raw.worldClass as WorldClass;
  }
  return { seed: raw.seed as number, map: map as string, ...(worldClass ? { worldClass } : {}), seats };
}

export function loadGenesisConfig(path: string): GenesisConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new Error(`could not read genesis config ${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  return parseGenesisConfig(parsed);
}

/**
 * The engine WorldConfig for a genesis: the Juarez map + its nodes/rules +
 * the effective world class, journaled in WORLD_GENESIS by World.create.
 * The class is always present here (declared, or the fail-closed default),
 * so a runner-created world is never left "unclassified" by silence.
 */
export function worldConfigFor(genesis: GenesisConfig): WorldConfig {
  const residents: ResidentConfig[] = genesis.seats.map((s) => ({
    id: s.seatId,
    satiety: s.satiety,
    maxSatiety: s.maxSatiety,
    actionsPerTick: s.actionsPerTick,
    position: s.position,
    intel: s.intel,
    backend: s.backend,
  }));
  return { ...juarezConfig(residents), worldClass: effectiveWorldClass(genesis) };
}
