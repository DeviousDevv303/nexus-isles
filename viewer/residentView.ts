// Nexus Isles — world viewer: the resident's view (read-only derivation).
//
// Beside the auditor's surface, the viewer renders ONE resident's view:
// what the engine authorizes that resident to perceive — his own state
// and the latest observation the engine delivered to him — plus the
// journal entries that concern him. It is derived from the same journal
// by the same replay, and it shows nothing beyond the resident's
// observation model: regions he cannot see do not appear, other
// residents appear only as names inside his delivered observation, and
// no other resident's state is shown. The two registers stay distinct:
// the resident's state is committed state at the journal head; the
// observation is mid-tick intelligence from the tick it names.
//
// The section also carries the owner's orders chat box. The page is
// static, so the box cannot write the orders file itself: it composes
// an owner order entry in the exact seat-orders schema the runner
// consumes (runner/ownerOrders.ts) and POSTs it to the relay endpoint
// below, whose route appends the entry to the world's orders file. An
// owner entry overrides the operator's orders for the same tick. If the
// endpoint is unreachable the failure is VISIBLE and the composed entry
// stays on screen for copy-paste — an order is never silently dropped.

import type { JournalEntry } from "../ledger/journal.js";
import type { WorldState } from "../engine/world/state.js";

/** The resident this view is scoped to: the founding resident of the refounding. */
export const RESIDENT_VIEW_SEAT = "cristian";

/**
 * Where the orders chat box sends owner orders: the ForgeClaw relay,
 * whose seat-orders route appends the composed entry to the world's
 * orders file. One named constant — a deployment points the box at its
 * own relay by changing this value only.
 */
export const ORDERS_ENDPOINT = "https://forgeclaw-relay.towerslutz.workers.dev";

/** The label the resident section carries. It stays on the page. */
export const RESIDENT_LABEL =
  "RESIDENT'S VIEW — what this resident is authorized to perceive: his own state and his " +
  "latest delivered observation. It is NOT the auditor's whole world, and no resident " +
  "sees the auditor's surface.";

/**
 * One owner order entry, in the exact shape of the seat-orders file the
 * runner consumes (SeatOrderEntry in runner/ownerOrders.ts — the viewer
 * may not import the runner, so the shape is pinned here and cross-checked
 * against the real parser in tests).
 */
export interface OwnerOrderEntry {
  tick: number;
  operator: "owner";
  directive: string;
  orders: [];
}

/**
 * Compose the owner order a chat-box submission produces: an entry for
 * the tick being targeted, authored by the owner, carrying his words as
 * a directive and no pre-translated actions. Under the orders file's
 * precedence rules this entry overrides the operator's orders for the
 * same tick; the operator translates the directive into action orders.
 */
export function composeOwnerOrder(text: string, tick: number): OwnerOrderEntry {
  return { tick, operator: "owner", directive: text, orders: [] };
}

/** The request body the chat box POSTs to `${ORDERS_ENDPOINT}/seat-orders`. */
export interface OrdersRequestBody {
  seat: string;
  entry: OwnerOrderEntry;
}

export function ordersRequestBody(seat: string, text: string, tick: number): OrdersRequestBody {
  return { seat, entry: composeOwnerOrder(text, tick) };
}

/** One engine action in an owner action entry: a verb and its arguments. */
export interface ActionOrder {
  verb: string;
  args: Record<string, unknown>;
}

/**
 * An owner order entry carrying pre-composed engine actions instead of
 * a directive: the gameplay composer's product. Same seat-orders schema
 * (pinned here, cross-checked against the real parser in tests); the
 * runner proposes exactly these actions through the seat driver, and
 * the validator — not this page — decides each one at resolution.
 */
export interface OwnerActionEntry {
  tick: number;
  operator: "owner";
  orders: ActionOrder[];
}

export function composeActionOrder(orders: ActionOrder[], tick: number): OwnerActionEntry {
  return { tick, operator: "owner", orders };
}

export function actionOrdersRequestBody(
  seat: string,
  orders: ActionOrder[],
  tick: number,
): { seat: string; entry: OwnerActionEntry } {
  return { seat, entry: composeActionOrder(orders, tick) };
}

