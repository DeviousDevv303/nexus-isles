// Nexus Isles — the five entities (AA12), derived from the journal.
//
//   Resident     one individual AI identity: one seat, one agency, one mortality
//   Family       a resident and its successors
//   Lineage      the residents assigned to a line by its founding record or by
//                their journaled birth record; ancestry is recorded separately
//   Dynasty      a lineage that has survived >= 1 executed succession
//   Civilization the persistent record that outlives every individual and dynasty
//
// Everything here is a pure derivation from journal entries. Lineage
// membership is read from the journaled record (WORLD_GENESIS founders,
// RESIDENT_BORN.lineage) and from nowhere else: no function in this module
// walks genome parentage to decide membership. That is the blend rule made
// structural — a blended child FOUNDS A NEW LINEAGE (dual ancestry recorded)
// and so counts toward NEITHER parent for population, extinction, or scoring.
// (The constitution's shorthand "all descendants of one founding genome" is
// true of fork lines only; a blended child descends from two founding
// genomes and belongs to neither line.)
//
// Succession records are VALIDATED here before they count for anything. A
// SUCCESSION_EXECUTED entry is accepted only if, from the journal alone:
// both parties are known residents and distinct; the deceased has a DEATH
// at the same tick, journaled before it; the successor is alive at that
// point; no succession was already accepted for that deceased; AND the
// record names the instrument that the deceased had authorized while alive
// (a journaled SUCCESSION_AUTHORIZED, not revoked, naming this successor).
// A correctly shaped record with no such instrument is rejected. Anything
// else lands in `rejectedSuccessions` with a reason and creates no dynasty
// and no family link. The world core's reducer enforces the same conditions
// plus execution-time ones (expiry, estate); this derivation does not rely
// on that and re-checks from the journal.
//
// PROVISIONAL readings (registry: t2-readings), pending the owner (the constitution's definitions
// are one line each):
//  - Dynasty: an accepted succession whose deceased AND successor are both
//    members of the lineage (the line continued through it).
//  - Family: every resident belongs to exactly one family. A resident heads
//    their own family until an accepted succession names them successor;
//    the FIRST such succession moves them into the deceased's family, and
//    later successions naming the same successor never move them again.
//  - Successor continuity: two named readings at the bottom of this file
//    ("succession-v0" and "birth-age-v0"). The 10-tick number is
//    constitutional text (AA1 c, Annex B 4); how it is applied is not.

import { createHash } from "node:crypto";
import { canonicalStringify, type JournalEntry } from "../ledger/journal.js";

export interface ResidentRecord {
  id: string;
  lineage: string;
  parents: string[];
  mode: "genesis" | "fork" | "blend";
  bornTick: number;
  diedTick: number | null;
  genomeHash: string | null;
}

export interface LineageRecord {
  id: string;
  founder: string;
  foundingGenomeHash: string | null;
  foundedTick: number;
  /** Parent lineages, as record only. Two entries for a blend-founded line. */
  ancestry: string[];
  members: string[];
  extinctTick: number | null;
}

export interface FamilyRecord {
  head: string;
  members: string[];
}

export interface RejectedSuccession {
  journalIndex: number;
  reason:
    | "malformed"
    | "unknown_resident"
    | "self_succession"
    | "deceased_not_dead_at_tick"
    | "successor_not_alive"
    | "duplicate_for_deceased"
    | "no_matching_instrument";
}

/** AA1 (c) / Annex B 4: own-agency survival ticks before a successor counts. */
export const CONTINUITY_MIN_TICKS = 10;

export interface SuccessionRecord {
  tick: number;
  deceased: string;
  successor: string;
  journalIndex: number;
  /** The authorized instrument this execution corresponds to. */
  instrumentId: string;
}

export interface CivilizationRecord {
  lineagesFounded: number;
  activeLineages: string[];
  /** The archive: read-only tombstones of extinct lineages. */
  archive: { lineage: string; founder: string; extinctTick: number; members: string[] }[];
  residentsEver: number;
  deaths: number;
}

export interface Entities {
  residents: Record<string, ResidentRecord>;
  lineages: Record<string, LineageRecord>;
  families: FamilyRecord[];
  /** Lineage ids with dynasty status — derived from succession events, never a flag. */
  dynasties: string[];
  /** Accepted (structurally valid) successions only. */
  successions: SuccessionRecord[];
  rejectedSuccessions: RejectedSuccession[];
  /** resident -> head of the one family they belong to. */
  familyOf: Record<string, string>;
  civilization: CivilizationRecord;
}

export function genomeHash(genome: unknown): string | null {
  if (genome === null || genome === undefined) return null;
  return createHash("sha256").update(canonicalStringify(genome), "utf8").digest("hex");
}

