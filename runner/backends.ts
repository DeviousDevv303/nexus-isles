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
// roster (SCRIPTED_SURVIVAL_REF, below), the real Nexus adapter
// (runner/nexusBackend.ts), labelled with the checkpoint it actually
// serves, and the owner-orders backend (runner/ownerOrders.ts) that
// drives the refounded Throne seat from a committed orders file. A
// backend registers by adding a factory to this map in code; its
// providerId and version are then journaled on every action by the engine
// (AT-20).

import { join } from "node:path";
import { ScriptedPolicyBackend, type SeatBackend } from "../seats/driver.js";
import type { Action, Observation } from "../seats/seatProvider.js";
import type { RunnerSeatSpec } from "./config.js";
import { createNexusLocalBackend, NEXUS_RUN25_REF } from "./nexusBackend.js";
import { OwnerOrdersBackend, OWNER_ORDERS_REF, SEAT_ORDERS_FILENAME } from "./ownerOrders.js";

/** Where a backend's world lives: the runner's data directory. */
export interface BackendContext {
  dataDir: string;
}

export type BackendFactory = (seat: RunnerSeatSpec, ctx: BackendContext) => SeatBackend;

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
 * Survival policy v2 — the fix for the first live session's hauler death
 * (#235 comment 7089299881: hauler, zaragoza, starved on tick 8 after the
 * validator rejected all 7 of its gathers as not_in_region).
 *
 * The v1 defect, proven from the map: v1 scans every VISIBLE region in
 * sorted order and names the first stocked node it finds. A resident sees
 * its neighbours (intel hops), but the validator lets it gather only where
 * it stands. From zaragoza the visible regions sort as industrial-east,
 * ysleta, zaragoza, so v1 named industrial-east's maquila-commissary on
 * every tick and never gathered. scout survived only because its own region
 * happens to sort first. v1 stays registered unchanged: its version is
 * journaled on every action it took (AT-20), so its behaviour is history.
 *
 * v2 reads ONLY the observation, like v1, and:
 *   1. eats when it is carrying food and satiety has fallen to the
 *      threshold, never more than fits (maxSatiety - satiety);
 *   2. gathers only from a stocked node in its OWN region;
 *   3. when its own region is bare, eats whatever it carries;
 *   4. otherwise, and only when every other visible region is a neighbour
 *      (intel 1: perception radius equals one move), moves to the first
 *      stocked neighbouring region in sorted order; with wider intel it
 *      cannot tell a neighbour from a region two hops out, so it waits
 *      rather than propose a move the validator would refuse;
 *   5. otherwise waits.
 * Every action it proposes is one the validator can accept from the
 * observed state; it never names a node or region it cannot reach.
 */
export const SURVIVAL_V2_EAT_AT_SATIETY = 4;

