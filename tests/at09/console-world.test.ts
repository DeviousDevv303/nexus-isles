// AA9 against a REAL world journal (not the dry-run fixture's vocabulary).
// Regression for the 807c050 bug: the console looked for TICK_RESOLVED and
// the observer for ACTION, which the world core never writes, so a past
// tick looked unresolved and the report showed zero ticks and actions.

import { describe, expect, it } from "vitest";
import { lastResolvedTick, submitConsoleEvent, type ConsoleSubmission } from "../../console/console.js";
import { deriveReport } from "../../observer/report.js";
import { World } from "../../engine/world/world.js";
import { baseConfig, drive, rebuildJournal } from "../helpers/worldFixtures.js";

const sub = (affectsTick: number, o: Partial<ConsoleSubmission> = {}): ConsoleSubmission => ({
  consoleClass: "C1",
  intent: "raise blight",
  diff: "rules.blightPercent: 25 -> 30",
  verbatim: "make blight a bit worse",
  confirmed: true,
  affectsTick,
  ...o,
});
const fiveTicks = () => {
  const w = World.create(1, baseConfig());
  drive(w, 5);
  return w;
};

describe("owner console on a real world journal (AA9)", () => {
  it("a past tick is recognised as resolved — the bare-journal path refuses it", () => {
    const j = rebuildJournal(fiveTicks());
    expect(lastResolvedTick(j.entries())).toBe(5);
    for (const t of [0, 2, 5]) expect(() => submitConsoleEvent(j, sub(t))).toThrow(/already resolved/);
  });

  it("World.submitConsoleEvent refuses past and current ticks, accepts the next one", () => {
    const w = fiveTicks();
    expect(() => w.submitConsoleEvent(sub(2))).toThrow(/already resolved/);
    expect(() => w.submitConsoleEvent(sub(5))).toThrow(/already resolved/);
    expect(() => w.submitConsoleEvent(sub(6))).not.toThrow();
  });

  it("the event is journaled verbatim INSIDE its tick, before anything in that tick resolves", () => {
    const w = fiveTicks();
    w.submitConsoleEvent(sub(6));
    drive(w, 1);
    const e = w.entries();
    const ext = e.filter((x) => x.type === "EXTERNAL_EVENT");
    expect(ext).toHaveLength(1);
    expect(ext[0]).toMatchObject({ tick: 6, actor: "owner-console" });
    expect(ext[0].payload).toMatchObject({ verbatim: "make blight a bit worse", consoleClass: "C1", affectsTick: 6 });
    const start = e.findIndex((x) => x.type === "TICK_START" && x.tick === 6);
    const firstAfter = e.findIndex((x, i) => i > start && x.type !== "EXTERNAL_EVENT");
    expect(ext[0].index).toBe(start + 1); // right after the clock advances
    expect(firstAfter).toBeGreaterThan(ext[0].index);
  });

  it("an event for a later tick waits for that tick", () => {
    const w = fiveTicks();
    w.submitConsoleEvent(sub(8));
    drive(w, 2);
    expect(w.entries().some((x) => x.type === "EXTERNAL_EVENT")).toBe(false);
    drive(w, 1);
    expect(w.entries().filter((x) => x.type === "EXTERNAL_EVENT").map((x) => x.tick)).toEqual([8]);
  });

  it("the journal stays restorable and ends at a commit", () => {
    const w = fiveTicks();
    w.submitConsoleEvent(sub(6));
    drive(w, 2);
    const r = World.restore(rebuildJournal(w));
    expect(r.state).toEqual(w.state);
    expect(w.entries().at(-1)!.type).toBe("TICK_COMMIT");
  });

  it("an EXTERNAL_EVENT forged outside its tick is refused on restore", () => {
    const w = fiveTicks();
    const j = rebuildJournal(w);
    j.append({ tick: 5, type: "EXTERNAL_EVENT", actor: "owner-console", payload: { affectsTick: 2, verbatim: "x" } });
    j.append({ tick: 5, type: "TICK_COMMIT", actor: "engine", payload: {} });
    expect(() => World.restore(j)).toThrow(/EXTERNAL_EVENT invariant violated/);
  });

  it("console laws still hold on the world path (draft, rollback, C3, C0)", () => {
    const w = fiveTicks();
    expect(() => w.submitConsoleEvent(sub(6, { confirmed: false }))).toThrow(/draft/);
    expect(() => w.submitConsoleEvent(sub(6, { intent: "rollback tick 3" }))).toThrow(/no rollback/);
    expect(() => w.submitConsoleEvent(sub(6, { consoleClass: "C3" }))).toThrow(/double confirmation/);
    expect(() => w.submitConsoleEvent(sub(6, { consoleClass: "C0" }))).toThrow(/query/);
  });
});

describe("observer on a real world journal (AT-18)", () => {
  it("counts resolved ticks, accepted and rejected actions, externals, and deaths from world-core entries", () => {
    const c = baseConfig();
    c.residents[3].satiety = 2; // delta starves on tick 2
    const w = World.create(1, c);
    w.submitConsoleEvent(sub(2));
    for (let t = 0; t < 4; t++) {
      w.submit("alpha", { verb: "gather", args: { node: "grove", amount: 1 } });
      w.submit("bravo", { verb: "teleport", args: {} });
      w.tick();
    }
    const r = deriveReport(rebuildJournal(w));
    expect(r.resolvedTicks).toBe(4); // genesis commit at tick 0 is not a resolved tick of play
    expect(r.actionsByActor).toEqual({ alpha: 4 });
    expect(r.rejectedByActor).toEqual({ bravo: 4 });
    expect(r.externalEvents).toBe(1);
    expect(r.deaths).toEqual(["delta"]);
  });
});
