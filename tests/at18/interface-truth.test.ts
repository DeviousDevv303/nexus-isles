// AT-18 Interface truth — the six adopted fixtures (owner ruling 6937295727,
// item 4), audited and filled in by Claude's lane (queue item 7, 6950678244).
//
// Mapping used, stated plainly: #235 records "GPT's five-fixture expansion"
// without listing it; the five parts written into the constitution's own
// AT-18 (v0.6.7, Table 2) are used as the five, plus Kimi's sixth
// (cross-machine, cross-time byte-identical emission). Muse to confirm.
//
//   (i)   unjournaled territory never appears controlled
//   (ii)  unverified threats never confirmed      -> NOT-YET-DEMONSTRATED (README)
//   (iii) dead residents never operational
//   (iv)  units/resources match authoritative state
//   (v)   journal replay reproduces displayed state
//   (vi)  cross-machine, cross-time byte-identical emission

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalStringify, Journal, type JournalEntry } from "../../ledger/journal.js";
import { reduce, type WorldState } from "../../engine/world/state.js";
import { juarezConfig } from "../../engine/world/maps/juarez.js";
import type { ResidentConfig } from "../../engine/world/state.js";
import { World } from "../../engine/world/world.js";
import { deriveReport } from "../../observer/report.js";
import { deriveDynastyScore } from "../../observer/dynastyScore.js";
import { TEST_BACKEND, baseConfig, drive, rebuildJournal, tempDir } from "../helpers/worldFixtures.js";

const res = (id: string, position: string, o: Partial<ResidentConfig> = {}): ResidentConfig => ({
  id, position, satiety: 9, maxSatiety: 10, actionsPerTick: 2, backend: TEST_BACKEND, ...o,
});

/** Everything the observer layer displays for a world, in one canonical string. */
function emission(w: World): string {
  const j = rebuildJournal(w);
  const seats = Object.keys(w.state.residents).sort();
  return canonicalStringify({
    report: deriveReport(j),
    score: deriveDynastyScore(j, "fixture-epoch"),
    observations: Object.fromEntries(seats.map((s) => [s, w.observe(s)])),
  });
}
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** The protocol world for (vi): fixed seed, fixed config, fixed script. */
function protocolWorld(): World {
  const w = World.create(424242, baseConfig());
  drive(w, 20);
  return w;
}

describe("AT-18 (i) unjournaled territory never appears controlled", () => {
  it("territory is MISSING in every score, and nothing displayed carries a control claim", () => {
    const w = World.create(1, juarezConfig([res("a", "centro"), res("b", "zaragoza")]));
    drive(w, 5, ["a", "b"]);
    const j = rebuildJournal(w);
    const score = deriveDynastyScore(j, "e");
    const lineages = score.scores as unknown as { axes: Record<string, { status: string }> }[];
    expect(lineages.length).toBe(2);
    for (const s of lineages) expect(s.axes.territoryYears.status).toBe("missing");
    // No displayed field asserts control or territory. (T8's Charter profile
    // mentions the owner's character on the Throne: presentation, not control.)
    const shown = JSON.stringify({ report: deriveReport(j), observations: ["a", "b"].map((s) => w.observe(s)) });
    expect(shown).not.toMatch(/"(control\w*|controller|controlledBy|territor\w*|holds|owns)"\s*:/i);
    // and no control fact exists in the journal for anything to display
    expect(w.entries().some((e) => /CONTROL/.test(e.type))).toBe(false);
  });
});

describe("AT-18 (iii) dead residents never operational", () => {
  it("after death: no observation, never present to others, actions rejected not accepted, reported dead", () => {
    const w = World.create(2, juarezConfig([res("watcher", "centro"), res("doomed", "centro", { satiety: 1 })]));
    w.tick(); // doomed starves
    expect(w.state.residents.doomed.alive).toBe(false);
    for (let t = 0; t < 3; t++) {
      w.submit("doomed", { verb: "wait", args: {} });
      w.tick();
    }
    expect(w.observe("doomed")).toBeNull();
    expect((w.observe("watcher")!.visible as { regions: Record<string, { residents: string[] }> }).regions.centro.residents).toEqual([]);
    const r = deriveReport(rebuildJournal(w));
    expect(r.deaths).toEqual(["doomed"]);
    expect(r.actionsByActor.doomed ?? 0).toBe(0);
    expect(r.rejectedByActor.doomed).toBe(3);
  });
});

