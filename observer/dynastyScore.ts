// Directive T7 (Issue #235): Annex B dynasty-score-v1, projected from a
// verified and replayed journal only. Missing axis weight remains in abeyance;
// every emission reports coverage, observed weighted average, weighted subtotal,
// and missing axes; no cross-coverage ranking is implied.
// keep absent evidence MISSING and exclude proposals, predictions, UI, and
// off-ledger tallies. Territory-years remains owner-RESERVED. Successor
// continuity uses the named succession-v0 reading from validated journal
// records; artifacts and wealth remain MISSING until their evidence schemas
// exist. No score behavior is changed outside this observer.

import { Journal, type JournalEntry } from "../ledger/journal.js";
import { continuitySuccessors } from "../lineage/entities.js";
import { deriveVerifiedEntities } from "../lineage/verifiedEntities.js";
import {
  DYNASTY_SCORE_AXIS_DEFINITIONS,
  DYNASTY_SCORE_VERSION,
  DYNASTY_SCORE_WEIGHTS,
  type DynastyScoreAxis,
  type DynastyScoreEpochOpenPayload,
} from "../governance/dynastyScoreSpec.js";

export type AxisEvidence =
  | {
      status: "available";
      evidenceClass: "verified-journal";
      rawValue: number;
      normalizedValue: number;
      diminishedValue: number;
      basis: string;
    }
  | {
      status: "missing";
      evidenceClass: "missing";
      rawValue: null;
      normalizedValue: null;
      diminishedValue: null;
      reason: string;
    };

export interface LineageDynastyScore {
  lineageId: string;
  axes: Record<DynastyScoreAxis, AxisEvidence>;
  coverage: number;
  observedWeightedAverage: number | null;
  weightedSubtotal: number;
  missingAxes: DynastyScoreAxis[];
  status: "partial" | "complete" | "missing";
}

export interface DynastyScoreRecord {
  version: typeof DYNASTY_SCORE_VERSION;
  epochId: string;
  startTick: number;
  endTick: number;
  resolvedTicks: number;
  normalizationPopulation: "active-lineages-at-epoch-close";
  evidenceClass: "verified-journal";
  sourceJournalHead: string;
  activeLineages: string[];
  excludedEvidence: string[];
  scores: LineageDynastyScore[];
}

const AXES = Object.keys(DYNASTY_SCORE_WEIGHTS) as DynastyScoreAxis[];
export interface DynastyScoreEpoch { epochId: string; startTick: number; }

function journalThroughTick(journal: Journal, endTick: number): Journal {
  const prefix = new Journal();
  for (const entry of journal.entries()) {
    if (entry.tick > endTick) break;
    const appended = prefix.append({
      tick: entry.tick,
      type: entry.type,
      actor: entry.actor,
      payload: { ...entry.payload },
    });
    if (appended.hash !== entry.hash) throw new Error(`journal entry ${entry.index} changed while copying`);
  }
  const verified = prefix.verify();
  if (!verified.ok) throw new Error(`journal prefix failed verification at index ${verified.firstBadIndex}: ${verified.reason}`);
  return prefix;
}

function latestCommittedTick(entries: readonly JournalEntry[]): number {
  const commits = entries.filter((entry) => entry.type === "TICK_COMMIT");
  const last = commits[commits.length - 1];
  if (!last || typeof last.payload.tick !== "number" || !Number.isSafeInteger(last.payload.tick)) {
    throw new Error("dynasty score requires a committed world tick");
  }
  return last.payload.tick;
}

