// Nexus Isles — private channels with scopes: pair / ring / lineage / world.
//
// Private layer (AA7): message content lives only in this hub's memory. It
// is never journaled, never written to disk, and this module has no export,
// dump, or admin-read path — the only way to read a message is to be one of
// its recipients, presenting a credential with "channel:read".
//
// Delivery is fixed at send time: recipients are the living members of the
// scope at that moment. Joining a ring later does not reveal earlier
// traffic; leaving one does not un-know what was already received. That is
// compartmentalisation: a member exposes only what reached them.
//
//   pair     the sender and one named resident
//   ring     the members of the sender's own ring in an order
//   lineage  the living members of the sender's lineage (journal-derived)
//   world    every living resident
//
// Orders and rings are private-layer organisation (membership is not world
// state). An order has ranked rings; only members of its top ring manage
// membership.

import type { World } from "../engine/world/world.js";
import { CredentialRegistry } from "./credentials.js";

export type ChannelTarget =
  | { scope: "pair"; to: string }
  | { scope: "ring"; order: string }
  | { scope: "lineage" }
  | { scope: "world" };

export interface Message {
  id: number;
  tick: number;
  from: string;
  /** Credential that authorized the send (attribution; not a secret). */
  credentialId: string;
  scope: ChannelTarget["scope"];
  /** "pair:<a>+<b>", "ring:<order>/<ring>", "lineage:<id>", or "world". */
  channel: string;
  body: string;
}

interface Stored extends Message {
  recipients: ReadonlySet<string>;
}

interface Order {
  /** Ring names, lowest rank first; the last is the managing ring. */
  rings: string[];
  /** resident -> ring name */
  members: Map<string, string>;
}

export class ChannelError extends Error {}

export class ChannelHub {
  private readonly messages: Stored[] = [];
  private readonly orders = new Map<string, Order>();
  private seq = 0;

  constructor(
    private readonly world: World,
    private readonly credentials: CredentialRegistry,
  ) {}

  // ---- orders and rings ---------------------------------------------------

  /** Found an order. The founder is placed in the top (managing) ring. */
  createOrder(token: string, orderId: string, rings: string[]): void {
    const p = this.credentials.authorize(token, "channel:send");
    this.requireAlive(p.seatId);
    if (this.orders.has(orderId)) throw new ChannelError(`order ${orderId} already exists`);
    if (rings.length === 0 || new Set(rings).size !== rings.length) {
      throw new ChannelError("an order needs one or more distinct rings");
    }
    this.orders.set(orderId, {
      rings: [...rings],
      members: new Map([[p.seatId, rings[rings.length - 1]]]),
    });
  }

  /** Place (or move) a resident in a ring. Top-ring members only. */
  setRing(token: string, orderId: string, resident: string, ring: string): void {
    const { order } = this.manage(token, orderId);
    if (!order.rings.includes(ring)) throw new ChannelError(`order ${orderId} has no ring ${ring}`);
    this.requireAlive(resident);
    order.members.set(resident, ring);
  }

  /** Strike a resident from the order. Top-ring members only. */
  expel(token: string, orderId: string, resident: string): void {
    const { order, seatId } = this.manage(token, orderId);
    const top = order.rings[order.rings.length - 1];
    if (resident === seatId && [...order.members.values()].filter((r) => r === top).length === 1) {
      throw new ChannelError("the last managing member cannot expel themselves");
    }
    order.members.delete(resident);
  }

  /** A member may learn only their OWN ring, never the roster. */
  myRing(token: string, orderId: string): string | null {
    const p = this.credentials.authorize(token, "channel:read");
    return this.orders.get(orderId)?.members.get(p.seatId) ?? null;
  }

  // ---- messaging ----------------------------------------------------------

  send(token: string, target: ChannelTarget, body: string): number {
    const p = this.credentials.authorize(token, "channel:send");
    this.requireAlive(p.seatId);
    if (typeof body !== "string" || body.length === 0) throw new ChannelError("empty message");
    const state = this.world.state;
    const alive = (id: string): boolean => state.residents[id]?.alive === true;
    let channel: string;
    let recipients: string[];
    switch (target.scope) {
      case "pair": {
        if (target.to === p.seatId || !alive(target.to)) {
          throw new ChannelError("pair target must be another living resident");
        }
        channel = `pair:${[p.seatId, target.to].sort().join("+")}`;
        recipients = [p.seatId, target.to];
        break;
      }
      case "ring": {
        const order = this.orders.get(target.order);
        const ring = order?.members.get(p.seatId);
        // Same error whether the order is missing or the sender is not in
        // it: a non-member cannot probe which orders exist.
        if (!order || !ring) throw new ChannelError("not a member of that order");
        channel = `ring:${target.order}/${ring}`;
        recipients = [...order.members].filter(([id, r]) => r === ring && alive(id)).map(([id]) => id);
        break;
      }
      case "lineage": {
        const lineage = state.residents[p.seatId].lineage;
        channel = lineage;
        recipients = Object.keys(state.residents).filter(
          (id) => alive(id) && state.residents[id].lineage === lineage,
        );
        break;
      }
      case "world": {
        channel = "world";
        recipients = Object.keys(state.residents).filter(alive);
        break;
      }
      default:
        throw new ChannelError("unknown channel scope");
    }
    const id = ++this.seq;
    this.messages.push({
      id,
      tick: state.tick,
      from: p.seatId,
      credentialId: p.credentialId,
      scope: target.scope,
      channel,
      body,
      recipients: new Set(recipients),
    });
    return id;
  }

  /** Everything delivered to the caller's seat, oldest first. */
  inbox(token: string): Message[] {
    const p = this.credentials.authorize(token, "channel:read");
    this.requireAlive(p.seatId); // death closes the seat
    return this.messages
      .filter((m) => m.recipients.has(p.seatId))
      .map(({ recipients: _recipients, ...m }) => ({ ...m }));
  }

  // ---- internals ----------------------------------------------------------

  private manage(token: string, orderId: string): { order: Order; seatId: string } {
    const p = this.credentials.authorize(token, "channel:send");
    this.requireAlive(p.seatId);
    const order = this.orders.get(orderId);
    const top = order?.rings[order.rings.length - 1];
    if (!order || order.members.get(p.seatId) !== top) {
      throw new ChannelError("only the order's managing ring may do that");
    }
    return { order, seatId: p.seatId };
  }

  private requireAlive(seatId: string): void {
    if (this.world.state.residents[seatId]?.alive !== true) {
      throw new ChannelError(`${seatId} is not a living resident`);
    }
  }
}
