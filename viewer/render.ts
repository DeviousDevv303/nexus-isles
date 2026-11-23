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
  const payload = {
    label: AUDITOR_LABEL,
    journalLabel: opts.journalLabel,
    journalEntries: opts.journalEntries,
    journalHeadHash: opts.journalHeadHash,
    verification: opts.verification ?? null,
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
</style>
</head>
<body>
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
<div class="scrubber">
  <button id="prev" type="button">← Prev tick</button>
  <input id="scrub" type="range" min="0" max="${frames.length - 1}" step="1" value="${frames.length - 1}">
  <button id="next" type="button">Next tick →</button>
  <strong id="tickLabel"></strong>
</div>
<div class="meta" id="frameMeta"></div>
<div class="sides">
  <section><h2>Juárez side</h2><div id="juarez"></div></section>
  <section><h2>El Paso side</h2><div id="elpaso"></div></section>
</div>
<h2>Edges</h2>
<div id="edges"></div>
<h2>Residents</h2>
<div id="residents"></div>
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
        box.appendChild(el("div", "Zero OBSERVED node events for this node this tick — the journal recorded no activity at this node. (This is \"no activity,\" not \"evidence missing\": a missing event payload would throw at replay.)", "empty"));
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
function render(i) {
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
}
scrub.addEventListener("input", () => render(Number(scrub.value)));
document.getElementById("prev").addEventListener("click", () => { scrub.value = Math.max(0, Number(scrub.value) - 1); render(Number(scrub.value)); });
document.getElementById("next").addEventListener("click", () => { scrub.value = Math.min(data.frames.length - 1, Number(scrub.value) + 1); render(Number(scrub.value)); });
function renderVerification() {
  const receiptHost = document.getElementById("verification-receipt");
  if (data.verification) {
    const v = data.verification;
    receiptHost.innerHTML = "";
    const line = (label, value) => { const p = document.createElement("div"); p.innerHTML = "<strong>" + label + ":</strong> "; const code = document.createElement("code"); code.textContent = value; p.appendChild(code); receiptHost.appendChild(p); };
    const verdict = document.createElement("div");
    verdict.className = "verdict pass";
    verdict.textContent = "Verified by " + v.verifier + " — hash chain intact; replay matched every TICK_COMMIT state hash.";
    receiptHost.appendChild(verdict);
    line("Verified at", v.verifiedAt);
    line("Head", v.head);
    line("Tick", String(v.tick));
    line("Entries", String(v.entries));
    if (v.actionsRunUrl) { const r = document.createElement("div"); r.innerHTML = "<strong>Run:</strong> "; const a = document.createElement("a"); a.href = v.actionsRunUrl; a.textContent = v.actionsRunUrl; a.rel = "noopener"; a.target = "_blank"; r.appendChild(a); receiptHost.appendChild(r); }
    const nb = document.createElement("div"); nb.className = "warn"; nb.textContent = "The receipt is a dated statement; it is not a cryptographic signature of this page. Reproduce independently (below) for proof outside trust in the verifier."; receiptHost.appendChild(nb);
  } else {
    receiptHost.innerHTML = "<div class=\"verdict absent\">No separate verification receipt was embedded for this render. The page shows recorded hashes only; matching values here do not constitute verification. Run the verification engine against the live journal to verify (see below).</div>";
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
