// Owner ruling 2026-11-17 (#235, 6937254884, item 3): refused owner-console
// submissions are journaled as OWNER_SUBMISSION_REJECTED — an occurrence
// record with reason and provenance, no world effect, no historical
// rewriting, never mistakable for an accepted intervention.

import { describe, expect, it } from "vitest";
import { ConsoleRejection, type ConsoleSubmission } from "../../console/console.js";
import { deriveReport } from "../../observer/report.js";
import { World } from "../../engine/world/world.js";
import { baseConfig, drive, rebuildJournal } from "../helpers/worldFixtures.js";

const sub = (affectsTick: number, o: Partial<ConsoleSubmission> = {}): ConsoleSubmission => ({
  consoleClass: "C1", intent: "raise blight", diff: "rules.blightPercent: 25 -> 30",
  verbatim: "make blight a bit worse", confirmed: true, affectsTick, ...o,
});
const of = (w: World, type: string) => w.entries().filter((e) => e.type === type);

function world(): World {
  const w = World.create(1, baseConfig());
  drive(w, 3);
  return w;
}

describe("OWNER_SUBMISSION_REJECTED", () => {
  it("the operator is still refused immediately, with a machine-readable code", () => {
    const w = world();
    try {
      w.submitConsoleEvent(sub(2));
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConsoleRejection);
      expect((err as ConsoleRejection).code).toBe("tick_already_resolved");
    }
  });

  it("every refusal kind is journaled at the next tick boundary, with reason and the submission as given", () => {
    const w = world();
    const attempts: [Partial<ConsoleSubmission>, string][] = [
      [{ affectsTick: 2 }, "tick_already_resolved"],
      [{ confirmed: false }, "unconfirmed_draft"],
      [{ intent: "rollback tick 2" }, "rollback_forbidden"],
      [{ consoleClass: "C3" }, "c3_double_confirm_required"],
      [{ consoleClass: "C3", doubleConfirmed: true }, "c3_reason_required"],
      [{ consoleClass: "C0" }, "query_not_intervention"],
    ];
    for (const [o] of attempts) expect(() => w.submitConsoleEvent(sub(4, o))).toThrow(ConsoleRejection);
    expect(of(w, "OWNER_SUBMISSION_REJECTED")).toHaveLength(0); // not until the boundary
    drive(w, 1);
    const rej = of(w, "OWNER_SUBMISSION_REJECTED");
    expect(rej.map((e) => e.payload.code)).toEqual(attempts.map(([, c]) => c));
    for (const e of rej) {
      expect(e).toMatchObject({ tick: 4, actor: "owner-console" });
      expect(e.payload).toMatchObject({ status: "rejected", submittedAtTick: 3 });
      expect(typeof e.payload.reason).toBe("string");
      expect((e.payload.submission as { verbatim: string }).verbatim).toBe("make blight a bit worse");
    }
    const start = w.entries().findIndex((e) => e.type === "TICK_START" && e.tick === 4);
    expect(rej[0].index).toBe(start + 1);
  });

  it("no world effect: the state is identical to a world where nothing was submitted", () => {
    const a = world();
    const b = world();
    expect(() => a.submitConsoleEvent(sub(1))).toThrow();
    drive(a, 2);
    drive(b, 2);
    expect(a.state).toEqual(b.state);
  });

  it("never mistakable for an intervention: distinct type, not counted as an external event", () => {
    const w = world();
    expect(() => w.submitConsoleEvent(sub(1))).toThrow();
    w.submitConsoleEvent(sub(4));
    drive(w, 1);
    expect(of(w, "EXTERNAL_EVENT")).toHaveLength(1);
    expect(of(w, "OWNER_SUBMISSION_REJECTED")).toHaveLength(1);
    const r = deriveReport(rebuildJournal(w));
    expect(r.externalEvents).toBe(1);
    expect(r.rejectedConsoleSubmissions).toBe(1);
  });

  it("no historical rewriting: everything before the record is byte-identical", () => {
    const w = world();
    const before = w.entries().map((e) => e.hash);
    expect(() => w.submitConsoleEvent(sub(0, { intent: "undo tick 1" }))).toThrow();
    drive(w, 1);
    expect(w.entries().slice(0, before.length).map((e) => e.hash)).toEqual(before);
    expect(World.restore(rebuildJournal(w)).state).toEqual(w.state);
  });

  it("a forged rejection record outside its boundary is refused on restore", () => {
    const w = world();
    const j = rebuildJournal(w);
    j.append({ tick: 3, type: "OWNER_SUBMISSION_REJECTED", actor: "owner-console", payload: { status: "rejected", code: "x", submittedAtTick: 0 } });
    j.append({ tick: 3, type: "TICK_COMMIT", actor: "engine", payload: {} });
    expect(() => World.restore(j)).toThrow(/OWNER_SUBMISSION_REJECTED invariant violated/);
  });

  it("a non-serialisable submission is still recorded (as null), never crashes the world", () => {
    const w = world();
    const cyclic = sub(1) as ConsoleSubmission & { self?: unknown };
    cyclic.self = cyclic;
    expect(() => w.submitConsoleEvent(cyclic)).toThrow(ConsoleRejection);
    drive(w, 1);
    expect(of(w, "OWNER_SUBMISSION_REJECTED")[0].payload.submission).toBeNull();
  });
});
