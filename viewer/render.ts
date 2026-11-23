// Nexus Isles — world viewer: static HTML rendering (read-only).
//
// Renders the replayed tick frames into ONE self-contained HTML file.
// The frames are embedded as JSON and the tick scrubber re-renders from
// them in the browser; there is no server and nothing to act on the
// world with. The page is an auditor's surface: it shows the whole
// journal-derived world, which no resident ever sees — the §12
// settlement requires it be labeled exactly that way, and the label
// below is part of the page, not a comment.

import type { MapSpec } from "../engine/world/map.js";
import { juarezMap } from "../engine/world/maps/juarez.js";
import type { JournalEntry } from "../ledger/journal.js";
import type { VerificationReceipt } from "./verificationReceipt.js";
import { loadJournalForViewing, type TickFrame } from "./replay.js";
import {
  composerModelFromState,
  latestSeatObservationAt,
  orderOutcomesFromJournal,
  renderResidentViewHtml,
  residentViewFromJournal,
  seatJournalNotesAt,
  RESIDENT_VIEW_SEAT,
} from "./residentView.js";
import { gameModelForFrame } from "./gameView.js";

/** The auditor-surface label. Acceptance condition: it stays on the page. */
export const AUDITOR_LABEL =
  "AUDITOR'S SURFACE — read-only observer view. This page is an auditor's view of the world, " +
  "replayed from the journal. It is NOT a resident's view: no resident sees this page, " +
  "and nothing on it can act on the world.";

/** Required wording distinguishing committed state from mid-tick observations. */
export const TWO_REGISTERS_SENTENCE =
  "Replay frames show committed state. Observation payloads show mid-tick intelligence. " +
  "They are different registers, not competing accounts of the world.";

type NodeEventType = "ENV_BLIGHT" | "RESOURCE_REGEN" | "GATHER_GRANTED";
type NodeEventAmountField = "loss" | "gained" | "granted";

interface ObservedNodeEvent {
  tick: number;
  journalIndex: number;
  type: NodeEventType;
  node: string;
  amountField: NodeEventAmountField;
  amount: number;
  resident?: string;
}

export interface RenderOptions {
  /** Path to the source journal; shown in the header and read for raw events. */
  journalLabel: string;
  /** Total journal entries the frames were replayed from. */
  journalEntries: number;
  /** Hash of the journal's final entry. */
  journalHeadHash: string;
  /**
   * The separate verification receipt written by runner/status.ts (buildReceipt). When present
   * it is embedded in the page and shown in the Verification section. ChatGPT's P1 audit of the
   * live viewer (forgeclaw #235): the page previously showed stateHash and journaledStateHash
   * beside each other and let the reader infer verification from their matching — displayed-
   * matching is not proof. The receipt names WHO verified, WHEN, and in WHICH run, so the page
   * no longer carries verification as a self-claim.
   */
  verification?: VerificationReceipt | null;
}

/** The map a frame is drawn on: the journaled map, else the Juárez shell. */
export function mapForFrame(frame: TickFrame): MapSpec {
  return frame.state.map ?? juarezMap();
}

