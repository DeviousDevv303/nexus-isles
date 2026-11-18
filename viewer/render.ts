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
import type { TickFrame } from "./replay.js";

/** The auditor-surface label. Acceptance condition: it stays on the page. */
export const AUDITOR_LABEL =
  "AUDITOR'S SURFACE — read-only observer view. This page is an auditor's view of the world, " +
  "replayed from the journal. It is NOT a resident's view: no resident sees this page, " +
  "and nothing on it can act on the world.";

export interface RenderOptions {
  /** Shown in the header: where the journal came from. */
  journalLabel: string;
  /** Total journal entries the frames were replayed from. */
  journalEntries: number;
  /** Hash of the journal's final entry. */
  journalHeadHash: string;
}

/** The map a frame is drawn on: the journaled map, else the Juárez shell. */
export function mapForFrame(frame: TickFrame): MapSpec {
  return frame.state.map ?? juarezMap();
}

function jsonForScript(value: unknown): string {
  // Keep the payload from ever closing the script element it rides in.
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * Render the whole viewer as one static HTML document. Deterministic:
 * the same frames in give the same bytes out.
 */
export function renderViewerHtml(frames: readonly TickFrame[], opts: RenderOptions): string {
  if (frames.length === 0) throw new Error("no frames to render: the journal committed no ticks");
  const payload = {
    label: AUDITOR_LABEL,
    journalLabel: opts.journalLabel,
    journalEntries: opts.journalEntries,
    journalHeadHash: opts.journalHeadHash,
    frames: frames.map((f) => ({
      tick: f.tick,
      commitIndex: f.commitIndex,
      commitHash: f.commitHash,
      stateHash: f.stateHash,
      journaledStateHash: f.journaledStateHash,
      map: mapForFrame(f),
      nodes: f.state.nodes,
      residents: f.state.residents,
    })),
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Nexus Isles — Auditor's World View</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; background: #101418; color: #e8ecef; }
  .auditor-label { border: 2px solid #d8a022; background: #2a2110; color: #ffd97a;
    padding: 0.75rem 1rem; font-weight: 600; border-radius: 6px; }
  .meta { color: #9fb0bd; font-size: 0.9rem; margin: 0.75rem 0; word-break: break-all; }
  .scrubber { display: flex; gap: 0.75rem; align-items: center; margin: 1rem 0; }
  .scrubber input[type=range] { flex: 1; }
  .sides { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; align-items: start; }
  .region { border: 1px solid #39434d; border-radius: 6px; padding: 0.6rem 0.8rem; margin-bottom: 0.75rem; background: #171d23; }
  .region h3 { margin: 0 0 0.4rem; font-size: 1rem; }
  .resident { color: #a8d8a8; } .dead { color: #d88a8a; text-decoration: line-through; }
  .node { color: #a8c8e8; } .empty { color: #66727d; }
  table { border-collapse: collapse; margin-top: 1rem; }
  td, th { border: 1px solid #39434d; padding: 0.3rem 0.6rem; text-align: left; font-size: 0.9rem; }
  .hash { font-family: ui-monospace, monospace; font-size: 0.8rem; word-break: break-all; }
</style>
</head>
<body>
<div class="auditor-label">${AUDITOR_LABEL}</div>
<h1>Nexus Isles — World View</h1>
<div class="meta">Journal: ${escapeHtml(opts.journalLabel)} · entries: ${opts.journalEntries} · head: <span class="hash">${opts.journalHeadHash}</span></div>
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
render(data.frames.length - 1);
</script>
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