export function survivalPolicyV2(input: { observation: Observation }): readonly Action[] {
  const v = input.observation.visible as {
    satiety?: unknown;
    maxSatiety?: unknown;
    inventory?: unknown;
    position?: unknown;
    intel?: unknown;
    regions?: Record<string, { nodes?: Record<string, number> }>;
    nodes?: Record<string, number>;
  };
  const satiety = typeof v.satiety === "number" ? v.satiety : 0;
  const maxSatiety = typeof v.maxSatiety === "number" ? v.maxSatiety : Number.POSITIVE_INFINITY;
  const inventory = typeof v.inventory === "number" ? v.inventory : 0;
  const room = Math.max(1, maxSatiety - satiety);
  const eat = (): readonly Action[] => [{ verb: "eat", args: { amount: Math.max(1, Math.min(inventory, 3, room)) } }];
  const firstStocked = (pool: Record<string, number> | undefined): string | undefined =>
    Object.keys(pool ?? {}).sort().find((node) => (pool as Record<string, number>)[node] > 0);

  if (inventory > 0 && satiety <= SURVIVAL_V2_EAT_AT_SATIETY) return eat();

  // Map world: gather where you stand, never in a region you can only see.
  if (v.regions) {
    const here = typeof v.position === "string" ? v.position : undefined;
    const local = here ? firstStocked(v.regions[here]?.nodes) : undefined;
    if (local) return [{ verb: "gather", args: { node: local, amount: 2 } }];
    if (inventory > 0) return eat();
    if (here && v.intel === 1) {
      const target = Object.keys(v.regions).sort().find((region) => region !== here && firstStocked(v.regions?.[region]?.nodes));
      if (target) return [{ verb: "move", args: { to: target } }];
    }
    return [{ verb: "wait", args: {} }];
  }

  // Mapless world: every visible node is gatherable.
  const node = firstStocked(v.nodes);
  if (node) return [{ verb: "gather", args: { node, amount: 2 } }];
  if (inventory > 0) return eat();
  return [{ verb: "wait", args: {} }];
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
/** The fixed policy's identity: same provider, new version, so the journal says which policy acted. */
export const SCRIPTED_SURVIVAL_V2_REF = { providerId: "scripted-policy:survival", version: "v2" } as const;

/** Versions of the production scripted policy, by the version a seat names. Unknown versions are refused. */
const SCRIPTED_SURVIVAL_VERSIONS: Readonly<Record<string, (input: { observation: Observation }) => readonly Action[]>> = {
  [SCRIPTED_SURVIVAL_REF.version]: survivalPolicy,
  [SCRIPTED_SURVIVAL_V2_REF.version]: survivalPolicyV2,
};

export const BUILTIN_BACKEND_FACTORIES: Readonly<Record<string, BackendFactory>> = {
  "test-double:scripted-policy": () => new ScriptedPolicyBackend(survivalPolicy),
  // v1 stays exactly as journaled; v2 is the out-of-region fix. A seat names which one it runs.
  [SCRIPTED_SURVIVAL_REF.providerId]: (seat) => {
    const policy = SCRIPTED_SURVIVAL_VERSIONS[seat.backend.version];
    if (!policy) {
      throw new Error(
        `no scripted-policy:survival version "${seat.backend.version}" (seat ${seat.seatId}); ` +
          `registered: ${Object.keys(SCRIPTED_SURVIVAL_VERSIONS).sort().join(", ")}`,
      );
    }
    return new ScriptedPolicyBackend(policy, { providerId: SCRIPTED_SURVIVAL_REF.providerId, version: seat.backend.version });
  },
  // The real Nexus adapter: Cristian's own LLM, the seated Run 25
  // checkpoint, served by the Python sidecar in runner/nexusBackend.ts.
  // The sidecar process is spawned lazily on the first propose() and the
  // checkpoint loads once per process.
  [NEXUS_RUN25_REF.providerId]: () => createNexusLocalBackend(),
  // The Throne seat's backend (2026-11-22 refounding): the founding
  // resident is driven by the committed orders file in the world's data
  // directory — authored by the operator of the day (Muse, later Nexus)
  // and by the owner himself, whose entries override. See
  // runner/ownerOrders.ts for the file schema and precedence rules.
  [OWNER_ORDERS_REF.providerId]: (seat, ctx) => {
    if (seat.backend.version !== OWNER_ORDERS_REF.version) {
      throw new Error(
        `no owner-orders version "${seat.backend.version}" (seat ${seat.seatId}); ` +
          `registered: ${OWNER_ORDERS_REF.version}`,
      );
    }
    return new OwnerOrdersBackend({
      ordersPath: join(ctx.dataDir, SEAT_ORDERS_FILENAME),
      seatId: seat.seatId,
      ref: { providerId: OWNER_ORDERS_REF.providerId, version: seat.backend.version },
    });
  },
};

/** Instantiate the backend for a seat, or refuse loudly if none is registered. */
export function createBackend(
  seat: RunnerSeatSpec,
  factories: Readonly<Record<string, BackendFactory>> = BUILTIN_BACKEND_FACTORIES,
  ctx: BackendContext = { dataDir: "." },
): SeatBackend {
  const factory = factories[seat.backend.providerId];
  if (!factory) {
    throw new Error(
      `no backend adapter registered for provider "${seat.backend.providerId}" (seat ${seat.seatId}) — ` +
        `the runner ships only the scripted test double; a real adapter must be registered in runner/backends.ts`,
    );
  }
  const backend = factory(seat, ctx);
  if (backend.ref.providerId !== seat.backend.providerId || backend.ref.version !== seat.backend.version) {
    throw new Error(
      `backend for seat ${seat.seatId} reports ${backend.ref.providerId}@${backend.ref.version} ` +
        `but the config names ${seat.backend.providerId}@${seat.backend.version} — refusing to mislabel a backend (provider-truth)`,
    );
  }
  return backend;
}