function jsonForScript(value: unknown): string {
  // Keep the payload from ever closing the script element it rides in.
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function observedNodeEvent(entry: JournalEntry): ObservedNodeEvent | null {
  let amountField: NodeEventAmountField;
  if (entry.type === "ENV_BLIGHT") amountField = "loss";
  else if (entry.type === "RESOURCE_REGEN") amountField = "gained";
  else if (entry.type === "GATHER_GRANTED") amountField = "granted";
  else return null;

  const node = entry.payload.node;
  const amount = entry.payload[amountField];
  if (
    typeof node !== "string" ||
    typeof amount !== "number" ||
    !Number.isSafeInteger(amount) ||
    amount < 0
  ) {
    throw new Error(`journal entry ${entry.index} has an invalid ${entry.type} node payload`);
  }

  const base = {
    tick: entry.tick,
    journalIndex: entry.index,
    type: entry.type as NodeEventType,
    node,
    amountField,
    amount,
  };
  if (entry.type === "GATHER_GRANTED") {
    const resident = entry.payload.resident;
    if (typeof resident !== "string") {
      throw new Error(`journal entry ${entry.index} has no GATHER_GRANTED resident`);
    }
    return { ...base, resident };
  }
  return base;
}

function nodeEventsByTick(entries: readonly JournalEntry[]): Map<number, ObservedNodeEvent[]> {
  const byTick = new Map<number, ObservedNodeEvent[]>();
  for (const entry of entries) {
    const event = observedNodeEvent(entry);
    if (!event) continue;
    const events = byTick.get(event.tick) ?? [];
    events.push(event);
    byTick.set(event.tick, events);
  }
  return byTick;
}

/**
 * Render the whole viewer as one static HTML document. The source journal is
 * reopened read-only so raw observed events can be shown without deriving
 * them from frame deltas. Entry count and chain head must still match replay.
 */
export function renderViewerHtml(frames: readonly TickFrame[], opts: RenderOptions): string {
  if (frames.length === 0) throw new Error("no frames to render: the journal committed no ticks");
  const journal = loadJournalForViewing(opts.journalLabel);
  if (journal.length !== opts.journalEntries) {
    throw new Error(
      `journal entry count changed between replay and rendering (${opts.journalEntries} != ${journal.length})`,
    );
  }
  if (journal.headHash() !== opts.journalHeadHash) {
    throw new Error("journal head changed between replay and rendering");
  }
  const events = nodeEventsByTick(journal.entries());
  // The resident's view, derived from the same journal and the final
  // replayed frame: his own state and his latest delivered observation —
  // nothing beyond his observation model (viewer/residentView.ts).
  const residentView = residentViewFromJournal(
    journal.entries(),
    frames[frames.length - 1].state,
    RESIDENT_VIEW_SEAT,
  );
  const residentSection = renderResidentViewHtml(residentView, {
    nextTick: frames[frames.length - 1].tick + 1,
    composer: composerModelFromState(
      frames[frames.length - 1].state,
      RESIDENT_VIEW_SEAT,
      frames[frames.length - 1].tick + 1,
    ),
    outcomes: orderOutcomesFromJournal(journal.entries(), RESIDENT_VIEW_SEAT),
  });
  const entries = journal.entries();
  const finalFrame = frames[frames.length - 1];
  const payload = {
    label: AUDITOR_LABEL,
    journalLabel: opts.journalLabel,
    journalEntries: opts.journalEntries,
    journalHeadHash: opts.journalHeadHash,
    verification: opts.verification ?? null,
    // The game surface's seat and the tick it enters the world (null when
    // the journal never seats it): the browser needs both to render the
    // resident's hero honestly at ticks before the founding.
    gameSeat: RESIDENT_VIEW_SEAT,
    seatBornTick: finalFrame.state.residents[RESIDENT_VIEW_SEAT]?.bornTick ?? null,
    frames: frames.map((f) => ({
      tick: f.tick,
      commitIndex: f.commitIndex,
      commitHash: f.commitHash,
      stateHash: f.stateHash,
      journaledStateHash: f.journaledStateHash,
      map: mapForFrame(f),
      nodes: f.state.nodes,
      residents: f.state.residents,
      nodeEvents: events.get(f.tick) ?? [],
      // The game view's model for this frame (viewer/gameView.ts) and the
      // seat's perception as of this tick: the latest observation the
      // engine had delivered to the seat at or before the frame's tick.
      game: gameModelForFrame(mapForFrame(f), f.state.nodes, f.state.residents),
      seatObservation: latestSeatObservationAt(entries, RESIDENT_VIEW_SEAT, f.tick),
      // What had happened to the seat by this tick (newest first): the
      // Game surface's events panel — history when scrubbed back, the
      // living present only at the final frame.
      seatEvents: seatJournalNotesAt(entries, RESIDENT_VIEW_SEAT, f.tick, 5),
    })),
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Nexus Isles — Auditor's World View</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; background: #101418; color: #e8ecef; }
  @media (max-width: 720px) { .sides { grid-template-columns: 1fr; } body { margin: 1rem; } }
  .auditor-label { border: 2px solid #d8a022; background: #2a2110; color: #ffd97a;
    padding: 0.75rem 1rem; font-weight: 600; border-radius: 6px; }
  .meta { color: #9fb0bd; font-size: 0.9rem; margin: 0.75rem 0; word-break: break-all; }
  .evidence-legend { border: 1px solid #53606b; border-radius: 6px; padding: 0.6rem 0.8rem; margin: 1rem 0; background: #171d23; }
  .evidence-legend h2 { margin-top: 0; }
  .scrubber { display: flex; gap: 0.75rem; align-items: center; margin: 1rem 0; }
  .scrubber input[type=range] { flex: 1; }
  .sides { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; align-items: start; }
  .region { border: 1px solid #39434d; border-radius: 6px; padding: 0.6rem 0.8rem; margin-bottom: 0.75rem; background: #171d23; }
  .region h3 { margin: 0 0 0.4rem; font-size: 1rem; }
  .resident { color: #a8d8a8; } .dead { color: #d88a8a; text-decoration: line-through; }
  .node { color: #a8c8e8; } .empty { color: #66727d; }
  .node-event { color: #e7c878; font-size: 0.85rem; margin: 0.2rem 0 0 0.75rem; }
  .verification { border: 1px solid #39434d; border-radius: 6px; padding: 0.6rem 0.8rem; margin: 1rem 0; background: #171d23; }
  .verification h2 { margin-top: 0; }
  .verification .verdict { font-weight: 700; }
  .verdict.pass { color: #8bd68b; } .verdict.fail { color: #d88a8a; } .verdict.absent { color: #e7c878; }
  .verification code { background: #0b0f13; padding: 0.15rem 0.35rem; border-radius: 3px; display: inline-block; max-width: 100%; overflow-wrap: anywhere; }
  .verification pre { background: #0b0f13; padding: 0.5rem; border-radius: 4px; overflow-x: auto; font-size: 0.8rem; }
  .warn { color: #e7c878; }
  table { border-collapse: collapse; margin-top: 1rem; }
  td, th { border: 1px solid #39434d; padding: 0.3rem 0.6rem; text-align: left; font-size: 0.9rem; }
  .hash { font-family: ui-monospace, monospace; font-size: 0.8rem; word-break: break-all; }
  .resident-view { border: 2px solid #4a7a4a; border-radius: 6px; padding: 0.75rem 1rem; margin: 1.5rem 0; background: #141a16; }
  .resident-label { border: 1px solid #4a7a4a; background: #1a241c; color: #a8d8a8;
    padding: 0.6rem 0.8rem; font-weight: 600; border-radius: 6px; }
  .orders-box textarea { width: 100%; box-sizing: border-box; background: #0b0f13; color: #e8ecef;
    border: 1px solid #39434d; border-radius: 4px; padding: 0.5rem; font: inherit; }
  .orders-box button { margin-top: 0.5rem; padding: 0.45rem 0.9rem; font: inherit; cursor: pointer; }
  .orders-composed { background: #0b0f13; padding: 0.5rem; border-radius: 4px; overflow-x: auto; font-size: 0.8rem; }
  .orders-box input, .orders-box select { background: #0b0f13; color: #e8ecef; border: 1px solid #39434d;
    border-radius: 4px; padding: 0.35rem 0.5rem; font: inherit; margin: 0.25rem 0; }
  .orders-box label { display: block; margin: 0.4rem 0 0.2rem; }
  .action-composer label { display: inline-block; margin-right: 0.6rem; }
  .ev-chip { display: inline-block; border: 1px solid #2a9db8; color: #8fd8e8; border-radius: 999px;
    padding: 0.05rem 0.55rem; font-size: 0.72rem; letter-spacing: 0.04em; vertical-align: middle; }
  /* The three surfaces and their tab bar. The tabs only show/hide
     sections; every surface renders from the same embedded frames. */
  .surface-tabs { position: sticky; top: 0; z-index: 20; display: flex; gap: 0.5rem;
    background: #101418; padding: 0.5rem 0; }
  .surface-tab { flex: 1; min-height: 52px; padding: 0.7rem 0.4rem; font: inherit; font-size: 1.05rem;
    font-weight: 700; border-radius: 8px; border: 1px solid #39434d; background: #171d23;
    color: #e8ecef; cursor: pointer; }
  .surface-tab[aria-selected="true"] { background: #12303a; border-color: #2a9db8; color: #bfeef7; }
  .surface[hidden] { display: none; }
  /* Resident Game surface — the established identity (visual identity
     set, 2026-11-19): a black command interior, holographic cyan
     operational displays, gold as the Throne's accent. */
  .hero { border: 2px solid #8a6d1f; border-radius: 10px; padding: 1rem; margin: 1rem 0;
    background: linear-gradient(160deg, #16130a, #0a0e13 55%, #0d1a21); }
  .hero-flex { display: flex; gap: 1rem; flex-wrap: wrap; }
  .hero-portrait { flex: 0 1 300px; min-width: 240px; }
  .hero-portrait svg { display: block; width: 100%; height: auto; }
  .hero-data { flex: 1 1 260px; min-width: 240px; }
  .hero-name { font-size: 2rem; font-weight: 800; letter-spacing: 0.02em; }
  .hero-title { color: #ffd97a; font-weight: 600; margin-left: 0.5rem; }
  .hero-line { color: #9fb0bd; margin: 0.3rem 0 0.8rem; }
  .status-pill { display: inline-block; padding: 0.2rem 0.7rem; border-radius: 999px; font-weight: 700;
    font-size: 0.9rem; margin-bottom: 0.8rem; }
  .status-pill.alive { background: #12303a; color: #bfeef7; border: 1px solid #2a9db8; }
  .status-pill.dead { background: #5d2c2c; color: #f2c9c9; }
  .stat { display: flex; align-items: center; gap: 0.6rem; margin: 0.45rem 0; }
  .stat label { width: 8.5rem; color: #9fb0bd; font-size: 0.9rem; }
  .stat .value { font-weight: 700; }
  .bar { flex: 1; max-width: 22rem; height: 0.9rem; background: #0b0f13; border: 1px solid #39434d; border-radius: 999px; overflow: hidden; }
  .bar-fill { height: 100%; background: #57d7e8; }
  .bar-fill.low { background: #d8a022; } .bar-fill.critical { background: #c0392b; }
  .game-panel { border: 1px solid #2a3a46; border-radius: 10px; padding: 0.8rem 1rem; margin: 1rem 0; background: #10161d; }
  .game-panel h3 { margin-top: 0; }
  .node-card { border: 1px solid #2c4a63; border-radius: 8px; padding: 0.5rem 0.7rem; margin: 0.5rem 0; background: #121a21; }
  .node-card .node-name { color: #a8c8e8; font-weight: 700; }
  .route-chip { display: inline-block; border: 1px solid #39434d; border-radius: 999px; padding: 0.25rem 0.7rem;
    margin: 0.2rem 0.3rem 0.2rem 0; background: #171d23; font-size: 0.9rem; }
  .route-chip.bridge { border-color: #8a6d1f; color: #ffd97a; }
  /* World Intelligence surface */
  .world-map-wrap { overflow-x: auto; border: 1px solid #39434d; border-radius: 10px; background: #0d1218; }
  .world-map-wrap svg { display: block; width: 100%; min-width: 560px; height: auto; }
  .resident-chips { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.8rem 0; }
  .resident-chip { padding: 0.5rem 0.9rem; min-height: 44px; font: inherit; border-radius: 999px;
    border: 1px solid #39434d; background: #171d23; color: #e8ecef; cursor: pointer; }
  .resident-chip[aria-pressed="true"] { border-color: #57d7e8; background: #12242e; }
  .resident-chip .dot { display: inline-block; width: 0.65rem; height: 0.65rem; border-radius: 50%; margin-right: 0.4rem; }
  .dot.alive { background: #57d7e8; } .dot.dead { background: #6b6b6b; }
  .dot.seat { background: #0b0b0d; border: 2px solid #d8a022; width: 0.5rem; height: 0.5rem; }
  .hud { border: 1px solid #39434d; border-radius: 10px; padding: 0.8rem 1rem; background: #171d23; }
  .hud h3 { margin-top: 0; }
  .legend { color: #9fb0bd; font-size: 0.9rem; margin: 0.6rem 0; }
  /* Happening vs observed: the mode banner is always on screen and is
     driven by the scrubber. LIVE only at the latest committed tick;
     anything older is REPLAY, styled so it cannot be mistaken for the
     present, with a one-tap return to the present. */
  .mode-banner { border-radius: 8px; padding: 0.7rem 1rem; margin: 0.8rem 0; font-weight: 700;
    display: flex; align-items: center; gap: 0.8rem; flex-wrap: wrap; }
  .mode-banner.live { background: #0e2a33; border: 2px solid #2a9db8; color: #bfeef7; }
  .mode-banner.replay { background: #33270e; border: 2px solid #d8a022; color: #ffd97a;
    background-image: repeating-linear-gradient(45deg, rgba(216,160,34,0.12) 0 14px, transparent 14px 28px); }
  .mode-banner button { font: inherit; font-weight: 700; padding: 0.45rem 0.9rem; min-height: 44px;
    border-radius: 8px; border: 1px solid #d8a022; background: #171d23; color: #ffd97a; cursor: pointer; }
  body[data-mode="replay"] .hero { border-color: #d8a022; filter: saturate(0.55); }
  body[data-mode="replay"] .scene-wrap { border-color: #6b5716; }
  body[data-mode="replay"] .game-panel { border-color: #6b5716; }
  /* The region scene: a place, drawn. Exits are the region's journaled
     edges; walking them moves the view, never the resident. */
  .scene-wrap { border: 1px solid #39434d; border-radius: 10px; background: #0d1218; overflow-x: auto; }
  .scene-wrap svg { display: block; width: 100%; min-width: 560px; height: auto; }
  .scene-head { display: flex; align-items: baseline; gap: 0.8rem; flex-wrap: wrap; margin: 1rem 0 0.5rem; }
  .scene-head h3 { margin: 0; }
  .scene-return { font: inherit; font-weight: 700; padding: 0.5rem 0.9rem; min-height: 44px; border-radius: 8px;
    border: 1px solid #d8a022; background: #171207; color: #ffd97a; cursor: pointer; }
  .scene-note { color: #9fb0bd; font-size: 0.9rem; margin: 0.4rem 0 0.8rem; }
</style>
</head>
<body>
<nav class="surface-tabs" role="tablist" aria-label="Surfaces">
  <button type="button" class="surface-tab" data-surface="game" role="tab" aria-selected="true">Game</button>
  <button type="button" class="surface-tab" data-surface="world" role="tab" aria-selected="false">World</button>
  <button type="button" class="surface-tab" data-surface="auditor" role="tab" aria-selected="false">Auditor</button>
</nav>
<div class="scrubber">
  <button id="prev" type="button">← Prev tick</button>
  <input id="scrub" type="range" min="0" max="${frames.length - 1}" step="1" value="${frames.length - 1}">
  <button id="next" type="button">Next tick →</button>
  <strong id="tickLabel"></strong>
</div>
<div class="meta" id="frameMeta"></div>
<div id="mode-banner" class="mode-banner live" role="status"></div>
<section id="surface-game" class="surface" aria-label="Resident game">
  <div id="game-hero"></div>
  <div id="game-scene"></div>
  <div id="game-surroundings"></div>
  <div id="game-perception"></div>
  <div id="game-events"></div>
${residentSection}
</section>
<section id="surface-world" class="surface" aria-label="World intelligence" hidden>
  <h2>World — the two banks of the Rio Grande</h2>
  <p class="meta">A schematic map drawn from the journaled map: regions on their own bank, bridges and the river crossing over the Rio Grande, resource nodes with their stock at the tick you are viewing. Read-only — like every surface here, it displays committed state and cannot act on the world. Region positions are a diagram of the map's sides and crossings, not geography.</p>
  <div class="world-map-wrap" id="world-map"></div>
  <p class="legend">Markers: black disc with a gold ring = cristian of the Núñez lineage · cyan initial disc = another resident, alive · grey † disc = dead, at their last region, never operational · blue badge on a place = resource node and its stock (amount/capacity) · amber line = bridge · dashed line = trail or river crossing.</p>
  <div class="resident-chips" id="world-chips"></div>
  <div class="hud" id="world-hud"></div>
</section>
<section id="surface-auditor" class="surface" aria-label="Auditor" hidden>
<div class="auditor-label">${AUDITOR_LABEL}</div>
<h1>Nexus Isles — World View</h1>
<div class="meta">Journal: ${escapeHtml(opts.journalLabel)} · entries: ${opts.journalEntries} · head: <span class="hash">${opts.journalHeadHash}</span></div>
<section class="evidence-legend" id="evidence-legend" aria-label="Evidence legend">
  <h2>Evidence legend</h2>
  <p>${TWO_REGISTERS_SENTENCE}</p>
  <p>This page is a <strong>replay artifact</strong>: committed tick frames derived from the journal at render time. The <strong>verification engine</strong> is <code>runner/status.ts</code> — it verifies the hash chain and that every commit's recorded state hash matches a from-scratch replay. The journal itself is the <strong>live observer</strong> record of what the engine committed. These three roles stay distinct; one does not substitute for another.</p>
</section>
<section class="verification" id="verification" aria-label="Verification">
  <h2>Verification</h2>
  <div id="verification-receipt"></div>
  <div id="verification-consistency"></div>
  <details><summary>Reproduce independently</summary>
    <p>Run the verification engine against the live journal yourself:</p>
    <pre><code>git clone https://github.com/DeviousDevv303/nexus-isles
git -C nexus-isles fetch origin live-world
git -C nexus-isles worktree add ../live live-world
cd nexus-isles &amp;&amp; npm ci
npx vite-node runner/status.ts --journal ../live/world-data/journal.jsonl --expect-head ${opts.journalHeadHash}</code></pre>
    <p>The page's recorded hashes match each other by construction; only the engine replaying the journal is proof.</p>
  </details>
</section>
<div class="sides">
  <section><h2>Juárez side</h2><div id="juarez"></div></section>
  <section><h2>El Paso side</h2><div id="elpaso"></div></section>
</div>
<h2>Edges</h2>
<div id="edges"></div>
<h2>Residents</h2>
<div id="residents"></div>
</section>
<script type="application/json" id="viewer-data">${jsonForScript(payload)}</script>
<script>
"use strict";
const data = JSON.parse(document.getElementById("viewer-data").textContent);
const scrub = document.getElementById("scrub");
function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
function renderSide(frame, side, host) {
  host.replaceChildren();
  for (const region of frame.map.regions.filter(r => r.side === side)) {
    const box = el("div", undefined, "region");
    box.appendChild(el("h3", region.name + " (" + region.id + ") — " + region.kind));
    const here = Object.entries(frame.residents).filter(([, r]) => r.position === region.id);
    if (here.length === 0) box.appendChild(el("div", "no residents", "empty"));
    for (const [id, r] of here) {
      box.appendChild(el("div", id + " · satiety " + r.satiety + "/" + r.maxSatiety +
        " · inventory " + r.inventory + " · " + (r.alive ? "alive" : "dead"), r.alive ? "resident" : "dead"));
    }
    const nodes = Object.entries(frame.nodes).filter(([, n]) => n.region === region.id);
    for (const [id, n] of nodes) {
      box.appendChild(el("div", id + " · " + n.amount + "/" + n.capacity + " (regen " + n.regen + ")", "node"));
      const observed = frame.nodeEvents.filter(event => event.node === id);
      if (observed.length === 0) {
        box.appendChild(el("div", 'Zero OBSERVED node events for this node this tick — the journal recorded no activity at this node. (This is "no activity," not "evidence missing": a missing event payload would throw at replay.)', "empty"));
      }
      for (const event of observed) {
        const recipient = event.resident ? " · resident " + event.resident : "";
        box.appendChild(el("div", "OBSERVED journal event · entry " + event.journalIndex +
          " · " + event.type + " · " + event.amountField + " " + event.amount + recipient, "node-event"));
      }
    }
    host.appendChild(box);
  }
}
let currentFrameIndex = data.frames.length - 1;
function render(i) {
  currentFrameIndex = i;
  const frame = data.frames[i];
  document.getElementById("tickLabel").textContent = "Tick " + frame.tick + " of " + data.frames[data.frames.length - 1].tick;
  document.getElementById("frameMeta").textContent =
    "state hash " + frame.stateHash + " · journaled " + frame.journaledStateHash +
    " · commit entry " + frame.commitIndex + " (" + frame.commitHash + ")";
  renderSide(frame, "juarez", document.getElementById("juarez"));
  renderSide(frame, "el-paso", document.getElementById("elpaso"));
  const edges = document.getElementById("edges");
  edges.replaceChildren();
  for (const e of frame.map.edges) {
    edges.appendChild(el("div", e.a + " — " + e.b + " · " + e.kind +
      (e.name ? " · " + e.name : "") + (e.crossingCapacity ? " · capacity " + e.crossingCapacity + "/tick" : "")));
  }
  const table = el("table");
  const head = el("tr");
  for (const h of ["resident", "alive", "position", "satiety", "inventory", "lineage"]) head.appendChild(el("th", h));
  table.appendChild(head);
  for (const [id, r] of Object.entries(frame.residents)) {
    const row = el("tr");
    for (const v of [id, String(r.alive), r.position ?? "—", r.satiety + "/" + r.maxSatiety, String(r.inventory), r.lineage]) {
      row.appendChild(el("td", v));
    }
    table.appendChild(row);
  }
  document.getElementById("residents").replaceChildren(table);
  renderMode(i, frame);
  renderGame(frame);
  renderWorld(frame);
}
function renderMode(i, frame) {
  const banner = document.getElementById("mode-banner");
  const last = data.frames.length - 1;
  banner.replaceChildren();
  if (i === last) {
    banner.className = "mode-banner live";
    banner.appendChild(el("span",
      "● LIVE — tick " + frame.tick + " of " + data.frames[last].tick +
      " · the living present: this is the world's committed state now, and the seat's latest events are below."));
    document.body.dataset.mode = "live";
  } else {
    banner.className = "mode-banner replay";
    banner.appendChild(el("span",
      "◐ REPLAY — you are observing history at tick " + frame.tick + " of " + data.frames[last].tick +
      ". Nothing on screen is the present. (Orders composed below still target the next live tick, " +
      (data.frames[last].tick + 1) + ".)"));
    const back = el("button", "Return to the present");
    back.type = "button";
    back.addEventListener("click", () => { scrub.value = last; render(last); });
    banner.appendChild(back);
    document.body.dataset.mode = "replay";
  }
}
for (const tab of document.querySelectorAll(".surface-tab")) {
  tab.addEventListener("click", () => {
    const target = tab.getAttribute("data-surface");
    for (const t of document.querySelectorAll(".surface-tab")) {
      t.setAttribute("aria-selected", t === tab ? "true" : "false");
    }
    for (const s of document.querySelectorAll(".surface")) {
      s.hidden = s.id !== "surface-" + target;
    }
  });
}
function regionName(frame, id) {
  const r = frame.map.regions.find((r) => r.id === id);
  return r ? r.name : id;
}
function satietyFillClass(r) {
  const f = r.maxSatiety > 0 ? r.satiety / r.maxSatiety : 0;
  return f <= 0.25 ? " critical" : f <= 0.5 ? " low" : "";
}
function statRow(label, build) {
  const row = el("div", undefined, "stat");
  row.appendChild(el("label", label));
  build(row);
  return row;
}
function satietyRow(r) {
  return statRow("Satiety", (row) => {
    const bar = el("div", undefined, "bar");
    const fill = el("div", undefined, "bar-fill" + satietyFillClass(r));
    fill.style.width = Math.round((100 * r.satiety) / Math.max(1, r.maxSatiety)) + "%";
    bar.appendChild(fill);
    row.appendChild(bar);
    row.appendChild(el("span", r.satiety + "/" + r.maxSatiety, "value"));
  });
}
let sceneFocus = null;
function renderGame(frame) {
  const hero = document.getElementById("game-hero");
  const scene = document.getElementById("game-scene");
  const surr = document.getElementById("game-surroundings");
  const perc = document.getElementById("game-perception");
  const events = document.getElementById("game-events");
  hero.replaceChildren();
  scene.replaceChildren();
  surr.replaceChildren();
  perc.replaceChildren();
  events.replaceChildren();
  const seat = frame.game.residents.find((r) => r.id === data.gameSeat);
  const heroBox = el("div", undefined, "hero");
  if (!seat) {
    heroBox.appendChild(el("div", data.gameSeat, "hero-name"));
    heroBox.appendChild(el("p",
      data.seatBornTick === null
        ? "This journal never seats " + data.gameSeat + " — the seat is vacant in this world."
        : data.gameSeat + " is not in the world yet at tick " + frame.tick + " — his founding lands at tick " +
          data.seatBornTick + ". Scrub forward to meet him.",
      "hero-line"));
    hero.appendChild(heroBox);
    scene.appendChild(el("p", "No scene — the resident has not entered the world at this tick.", "empty"));
    surr.appendChild(el("p", "No surroundings — the resident has not entered the world at this tick.", "empty"));
    perc.appendChild(el("p", "No perception — nothing had been delivered to him by this tick.", "empty"));
    renderEvents(frame, null);
    return;
  }
  const flex = el("div", undefined, "hero-flex");
  const portrait = el("div", undefined, "hero-portrait");
  portrait.appendChild(drawThronePortrait(seat));
  flex.appendChild(portrait);
  const dataBox = el("div", undefined, "hero-data");
  const head = el("div");
  head.appendChild(el("span", seat.id, "hero-name"));
  head.appendChild(el("span", "the Throne", "hero-title"));
  dataBox.appendChild(head);
  dataBox.appendChild(el("div",
    seat.lineage + " · at " + regionName(frame, seat.region) + " (" + seat.region + ")", "hero-line"));
  dataBox.appendChild(el("span",
    seat.alive ? "ALIVE" : "DEAD — died at tick " + seat.diedAtTick,
    "status-pill " + (seat.alive ? "alive" : "dead")));
  dataBox.appendChild(satietyRow(seat));
  dataBox.appendChild(statRow("Inventory", (row) => row.appendChild(el("span", String(seat.inventory), "value"))));
  dataBox.appendChild(statRow("Latest observation", (row) =>
    row.appendChild(el("span", frame.seatObservation ? "delivered at tick " + frame.seatObservation.tick : "none yet", "value"))));
  const hint = el("p", undefined, "meta");
  hint.appendChild(document.createTextNode("Your decisions go through one path only: the orders box in "));
  const anchor = el("a", "Direct your resident");
  anchor.href = "#resident-view";
  hint.appendChild(anchor);
  hint.appendChild(document.createTextNode(" below. The engine executes them on the next tick — nothing else on this page acts on the world."));
  dataBox.appendChild(hint);
  flex.appendChild(dataBox);
  heroBox.appendChild(flex);
  hero.appendChild(heroBox);
  renderScene(frame, seat);
  const panel = el("div", undefined, "game-panel");
  panel.appendChild(el("h3", "Your surroundings — " + regionName(frame, seat.region)));
  const region = frame.map.regions.find((r) => r.id === seat.region);
  if (region) {
    panel.appendChild(el("p", region.kind + " · " + (region.side === "juarez" ? "Juárez side" : "El Paso side"), "meta"));
  }
  const nodesHere = frame.game.nodes.filter((n) => n.region === seat.region);
  if (nodesHere.length === 0) panel.appendChild(el("p", "No resource nodes here.", "empty"));
  for (const n of nodesHere) {
    const card = el("div", undefined, "node-card");
    card.appendChild(el("span", n.id, "node-name"));
    card.appendChild(el("span", " — stock " + n.amount + "/" + n.capacity + " · regen " + n.regen + "/tick"));
    panel.appendChild(card);
  }
  const others = frame.game.residents.filter((r) => r.id !== seat.id && r.region === seat.region);
  panel.appendChild(el("p",
    others.length === 0 ? "No one else is here." : "Also here: " + others.map((r) => r.id + (r.alive ? "" : " (dead)")).join(", ")));
  const routes = frame.map.edges.filter((e) => e.a === seat.region || e.b === seat.region);
  if (routes.length > 0) {
    const rp = el("p");
    rp.appendChild(el("span", "Routes out: "));
    for (const e of routes) {
      const other = e.a === seat.region ? e.b : e.a;
      rp.appendChild(el("span",
        regionName(frame, other) + " · " + e.kind + (e.name ? " · " + e.name : "") +
          (e.crossingCapacity ? " · capacity " + e.crossingCapacity + "/tick" : ""),
        "route-chip" + (e.kind === "bridge" ? " bridge" : "")));
    }
    panel.appendChild(rp);
  }
  surr.appendChild(panel);
  const pp = el("div", undefined, "game-panel");
  const obs = frame.seatObservation;
  pp.appendChild(el("h3", obs ? "What you perceive — observation delivered at tick " + obs.tick : "What you perceive"));
  pp.appendChild(el("p",
    "Mid-tick intelligence the engine delivered to the resident — a different register from the committed state above.", "meta"));
  if (!obs) {
    pp.appendChild(el("p", "No observation had been delivered to " + seat.id + " by tick " + frame.tick + ".", "empty"));
  } else if (obs.regions.length === 0) {
    pp.appendChild(el("p", "The observation carried no regions.", "empty"));
  } else {
    for (const rg of obs.regions) {
      const box = el("div", undefined, "region");
      box.appendChild(el("h3", regionName(frame, rg.region) + " (" + rg.region + ")"));
      const nodeText = Object.entries(rg.nodes).map(([id, amt]) => id + " · " + amt).join(" · ");
      box.appendChild(el("div", nodeText || "no nodes", "node"));
      box.appendChild(el("div", rg.residents.length ? rg.residents.join(", ") : "no other residents", "empty"));
      pp.appendChild(box);
    }
  }
  perc.appendChild(pp);
  renderEvents(frame, seat);
}
function renderEvents(frame, seat) {
  const host = document.getElementById("game-events");
  const panel = el("div", undefined, "game-panel");
  const live = frame.tick === data.frames[data.frames.length - 1].tick;
  panel.appendChild(el("h3", live
    ? "Happening now — the latest journal entries concerning " + data.gameSeat
    : "What had happened by tick " + frame.tick + " — journal entries concerning " + data.gameSeat + " (history)"));
  if (!seat) {
    panel.appendChild(el("p", "He is not in the world at this tick; there is nothing to record.", "empty"));
  } else if (frame.seatEvents.length === 0) {
    panel.appendChild(el("p", "No journal entries concern him at or before tick " + frame.tick + ".", "empty"));
  } else {
    for (const n of frame.seatEvents) {
      panel.appendChild(el("div", "tick " + n.tick + " · entry " + n.index + " · " + n.type + " · by " + n.actor, "node-event"));
    }
  }
  panel.appendChild(el("p",
    "These are committed journal entries — outcomes the engine recorded. The observation panel above is a different " +
    "register: mid-tick intelligence delivered to the resident, never an event.", "meta"));
  host.appendChild(panel);
}
/** The spider-swarm insignia of the Núñez lineage (identity set, 2026-11-19). */
function spiderInsignia(cx, cy, scale, color) {
  const g = svgEl("g", { stroke: color, fill: "none", "stroke-width": 2 * scale, "stroke-linecap": "round" });
  for (const side of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const y0 = cy - 4 * scale + k * 4 * scale;
      const pts = cx + side * 5 * scale + "," + y0 + " " +
        (cx + side * (16 + k * 2) * scale) + "," + (y0 - 6 * scale) + " " +
        (cx + side * (23 + k * 2) * scale) + "," + (y0 + 3 * scale);
      g.appendChild(svgEl("polyline", { points: pts }));
    }
  }
  g.appendChild(svgEl("ellipse", { cx: cx, cy: cy + 2 * scale, rx: 7 * scale, ry: 10 * scale, fill: color, stroke: "none" }));
  g.appendChild(svgEl("circle", { cx: cx, cy: cy - 11 * scale, r: 4 * scale, fill: color, stroke: "none" }));
  return g;
}
/**
 * The Throne portrait: cristian in the Núñez lineage identity (visual
 * identity set image 1, 2026-11-19) — black tactical figure, full black
 * face covering with the eyes visible through the goggle band, gold
 * crown, amber chest lights, seated on the high-back command throne
 * under the spider-swarm insignia. Identity presentation, not a world
 * claim. A dead seat is drawn dark and unlit: no crown gold, no eye
 * light, no swarm — the dead are never rendered operational.
 */
function drawThronePortrait(seat) {
  const svg = svgEl("svg", { viewBox: "0 0 320 300", role: "img",
    "aria-label": seat.id + " of the Núñez lineage, on the Throne" + (seat.alive ? "" : " — dead") });
  const gold = seat.alive ? "#d8a022" : "#4a4a4a";
  const goldHi = seat.alive ? "#ffd97a" : "#5a5a5a";
  svg.appendChild(svgEl("rect", { x: 0, y: 0, width: 320, height: 300, fill: "#08090b" }));
  svg.appendChild(svgEl("rect", { x: 70, y: 16, width: 180, height: 216, rx: 14, fill: "#14100a", stroke: gold, "stroke-width": 2 }));
  svg.appendChild(svgEl("rect", { x: 86, y: 32, width: 148, height: 184, rx: 10, fill: "#0d0b06", stroke: "#3a2f14" }));
  svg.appendChild(spiderInsignia(160, 56, 0.9, gold));
  if (seat.alive) {
    let s = 7;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 14; i++) {
      svg.appendChild(svgEl("circle", { cx: 24 + rnd() * 272, cy: 26 + rnd() * 240, r: 1.6, fill: "#57d7e8", opacity: 0.75 }));
    }
  }
  const crown = svgEl("polygon", { points: "128,106 136,80 148,98 160,74 172,98 184,80 192,106",
    fill: gold, stroke: goldHi, "stroke-width": 1.5 });
  svg.appendChild(crown);
  svg.appendChild(svgEl("ellipse", { cx: 160, cy: 130, rx: 26, ry: 30, fill: "#0a0a0c", stroke: "#26262b" }));
  svg.appendChild(svgEl("rect", { x: 136, y: 118, width: 48, height: 16, rx: 8, fill: "#10333d", stroke: "#2a9db8" }));
  const eyeFill = seat.alive ? "#bfeef7" : "#33424a";
  svg.appendChild(svgEl("rect", { x: 144, y: 124, width: 10, height: 3.5, fill: eyeFill }));
  svg.appendChild(svgEl("rect", { x: 166, y: 124, width: 10, height: 3.5, fill: eyeFill }));
  svg.appendChild(svgEl("rect", { x: 141, y: 136, width: 38, height: 20, rx: 6, fill: "#0d0d10" }));
  svg.appendChild(svgEl("rect", { x: 112, y: 162, width: 96, height: 88, rx: 16, fill: "#101014", stroke: "#2c2c33" }));
  svg.appendChild(svgEl("rect", { x: 126, y: 176, width: 68, height: 54, rx: 6, fill: "#0a0a0c", stroke: "#33333b" }));
  const lightFill = seat.alive ? "#ffb347" : "#3a3325";
  svg.appendChild(svgEl("rect", { x: 146, y: 188, width: 10, height: 16, fill: lightFill }));
  svg.appendChild(svgEl("rect", { x: 164, y: 188, width: 10, height: 16, fill: lightFill }));
  for (let i = 0; i < 3; i++) {
    svg.appendChild(svgEl("line", { x1: 130, y1: 214 + i * 6, x2: 190, y2: 214 + i * 6, stroke: "#26262e", "stroke-width": 2 }));
  }
  svg.appendChild(svgEl("rect", { x: 88, y: 170, width: 20, height: 66, rx: 9, fill: "#0d0d10", stroke: "#1d1d22" }));
  svg.appendChild(svgEl("rect", { x: 212, y: 170, width: 20, height: 66, rx: 9, fill: "#0d0d10", stroke: "#1d1d22" }));
  svg.appendChild(svgEl("rect", { x: 74, y: 230, width: 46, height: 12, rx: 6, fill: "#171207", stroke: gold }));
  svg.appendChild(svgEl("rect", { x: 200, y: 230, width: 46, height: 12, rx: 6, fill: "#171207", stroke: gold }));
  svg.appendChild(svgEl("rect", { x: 96, y: 250, width: 128, height: 16, rx: 6, fill: "#14100a", stroke: gold }));
  if (!seat.alive) svg.appendChild(svgEl("rect", { x: 0, y: 0, width: 320, height: 300, fill: "#05070a", opacity: 0.45 }));
  return svg;
}
/** Deterministic decoration seed from a region id (display only). */
function seedFrom(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822519); h = Math.imul(h ^ (h >>> 13), 3266489917); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
}
/**
 * The region scene: a holographic operational display of ONE region —
 * the established world identity (holographic terrain, persistent
 * operational displays) — projected from the committed frame. Terrain
 * texture expresses the region's journaled kind only; every marker is a
 * journaled fact at this tick (nodes and their stock, residents and
 * their state, edges as exits). Walking an exit moves the DISPLAY to
 * the neighbouring region; it never moves the resident.
 */
function renderScene(frame, seat) {
  const host = document.getElementById("game-scene");
  const focus = sceneFocus ?? seat.region;
  const region = frame.map.regions.find((r) => r.id === focus);
  if (!region) { sceneFocus = null; return; }
  const head = el("div", undefined, "scene-head");
  head.appendChild(el("h3", region.name));
  if (focus === seat.region) {
    head.appendChild(el("span", "CRISTIAN IS HERE", "status-pill alive"));
  } else {
    head.appendChild(el("span", "VIEWING — cristian is at " + regionName(frame, seat.region), "status-pill dead"));
    const back = el("button", "Return to cristian", "scene-return");
    back.type = "button";
    back.addEventListener("click", () => { sceneFocus = null; renderGame(frame); });
    head.appendChild(back);
  }
  host.appendChild(head);
  host.appendChild(el("p",
    "Holographic operational display — terrain and markers projected from the committed frame at tick " + frame.tick +
    ". Walking an exit moves the display, never the resident. This is committed state on a display, not the resident's perception.",
    "scene-note"));
  const wrap = el("div", undefined, "scene-wrap");
  const W = 960, H = 440, horizon = 248;
  const svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, role: "img",
    "aria-label": "Holographic display of " + region.name + " at tick " + frame.tick });
  const rnd = seedFrom(region.id);
  svg.appendChild(svgEl("rect", { x: 0, y: 0, width: W, height: horizon, fill: "#0c1620" }));
  svg.appendChild(svgEl("rect", { x: 0, y: horizon, width: W, height: H - horizon, fill: "#0a141d" }));
  for (let i = 0; i < 7; i++) {
    const y = horizon + 12 + i * i * 3.4 + i * 8;
    if (y < H) svg.appendChild(svgEl("line", { x1: 0, y1: y, x2: W, y2: y, stroke: "#12303c", "stroke-width": 1 }));
  }
  for (let i = 0; i <= 10; i++) {
    svg.appendChild(svgEl("line", { x1: 480 + (i - 5) * 26, y1: horizon, x2: 480 + (i - 5) * 150, y2: H, stroke: "#12303c", "stroke-width": 1 }));
  }
  const holo = { stroke: "#2a9db8", fill: "#57d7e8", "fill-opacity": 0.05, "stroke-width": 1.2 };
  if (region.kind === "river") {
    svg.appendChild(svgEl("path", { d: "M 0 292 Q 240 276 480 292 T 960 292 L 960 330 Q 720 316 480 330 T 0 330 Z",
      fill: "#2a9db8", "fill-opacity": 0.2, stroke: "#57d7e8", "stroke-width": 1.2 }));
    for (let i = 0; i < 3; i++) {
      svg.appendChild(svgEl("path", { d: "M -20 " + (300 + i * 9) + " q 60 -7 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0",
        stroke: "#57d7e8", fill: "none", opacity: 0.5 }));
    }
  } else if (region.kind === "desert") {
    for (let i = 0; i < 3; i++) {
      const y = 292 + i * 34;
      svg.appendChild(svgEl("path", { d: "M 0 " + y + " Q 240 " + (y - 22) + " 480 " + y + " T 960 " + y, stroke: "#2a9db8", fill: "none", "stroke-width": 1.2, opacity: 0.8 }));
    }
  } else if (region.kind === "industrial") {
    for (let i = 0; i < 7; i++) {
      const bw = 62 + rnd() * 50, bh = 26 + rnd() * 44, bx = 46 + i * 128 + rnd() * 22;
      svg.appendChild(svgEl("rect", Object.assign({ x: bx, y: horizon - bh, width: bw, height: bh }, holo)));
    }
  } else {
    const rows = region.kind === "far-shore" ? 6 : 5;
    for (let i = 0; i < rows; i++) {
      const bw = 44 + rnd() * 44, bh = (region.kind === "far-shore" ? 44 : 28) + rnd() * 40, bx = 40 + i * 152 + rnd() * 26;
      svg.appendChild(svgEl("rect", Object.assign({ x: bx, y: horizon - bh, width: bw, height: bh }, holo)));
    }
  }
  const nodesHere = frame.game.nodes.filter((n) => n.region === focus);
  nodesHere.forEach((n, idx) => {
    const x = nodesHere.length === 1 ? 250 : 200 + idx * (560 / Math.max(1, nodesHere.length - 1));
    const g = svgEl("g", {});
    g.appendChild(svgEl("line", { x1: x, y1: horizon + 6, x2: x, y2: 262, stroke: "#2a9db8", "stroke-width": 1, "stroke-dasharray": "3 5", opacity: 0.7 }));
    g.appendChild(svgEl("polygon", { points: x + ",258 " + (x + 13) + ",278 " + x + ",298 " + (x - 13) + ",278",
      fill: "#12303a", stroke: "#57d7e8", "stroke-width": 1.5 }));
    g.appendChild(svgEl("circle", { cx: x, cy: 278, r: 3.2, fill: "#57d7e8" }));
    const label = n.id + " · " + n.amount + "/" + n.capacity;
    const w = Math.max(96, label.length * 6.2 + 14);
    g.appendChild(svgEl("rect", { x: x - w / 2, y: 304, width: w, height: 17, rx: 4, fill: "#0d1a21", stroke: "#2a9db8" }));
    g.appendChild(svgEl("text", { x: x, y: 316, "text-anchor": "middle", fill: "#bfeef7", "font-size": 10 }, label));
    g.appendChild(svgEl("rect", { x: x - 45, y: 325, width: 90, height: 6, rx: 3, fill: "#0b0f13", stroke: "#2a3a46" }));
    g.appendChild(svgEl("rect", { x: x - 45, y: 325, width: Math.round(90 * n.amount / Math.max(1, n.capacity)), height: 6, rx: 3, fill: "#57d7e8" }));
    svg.appendChild(g);
  });
  const here = frame.game.residents.filter((r) => r.region === focus);
  here.forEach((r, idx) => {
    const x = here.length === 1 ? 480 : 360 + idx * (240 / Math.max(1, here.length - 1));
    const base = 372;
    const g = svgEl("g", {});
    if (!r.alive) {
      g.appendChild(svgEl("rect", { x: x - 6, y: base - 40, width: 12, height: 40, fill: "#23262b", stroke: "#3c4147" }));
      g.appendChild(svgEl("text", { x: x, y: base - 48, "text-anchor": "middle", fill: "#8a8f96", "font-size": 14 }, "†"));
      g.appendChild(svgEl("text", { x: x, y: base + 14, "text-anchor": "middle", fill: "#8a8f96", "font-size": 10.5 },
        r.id + " — fallen, tick " + r.diedAtTick));
    } else if (r.id === data.gameSeat) {
      g.appendChild(svgEl("ellipse", { cx: x, cy: base, rx: 30, ry: 6, fill: "none", stroke: "#d8a022", "stroke-width": 2 }));
      g.appendChild(svgEl("rect", { x: x - 11, y: base - 44, width: 22, height: 34, rx: 8, fill: "#0a0a0c", stroke: "#d8a022", "stroke-width": 1.5 }));
      g.appendChild(svgEl("circle", { cx: x, cy: base - 54, r: 10, fill: "#0a0a0c", stroke: "#d8a022", "stroke-width": 1.5 }));
      g.appendChild(svgEl("rect", { x: x - 8, y: base - 58, width: 16, height: 5, rx: 2.5, fill: "#10333d", stroke: "#2a9db8" }));
      g.appendChild(svgEl("polygon", { points: (x - 9) + "," + (base - 66) + " " + (x - 5) + "," + (base - 76) + " " + x + "," + (base - 68) + " " + (x + 5) + "," + (base - 76) + " " + (x + 9) + "," + (base - 66),
        fill: "#d8a022" }));
      g.appendChild(svgEl("text", { x: x, y: base + 15, "text-anchor": "middle", fill: "#ffd97a", "font-size": 11, "font-weight": 700 },
        r.id + " — the Throne"));
    } else {
      g.appendChild(svgEl("ellipse", { cx: x, cy: base, rx: 24, ry: 5, fill: "none", stroke: "#2a9db8", "stroke-width": 1.2 }));
      g.appendChild(svgEl("rect", { x: x - 10, y: base - 42, width: 20, height: 32, rx: 7, fill: "#12303a", stroke: "#57d7e8", "stroke-width": 1.2, opacity: 0.92 }));
      g.appendChild(svgEl("circle", { cx: x, cy: base - 51, r: 9, fill: "#12303a", stroke: "#57d7e8", "stroke-width": 1.2 }));
      g.appendChild(svgEl("line", { x1: x + 7, y1: base - 58, x2: x + 13, y2: base - 70, stroke: "#57d7e8", "stroke-width": 1.2 }));
      g.appendChild(svgEl("circle", { cx: x + 13, cy: base - 71, r: 2, fill: "#57d7e8" }));
      g.appendChild(svgEl("text", { x: x, y: base + 15, "text-anchor": "middle", fill: "#bfeef7", "font-size": 11 }, r.id));
    }
    svg.appendChild(g);
  });
  if (here.length === 0) {
    svg.appendChild(svgEl("text", { x: 480, y: 366, "text-anchor": "middle", fill: "#66727d", "font-size": 12 },
      "No residents in this region at tick " + frame.tick + "."));
  }
  const exits = frame.map.edges.filter((e) => e.a === focus || e.b === focus);
  exits.forEach((e, idx) => {
    const dest = e.a === focus ? e.b : e.a;
    const x = exits.length === 1 ? 480 : 130 + idx * (700 / Math.max(1, exits.length - 1));
    const bridge = e.kind === "bridge" || e.kind === "river-crossing";
    const accent = bridge ? "#d8a022" : "#57d7e8";
    const g = svgEl("g", { cursor: "pointer" });
    g.appendChild(svgEl("title", {}, "Walk the display to " + regionName(frame, dest) + " (" + e.kind + (e.name ? " · " + e.name : "") + ")"));
    g.appendChild(svgEl("path", { d: "M 480 440 L " + (x - 34) + " 440 L " + (x - 12) + " 390 L " + (x + 12) + " 390 L " + (x + 34) + " 440 Z",
      fill: accent, "fill-opacity": 0.07, stroke: accent, "stroke-width": 1, "stroke-dasharray": "4 4" }));
    g.appendChild(svgEl("polygon", { points: (x - 8) + ",402 " + x + ",390 " + (x + 8) + ",402", fill: accent }));
    const fullName = regionName(frame, dest);
    const label = (fullName.length > 16 ? fullName.slice(0, 16) + "…" : fullName) + " · " + e.kind;
    const w = Math.max(104, label.length * 6.4 + 16);
    g.appendChild(svgEl("rect", { x: x - w / 2, y: 406, width: w, height: 19, rx: 5, fill: "#0d1a21", stroke: accent }));
    g.appendChild(svgEl("text", { x: x, y: 419, "text-anchor": "middle", fill: bridge ? "#ffd97a" : "#bfeef7", "font-size": 10.5 }, label));
    g.addEventListener("click", () => { sceneFocus = dest; renderGame(frame); });
    svg.appendChild(g);
  });
  wrap.appendChild(svg);
  host.appendChild(wrap);
}
const SVGNS = "http://www.w3.org/2000/svg";
let worldSelection = data.gameSeat;
function svgEl(tag, attrs, text) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text;
  return n;
}
function wrapName(name) {
  const lines = [];
  let line = "";
  for (const word of name.split(" ")) {
    if (line && (line + " " + word).length > 15) { lines.push(line); line = word; }
    else line = line ? line + " " + word : word;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}
const REGION_FILLS = { district: "#12242e", industrial: "#1a2436", river: "#10303c", desert: "#2a2118", "far-shore": "#14261e" };
function renderWorld(frame) {
  const host = document.getElementById("world-map");
  host.replaceChildren();
  const layout = frame.game.layout;
  const pos = layout.positions;
  const svg = svgEl("svg", { viewBox: "0 0 " + layout.width + " " + layout.height, role: "img",
    "aria-label": "Schematic map of the world at tick " + frame.tick });
  svg.appendChild(svgEl("text", { x: 24, y: 38, fill: "#9fb0bd", "font-size": 13, "font-weight": 700 }, "EL PASO — far shore"));
  svg.appendChild(svgEl("text", { x: 24, y: layout.height - 18, fill: "#9fb0bd", "font-size": 13, "font-weight": 700 }, "CIUDAD JUÁREZ"));
  svg.appendChild(svgEl("rect", { x: 0, y: layout.riverTop, width: layout.width,
    height: layout.riverBottom - layout.riverTop, fill: "#0f2e3d" }));
  svg.appendChild(svgEl("line", { x1: 0, y1: (layout.riverTop + layout.riverBottom) / 2, x2: layout.width,
    y2: (layout.riverTop + layout.riverBottom) / 2, stroke: "#2a9db8", "stroke-width": 1.5, opacity: 0.8 }));
  let wave = "M 0 " + (layout.riverTop + 22);
  for (let x = 0; x < layout.width; x += 120) wave += " q 30 -10 60 0 t 60 0";
  svg.appendChild(svgEl("path", { d: wave, stroke: "#2a6f8f", "stroke-width": 3, fill: "none", opacity: 0.7 }));
  const riverLabel = svgEl("text", { x: layout.width / 2, y: layout.riverTop + 17, fill: "#7fb6c9",
    "font-size": 12, "text-anchor": "middle", "letter-spacing": 4 }, "RIO GRANDE");
  svg.appendChild(riverLabel);
  for (const e of frame.map.edges) {
    const a = pos[e.a], b = pos[e.b];
    if (!a || !b) continue;
    if (e.kind === "bridge") {
      svg.appendChild(svgEl("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: "#d8a022", "stroke-width": 7, opacity: 0.85 }));
      svg.appendChild(svgEl("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: "#ffd97a", "stroke-width": 2 }));
    } else {
      const style = e.kind === "road"
        ? { stroke: "#4a5a68", "stroke-width": 2 }
        : e.kind === "river-crossing"
          ? { stroke: "#2a6f8f", "stroke-width": 3, "stroke-dasharray": "7 5" }
          : { stroke: "#7a6748", "stroke-width": 2, "stroke-dasharray": "5 5" };
      svg.appendChild(svgEl("line", Object.assign({ x1: a.x, y1: a.y, x2: b.x, y2: b.y }, style)));
    }
    if (e.name && (e.kind === "bridge" || e.kind === "river-crossing")) {
      svg.appendChild(svgEl("text", { x: (a.x + b.x) / 2 + 8, y: (a.y + b.y) / 2 - 6,
        fill: e.kind === "bridge" ? "#ffd97a" : "#7fb6c9", "font-size": 10.5 },
        e.name + (e.crossingCapacity ? " · cap " + e.crossingCapacity : "")));
    }
  }
  const seatMark = frame.game.residents.find((r) => r.id === data.gameSeat);
  const selectedMark = frame.game.residents.find((r) => r.id === worldSelection);
  for (const region of frame.map.regions) {
    const p = pos[region.id];
    if (!p) continue;
    const g = svgEl("g", {});
    let stroke = "#46545f", strokeWidth = 1;
    if (seatMark && seatMark.region === region.id) { stroke = "#d8a022"; strokeWidth = 2.5; }
    if (selectedMark && selectedMark.region === region.id && region.id !== (seatMark && seatMark.region)) {
      stroke = "#57d7e8"; strokeWidth = 2.5;
    }
    g.appendChild(svgEl("rect", { x: p.x - 79, y: p.y - 42, width: 158, height: 84, rx: 10,
      fill: REGION_FILLS[region.kind] || "#1c2733", stroke: stroke, "stroke-width": strokeWidth }));
    const lines = wrapName(region.name);
    const nameText = svgEl("text", { x: p.x, y: p.y - 14 - (lines.length - 1) * 6.5, "text-anchor": "middle",
      fill: "#e8ecef", "font-size": 12, "font-weight": 600 });
    lines.forEach((ln, idx) => {
      const t = svgEl("tspan", { x: p.x, dy: idx === 0 ? 0 : 13 }, ln);
      nameText.appendChild(t);
    });
    g.appendChild(nameText);
    g.appendChild(svgEl("text", { x: p.x, y: p.y + 16, "text-anchor": "middle", fill: "#9fb0bd", "font-size": 9.5 },
      region.kind + " · " + region.id));
    const nodesHere = frame.game.nodes.filter((n) => n.region === region.id);
    nodesHere.forEach((n, idx) => {
      const label = n.id + " " + n.amount + "/" + n.capacity;
      const w = label.length * 6.1 + 12;
      const by = p.y - 42 - idx * 17;
      g.appendChild(svgEl("rect", { x: p.x - w / 2, y: by - 10, width: w, height: 15, rx: 7.5, fill: "#1d3a52", stroke: "#2c4a63" }));
      g.appendChild(svgEl("text", { x: p.x, y: by + 1.5, "text-anchor": "middle", fill: "#a8c8e8", "font-size": 9.5 }, label));
    });
    const here = frame.game.residents.filter((r) => r.region === region.id);
    here.forEach((r, idx) => {
      const cx = p.x + (idx - (here.length - 1) / 2) * 27;
      const cy = p.y + 30;
      const mg = svgEl("g", { cursor: "pointer" });
      mg.appendChild(svgEl("title", {}, r.id + " — " + (r.alive ? "alive" : "dead, died at tick " + r.diedAtTick) +
        " · satiety " + r.satiety + "/" + r.maxSatiety + " · inventory " + r.inventory));
      const isSeat = r.id === data.gameSeat;
      mg.appendChild(svgEl("circle", { cx: cx, cy: cy, r: 11,
        fill: !r.alive ? "#555c63" : isSeat ? "#0b0b0d" : "#1d5b6e",
        stroke: r.id === worldSelection ? "#ffffff" : isSeat && r.alive ? "#d8a022" : "#0b0f13",
        "stroke-width": r.id === worldSelection || (isSeat && r.alive) ? 2 : 1 }));
      mg.appendChild(svgEl("text", { x: cx, y: cy + 3, "text-anchor": "middle", fill: isSeat && r.alive ? "#ffd97a" : "#ffffff",
        "font-size": 8.5, "font-weight": 700 }, r.id.slice(0, 2).toUpperCase()));
      if (!r.alive) {
        mg.appendChild(svgEl("text", { x: cx + 13, y: cy - 6, fill: "#9a9a9a", "font-size": 11 }, "†"));
      }
      mg.addEventListener("click", () => { worldSelection = r.id; renderWorld(frame); });
      g.appendChild(mg);
    });
    svg.appendChild(g);
  }
  host.appendChild(svg);
  renderWorldChips(frame);
  renderWorldHud(frame);
}
function renderWorldChips(frame) {
  const host = document.getElementById("world-chips");
  host.replaceChildren();
  for (const r of frame.game.residents) {
    const chip = el("button", undefined, "resident-chip");
    chip.type = "button";
    chip.setAttribute("aria-pressed", r.id === worldSelection ? "true" : "false");
    const dot = el("span", undefined, r.id === data.gameSeat && r.alive ? "dot seat" : "dot " + (r.alive ? "alive" : "dead"));
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(r.id + (r.alive ? "" : " †")));
    chip.addEventListener("click", () => { worldSelection = r.id; renderWorld(frame); });
    host.appendChild(chip);
  }
}
function renderWorldHud(frame) {
  const host = document.getElementById("world-hud");
  host.replaceChildren();
  const r = frame.game.residents.find((x) => x.id === worldSelection);
  if (!r) {
    const born = data.seatBornTick;
    host.appendChild(el("p",
      worldSelection + " is not in the world at tick " + frame.tick +
        (worldSelection === data.gameSeat && born !== null ? " — he enters at tick " + born + "." : "."),
      "empty"));
    return;
  }
  host.appendChild(el("h3", r.id + (r.alive ? "" : " — dead")));
  host.appendChild(el("p",
    (r.alive ? "Alive" : "Dead — died at tick " + r.diedAtTick) + " · at " + regionName(frame, r.region) +
      " (" + r.region + ") · lineage " + r.lineage + " · in the world since tick " + r.bornTick));
  host.appendChild(satietyRow(r));
  host.appendChild(statRow("Inventory", (row) => row.appendChild(el("span", String(r.inventory), "value"))));
  if (r.id === data.gameSeat) {
    host.appendChild(statRow("Latest observation", (row) =>
      row.appendChild(el("span", frame.seatObservation ? "delivered at tick " + frame.seatObservation.tick : "none yet", "value"))));
  }
}
scrub.addEventListener("input", () => render(Number(scrub.value)));
document.getElementById("prev").addEventListener("click", () => { scrub.value = Math.max(0, Number(scrub.value) - 1); render(Number(scrub.value)); });
document.getElementById("next").addEventListener("click", () => { scrub.value = Math.min(data.frames.length - 1, Number(scrub.value) + 1); render(Number(scrub.value)); });
function renderVerification() {
  const receiptHost = document.getElementById("verification-receipt");
  const line = (host, label, value) => { const p = document.createElement("div"); p.innerHTML = "<strong>" + label + ":</strong> "; const code = document.createElement("code"); code.textContent = value; p.appendChild(code); host.appendChild(p); };
  if (data.verification) {
    const v = data.verification;
    receiptHost.innerHTML = "";
    // Validate the receipt's own claim fields BEFORE any verdict (GPT PR #54 finding 3 / Kimi T10):
    // without this, a receipt with { chainVerified: false }, an unknown schema, or a missing/wrong
    // claimClass but matching head/entries/tick would still render green. Every failure here is
    // FAIL — the receipt is not usable evidence for this page.
    const EXPECTED_SCHEMA = "nexus-isles-verification/v1";
    const EXPECTED_CLAIM_CLASS = "runner-attested";
    const claimFailures = [];
    if (v.schema !== EXPECTED_SCHEMA) claimFailures.push("schema: receipt " + JSON.stringify(v.schema) + " is not " + JSON.stringify(EXPECTED_SCHEMA));
    if (v.claimClass !== EXPECTED_CLAIM_CLASS) claimFailures.push("claimClass: receipt " + JSON.stringify(v.claimClass) + " is not " + JSON.stringify(EXPECTED_CLAIM_CLASS) + " (a receipt may not silently take on a stronger claim class)");
    if (v.chainVerified !== true) claimFailures.push("chainVerified: receipt reports " + JSON.stringify(v.chainVerified) + " — the verifier did not confirm the chain");
    if (v.replayStateHashesMatchedAtEveryCommit !== true) claimFailures.push("replayStateHashesMatchedAtEveryCommit: receipt reports " + JSON.stringify(v.replayStateHashesMatchedAtEveryCommit) + " — the verifier did not confirm the replay");
    // Bind the receipt to THIS artifact (GPT finding 1, PR #54): a receipt whose head/entries/tick
    // do not match the embedded replay could still have rendered green beside the wrong replay.
    // Compare, and if any field disagrees, fail closed — never display the receipt as passed.
    const lastFrameTick = data.frames.length > 0 ? data.frames[data.frames.length - 1].tick : null;
    const mismatches = [];
    if (v.head !== data.journalHeadHash) mismatches.push("head: receipt " + v.head + " vs artifact " + data.journalHeadHash);
    if (v.entries !== data.journalEntries) mismatches.push("entries: receipt " + v.entries + " vs artifact " + data.journalEntries);
    if (lastFrameTick !== null && v.tick !== lastFrameTick) mismatches.push("tick: receipt " + v.tick + " vs artifact final frame " + lastFrameTick);
    // Surface torn-tail (GPT finding 2, PR #54): Journal.loadFromFile's loadReport.tornTail
    // records a discarded fragment the chain verification does not cover. The receipt must
    // disclose it; the viewer treats it as INCOMPLETE and refuses green.
    const tornTail = v.sourceTornTail;
    const unterminated = v.sourceUnterminatedFinalEntry;
    const claimOk = claimFailures.length === 0;
    const bindingOk = mismatches.length === 0;
    const sourceClean = !tornTail;
    const verdict = document.createElement("div");
    if (!claimOk) {
      verdict.className = "verdict fail";
      verdict.textContent = "FAIL — the receipt itself does not carry the claims a runner-generated receipt must carry. It is not evidence for this page; see the list below.";
    } else if (!bindingOk) {
      verdict.className = "verdict fail";
      verdict.textContent = "FAIL — the runner-generated receipt does not match this replay artifact. A matching receipt was expected; a receipt from a different world or run is not evidence for this page.";
    } else if (!sourceClean) {
      verdict.className = "verdict absent";
      verdict.textContent = "INCOMPLETE — runner-generated receipt for this artifact, but the source journal had a torn trailing fragment at load time. The surviving prefix was verified; the discarded bytes were not. See the Source section below.";
    } else {
      verdict.className = "verdict pass";
      // Read claimClass from the receipt rather than hardcoding it: a future schema version may change it,
      // and a receipt that smuggled a weaker/stronger class in should not inherit this line's wording.
      verdict.textContent = "Runner-generated receipt (claim-class: " + v.claimClass + ") — hash chain intact and replay matched every TICK_COMMIT state hash. The run reference and head below are recorded, but external correspondence between this page and the live journal is not independently established (reproduce below).";
    }
    receiptHost.appendChild(verdict);
    if (!claimOk) {
      const list = document.createElement("ul");
      for (const f of claimFailures) { const li = document.createElement("li"); li.textContent = f; list.appendChild(li); }
      receiptHost.appendChild(list);
    } else if (!bindingOk) {
      const list = document.createElement("ul");
      for (const m of mismatches) { const li = document.createElement("li"); li.textContent = m; list.appendChild(li); }
      receiptHost.appendChild(list);
    }
    line(receiptHost, "Verified at", v.verifiedAt);
    line(receiptHost, "Head (receipt)", v.head);
    line(receiptHost, "Head (artifact)", data.journalHeadHash);
    line(receiptHost, "Tick", String(v.tick));
    line(receiptHost, "Entries", String(v.entries));
    const srcHeader = document.createElement("div"); srcHeader.innerHTML = "<strong>Source:</strong>"; receiptHost.appendChild(srcHeader);
    if (tornTail) {
      const t = document.createElement("div");
      t.className = "verdict absent";
      t.textContent = "Torn trailing fragment: " + tornTail.bytes + " bytes discarded at offset " + tornTail.offset + " (sha256 " + tornTail.sha256 + "). This prefix was verified; the discarded tail was not and is not part of the chain.";
      receiptHost.appendChild(t);
    } else if (unterminated) {
      const u = document.createElement("div"); u.className = "warn";
      u.textContent = "The final journal entry was unterminated (no trailing newline) but parsed cleanly and was kept. No bytes were discarded.";
      receiptHost.appendChild(u);
    } else {
      const c = document.createElement("div"); c.textContent = "Complete file, no torn tail."; receiptHost.appendChild(c);
    }
    if (v.actionsRunUrl) { const r = document.createElement("div"); r.innerHTML = "<strong>Run:</strong> "; const a = document.createElement("a"); a.href = v.actionsRunUrl; a.textContent = v.actionsRunUrl; a.rel = "noopener"; a.target = "_blank"; r.appendChild(a); receiptHost.appendChild(r); }
    const nb = document.createElement("div"); nb.className = "warn"; nb.textContent = "This is a runner-generated receipt, not a cryptographic signature of this page. Reproduce independently (below) for proof outside trust in the verifier."; receiptHost.appendChild(nb);
  } else {
    receiptHost.innerHTML = '<div class="verdict absent">No separate verification receipt was embedded for this render. The page shows recorded hashes only; matching values here do not constitute verification. Run the verification engine against the live journal to verify (see below).</div>';
  }
  const hostC = document.getElementById("verification-consistency");
  hostC.innerHTML = "";
  let indicesMonotone = true, hashesMatchJournaled = true, lastIndex = -1;
  for (const f of data.frames) {
    if (f.commitIndex <= lastIndex) indicesMonotone = false;
    lastIndex = f.commitIndex;
    if (f.stateHash !== f.journaledStateHash) hashesMatchJournaled = false;
  }
  const pass = indicesMonotone && hashesMatchJournaled;
  const c = document.createElement("div");
  c.className = "verdict " + (pass ? "pass" : "fail");
  c.textContent = (pass ? "PASS" : "FAIL") + " · embedded-frames internal consistency: commit indices strictly ascending and every frame's replayed state hash equals its journaled value (this check runs here in the browser; it is NOT independent verification — the frames and their journaled hashes come from the same page).";
  hostC.appendChild(c);
}
renderVerification();
render(data.frames.length - 1);
</script>
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
