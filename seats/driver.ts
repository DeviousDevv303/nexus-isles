// Nexus Isles — seat driver (owner directive, ForgeClaw issue #235).
//
// The driver is the narrow bridge between a resident's seat and a backend:
// observation -> backend proposal -> structural parse -> World.submit(). It
// never mutates WorldState, bypasses the validator, receives full world state,
// or journals private directives/raw backend output.

import type { BackendRef } from "../engine/world/state.js";
import type { World } from "../engine/world/world.js";
import { checkTickDelivery } from "../engine/world/writerLock.js";
import { createHash } from "node:crypto";
import { canonicalStringify } from "../ledger/journal.js";
import type { Action, ActionProvenance, Observation } from "./seatProvider.js";

export interface DriverDirective {
  tick: number;
  kind: string;
  body: string;
}

export interface SeatBackend {
  readonly ref: BackendRef;
  propose(input: {
    observation: Observation;
    directives: readonly DriverDirective[];
  }): unknown | Promise<unknown>;
  /** Derive journal-safe provenance for the exact private input sent to propose. */
  provenance?(input: {
    observation: Observation;
    directives: readonly DriverDirective[];
  }): ActionProvenance;
}

function fallbackProvenance(input: {
  observation: Observation;
  directives: readonly DriverDirective[];
}): ActionProvenance {
  return {
    promptHash: createHash("sha256")
      .update(canonicalStringify(input), "utf8")
      .digest("hex"),
    inputReferences: [
      `observation:tick:${input.observation.tick}`,
      "observation:visible",
      ...input.directives.map((d) => `directive:tick:${d.tick}:${d.kind}`),
    ],
  };
}

/**
 * Deterministic scripted-policy backend. Its identity is the ref it is
 * constructed with: the DEFAULT ref is the labeled test double
 * ("test-double:scripted-policy"), which non-scratch worlds refuse. A
 * deployment that runs a scripted policy as a real resident (the decided
 * first-live roster's scripted-policy residents) constructs it with that
 * deployment's own honest ref instead — the journal then records exactly
 * the scripted policy that drove the seat. Never label this provider as
 * Nexus or a model, whatever ref it carries.
 */
export class ScriptedPolicyBackend implements SeatBackend {
  readonly ref: BackendRef;

  constructor(
    private readonly policy: (input: {
      observation: Observation;
      directives: readonly DriverDirective[];
    }) => readonly Action[],
    ref: BackendRef = { providerId: "test-double:scripted-policy", version: "test-v1" },
  ) {
    this.ref = ref;
  }

  propose(input: {
    observation: Observation;
    directives: readonly DriverDirective[];
  }): readonly Action[] {
    return this.policy(input);
  }
}

/**
 * Contract adapter for Nexus or another real backend. The backend returns raw
 * model output; this adapter supplies the explicit parser. It does not repair
 * malformed output into a different action.
 */
export class RawOutputBackend implements SeatBackend {
  constructor(
    public readonly ref: BackendRef,
    private readonly invoke: (input: {
      observation: Observation;
      directives: readonly DriverDirective[];
    }) => unknown | Promise<unknown>,
    private readonly parse: (raw: unknown) => unknown,
    private readonly makeProvenance?: (input: {
      observation: Observation;
      directives: readonly DriverDirective[];
    }) => ActionProvenance,
  ) {}

  provenance(input: {
    observation: Observation;
    directives: readonly DriverDirective[];
  }): ActionProvenance {
    return this.makeProvenance?.(input) ?? fallbackProvenance(input);
  }

  async propose(input: {
    observation: Observation;
    directives: readonly DriverDirective[];
  }): Promise<unknown> {
    return this.parse(await this.invoke(input));
  }
}

export interface DrivenSeat {
  seatId: string;
  backend: SeatBackend;
  directives?: () => readonly DriverDirective[];
}

