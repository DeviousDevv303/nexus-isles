// Directive T7 (Issue #235): Annex B dynasty-score-v1, projected from a
// verified and replayed journal only. Key decisions: normalize against active
// close-time lineages; sqrt normalized axes; renormalize available weights;
// keep absent evidence MISSING and exclude proposals, predictions, UI, and
// off-ledger tallies. Unfinished: territory-years remains MISSING, successor
// continuity is held for the owner's E6 audit, and artifacts/wealth lack
// evidence schemas. No score behavior is changed by the T7 mainline update.

import { canonicalStringify, Journal, type JournalEntry } from "../ledger/journal.js";
import { deriveVerifiedEntities } from "../lineage/verifiedEntities.js";
import type { World } from "../engine/world/world.js";
import {
  DYNASTY_SCORE_AXIS_DEFINITIONS,
  DYNASTY_SCORE_VERSION,
  DYNASTY_SCORE_WEIGHTS,
  type DynastyScoreAxis,
  type DynastyScoreEpochOpenPayload,
} from "./dynastyScoreSpec.js";

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
  availableWeight: number;
  score: number | null;
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
const EPOCH_OPEN = "DYNASTY_SCORE_EPOCH_OPENED";
const EPOCH_CLOSE = "DYNASTY_SCORE_EPOCH_CLOSED";

function copyToJournal(entries: readonly JournalEntry[]): Journal {
  const journal = new Journal();
  for (const entry of entries) {
    const appended = journal.append({
      tick: entry.tick,
      type: entry.type,
      actor: entry.actor,
      payload: { ...entry.payload },
    });
    if (appended.hash !== entry.hash) {
      throw new Error(`journal entry ${entry.index} changed while copying`);
    }
  }
  const verified = journal.verify();
  if (!verified.ok) throw new Error(`journal failed verification at index ${verified.firstBadIndex}: ${verified.reason}`);
  return journal;
}

function latestCommittedTick(entries: readonly JournalEntry[]): number {
  const commits = entries.filter((entry) => entry.type === "TICK_COMMIT");
  const last = commits[commits.length - 1];
  if (!last || typeof last.payload.tick !== "number" || !Number.isSafeInteger(last.payload.tick)) {
    throw new Error("dynasty score requires a committed world tick");
  }
  return last.payload.tick;
}

function openPayload(entries: readonly JournalEntry[], epochId: string): DynastyScoreEpochOpenPayload {
  const matches = entries.filter((entry) => entry.type === EPOCH_OPEN && entry.payload.epochId === epochId);
  if (matches.length !== 1) throw new Error(`expected exactly one open record for score epoch ${epochId}`);
  const payload = matches[0].payload as unknown as DynastyScoreEpochOpenPayload;
  if (
    payload.version !== DYNASTY_SCORE_VERSION ||
    canonicalStringify(payload.weights) !== canonicalStringify(DYNASTY_SCORE_WEIGHTS) ||
    payload.normalizationPopulation !== "active-lineages-at-epoch-close" ||
    payload.formula !== "sum(renormalized_weight * sqrt(raw / max_active_lineage_raw))" ||
    payload.tickAccounting !== "resolved-ticks-after-open; alive-at-tick-start" ||
    !Number.isSafeInteger(payload.startTick) ||
    !Array.isArray(payload.activeLineagesAtOpen) ||
    canonicalStringify(payload.axisDefinitions) !== canonicalStringify(DYNASTY_SCORE_AXIS_DEFINITIONS)
  ) {
    throw new Error(`score epoch ${epochId} has an unsupported or altered formula contract`);
  }
  return payload;
}

/**
 * Open a score epoch at the world's current committed boundary. The exact
 * version, weights, raw-axis definitions, tick convention, and open-time
 * active-lineage snapshot are recorded before the epoch's scored ticks.
 */