describe("AT-18 (iv) displayed units/resources match authoritative state", () => {
  it("every delivered observation equals the replayed state at the moment it was delivered", () => {
    const w = World.create(3, juarezConfig([res("a", "centro", { intel: 2 }), res("b", "industrial-east"), res("c", "ysleta")]));
    for (let t = 0; t < 8; t++) {
      w.submit("a", { verb: "gather", args: { node: "mercado-centro", amount: 2 } });
      w.submit("b", { verb: "move", args: { to: t % 2 ? "industrial-east" : "pronaf" } });
      w.tick();
    }
    let state: WorldState | null = null;
    let checked = 0;
    for (const e of w.entries() as readonly JournalEntry[]) {
      if (e.type === "OBSERVATION_DELIVERED") {
        const s = state as WorldState;
        const v = e.payload.visible as { satiety: number; inventory: number; position: string; regions: Record<string, { residents: string[]; nodes: Record<string, number> }> };
        const me = s.residents[e.payload.seat as string];
        expect([v.satiety, v.inventory, v.position]).toEqual([me.satiety, me.inventory, me.position]);
        for (const [reg, info] of Object.entries(v.regions)) {
          for (const [node, amount] of Object.entries(info.nodes)) expect(amount).toBe(s.nodes[node].amount);
          const present = Object.keys(s.residents).filter((o) => o !== e.payload.seat && s.residents[o].alive && s.residents[o].position === reg).sort();
          expect(info.residents).toEqual(present);
        }
        checked++;
      }
      state = reduce(state, e);
    }
    expect(checked).toBe(3 * 8);
  });

  it("the report's counts equal the journal's own counts", () => {
    const w = protocolWorld();
    const r = deriveReport(rebuildJournal(w));
    const e = w.entries();
    expect(r.totalEntries).toBe(e.length);
    expect(Object.values(r.actionsByActor).reduce((a, b) => a + b, 0)).toBe(e.filter((x) => x.type === "ACTION_ACCEPTED").length);
    expect(Object.values(r.rejectedByActor).reduce((a, b) => a + b, 0)).toBe(e.filter((x) => x.type === "ACTION_REJECTED").length);
  });
});

describe("AT-18 (v) journal replay reproduces displayed state", () => {
  it("restart from the persisted file displays byte-for-byte what the live world displayed", () => {
    const path = join(tempDir(), "w.jsonl");
    const live = World.create(424242, baseConfig(), { persistPath: path });
    drive(live, 20);
    const restored = World.restoreFromFile(path);
    expect(emission(restored)).toBe(emission(live));
    expect(emission(World.restore(Journal.loadFromFile(path)))).toBe(emission(live));
  });
});

describe("AT-18 (vi) cross-machine, cross-time byte-identical emission (Kimi's sixth)", () => {
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.TZ;
  });

  // The golden hash is the cross-machine half: CI runs on a different
  // machine, and every future run is a different time; both must reproduce
  // this exact value. If a deliberate change alters the emission, this
  // constant changes in the same PR, visibly.
  const GOLDEN = "47b3cadeea4ad2f712d8c5231718f0917949440d686f34aed43e83e274b81d72";

  it("the protocol world's emission matches the committed golden hash", () => {
    expect(sha(emission(protocolWorld()))).toBe(GOLDEN);
  });

  it("wall-clock time and timezone do not change a single byte", () => {
    const base = emission(protocolWorld());
    for (const [iso, tz] of [["1999-12-31T23:59:59Z", "Pacific/Kiritimati"], ["2031-06-15T12:00:00Z", "America/Ciudad_Juarez"], ["2026-11-17T03:00:00Z", "UTC"]]) {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(iso));
      process.env.TZ = tz;
      expect(emission(protocolWorld())).toBe(base);
      vi.useRealTimers();
    }
  });

  it("no engine, ledger, lineage, seat, console or observer code reads the clock, the locale, or ambient randomness", () => {
    const ROOT = join(import.meta.dirname, "..", "..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts")) {
          readFileSync(p, "utf8").split("\n").forEach((line, i) => {
            const code = line.replace(/\/\/.*$/, "");
            if (/\b(Date\.now|new Date|performance\.now|process\.hrtime|Math\.random|toLocale\w*|Intl\.)/.test(code)) offenders.push(`${p}:${i + 1}`);
          });
        }
      }
    };
    for (const d of ["engine", "ledger", "lineage", "seats", "console", "observer", "residents"]) walk(join(ROOT, d));
    expect(offenders).toEqual([]);
  });
});
