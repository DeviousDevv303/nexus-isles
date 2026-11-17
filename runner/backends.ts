// Nexus Isles — launch runner: backend registry.
//
// The runner drives seats through the existing SeatDriver. Which backend
// acts through a seat is decided HERE, by providerId, in code — never by
// the config file alone: a config may name a provider, but if no factory is
// registered for it the runner refuses to start rather than improvise one.
//
// The registry ships with exactly one backend: the deterministic scripted
// TEST DOUBLE from seats/driver.ts, honestly labelled
// "test-double:scripted-policy". A real backend (e.g. the Nexus adapter)
// registers by adding a factory to this map in code; its providerId and
// version are then journaled on every action by the engine (AT-20).

import { ScriptedPolicyBackend, type SeatBackend } from "../seats/driver.js";
import type { Action, Observation } from "../seats/seatProvider.js";
import type { RunnerSeatSpec } from "./config.js";

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

export const BUILTIN_BACKEND_FACTORIES: Readonly<Record<string, BackendFactory>> = {
  "test-double:scripted-policy": () => new ScriptedPolicyBackend(survivalPolicy),
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
