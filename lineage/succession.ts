// Nexus Isles — Lineage: succession instruments (build order step 4).
//
// Succession is ONE procedure (AA4 as reconciled in v0.5/v0.6):
//  1. A LIVING resident prepares and authorizes an instrument naming the
//     successor and the eligible transfers.
//  2. The engine validates it at authorization (legitimacy when created).
//  3. On the founder's death the engine EXECUTES it — machinery acting on
//     authority granted while the founder lived. The dead exercise no
//     agency, so the dead-hand rule stays intact.
//  4. Execution re-validates EVERY transfer against death-tick state
//     (GPT's execution-time validation): a transfer of something the
//     founder no longer owns fails closed, is journaled as failed, and
//     falls to contested salvage. Unauthorized assets are never granted.
//  5. No valid instrument -> default death-allocation: contested salvage.
//
// Inheritance transfers continuity, never identity: the successor is a new
// resident with its own identity and mortality; it can never be the
// founder (AT-08: no return through succession). Alliances and third-party
// obligations never transfer — they are not a transferable kind here at all.

export type TransferKind =
  | "command-authority"
  | "asset"
  | "infrastructure"
  | "standing-order"
  | "knowledge";

export interface Transfer {
  kind: TransferKind;
  /** Identifier of the thing transferred (asset id, order id, knowledge ref). */
  ref: string;
}

export interface SuccessionInstrument {
  id: string;
  founderId: string;
  successorId: string;
  transfers: Transfer[];
  authorizedTick: number;
  /** Optional expiry (in world ticks); null = no expiry. */
  expiresTick: number | null;
  revoked: boolean;
}

export interface SuccessionContext {
  currentTick: number;
  /** Residents currently alive. */
  aliveResidents: ReadonlySet<string>;
  /** ref -> current owner resident id, for asset/infrastructure transfers. */
  ownership: ReadonlyMap<string, string>;
  /** Standing orders by ref: their owner and whether still in force. */
  standingOrders: ReadonlyMap<string, { ownerId: string; inForce: boolean }>;
  /** Knowledge refs the founder may bequeath (public/bequeathed only). */
  bequeathableKnowledge: ReadonlySet<string>;
  /** Whether this founder holds command authority that can be transferred. */
  commandHolders: ReadonlySet<string>;
}

function checkTransfer(
  transfer: Transfer,
  founderId: string,
  ctx: SuccessionContext,
): string | null {
  switch (transfer.kind) {
    case "asset":
    case "infrastructure": {
      const owner = ctx.ownership.get(transfer.ref);
      if (owner === undefined) return `unknown ${transfer.kind} ref ${transfer.ref}`;
      if (owner !== founderId) return `${transfer.kind} ${transfer.ref} not owned by founder`;
      return null;
    }
    case "standing-order": {
      const order = ctx.standingOrders.get(transfer.ref);
      if (!order) return `unknown standing order ${transfer.ref}`;
      if (order.ownerId !== founderId) return `standing order ${transfer.ref} not the founder's`;
      if (!order.inForce) return `standing order ${transfer.ref} no longer in force`;
      return null;
    }
    case "knowledge": {
      if (!ctx.bequeathableKnowledge.has(transfer.ref)) {
        return `knowledge ${transfer.ref} is not bequeathable (private memory never transfers)`;
      }
      return null;
    }
    case "command-authority": {
      if (!ctx.commandHolders.has(founderId)) return "founder holds no command authority";
      return null;
    }
  }
}

/**
 * Stage 1 — authorization-time validation. Establishes the instrument was
 * legitimate when created. Returns issue strings; empty = valid.
 */
export function validateAuthorization(
  instrument: SuccessionInstrument,
  ctx: SuccessionContext,
): string[] {
  const issues: string[] = [];
  if (instrument.revoked) issues.push("instrument is revoked");
  if (!ctx.aliveResidents.has(instrument.founderId)) {
    issues.push("founder is not alive — the dead cannot authorize");
  }
  if (!ctx.aliveResidents.has(instrument.successorId)) {
    issues.push("successor is not alive");
  }
  if (instrument.successorId === instrument.founderId) {
    issues.push("successor cannot be the founder — succession is not resurrection");
  }
  if (instrument.expiresTick !== null && instrument.expiresTick <= ctx.currentTick) {
    issues.push("instrument already expired");
  }
  for (const transfer of instrument.transfers) {
    const issue = checkTransfer(transfer, instrument.founderId, ctx);
    if (issue) issues.push(issue);
  }
  return issues;
}

/**
 * Revoke an instrument. Only the living founder may revoke their own;
 * revocation is itself a journaled act in the engine (here: pure check).
 */
export function revokeInstrument(
  instrument: SuccessionInstrument,
  byResidentId: string,
  ctx: SuccessionContext,
): SuccessionInstrument {
  if (byResidentId !== instrument.founderId) {
    throw new Error("only the founder may revoke their instrument");
  }
  if (!ctx.aliveResidents.has(instrument.founderId)) {
    throw new Error("the dead cannot revoke — agency dies with the resident");
  }
  return { ...instrument, revoked: true };
}

export interface ExecutedTransfer {
  transfer: Transfer;
  to: string;
}

export interface FailedTransfer {
  transfer: Transfer;
  reason: string;
}

export interface SuccessionOutcome {
  executed: ExecutedTransfer[];
  failed: FailedTransfer[];
  /** Refs falling to contested salvage (every failed transfer's ref). */
  salvage: string[];
}

/**
 * Stage 2 — execution at the founder's death. Each transfer is re-checked
 * against death-tick state and fails closed, individually. If the
 * successor is dead, nothing executes — everything salvages. If the
 * instrument was revoked or has expired, nothing executes.
 */
export function executeSuccession(
  instrument: SuccessionInstrument,
  ctx: SuccessionContext,
): SuccessionOutcome {
  const executed: ExecutedTransfer[] = [];
  const failed: FailedTransfer[] = [];
  const failAll = (reason: string): SuccessionOutcome => ({
    executed: [],
    failed: instrument.transfers.map((transfer) => ({ transfer, reason })),
    salvage: instrument.transfers.map((t) => t.ref),
  });

  if (instrument.revoked) return failAll("instrument revoked before death");
  if (instrument.expiresTick !== null && instrument.expiresTick <= ctx.currentTick) {
    return failAll("instrument expired before death");
  }
  if (!ctx.aliveResidents.has(instrument.successorId)) {
    return failAll("successor is dead — no one to inherit");
  }
  if (instrument.successorId === instrument.founderId) {
    return failAll("successor is the founder — succession is not resurrection");
  }

  for (const transfer of instrument.transfers) {
    const issue = checkTransfer(transfer, instrument.founderId, ctx);
    if (issue) {
      failed.push({ transfer, reason: issue });
    } else {
      executed.push({ transfer, to: instrument.successorId });
    }
  }
  return { executed, failed, salvage: failed.map((f) => f.transfer.ref) };
}
