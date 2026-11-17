// Nexus Isles — the participant ↔ own-AI chat box (Phase 1 task T5).
//
// Every human participant (a "principal") talks directly to THEIR OWN AI
// and can change its approach at any moment. Nobody can address anyone
// else's AI. One interface, two connection shapes: Nexus is built in
// (Tier 0, in-process) and every other AI joins through the seat protocol;
// both use exactly these calls with credentials.
//
// Hard rules, enforced here:
//  - Own AI only. A principal is enrolled to exactly one seat, and a seat
//    has exactly one principal. Every call resolves the target seat from the
//    caller's credential; no call takes a seat id. A "chat" credential that
//    was not issued by enrol() is refused.
//  - Private layer (AA7). Messages live in this object's memory only: never
//    journaled, never written to disk, no export or admin-read path. They
//    are not training material.
//  - Guidance, not authority. There is no method here that submits a world
//    action. The AI reads its principal's direction and acts — if it acts —
//    through the gateway, where the single validator decides and the journal
//    records the action (with backend and credential), never the chat.
//  - Death closes the seat: a dead resident's AI receives nothing new.

import type { World } from "../engine/world/world.js";
import { AuthError, CredentialRegistry } from "./credentials.js";

export type ChatKind = "message" | "set_approach" | "reply";

export interface ChatMessage {
  id: number;
  /** World tick when sent (ordering context only). */
  tick: number;
  from: "principal" | "agent";
  kind: ChatKind;
  body: string;
  /** Credential that sent it (attribution; not a secret). */
  credentialId: string;
}

export class ChatError extends Error {}

interface Enrolment {
  principalId: string;
  seatId: string;
  credentialId: string;
}

export class ChatBox {
  private readonly bySeat = new Map<string, Enrolment>();
  private readonly byPrincipal = new Map<string, Enrolment>();
  private readonly principalCreds = new Set<string>();
  private readonly agentCreds = new Set<string>();
  private readonly threads = new Map<string, ChatMessage[]>();
  private seq = 0;

  constructor(
    private readonly world: World,
    private readonly credentials: CredentialRegistry,
  ) {}

  // ---- operator side ------------------------------------------------------

  /**
   * Bind a principal to the one seat whose AI is theirs, and issue the
   * principal's chat credential. Refuses a second principal for a seat and
   * a second seat for a principal.
   */
  enrol(principalId: string, seatId: string): { credentialId: string; token: string } {
    if (!principalId) throw new ChatError("principal id required");
    if (!this.world.state.residents[seatId]) throw new ChatError(`unknown seat ${seatId}`);
    const seatOwner = this.bySeat.get(seatId);
    if (seatOwner && seatOwner.principalId !== principalId) {
      throw new ChatError(`seat ${seatId} already belongs to another principal`);
    }
    const principalSeat = this.byPrincipal.get(principalId);
    if (principalSeat && principalSeat.seatId !== seatId) {
      throw new ChatError(`principal ${principalId} is already enrolled to another seat`);
    }
    const issued = this.credentials.issue(seatId, ["chat"]);
    const e: Enrolment = { principalId, seatId, credentialId: issued.credentialId };
    this.bySeat.set(seatId, e);
    this.byPrincipal.set(principalId, e);
    this.principalCreds.add(issued.credentialId);
    return issued;
  }

  /** Issue the seat's AI-side chat credential (in-process for Tier 0, handed to the gateway client otherwise). */
  agentCredential(seatId: string): { credentialId: string; token: string } {
    if (!this.world.state.residents[seatId]) throw new ChatError(`unknown seat ${seatId}`);
    const issued = this.credentials.issue(seatId, ["chat:agent"]);
    this.agentCreds.add(issued.credentialId);
    return issued;
  }

  // ---- principal side -----------------------------------------------------

  /** Talk to your own AI. */
  say(principalToken: string, body: string): number {
    return this.post(this.principal(principalToken), "principal", "message", body);
  }

  /** Change your AI's approach. Takes effect for the AI's next read. */
  setApproach(principalToken: string, approach: string): number {
    return this.post(this.principal(principalToken), "principal", "set_approach", approach);
  }

  /** Your conversation with your own AI. */
  transcript(principalToken: string): ChatMessage[] {
    const p = this.principal(principalToken);
    return (this.threads.get(p.seatId) ?? []).map((m) => ({ ...m }));
  }

  // ---- AI side ------------------------------------------------------------

  /** Everything the principal has said to this AI, oldest first. */
  directives(agentToken: string): ChatMessage[] {
    const a = this.agent(agentToken);
    return (this.threads.get(a.seatId) ?? []).filter((m) => m.from === "principal").map((m) => ({ ...m }));
  }

  /** The principal's latest approach, or null if never set. */
  currentApproach(agentToken: string): string | null {
    const d = this.directives(agentToken).filter((m) => m.kind === "set_approach");
    return d.length > 0 ? d[d.length - 1].body : null;
  }

  /** The AI answers its own principal. */
  reply(agentToken: string, body: string): number {
    return this.post(this.agent(agentToken), "agent", "reply", body);
  }

  // ---- internals ----------------------------------------------------------

  private principal(token: string): { seatId: string; credentialId: string } {
    const p = this.credentials.authorize(token, "chat");
    if (!this.principalCreds.has(p.credentialId)) {
      throw new AuthError("scope_denied", "not an enrolled principal credential");
    }
    return p;
  }

  private agent(token: string): { seatId: string; credentialId: string } {
    const p = this.credentials.authorize(token, "chat:agent");
    if (!this.agentCreds.has(p.credentialId)) {
      throw new AuthError("scope_denied", "not an issued agent chat credential");
    }
    return p;
  }

  private post(
    who: { seatId: string; credentialId: string },
    from: ChatMessage["from"],
    kind: ChatKind,
    body: string,
  ): number {
    if (typeof body !== "string" || body.length === 0) throw new ChatError("empty message");
    if (this.world.state.residents[who.seatId]?.alive !== true) {
      throw new ChatError(`${who.seatId} is not a living resident — the seat is closed`);
    }
    const id = ++this.seq;
    const thread = this.threads.get(who.seatId) ?? [];
    thread.push({ id, tick: this.world.tickNumber, from, kind, body, credentialId: who.credentialId });
    this.threads.set(who.seatId, thread);
    return id;
  }
}
