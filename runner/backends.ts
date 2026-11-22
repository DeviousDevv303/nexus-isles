// Nexus Isles — launch runner: backend registry.
//
// The runner drives seats through the existing SeatDriver. Which backend
// acts through a seat is decided HERE, by providerId, in code — never by
// the config file alone: a config may name a provider, but if no factory is
// registered for it the runner refuses to start rather than improvise one.
//
// The registry ships with the deterministic scripted TEST DOUBLE from
// seats/driver.ts, honestly labelled "test-double:scripted-policy", the
// production scripted-policy registration for the decided first-live
// roster (SCRIPTED_SURVIVAL_REF, below), and the real Nexus adapter
// (runner/nexusBackend.ts), labelled with the checkpoint it actually
// serves. A backend registers by adding a factory to this map in code; its
// providerId and version are then journaled on every action by the engine
// (AT-20).

import { ScriptedPolicyBackend, type SeatBackend } from "../seats/driver.js";
import type { Action, Observation } from "../seats/seatProvider.js";
import type { RunnerSeatSpec } from "./config.js";
import { createNexusLocalBackend, NEXUS_RUN25_REF } from "./nexusBackend.js";

export type BackendFactory = (seat: RunnerSeatSpec) => SeatBackend;

/**
 * The test double's policy: a deterministic survival loop that reads ONLY
 * the observation the engine delivered (never world state). Eat when hungry
 * and carrying; otherwise gather from the first visible stocked node
 * (canonical sorted order, so the choice is reproducible).
 */
export function survivalPolicy(input: { observation: Observation }): readonly Action[] {
  const v = input.observation.visible as {
    satiety?: unknown;
    inventory?: unknown;
    regions?: Record<string, { nodes?: Record<string, number> }>;
    nodes?: Record<string, number>;
  };
  const satiety = typeof v.satiety === "number" ? v.satiety : 0;
  const inventory = typeof v.inventory === "number" ? v.inventory : 0;
  if (inventory > 0 && satiety <= 4) {
    return [{ verb: "eat", args: { amount: Math.min(inventory, 3) } }];
  }
  const pools: Record<string, number>[] = [];
  if (v.regions) {
    for (const region of Object.keys(v.regions).sort()) pools.push(v.regions[region].nodes ?? {});
  } else if (v.nodes) {
    pools.push(v.nodes);
  }
  for (const pool of pools) {
    for (const node of Object.keys(pool).sort()) {
      if (pool[node] > 0) return [{ verb: "gather", args: { node, amount: 2 } }];
    }
  }
  if (inventory > 0) return [{ verb: "eat", args: { amount: Math.min(inventory, 3) } }];
  return [];
}

/**
 * The production identity of the scripted survival policy, for worlds that
 * seat scripted-policy residents as REAL residents (the owner's decided
 * first-live roster: Nexus + two scripted-policy residents in a persistent
 * world). It runs the exact policy the test double runs; only the identity
 * differs, and the difference is the point — a persistent world refuses the
 * "test-double:" prefix at genesis and at bind time, so before this
 * registration the decided roster could not be instantiated at all. The
 * label claims nothing the code does not do: a deterministic scripted
 * policy, journaled under its own name on every action (AT-20).
 */
export const SCRIPTED_SURVIVAL_REF = { providerId: "scripted-policy:survival", version: "v1" } as const;

export const BUILTIN_BACKEND_FACTORIES: Readonly<Record<string, BackendFactory>> = {
  "test-double:scripted-policy": () => new ScriptedPolicyBackend(survivalPolicy),
  [SCRIPTED_SURVIVAL_REF.providerId]: () => new ScriptedPolicyBackend(survivalPolicy, SCRIPTED_SURVIVAL_REF),
  // The real Nexus adapter: Cristian's own LLM, the seated Run 25
  // checkpoint, served by the Python sidecar in runner/nexusBackend.ts.
  // The sidecar process is spawned lazily on the first propose() and the
  // checkpoint loads once per process.
  [NEXUS_RUN25_REF.providerId]: () => createNexusLocalBackend(),
};

/** Instantiate the backend for a seat, or refuse loudly if none is registered. */
export function createBackend(
  seat: RunnerSeatSpec,
  factories: Readonly<Record<string, BackendFactory>> = BUILTIN_BACKEND_FACTORIES,
): SeatBackend {
  const factory = factories[seat.backend.providerId];
  if (!factory) {
    throw new Error(
      `no backend adapter registered for provider "${seat.backend.providerId}" (seat ${seat.seatId}) — ` +
        `the runner ships only the scripted test double; a real adapter must be registered in runner/backends.ts`,
    );
  }
  const backend = factory(seat);
  if (backend.ref.providerId !== seat.backend.providerId || backend.ref.version !== seat.backend.version) {
    throw new Error(
      `backend for seat ${seat.seatId} reports ${backend.ref.providerId}@${backend.ref.version} ` +
        `but the config names ${seat.backend.providerId}@${seat.backend.version} — refusing to mislabel a backend (provider-truth)`,
    );
  }
  return backend;
}