/** The journaled outcome of one tick's actions for a resident. */
export interface OrderTickOutcome {
  tick: number;
  accepted: { verb: string; args: Record<string, unknown> }[];
  rejected: { verb: string; args: Record<string, unknown>; reason: string }[];
}

/**
 * Per-tick action outcomes for a resident, derived from the journal's
 * ACTION_ACCEPTED / ACTION_REJECTED entries (the engine's own verdicts,
 * journaled at resolution) — newest tick first. This is the ONLY source
 * the page may use to call an order accepted or rejected: a relay
 * "recorded" is not an outcome, and nothing here is inferred from the
 * orders file or the request that sent it.
 */
export function orderOutcomesFromJournal(
  entries: readonly JournalEntry[],
  residentId: string,
  limit = 3,
): OrderTickOutcome[] {
  const byTick = new Map<number, OrderTickOutcome>();
  for (const e of entries) {
    if (e.type !== "ACTION_ACCEPTED" && e.type !== "ACTION_REJECTED") continue;
    if (e.payload.seat !== residentId && e.actor !== residentId) continue;
    let outcome = byTick.get(e.tick);
    if (!outcome) {
      outcome = { tick: e.tick, accepted: [], rejected: [] };
      byTick.set(e.tick, outcome);
    }
    const item = {
      verb: typeof e.payload.verb === "string" ? e.payload.verb : "?",
      args: (e.payload.args ?? {}) as Record<string, unknown>,
    };
    if (e.type === "ACTION_ACCEPTED") outcome.accepted.push(item);
    else outcome.rejected.push({ ...item, reason: typeof e.payload.reason === "string" ? e.payload.reason : "rejected" });
  }
  return [...byTick.values()].sort((a, b) => b.tick - a.tick).slice(0, limit);
}

/**
 * What the action composer may offer, derived from committed state at
 * the journal head: the nodes in the resident's own region (gather
 * validates where he stands), the regions one edge away (move validates
 * adjacency), his per-tick action budget, and the gather cap. Nothing
 * beyond his position is offered, and the validator still has the last
 * word on every composed action at resolution.
 */
export interface OrderComposerModel {
  nextTick: number;
  actionsPerTick: number;
  inventory: number;
  maxGatherPerAction: number;
  nodesHere: { id: string; amount: number }[];
  exits: { id: string; name: string }[];
}

