// Nexus Isles — launch runner: the owner-orders backend (the Throne seat).
//
// The founding resident of the successor Núñez lineage (resident
// "cristian", seated by the 2026-11-22 AA10 refounding) is driven by
// ORDERS, not by a policy or a model: an operator authors the resident's
// actions in a committed orders file, and this backend proposes exactly
// those orders through the ordinary seat driver — so every order passes
// the one validator like any resident action, is journaled with its
// provenance (AT-20), and is refused in the open when unlawful. There is
// no second path and no silent forcing.
//
// Operation (owner directive, 2026-11-22 ~21:35 CST): until a Nexus
// training run passes the frozen grade and takes the seat from Run 25,
// the operator is Muse (operator: "muse"); then operation passes to
// Nexus (operator: "nexus"). The operator identity is data — the
// `operator` field on every entry — never code: the handoff changes who
// writes the file, nothing else. The owner's own orders (operator:
// "owner", including directives typed into the resident view's orders
// chat box) override the operator's for the same tick: his word wins.
//
// The file is the audit trail. It lives in the world's data directory
// (seat-orders.json beside journal.jsonl), is committed with the world
// data, and every entry names its author. An entry is one of:
//   - action orders: `orders` lists engine actions for one tick;
//   - a directive: `directive` carries the author's words (the owner's
//     chat-box entries). A directive entry with no orders DISPLACES the
//     operator's orders for its tick — the backend submits nothing —
//     until the operator translates the directive into action orders.
// Entries name the world tick their orders RESOLVE in (the tick the
// driver delivers, one past the observation the backend is shown).
// A `standing` entry (tick: null) covers any tick with no tick-specific
// entry. Within one precedence class the LAST entry in the file wins, so
// a correction is a new appended entry — the original remains, per AA9.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonicalStringify } from "../ledger/journal.js";
import type { BackendRef } from "../engine/world/state.js";
import type { SeatBackend } from "../seats/driver.js";
import type { Action, ActionProvenance, Observation } from "../seats/seatProvider.js";

/** The journaled identity of the orders backend. Not a test double. */
export const OWNER_ORDERS_REF: BackendRef = { providerId: "owner-orders", version: "v1" };

/** The orders file's name inside the world's data directory. */
export const SEAT_ORDERS_FILENAME = "seat-orders.json";

/** The operator value that outranks every other author for the same tick. */
export const OWNER_OPERATOR = "owner";

export interface SeatOrderEntry {
  /** World tick the orders resolve in; null for a standing entry. */
  tick: number | null;
  /** Who authored this entry: "owner" | "muse" | "nexus" | a future operator. */
  operator: string;
  /** Engine actions to submit for the tick (may be empty). */
  orders: Action[];
  /** The author's words, when the entry is a directive rather than actions. */
  directive?: string;
  /** True when the entry covers any tick without a tick-specific entry. */
  standing?: boolean;
}

