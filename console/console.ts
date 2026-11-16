// Nexus Isles — Owner Console: the EXTERNAL_EVENT pipeline (step 5).
//
// The console is the owner's only intervention hand (AA9). Its law:
// natural-language input is parsed to an intent, the intent + diff are
// shown, the owner confirms, and the intervention is journaled VERBATIM
// as an EXTERNAL_EVENT before the tick it affects resolves. Corrections
// are separate visible events; the original record always remains.
// There is no rollback — the console's classes are:
//   C0 query (read-only; never journaled as an intervention)
//   C1 world-law adjustment
//   C2 physics adjustment
//   C3 seat operations — double-confirm + typed reason, enforced here
//   C4 pause / extend — never rollback
// Effects land only at tick boundaries: an event may only target a tick
// that has not yet resolved.

import { Journal } from "../ledger/journal.js";

export type ConsoleClass = "C0" | "C1" | "C2" | "C3" | "C4";

export interface ConsoleSubmission {
  consoleClass: ConsoleClass;
  /** The parsed intent, as shown to the owner before confirmation. */
  intent: string;
  /** The diff of effects, as shown to the owner before confirmation. */
  diff: string;
  /** The owner's original words, journaled verbatim. */
  verbatim: string;
  /** The owner confirmed the shown intent + diff. */
  confirmed: boolean;
  /** C3 only: the second confirmation. */
  doubleConfirmed?: boolean;
  /** C3 only: the owner's typed reason. */
  reason?: string;
  /** The tick this event affects; must not already be resolved. */
  affectsTick: number;
}

export function submitConsoleEvent(
  journal: Journal,
  submission: ConsoleSubmission,
): number {
  if (submission.consoleClass === "C0") {
    throw new Error("C0 is a query — read-only, never an intervention event");
  }
  if (!submission.confirmed) {
    throw new Error("unconfirmed console input is a draft, not an event");
  }
  if (/rollback|roll back|undo tick/i.test(submission.intent)) {
    throw new Error("the console has no rollback — corrections are new events");
  }
  if (submission.consoleClass === "C3") {
    if (!submission.doubleConfirmed) {
      throw new Error("C3 seat operations require double confirmation");
    }
    if (!submission.reason || submission.reason.trim().length === 0) {
      throw new Error("C3 seat operations require a typed reason");
    }
  }
  const lastResolved = journal
    .entries()
    .filter((e) => e.type === "TICK_RESOLVED")
    .reduce((max, e) => Math.max(max, e.tick), -1);
  if (submission.affectsTick <= lastResolved) {
    throw new Error(
      `tick ${submission.affectsTick} already resolved — console events land before the tick they affect`,
    );
  }
  const entry = journal.append({
    tick: submission.affectsTick,
    actor: "owner-console",
    type: "EXTERNAL_EVENT",
    payload: {
      consoleClass: submission.consoleClass,
      intent: submission.intent,
      diff: submission.diff,
      verbatim: submission.verbatim,
      reason: submission.reason ?? null,
    },
  });
  return entry.index;
}