export function deriveEntities(entries: readonly JournalEntry[]): Entities {
  const residents: Record<string, ResidentRecord> = {};
  const lineages: Record<string, LineageRecord> = {};
  const successions: SuccessionRecord[] = [];
  const rejectedSuccessions: RejectedSuccession[] = [];
  const familyOf: Record<string, string> = {};
  const movedBySuccession = new Set<string>();
  /** founder -> the instrument they have in force, from the journal alone. */
  const inForce = new Map<string, { id: string; successorId: string }>();

  const found = (id: string, founder: string, hash: string | null, tick: number, ancestry: string[]) => {
    if (lineages[id]) throw new Error(`lineage ${id} founded twice`);
    lineages[id] = { id, founder, foundingGenomeHash: hash, foundedTick: tick, ancestry, members: [], extinctTick: null };
  };

  for (const e of entries) {
    const p = e.payload;
    if (e.type === "WORLD_GENESIS") {
      const config = p.config as { residents: { id: string; genome?: unknown }[] };
      for (const r of config.residents) {
        const lineage = `lineage:${r.id}`;
        const hash = genomeHash(r.genome);
        found(lineage, r.id, hash, e.tick, []);
        residents[r.id] = { id: r.id, lineage, parents: [], mode: "genesis", bornTick: e.tick, diedTick: null, genomeHash: hash };
        lineages[lineage].members.push(r.id);
      }
    } else if (e.type === "RESIDENT_BORN") {
      const id = p.resident as string;
      const lineage = p.lineage as string;
      const mode = p.mode as "fork" | "blend";
      const hash = genomeHash(p.genome);
      if (!lineages[lineage]) {
        if (mode !== "blend") throw new Error(`fork child ${id} names unknown lineage ${lineage}`);
        found(lineage, id, hash, e.tick, [...(p.ancestry as string[])]);
      }
      residents[id] = { id, lineage, parents: [...(p.parents as string[])], mode, bornTick: e.tick, diedTick: null, genomeHash: hash };
      lineages[lineage].members.push(id);
    } else if (e.type === "DEATH") {
      const id = p.resident as string;
      const r = residents[id];
      if (!r) continue; // journal-level fixtures without a genesis roster
      r.diedTick = e.tick;
      const line = lineages[r.lineage];
      if (line.members.every((m) => residents[m].diedTick !== null)) line.extinctTick = e.tick;
    } else if (e.type === "SUCCESSION_AUTHORIZED") {
      const inst = p.instrument as { id?: unknown; founderId?: unknown; successorId?: unknown } | undefined;
      const founder = inst?.founderId;
      // Only a living, known founder can have authorized anything.
      if (
        typeof inst?.id === "string" && typeof founder === "string" && typeof inst.successorId === "string" &&
        residents[founder] && residents[founder].diedTick === null
      ) {
        inForce.set(founder, { id: inst.id, successorId: inst.successorId });
      }
    } else if (e.type === "SUCCESSION_REVOKED") {
      const r = p.resident;
      if (typeof r === "string" && inForce.get(r)?.id === p.instrumentId) inForce.delete(r);
    } else if (e.type === "SUCCESSION_FAILED") {
      if (typeof p.deceased === "string") inForce.delete(p.deceased); // spent
    } else if (e.type === "SUCCESSION_EXECUTED") {
      const reject = (reason: RejectedSuccession["reason"]) =>
        rejectedSuccessions.push({ journalIndex: e.index, reason });
      const deceased = p.deceased;
      const successor = p.successor;
      if (typeof deceased !== "string" || typeof successor !== "string") {
        reject("malformed");
      } else if (!residents[deceased] || !residents[successor]) {
        reject("unknown_resident");
      } else if (deceased === successor) {
        reject("self_succession");
      } else if (residents[deceased].diedTick !== e.tick) {
        reject("deceased_not_dead_at_tick");
      } else if (residents[successor].diedTick !== null) {
        reject("successor_not_alive");
      } else if (successions.some((s) => s.deceased === deceased)) {
        reject("duplicate_for_deceased");
      } else if (
        // Correct shape is not enough: the record must correspond to the
        // instrument this resident had in force, naming this successor.
        typeof p.instrumentId !== "string" ||
        inForce.get(deceased)?.id !== p.instrumentId ||
        inForce.get(deceased)?.successorId !== successor
      ) {
        reject("no_matching_instrument");
      } else {
        inForce.delete(deceased); // an instrument executes at most once
        successions.push({ tick: e.tick, deceased, successor, journalIndex: e.index, instrumentId: p.instrumentId });
        if (!movedBySuccession.has(successor)) {
          movedBySuccession.add(successor);
          // The successor and anyone already in the family they headed move
          // together, so the partition stays a partition.
          const from = familyOf[successor];
          const to = familyOf[deceased];
          for (const id of Object.keys(familyOf)) if (familyOf[id] === from) familyOf[id] = to;
        }
      }
    }
    for (const id of Object.keys(residents)) familyOf[id] ??= id;
  }

  const dynasties = Object.values(lineages)
    .filter((l) =>
      successions.some(
        (s) => residents[s.deceased]?.lineage === l.id && residents[s.successor]?.lineage === l.id,
      ),
    )
    .map((l) => l.id)
    .sort();

  const byHead = new Map<string, string[]>();
  for (const id of Object.keys(residents)) {
    const head = familyOf[id];
    byHead.set(head, [...(byHead.get(head) ?? []), id]);
  }
  const families: FamilyRecord[] = [...byHead.keys()]
    .sort()
    .map((head) => ({ head, members: [head, ...byHead.get(head)!.filter((m) => m !== head)] }));

  const all = Object.values(lineages);
  const civilization: CivilizationRecord = {
    lineagesFounded: all.length,
    activeLineages: all.filter((l) => l.extinctTick === null).map((l) => l.id).sort(),
    archive: all
      .filter((l) => l.extinctTick !== null)
      .map((l) => ({ lineage: l.id, founder: l.founder, extinctTick: l.extinctTick as number, members: [...l.members] })),
    residentsEver: Object.keys(residents).length,
    deaths: Object.values(residents).filter((r) => r.diedTick !== null).length,
  };

  return { residents, lineages, families, dynasties, successions, rejectedSuccessions, familyOf, civilization };
}