function openPayload(journal: Journal, epoch: DynastyScoreEpoch): DynastyScoreEpochOpenPayload {
  if (!epoch.epochId || epoch.epochId.trim() !== epoch.epochId) throw new Error("epochId must be a non-empty trimmed string");
  if (!Number.isSafeInteger(epoch.startTick) || epoch.startTick < 0) throw new Error("epoch startTick must be a non-negative integer");
  const latest = latestCommittedTick(journal.entries());
  if (epoch.startTick > latest) throw new Error("epoch startTick cannot exceed the latest committed tick");
  const entities = deriveVerifiedEntities(journal);
  return {
    epochId: epoch.epochId,
    version: DYNASTY_SCORE_VERSION,
    startTick: epoch.startTick,
    weights: DYNASTY_SCORE_WEIGHTS,
    normalizationPopulation: "active-lineages-at-epoch-close",
    formula: "weighted subtotal uses frozen weights; missing weight remains in abeyance",
    tickAccounting: "resolved-ticks-after-open; alive-at-tick-start",
    activeLineagesAtOpen: [...entities.civilization.activeLineages],
    axisDefinitions: DYNASTY_SCORE_AXIS_DEFINITIONS,
    unresolvedInterpretations: [
      "successor continuity uses the succession-v0 reading: accepted in-lineage successors after 10 own-agency ticks",
      "territory-years is owner-reserved and has no definition in this contract",
      "verified artifacts remains MISSING until third-party citation/use records exist",
      "wealth-resilience remains MISSING until income-source, upkeep, and productive-deployment records exist",
    ],
  };
}

function missing(reason: string): AxisEvidence {
  return {
    status: "missing",
    evidenceClass: "missing",
    rawValue: null,
    normalizedValue: null,
    diminishedValue: null,
    reason,
  };
}

function available(rawValue: number, basis: string): AxisEvidence {
  return {
    status: "available",
    evidenceClass: "verified-journal",
    rawValue,
    normalizedValue: 0,
    diminishedValue: 0,
    basis,
  };
}