export function openDynastyScoreEpoch(world: World, epochId: string): void {
  if (!epochId || epochId.trim() !== epochId) throw new Error("epochId must be a non-empty trimmed string");
  const journal = copyToJournal(world.entries());
  const entities = deriveVerifiedEntities(journal);
  const alreadyOpen = journal.entries().some((entry) =>
    entry.type === EPOCH_OPEN &&
    !journal.entries().some((closed) => closed.type === EPOCH_CLOSE && closed.payload.epochId === entry.payload.epochId),
  );
  if (alreadyOpen) throw new Error("a dynasty-score epoch is already open");
  if (journal.entries().some((entry) => entry.type === EPOCH_OPEN && entry.payload.epochId === epochId)) {
    throw new Error(`score epoch ${epochId} was already opened`);
  }
  const payload: DynastyScoreEpochOpenPayload = {
    epochId,
    version: DYNASTY_SCORE_VERSION,
    startTick: world.tickNumber,
    weights: DYNASTY_SCORE_WEIGHTS,
    normalizationPopulation: "active-lineages-at-epoch-close",
    formula: "sum(renormalized_weight * sqrt(raw / max_active_lineage_raw))",
    tickAccounting: "resolved-ticks-after-open; alive-at-tick-start",
    activeLineagesAtOpen: [...entities.civilization.activeLineages],
    axisDefinitions: DYNASTY_SCORE_AXIS_DEFINITIONS,
    unresolvedInterpretations: [
      "successor continuity remains MISSING until the owner selects the heir and own-agency clock reading",
      "territory-years remains MISSING until validated region-control and improvement events exist",
      "verified artifacts remains MISSING until third-party citation/use records exist",
      "wealth-resilience remains MISSING until income-source, upkeep, and productive-deployment records exist",
    ],
  };
  world.openDynastyScoreEpoch(payload);
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
  endTick: number,
  sourceJournalHead: string,
): DynastyScoreRecord {
  const entries = journal.entries();
  const opened = openPayload(entries, epochId);
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
      territoryYears: missing("no-validated-region-control-or-improvement-events; resident position is not control"),
      verifiedArtifacts: missing("no-validated-third-party-citation-or-use-events"),
      successorContinuity: missing("owner-ruling-required-for-heir-and-own-agency-clock-reading"),
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
    const availableWeight = availableAxes.reduce((sum, axis) => sum + DYNASTY_SCORE_WEIGHTS[axis], 0);
    const score = availableWeight === 0
      ? null
      : availableAxes.reduce((sum, axis) => sum + DYNASTY_SCORE_WEIGHTS[axis] * (axes[axis] as Extract<AxisEvidence, { status: "available" }>).diminishedValue, 0) / availableWeight;
    return {
      lineageId,
      axes,
      availableWeight,
      score,
      status: availableWeight === 0 ? "missing" : availableAxes.length === AXES.length ? "complete" : "partial",
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

/** Derive the current epoch score, or re-derive and check a recorded close. */
export function deriveDynastyScore(journal: Journal, epochId: string): DynastyScoreRecord {
  const verified = journal.verify();
  if (!verified.ok) throw new Error(`journal failed verification at index ${verified.firstBadIndex}: ${verified.reason}`);
  // Replay the entire world and validate every state claim before scoring.
  deriveVerifiedEntities(journal);
  const entries = journal.entries();
  const closes = entries.filter((entry) => entry.type === EPOCH_CLOSE && entry.payload.epochId === epochId);
  if (closes.length > 1) throw new Error(`score epoch ${epochId} was closed more than once`);
  if (closes.length === 1) {
    const close = closes[0];
    const prefix = copyToJournal(entries.slice(0, close.index));
    const priorHead = prefix.headHash();
    const recorded = close.payload.score;
    const computed = computeScore(prefix, epochId, close.payload.endTick as number, priorHead);
    if (canonicalStringify(computed) !== canonicalStringify(recorded)) {
      throw new Error(`recorded score for epoch ${epochId} does not reproduce from its verified journal`);
    }
    return computed;
  }
  return computeScore(journal, epochId, latestCommittedTick(entries), journal.headHash());
}

/** Close and journal a reproducible score snapshot at the current boundary. */
export function closeDynastyScoreEpoch(world: World, epochId: string): DynastyScoreRecord {
  const journal = copyToJournal(world.entries());
  const sourceJournalHead = journal.headHash();
  const score = computeScore(journal, epochId, world.tickNumber, sourceJournalHead);
  world.closeDynastyScoreEpoch({
    epochId,
    endTick: score.endTick,
    sourceJournalHead,
    score,
  });
  return score;
}