export interface DriverTickReport {
  tick: number;
  submitted: number;
  refused: number;
  closedSeats: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseActions(value: unknown): Action[] {
  if (!Array.isArray(value)) throw new Error("backend output must be an array of actions");
  return value.map((candidate, index) => {
    if (!isRecord(candidate) || typeof candidate.verb !== "string" || candidate.verb.length === 0) {
      throw new Error(`backend action ${index} must contain a non-empty verb`);
    }
    if (candidate.args !== undefined && !isRecord(candidate.args)) {
      throw new Error(`backend action ${index} args must be an object`);
    }
    return { verb: candidate.verb, args: (candidate.args ?? {}) as Readonly<Record<string, unknown>> };
  });
}

export class SeatDriver {
  private readonly closed = new Set<string>();
  private readonly seats = new Map<string, DrivenSeat>();
  /** Single flight: a second delivery while one is running is refused. */
  private inFlight = false;
  /**
   * The tick whose proposals are already submitted but whose world tick has
   * not committed (it threw, e.g. on an emergency stop). A redelivery of that
   * same tick re-runs only the world tick; it never submits the seats twice.
   */
  private submittedFor: number | null = null;

  constructor(private readonly world: World, drivenSeats: readonly DrivenSeat[]) {
    for (const seat of drivenSeats) {
      if (this.seats.has(seat.seatId)) throw new Error(`duplicate driven seat ${seat.seatId}`);
      const resident = world.state.residents[seat.seatId];
      if (!resident) throw new Error(`driven seat ${seat.seatId} is not a resident`);
      if (!resident.alive) throw new Error(`driven seat ${seat.seatId} is dead`);
      this.seats.set(seat.seatId, seat);
      // Backend binding lands at the next world tick boundary. There is no
      // driver rebind/respawn path after a resident dies.
      world.bindBackend(seat.seatId, seat.backend.ref);
    }
  }

  /**
   * One driver tick. With `expectTick`, the delivery names its tick: a
   * repeated delivery of a committed tick is refused before any backend is
   * asked or anything is submitted (TickDeliveryError).
   */
  async tick(opts: { expectTick?: number } = {}): Promise<DriverTickReport> {
    if (this.inFlight) throw new Error("a driver tick is already in flight: a concurrent delivery never ticks twice");
    const next = this.world.tickNumber + 1;
    checkTickDelivery(opts.expectTick, next);
    this.inFlight = true;
    try {
      return await this.tickOnce(next, opts.expectTick);
    } finally {
      this.inFlight = false;
    }
  }

  private async tickOnce(next: number, expectTick: number | undefined): Promise<DriverTickReport> {
    let submitted = 0;
    let refused = 0;
    const closedSeats: string[] = [];

    const alreadySubmitted = this.submittedFor === next;
    for (const [seatId, seat] of [...this.seats.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (alreadySubmitted) break;
      if (this.closed.has(seatId)) continue;
      const resident = this.world.state.residents[seatId];
      if (!resident?.alive) {
        this.closed.add(seatId);
        closedSeats.push(seatId);
        continue;
      }
      const observation = this.world.observe(seatId);
      if (!observation) {
        this.world.recordDriverRefusal(seatId, seat.backend.ref, "no_observation");
        refused += 1;
        continue;
      }
      const directives = [...(seat.directives?.() ?? [])].map((directive) => ({
        tick: directive.tick,
        kind: directive.kind,
        body: directive.body,
      }));
      try {
        const input = { observation, directives };
        const provenance = seat.backend.provenance?.(input) ?? fallbackProvenance(input);
        const raw = await seat.backend.propose(input);
        for (const action of parseActions(raw)) {
          this.world.submit(seatId, action, { provenance });
          submitted += 1;
        }
      } catch (error) {
        // Never copy backend exception text: it may contain private prompts or
        // raw model output. The journal gets only this stable safe category.
        void error;
        this.world.recordDriverRefusal(seatId, seat.backend.ref, "malformed_backend_output");
        refused += 1;
      }
    }

    this.submittedFor = next;
    this.world.tick({ expectTick });
    this.submittedFor = null;
    for (const [seatId] of this.seats) {
      if (!this.world.state.residents[seatId]?.alive && !this.closed.has(seatId)) {
        this.closed.add(seatId);
        closedSeats.push(seatId);
      }
    }
    return { tick: this.world.tickNumber, submitted, refused, closedSeats: closedSeats.sort() };
  }
}

export function parseBackendActions(raw: unknown): Action[] {
  return parseActions(raw);
}
