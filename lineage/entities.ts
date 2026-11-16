// Nexus Isles — the five entities (AA12), derived from the journal.
//
//   Resident     one individual AI identity: one seat, one agency, one mortality
//   Family       a resident and its successors
//   Lineage      all descendants of one founding genome
//   Dynasty      a lineage that has survived >= 1 executed succession
//   Civilization the persistent record that outlives every individual and dynasty
//
// Everything here is a pure derivation from journal entries. Lineage
// membership is read from the journaled birth record (WORLD_GENESIS founders,
// RESIDENT_BORN.lineage) and from nowhere else: no function in this module
// walks genome parentage to decide membership. That is the blend rule made
// structural — a blended child FOUNDS A NEW LINEAGE (dual ancestry recorded)
// and so counts toward NEITHER parent for population, extinction, or scoring.
//
// Interpretations made here, flagged for the owner (the constitution's
// definitions are one line each):
//  - Dynasty: needs a SUCCESSION_EXECUTED whose deceased AND successor are
//    both members of the lineage (the line continued through it).
//  - Family: the head plus residents reached by executed successions,
//    transitively. Offspring are lineage members, not automatically family.
//  - Heir (successor continuity): a non-founder member of the lineage.

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

export interface SuccessionRecord {
  tick: number;
  deceased: string;
  successor: string;
  journalIndex: number;
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
  successions: SuccessionRecord[];
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
    } else if (e.type === "SUCCESSION_EXECUTED") {
      successions.push({
        tick: e.tick,
        deceased: p.deceased as string,
        successor: p.successor as string,
        journalIndex: e.index,
      });
    }
  }

  const dynasties = Object.values(lineages)
    .filter((l) =>
      successions.some(
        (s) => residents[s.deceased]?.lineage === l.id && residents[s.successor]?.lineage === l.id,
      ),
    )
    .map((l) => l.id)
    .sort();

  const succeeded = new Set(successions.map((s) => s.successor));
  const families: FamilyRecord[] = Object.keys(residents)
    .filter((id) => !succeeded.has(id))
    .sort()
    .map((head) => {
      const members = [head];
      for (let i = 0; i < members.length; i++) {
        for (const s of successions) {
          if (s.deceased === members[i] && !members.includes(s.successor)) members.push(s.successor);
        }
      }
      return { head, members };
    });

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

  return { residents, lineages, families, dynasties, successions, civilization };
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

/**
 * Successor-continuity input (AA1 c / Annex B): heirs of the lineage alive
 * at the scoring tick with >= minTicks of continuous own-agency survival.
 */
export function continuityHeirs(e: Entities, lineage: string, scoringTick: number, minTicks = 10): string[] {
  const l = e.lineages[lineage];
  if (!l) throw new Error(`unknown lineage ${lineage}`);
  return lineagePopulation(e, lineage, scoringTick).filter(
    (m) => m !== l.founder && scoringTick - e.residents[m].bornTick >= minTicks,
  );
}
