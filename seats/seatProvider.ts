// Nexus Isles — SeatProvider: the ONLY integration point for residents.
//
// A seat is a seat (AA11). Every resident — Nexus embedded in-process,
// a local model through the local-runner, or a hosted model through the
// gateway — connects through this one interface and submits actions
// through the identical validation and resolution path. Provider identity
// is journaled, never a scoring input. Budgets are denominated in tokens
// and actions per tick, never dollars; latency is never scored (AA8).

export interface SeatSpec {
  /** Stable seat identity within the world. */
  seatId: string;
  /** Residency tier: 0 = embedded (Nexus), 1 = local-runner, 2 = hosted. */
  tier: 0 | 1 | 2;
  /** The actual underlying model, named truthfully (provider-truth rule). */
  providerId: string;
  /**
   * The exact backend version acting through this seat (checkpoint / model
   * build). Journaled on every action (AT-20). Optional in the type so
   * existing specs still compile; a seat with no bound backend cannot act.
   */
  backendVersion?: string;
  /** Per-tick budgets. Denominated in tokens and actions — never dollars. */
  budget: { tokensPerTick: number; actionsPerTick: number };
}

export interface Observation {
  tick: number;
  /** What the engine authorizes this seat to perceive — nothing more. */
  visible: Readonly<Record<string, unknown>>;
}

export interface Action {
  verb: string;
  args: Readonly<Record<string, unknown>>;
}

/**
 * Ruling 9 action provenance. The journal stores only a digest of the private
 * backend input and stable labels for the inputs used; it never stores a raw
 * prompt, directive body, or deliberation.
 */
export interface ActionProvenance {
  promptHash: string;
  inputReferences: readonly string[];
}

export interface Receipt {
  accepted: boolean;
  /** Journal index of the resolved action, when accepted. */
  journalIndex?: number;
  /** Machine-readable rejection reason, when not accepted. */
  reason?: string;
}

export interface SeatHandle {
  readonly spec: SeatSpec;
}

export interface SeatProvider {
  connect(spec: SeatSpec): Promise<SeatHandle>;
  observe(handle: SeatHandle): Promise<Observation>;
  submit(handle: SeatHandle, action: Action): Promise<Receipt>;
}
