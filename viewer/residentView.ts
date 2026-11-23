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
  let observation: ResidentView["observation"] = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.type !== "OBSERVATION_DELIVERED" || e.payload.seat !== residentId) continue;
    const visible = e.payload.visible as {
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
    observation = {
      tick: e.tick,
      position: typeof visible?.position === "string" ? visible.position : null,
      regions,
    };
    break;
  }
  const recent: ResidentJournalNote[] = [];
  for (let i = entries.length - 1; i >= 0 && recent.length < 20; i--) {
    const e = entries[i];
    if (!concernsResident(e, residentId)) continue;
    recent.push({ index: e.index, tick: e.tick, type: e.type, actor: e.actor });
  }
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
export function renderResidentViewHtml(view: ResidentView, opts: { nextTick: number }): string {
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
        `satiety ${view.satiety}/${view.maxSatiety} · inventory ${view.inventory}</p>`,
    );
    if (view.observation) {
      parts.push(`<h3>Latest delivered observation — tick ${view.observation.tick}</h3>`);
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
      parts.push(`<p class="empty">No observation has been delivered to this resident yet.</p>`);
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
  parts.push(`<h3>Direct your resident</h3>`);
  parts.push(
    `<p class="meta">An order from this box is journaled into the world's orders file as an ` +
      `<strong>owner</strong> entry for tick ${opts.nextTick} and overrides the operator's orders ` +
      `for that tick. The operator translates your words into the resident's actions.</p>`,
  );
  parts.push(
    `<div class="orders-box">` +
      `<textarea id="orders-text" rows="3" placeholder="Your order for ${esc(view.residentId)} — e.g. gather at the market, then eat"></textarea>` +
      `<button id="orders-send" type="button">Send order for tick ${opts.nextTick}</button>` +
      `<div id="orders-status" class="meta"></div>` +
      `<pre id="orders-composed" class="orders-composed" hidden></pre>` +
      `</div>`,
  );
  parts.push(`<script>
"use strict";
const ORDERS_ENDPOINT = ${JSON.stringify(ORDERS_ENDPOINT)};
const ORDERS_SEAT = ${JSON.stringify(view.residentId)};
const ORDERS_TICK = ${opts.nextTick};
document.getElementById("orders-send").addEventListener("click", async () => {
  const text = document.getElementById("orders-text").value.trim();
  const status = document.getElementById("orders-status");
  const composed = document.getElementById("orders-composed");
  if (!text) { status.textContent = "Write an order first — an empty box sends nothing."; return; }
  const body = { seat: ORDERS_SEAT, entry: { tick: ORDERS_TICK, operator: "owner", directive: text, orders: [] } };
  composed.hidden = false;
  composed.textContent = JSON.stringify(body, null, 2);
  status.textContent = "Sending…";
  try {
    const res = await fetch(ORDERS_ENDPOINT + "/seat-orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("relay answered " + res.status);
    status.textContent = "Order sent for tick " + ORDERS_TICK + " as an owner entry. It overrides the operator's orders for that tick.";
  } catch (err) {
    status.textContent = "FAILED — the order did not reach the relay (" + (err && err.message ? err.message : String(err)) + "). " +
      "It has NOT been recorded. Your composed order is shown below, verbatim, to copy and paste — it is not lost.";
  }
});
</script>`);
  parts.push(`</section>`);
  return parts.join("\n");
}