function computeScore(
  journal: Journal,
  epochId: string,
  startTick: number,
  endTick: number,
  sourceJournalHead: string,
): DynastyScoreRecord {
  const entries = journal.entries();
  const opened = openPayload(journal, { epochId, startTick });
  if (!Number.isSafeInteger(endTick) || endTick < opened.startTick) {
    throw new Error("score epoch endTick must be a committed tick at or after its startTick");
  }
  const currentTick = latestCommittedTick(entries);
  if (endTick > currentTick) throw new Error("score epoch cannot extend past the latest committed tick");
  const commits = new Set(entries
    .filter((entry) => entry.type === "TICK_COMMIT")
    .map((entry) => entry.payload.tick)
    .filter((tick): tick is number => typeof tick === "number"));
  const resolvedTicks = endTick - opened.startTick;
  for (let tick = opened.startTick + 1; tick <= endTick; tick++) {
    if (!commits.has(tick)) throw new Error(`score epoch is missing committed tick ${tick}`);
  }

  const entities = deriveVerifiedEntities(journal);
  const activeLineages = Object.values(entities.lineages)
    .filter((lineage) => lineage.extinctTick === null)
    .map((lineage) => lineage.id)
    .sort();

  // A continuity axis is measurable only when the verified journal contains
  // at least one accepted succession. Once the axis is measurable, a lineage
  // with no qualifying successor is a measured zero (E8), not missing data.
  const hasSuccessionEvidence = entities.successions.length > 0;

  const byLineage = new Map<string, Record<DynastyScoreAxis, AxisEvidence>>();
  for (const lineageId of activeLineages) {
    const lineage = entities.lineages[lineageId];
    let memberTicks = 0;
    for (let tick = opened.startTick + 1; tick <= endTick; tick++) {
      for (const residentId of lineage.members) {
        const resident = entities.residents[residentId];
        // A resident born during tick t begins their first full own-agency
        // survival tick at t+1. A death during t counts as alive at tick t's
        // start; both conventions are pinned in the epoch-open journal entry.
        if (resident.bornTick < tick && (resident.diedTick === null || resident.diedTick >= tick)) {
          memberTicks += 1;
        }
      }
    }
    const axes = {
      survival: resolvedTicks > 0
        ? available(memberTicks / resolvedTicks, "verified WORLD_GENESIS/RESIDENT_BORN/DEATH records across committed ticks")
        : missing("epoch-has-no-resolved-ticks"),
      territoryYears: missing("owner-reserved; no territory definition is authorized"),
      verifiedArtifacts: missing("no-validated-third-party-citation-or-use-events"),
      successorContinuity: hasSuccessionEvidence
        ? available(
            continuitySuccessors(entities, lineageId, endTick).length,
            (() => {
              const qualifying = entities.successions.filter(
                (succession) =>
                  succession.successor in entities.residents &&
                  entities.residents[succession.deceased]?.lineage === lineageId &&
                  continuitySuccessors(entities, lineageId, endTick).includes(succession.successor),
              );
              const refs = qualifying.map((succession) => `SUCCESSION_EXECUTED#${succession.journalIndex}`);
              return refs.length > 0
                ? `succession-v0; ${refs.join(", ")}; validated SUCCESSION_AUTHORIZED and DEATH precede each execution`
                : "succession-v0; validated SUCCESSION_EXECUTED records exist, but none qualify for this lineage at the scoring tick";
            })(),
          )
        : missing("no validated SUCCESSION_EXECUTED records in the journal"),
      wealthResilience: missing("no-validated-income-source-upkeep-or-productive-deployment-events"),
    } satisfies Record<DynastyScoreAxis, AxisEvidence>;
    byLineage.set(lineageId, axes);
  }

  const normalizedByAxis = new Map<DynastyScoreAxis, Map<string, AxisEvidence>>();
  for (const axis of AXES) {
    const availableValues = activeLineages
      .map((id) => byLineage.get(id)![axis])
      .filter((evidence): evidence is Extract<AxisEvidence, { status: "available" }> => evidence.status === "available");
    const maxRaw = Math.max(0, ...availableValues.map((evidence) => evidence.rawValue));
    const values = new Map<string, AxisEvidence>();
    for (const lineageId of activeLineages) {
      const evidence = byLineage.get(lineageId)![axis];
      if (evidence.status === "missing") {
        values.set(lineageId, evidence);
        continue;
      }
      // When all known raw values are zero, the available axis is a real zero,
      // not missing evidence; its normalized score is zero for every lineage.
      const normalizedValue = maxRaw === 0 ? 0 : evidence.rawValue / maxRaw;
      values.set(lineageId, {
        ...evidence,
        normalizedValue,
        diminishedValue: Math.sqrt(normalizedValue),
      });
    }
    normalizedByAxis.set(axis, values);
  }

  const scores = activeLineages.map((lineageId): LineageDynastyScore => {
    const axes = Object.fromEntries(AXES.map((axis) => [axis, normalizedByAxis.get(axis)!.get(lineageId)!])) as Record<DynastyScoreAxis, AxisEvidence>;
    const availableAxes = AXES.filter((axis) => axes[axis].status === "available");
    const coverage = availableAxes.reduce((sum, axis) => sum + DYNASTY_SCORE_WEIGHTS[axis], 0);
    const weightedSubtotal = availableAxes.reduce(
      (sum, axis) => sum + DYNASTY_SCORE_WEIGHTS[axis] * (axes[axis] as Extract<AxisEvidence, { status: "available" }>).diminishedValue,
      0,
    );
    const observedWeightedAverage = coverage === 0 ? null : weightedSubtotal / coverage;
    const missingAxes = AXES.filter((axis) => axes[axis].status === "missing");
    return {
      lineageId,
      axes,
      coverage,
      observedWeightedAverage,
      weightedSubtotal,
      missingAxes,
      status: coverage === 0 ? "missing" : availableAxes.length === AXES.length ? "complete" : "partial",
    };
  });

  return {
    version: DYNASTY_SCORE_VERSION,
    epochId,
    startTick: opened.startTick,
    endTick,
    resolvedTicks,
    normalizationPopulation: "active-lineages-at-epoch-close",
    evidenceClass: "verified-journal",
    sourceJournalHead,
    activeLineages,
    excludedEvidence: [
      "accepted/rejected action proposals do not count as world outcomes",
      "external-event free text does not establish score evidence",
      "predictions, UI state, and off-ledger tallies are never read",
    ],
    scores,
  };
}

/** Derive a score from a verified journal only; this observer never mutates the world or journal. */
export function deriveDynastyScore(
  journal: Journal,
  epochId: string,
  startTick = 0,
  endTick?: number,
): DynastyScoreRecord {
  const verified = journal.verify();
  if (!verified.ok) throw new Error(`journal failed verification at index ${verified.firstBadIndex}: ${verified.reason}`);
  deriveVerifiedEntities(journal);
  const entries = journal.entries();
  const resolvedEndTick = endTick ?? latestCommittedTick(entries);
  const scoringJournal = resolvedEndTick === latestCommittedTick(entries) ? journal : journalThroughTick(journal, resolvedEndTick);
  return computeScore(scoringJournal, epochId, startTick, resolvedEndTick, scoringJournal.headHash());
}