// ---- the three walks the blend rule governs --------------------------------

/** Living members of a lineage as of `tick` (inclusive). */
export function lineagePopulation(e: Entities, lineage: string, tick: number): string[] {
  const l = e.lineages[lineage];
  if (!l) throw new Error(`unknown lineage ${lineage}`);
  return l.members.filter((m) => {
    const r = e.residents[m];
    return r.bornTick <= tick && (r.diedTick === null || r.diedTick > tick);
  });
}

export function isExtinct(e: Entities, lineage: string): boolean {
  const l = e.lineages[lineage];
  if (!l) throw new Error(`unknown lineage ${lineage}`);
  return l.extinctTick !== null;
}

// ---- successor continuity: two readings, both PROVISIONAL -------------------
//
// AA1 (c): "a successor counts toward continuity only if it has survived at
// least 10 ticks on its own agency as of the scoring tick". The 10 is the
// constitution's. WHO is a "successor" and WHEN the 10 ticks start are not
// spelled out, and the two readings below give different answers. Neither
// is law until the owner rules; dynasty-score must name which one it used.

export type ContinuityReading = "succession-v0" | "birth-age-v0";

/**
 * Reading "succession-v0" (Muse / ChatGPT audit): a successor is a resident
 * named in an ACCEPTED executed succession whose deceased and successor are
 * both in this lineage; it counts once it has survived >= minTicks SINCE
 * THAT SUCCESSION and is alive at the scoring tick.
 */
export function continuitySuccessors(
  e: Entities,
  lineage: string,
  scoringTick: number,
  minTicks = CONTINUITY_MIN_TICKS,
): string[] {
  if (!e.lineages[lineage]) throw new Error(`unknown lineage ${lineage}`);
  const alive = new Set(lineagePopulation(e, lineage, scoringTick));
  const out = new Set<string>();
  for (const s of e.successions) {
    if (
      e.residents[s.deceased].lineage === lineage &&
      alive.has(s.successor) &&
      s.tick <= scoringTick &&
      scoringTick - s.tick >= minTicks
    ) {
      out.add(s.successor);
    }
  }
  return [...out].sort();
}

/**
 * Reading "birth-age-v0" (this build's first cut): any non-founder member
 * of the lineage alive at the scoring tick, >= minTicks SINCE BIRTH. This
 * repurposes the 10-tick rule as an age test; kept only so the difference
 * is visible and testable.
 */
export function continuityMembersByBirthAge(
  e: Entities,
  lineage: string,
  scoringTick: number,
  minTicks = CONTINUITY_MIN_TICKS,
): string[] {
  const l = e.lineages[lineage];
  if (!l) throw new Error(`unknown lineage ${lineage}`);
  return lineagePopulation(e, lineage, scoringTick).filter(
    (m) => m !== l.founder && scoringTick - e.residents[m].bornTick >= minTicks,
  );
}