export function composerModelFromState(
  state: WorldState,
  residentId: string,
  nextTick: number,
): OrderComposerModel | null {
  const resident = state.residents[residentId];
  if (!resident || !resident.alive || !resident.position) return null;
  const nodesHere = Object.entries(state.nodes)
    .filter(([, n]) => n.region === resident.position)
    .map(([id, n]) => ({ id, amount: n.amount }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const exitIds = new Set<string>();
  if (state.map) {
    for (const e of state.map.edges) {
      if (e.a === resident.position) exitIds.add(e.b);
      else if (e.b === resident.position) exitIds.add(e.a);
    }
  }
  const exits = [...exitIds]
    .map((id) => ({ id, name: state.map?.regions.find((r) => r.id === id)?.name ?? id }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    nextTick,
    actionsPerTick: resident.actionsPerTick,
    inventory: resident.inventory,
    maxGatherPerAction: state.rules.maxGatherPerAction,
    nodesHere,
    exits,
  };
}

export interface ResidentJournalNote {
  index: number;
  tick: number;
  type: string;
  actor: string;
}

export interface ResidentObservationRegion {
  region: string;
  residents: string[];
  nodes: Record<string, number>;
}

export interface ResidentView {
  residentId: string;
  /** A LINEAGE_FOUNDED entry for this resident exists in the journal. */
  founded: boolean;
  foundingTick: number | null;
  lineage: string | null;
  alive: boolean;
  position: string | null;
  positionName: string | null;
  satiety: number | null;
  maxSatiety: number | null;
  inventory: number | null;
  /**
   * The latest observation the engine delivered to this resident, exactly
   * as journaled — the resident's authorized perception at that tick.
   */
  observation: {
    tick: number;
    position: string | null;
    regions: ResidentObservationRegion[];
  } | null;
  /** Journal entries that concern this resident, newest first. */
  recent: ResidentJournalNote[];
}

/** One delivered observation, parsed from its journal entry. */
export interface SeatObservation {
  tick: number;
  position: string | null;
  regions: ResidentObservationRegion[];
}

/**
 * Parse an OBSERVATION_DELIVERED entry into the observation it carried
 * for `residentId`. Returns null for any other entry, and for entries
 * delivered to a different seat.
 */
export function observationFromEntry(entry: JournalEntry, residentId: string): SeatObservation | null {
  if (entry.type !== "OBSERVATION_DELIVERED" || entry.payload.seat !== residentId) return null;
  const visible = entry.payload.visible as {
    position?: unknown;
    regions?: Record<string, { residents?: unknown; nodes?: unknown }>;
  };
  const regions: ResidentObservationRegion[] = [];
  if (visible && typeof visible.regions === "object" && visible.regions !== null) {
    for (const region of Object.keys(visible.regions).sort()) {
      const r = visible.regions[region];
      regions.push({
        region,
        residents: Array.isArray(r?.residents) ? (r.residents as string[]) : [],
        nodes: (r?.nodes ?? {}) as Record<string, number>,
      });
    }
  }
  return {
    tick: entry.tick,
    position: typeof visible?.position === "string" ? visible.position : null,
    regions,
  };
}

/**
 * The latest observation delivered to a seat at or before `throughTick`
 * — the seat's perception as of that tick. Pure scan of the journal,
 * newest wins; null when nothing had been delivered yet.
 */
export function latestSeatObservationAt(
  entries: readonly JournalEntry[],
  residentId: string,
  throughTick: number,
): SeatObservation | null {
  let latest: SeatObservation | null = null;
  for (const e of entries) {
    if (e.tick > throughTick) continue;
    const obs = observationFromEntry(e, residentId);
    if (obs) latest = obs;
  }
  return latest;
}

function concernsResident(entry: JournalEntry, residentId: string): boolean {
  const p = entry.payload;
  return (
    entry.actor === residentId ||
    p.resident === residentId ||
    p.seat === residentId ||
    p.successor === residentId
  );
}

/**
 * The journal entries concerning a seat at or before `throughTick`,
 * newest first, capped at `limit`. The per-frame form of the resident
 * view's `recent` list: what had happened to the seat by that tick —
 * history when the viewer is scrubbed back, the living present only at
 * the journal head.
 */
export function seatJournalNotesAt(
  entries: readonly JournalEntry[],
  residentId: string,
  throughTick: number,
  limit: number,
): ResidentJournalNote[] {
  const notes: ResidentJournalNote[] = [];
  for (let i = entries.length - 1; i >= 0 && notes.length < limit; i--) {
    const e = entries[i];
    if (e.tick > throughTick) continue;
    if (!concernsResident(e, residentId)) continue;
    notes.push({ index: e.index, tick: e.tick, type: e.type, actor: e.actor });
  }
  return notes;
}

/**
 * Derive the resident's view from the journal and the replayed final
 * state. Pure and read-only, like the rest of the viewer.
 */
export function residentViewFromJournal(
  entries: readonly JournalEntry[],
  finalState: WorldState,
  residentId: string,
): ResidentView {
  const founding = entries.find((e) => e.type === "LINEAGE_FOUNDED" && e.payload.resident === residentId);
  const resident = finalState.residents[residentId];
  const observation = latestSeatObservationAt(entries, residentId, Number.POSITIVE_INFINITY);
  const recent = seatJournalNotesAt(entries, residentId, Number.POSITIVE_INFINITY, 20);
  return {
    residentId,
    founded: founding !== undefined,
    foundingTick: founding ? founding.tick : null,
    lineage: resident ? resident.lineage : null,
    alive: resident ? resident.alive : false,
    position: resident ? resident.position : null,
    positionName:
      resident && resident.position
        ? (finalState.map?.regions.find((r) => r.id === resident.position)?.name ?? resident.position)
        : null,
    satiety: resident ? resident.satiety : null,
    maxSatiety: resident ? resident.maxSatiety : null,
    inventory: resident ? resident.inventory : null,
    observation,
    recent,
  };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Render the resident section as static HTML, chat box included. The box
 * targets `nextTick` — the next tick the world will resolve — because an
 * order can only land in a tick that has not resolved yet (AA9).
 */
export function renderResidentViewHtml(
  view: ResidentView,
  opts: { nextTick: number; composer?: OrderComposerModel | null; outcomes?: OrderTickOutcome[] },
): string {
  const parts: string[] = [];
  parts.push(`<section class="resident-view" id="resident-view" aria-label="Resident's view">`);
  parts.push(`<div class="resident-label">${esc(RESIDENT_LABEL)}</div>`);
  parts.push(`<h2>Resident's view — ${esc(view.residentId)} (the Throne)</h2>`);
  if (!view.founded) {
    parts.push(
      `<p class="empty">Not yet seated: this journal holds no LINEAGE_FOUNDED entry for ${esc(view.residentId)}. ` +
        `The seat is vacant; there is no resident's view to show.</p>`,
    );
  } else {
    parts.push(
      `<p>Founded at tick ${view.foundingTick} · lineage <span class="hash">${esc(view.lineage ?? "")}</span> · ` +
        `${view.alive ? "alive" : "dead"} · at ${esc(view.positionName ?? "—")} (${esc(view.position ?? "—")}) · ` +
        `satiety ${view.satiety}/${view.maxSatiety} · inventory ${view.inventory} ` +
        `<span class="ev-chip">DERIVED · committed state, replayed from the journal</span></p>`,
    );
    if (view.observation) {
      parts.push(
        `<h3>Latest delivered observation — tick ${view.observation.tick} ` +
          `<span class="ev-chip">OBSERVED · delivered to the resident at that tick</span></h3>`,
      );
      parts.push(
        `<p class="meta">Mid-tick intelligence the engine delivered to the resident at that tick — ` +
          `a different register from the committed state above.</p>`,
      );
      if (view.observation.regions.length === 0) {
        parts.push(`<p class="empty">The observation carried no regions.</p>`);
      }
      for (const region of view.observation.regions) {
        const nodes = Object.entries(region.nodes)
          .map(([id, amount]) => `${esc(id)} · ${amount}`)
          .join(" · ");
        const present = region.residents.length > 0 ? region.residents.map(esc).join(", ") : "no other residents";
        parts.push(
          `<div class="region"><h3>${esc(region.region)}</h3>` +
            `<div class="node">${nodes || "no nodes"}</div>` +
            `<div class="empty">${present}</div></div>`,
        );
      }
    } else {
      parts.push(`<p class="empty">NOT OBSERVED · no observation has been delivered to this resident yet.</p>`);
    }
    parts.push(`<h3>Journal entries concerning ${esc(view.residentId)}</h3>`);
    if (view.recent.length === 0) {
      parts.push(`<p class="empty">None yet.</p>`);
    } else {
      const rows = view.recent
        .map((n) => `<tr><td>${n.tick}</td><td>${n.index}</td><td>${esc(n.type)}</td><td>${esc(n.actor)}</td></tr>`)
        .join("");
      parts.push(
        `<table><tr><th>tick</th><th>entry</th><th>type</th><th>actor</th></tr>${rows}</table>`,
      );
    }
  }
  if (opts.outcomes && opts.outcomes.length > 0) {
    parts.push(`<h3>Engine outcomes — what the journal says your orders did</h3>`);
    parts.push(
      `<p class="meta">Read from the journal's ACTION_ACCEPTED / ACTION_REJECTED entries — the ` +
        `engine's verdicts at resolution, not the relay's. <span class="ev-chip">DERIVED · from journaled action entries</span></p>`,
    );
    for (const outcome of opts.outcomes) {
      const accepted = outcome.accepted
        .map((a) => `${esc(a.verb)} (${esc(JSON.stringify(a.args))})`)
        .join(" · ");
      const rejected = outcome.rejected
        .map((r) => `${esc(r.verb)} — rejected: ${esc(r.reason)}`)
        .join(" · ");
      parts.push(
        `<p>Tick ${outcome.tick} — RESOLVED${accepted ? ` · accepted: ${accepted}` : ""}` +
          `${rejected ? ` · ${rejected}` : ""}</p>`,
      );
    }
  }
  parts.push(`<h3>Direct your resident</h3>`);
  parts.push(
    `<p class="meta">An order from this box is journaled into the world's orders file as an ` +
      `<strong>owner</strong> entry for tick ${opts.nextTick} and overrides the operator's orders ` +
      `for that tick. Words go as a directive (the operator translates them into actions); ` +
      `the action composer below sends the actions themselves. Either way the engine's ` +
      `validator decides at resolution — this page records, it never accepts.</p>`,
  );
  parts.push(
    `<div class="orders-box">` +
      `<label for="orders-code">Owner code — the relay records orders only from the owner; the shared family code does not authorize orders. ` +
      `It is held only in this field, sent to the relay over HTTPS, and never stored by this page.</label>` +
      `<input id="orders-code" type="password" autocomplete="off" placeholder="Owner code">` +
      `<textarea id="orders-text" rows="3" placeholder="Your order for ${esc(view.residentId)} — e.g. gather at the market, then eat"></textarea>` +
      `<button id="orders-send" type="button">Send order for tick ${opts.nextTick}</button>` +
      `<div id="orders-status" class="meta"></div>` +
      `<pre id="orders-composed" class="orders-composed" hidden></pre>` +
      `</div>`,
  );
  if (opts.composer && view.alive) {
    const c = opts.composer;
    const nodeOptions = c.nodesHere
      .map((n) => `<option value="${esc(n.id)}">${esc(n.id)} · stock ${n.amount}</option>`)
      .join("");
    const exitOptions = c.exits
      .map((e) => `<option value="${esc(e.id)}">${esc(e.name)} (${esc(e.id)})</option>`)
      .join("");
    parts.push(
      `<div class="orders-box action-composer">` +
        `<h4>Compose actions for tick ${c.nextTick}</h4>` +
        `<p class="meta">Up to ${c.actionsPerTick} actions — his budget for one tick. Gather takes ` +
        `from a node where he stands (max ${c.maxGatherPerAction} per action); eat draws on his ` +
        `inventory (${c.inventory}); move crosses one edge. The validator can still reject any ` +
        `of these at resolution, in the open, and the outcome panel above will show it.</p>` +
        `<label>Action <select id="action-verb">` +
        `<option value="gather">gather</option><option value="eat">eat</option>` +
        `<option value="move">move</option><option value="wait">wait</option></select></label> ` +
        `<label>Node <select id="action-node">${nodeOptions}</select></label> ` +
        `<label>Amount <input id="action-amount" type="number" min="1" max="${c.maxGatherPerAction}" value="${c.maxGatherPerAction}"></label> ` +
        `<label>Move to <select id="action-exit">${exitOptions}</select></label> ` +
        `<button id="action-add" type="button">Add action</button>` +
        `<ul id="action-list"></ul>` +
        `<button id="actions-send" type="button">Send actions for tick ${c.nextTick}</button>` +
        `<div id="actions-status" class="meta"></div>` +
        `</div>`,
    );
  }
  parts.push(`<script>
"use strict";
const ORDERS_ENDPOINT = ${JSON.stringify(ORDERS_ENDPOINT)};
const ORDERS_SEAT = ${JSON.stringify(view.residentId)};
const ORDERS_TICK = ${opts.nextTick};
const COMPOSER = ${JSON.stringify(opts.composer ?? null)};
// The owner code lives only in its password field and in this request's
// header: no storage API is touched anywhere in this script, so closing
// the page forgets it. The relay — never this page — holds the GitHub
// token, and it answers for itself: recorded, duplicate, or an error.
function ordersCode() { return document.getElementById("orders-code").value; }
async function postOrder(body, status) {
  const composed = document.getElementById("orders-composed");
  composed.hidden = false;
  composed.textContent = JSON.stringify(body, null, 2);
  const code = ordersCode();
  if (!code) {
    status.textContent = "Enter your owner code first — the relay records orders only from the owner, and this page never stores the code.";
    return;
  }
  status.textContent = "Sending…";
  try {
    const res = await fetch(ORDERS_ENDPOINT + "/seat-orders", {
      method: "POST",
      headers: { "content-type": "application/json", "Authorization": "Bearer " + code },
      body: JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (res.ok && data && data.status === "recorded") {
      status.textContent = "Recorded for tick " + body.entry.tick + " as an owner entry — PENDING: the engine resolves it when tick " + body.entry.tick + " runs, and after the next world session publishes, the outcome panel on this page shows the journaled verdict. Recorded is not accepted.";
    } else if (res.ok && data && data.status === "duplicate") {
      status.textContent = "Already recorded — an identical entry is already in the orders file, so nothing was appended. To change the order, change the order itself: a correction supersedes; a retry does not.";
    } else if (res.status === 401) {
      status.textContent = "FAILED — the relay rejected the owner code (401). The order has NOT been recorded.";
    } else if (res.status === 503) {
      status.textContent = "FAILED — the relay is not configured for seat orders yet (503). The order has NOT been recorded.";
    } else {
      status.textContent = "FAILED — the relay answered " + res.status + ". The order has NOT been recorded. Your composed order is shown below, verbatim, to copy and paste — it is not lost.";
    }
  } catch (err) {
    status.textContent = "FAILED — the order did not reach the relay (" + (err && err.message ? err.message : String(err)) + "). " +
      "It has NOT been recorded. Your composed order is shown below, verbatim, to copy and paste — it is not lost.";
  }
}
document.getElementById("orders-send").addEventListener("click", async () => {
  const text = document.getElementById("orders-text").value.trim();
  const status = document.getElementById("orders-status");
  if (!text) { status.textContent = "Write an order first — an empty box sends nothing."; return; }
  await postOrder({ seat: ORDERS_SEAT, entry: { tick: ORDERS_TICK, operator: "owner", directive: text, orders: [] } }, status);
});
if (COMPOSER) {
  const chosen = [];
  const verbSel = document.getElementById("action-verb");
  const nodeSel = document.getElementById("action-node");
  const amountIn = document.getElementById("action-amount");
  const exitSel = document.getElementById("action-exit");
  const listEl = document.getElementById("action-list");
  const aStatus = document.getElementById("actions-status");
  function describe(o) {
    if (o.verb === "gather") return "gather " + o.args.amount + " · " + o.args.node;
    if (o.verb === "eat") return "eat " + o.args.amount;
    if (o.verb === "move") return "move to " + o.args.to;
    return "wait";
  }
  function syncFields() {
    const v = verbSel.value;
    nodeSel.disabled = v !== "gather";
    amountIn.disabled = !(v === "gather" || v === "eat");
    exitSel.disabled = v !== "move";
  }
  function renderChosen() {
    listEl.innerHTML = "";
    chosen.forEach((o, i) => {
      const li = document.createElement("li");
      li.textContent = describe(o) + " ";
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = "Remove";
      b.addEventListener("click", () => { chosen.splice(i, 1); renderChosen(); });
      li.appendChild(b);
      listEl.appendChild(li);
    });
  }
  verbSel.addEventListener("change", syncFields);
  syncFields();
  document.getElementById("action-add").addEventListener("click", () => {
    if (chosen.length >= COMPOSER.actionsPerTick) {
      aStatus.textContent = "That is his full budget for one tick (" + COMPOSER.actionsPerTick + " actions). Send these, or remove one.";
      return;
    }
    const v = verbSel.value;
    const amount = Number(amountIn.value);
    if (v === "gather") {
      if (!nodeSel.value) { aStatus.textContent = "No node here to gather from."; return; }
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > COMPOSER.maxGatherPerAction) {
        aStatus.textContent = "Gather amount must be a whole number from 1 to " + COMPOSER.maxGatherPerAction + ".";
        return;
      }
      chosen.push({ verb: "gather", args: { node: nodeSel.value, amount: amount } });
    } else if (v === "eat") {
      if (!Number.isSafeInteger(amount) || amount < 1) { aStatus.textContent = "Eat amount must be a whole number of at least 1."; return; }
      chosen.push({ verb: "eat", args: { amount: amount } });
    } else if (v === "move") {
      if (!exitSel.value) { aStatus.textContent = "No exit to move through."; return; }
      chosen.push({ verb: "move", args: { to: exitSel.value } });
    } else {
      chosen.push({ verb: "wait", args: {} });
    }
    aStatus.textContent = "";
    renderChosen();
  });
  document.getElementById("actions-send").addEventListener("click", async () => {
    if (!chosen.length) { aStatus.textContent = "Compose at least one action first — an empty list sends nothing."; return; }
    await postOrder({ seat: ORDERS_SEAT, entry: { tick: ORDERS_TICK, operator: "owner", orders: chosen } }, aStatus);
  });
}
</script>`);
  parts.push(`</section>`);
  return parts.join("\n");
}