export interface SeatOrdersFile {
  seat: string;
  entries: SeatOrderEntry[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseEntry(raw: unknown, index: number): SeatOrderEntry {
  const where = `seat orders entry ${index}`;
  if (!isRecord(raw)) throw new Error(`${where}: must be an object`);
  const { tick, operator, orders, directive, standing } = raw;
  if (tick !== null && !(typeof tick === "number" && Number.isSafeInteger(tick) && tick >= 1)) {
    throw new Error(`${where}: tick must be null (standing) or an integer >= 1`);
  }
  if (standing !== undefined && typeof standing !== "boolean") {
    throw new Error(`${where}: standing must be a boolean when present`);
  }
  if (standing === true && tick !== null) {
    throw new Error(`${where}: a standing entry carries tick: null`);
  }
  if (standing !== true && tick === null) {
    throw new Error(`${where}: a non-standing entry must name its tick`);
  }
  if (typeof operator !== "string" || operator.length === 0) {
    throw new Error(`${where}: operator must be a non-empty string naming the author`);
  }
  if (!Array.isArray(orders)) throw new Error(`${where}: orders must be an array`);
  const parsedOrders: Action[] = orders.map((o, i) => {
    if (!isRecord(o) || typeof o.verb !== "string" || o.verb.length === 0) {
      throw new Error(`${where}: orders[${i}] must carry a non-empty verb`);
    }
    if (o.args !== undefined && !isRecord(o.args)) {
      throw new Error(`${where}: orders[${i}].args must be an object`);
    }
    return { verb: o.verb, args: (o.args ?? {}) as Readonly<Record<string, unknown>> };
  });
  if (directive !== undefined && typeof directive !== "string") {
    throw new Error(`${where}: directive must be a string when present`);
  }
  return {
    tick,
    operator,
    orders: parsedOrders,
    ...(directive !== undefined ? { directive } : {}),
    ...(standing !== undefined ? { standing } : {}),
  };
}

/** Parse and validate an orders file's contents. Throws on any malformation. */
export function parseSeatOrdersFile(raw: unknown): SeatOrdersFile {
  if (!isRecord(raw)) throw new Error("seat orders file must be a JSON object");
  if (typeof raw.seat !== "string" || raw.seat.length === 0) {
    throw new Error("seat orders file: seat must be a non-empty string");
  }
  if (!Array.isArray(raw.entries)) throw new Error("seat orders file: entries must be an array");
  return { seat: raw.seat, entries: raw.entries.map(parseEntry) };
}

/** Load an orders file from disk. A missing or malformed file throws. */
export function loadSeatOrdersFile(path: string): SeatOrdersFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new Error(`could not read seat orders file ${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  return parseSeatOrdersFile(parsed);
}

export interface ResolvedOrders {
  /** The author of the governing entry. */
  operator: string;
  /** The actions to submit (empty when a directive displaces the plan). */
  orders: Action[];
  /** The governing entry's directive text, when it carries one. */
  directive: string | null;
  /** Whether the governing entry was tick-specific or standing. */
  source: "tick" | "standing";
}

/**
 * The orders governing one tick. Precedence: a tick-specific entry beats
 * a standing one; within a class, an owner entry beats every other
 * operator; within an author class, the last entry in the file wins
 * (corrections are appended, originals remain). Null when nothing in the
 * file covers the tick — the resident then receives no orders that tick.
 */
export function resolveOrdersForTick(file: SeatOrdersFile, tick: number): ResolvedOrders | null {
  const pick = (list: SeatOrderEntry[]): SeatOrderEntry | null => {
    if (list.length === 0) return null;
    const owners = list.filter((e) => e.operator === OWNER_OPERATOR);
    const pool = owners.length > 0 ? owners : list;
    return pool[pool.length - 1];
  };
  const specific = pick(file.entries.filter((e) => e.tick === tick));
  if (specific) {
    return { operator: specific.operator, orders: specific.orders, directive: specific.directive ?? null, source: "tick" };
  }
  const standing = pick(file.entries.filter((e) => e.standing === true));
  if (standing) {
    return { operator: standing.operator, orders: standing.orders, directive: standing.directive ?? null, source: "standing" };
  }
  return null;
}

/**
 * The backend that acts through the founding resident's seat: it reads
 * the orders file fresh on every proposal (the file may be appended
 * between sessions), resolves the orders for the tick being delivered
 * (observation tick + 1), and proposes exactly them. Its provenance names
 * the governing entry's operator, so the journal itself records who
 * authored every action the seat takes (AT-20).
 */
export class OwnerOrdersBackend implements SeatBackend {
  readonly ref: BackendRef;

  constructor(private readonly opts: { ordersPath: string; seatId: string; ref?: BackendRef }) {
    this.ref = opts.ref ?? OWNER_ORDERS_REF;
  }

  private resolvedFor(observation: Observation): { tick: number; resolved: ResolvedOrders | null } {
    const file = loadSeatOrdersFile(this.opts.ordersPath);
    if (file.seat !== this.opts.seatId) {
      throw new Error(`seat orders file ${this.opts.ordersPath} is for seat ${file.seat}, not ${this.opts.seatId}`);
    }
    const tick = observation.tick + 1;
    return { tick, resolved: resolveOrdersForTick(file, tick) };
  }

  provenance(input: { observation: Observation }): ActionProvenance {
    const { tick, resolved } = this.resolvedFor(input.observation);
    return {
      promptHash: createHash("sha256")
        .update(
          canonicalStringify({
            observation: input.observation,
            ordersTick: tick,
            operator: resolved?.operator ?? null,
            orders: resolved?.orders ?? [],
            directive: resolved?.directive ?? null,
          }),
          "utf8",
        )
        .digest("hex"),
      inputReferences: [
        `observation:tick:${input.observation.tick}`,
        "observation:visible",
        `orders:tick:${tick}`,
        `orders:operator:${resolved?.operator ?? "none"}`,
        ...(resolved?.directive ? ["orders:directive"] : []),
      ],
    };
  }

  propose(input: { observation: Observation }): readonly Action[] {
    const { resolved } = this.resolvedFor(input.observation);
    if (!resolved) return [];
    return resolved.orders.map((a) => ({ verb: a.verb, args: { ...a.args } }));
  }
}
