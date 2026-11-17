// T5 — participant ↔ own-AI chat box. Two principals, two seats, both
// connection shapes (Tier 0 Nexus in-process; a hosted AI via the gateway).
// Acceptance (#235, 6929860889): each principal's messages reach only their
// own seat; a chat instruction that would violate the validator is refused
// and journaled as a rejection like any other. Plus AA7 and agency isolation.

import { describe, expect, it } from "vitest";
import { ChatBox, ChatError } from "../../seats/chat.js";
import { AuthError, CredentialRegistry } from "../../seats/credentials.js";
import { SeatGateway } from "../../seats/gateway.js";
import type { Action } from "../../seats/seatProvider.js";
import { NexusEmbeddedSeat } from "../../residents/nexus/embeddedSeat.js";
import type { WorldConfig } from "../../engine/world/state.js";
import { World } from "../../engine/world/world.js";
import { TEST_BACKEND } from "../helpers/worldFixtures.js";

function cfg(): WorldConfig {
  return {
    nodes: [{ id: "grove", capacity: 100, amount: 100, regen: 10 }],
    residents: [
      { id: "nexus", satiety: 9, maxSatiety: 10, actionsPerTick: 2 }, // backend bound on connect
      { id: "alpha", satiety: 9, maxSatiety: 10, actionsPerTick: 2, backend: TEST_BACKEND },
      { id: "bravo", satiety: 2, maxSatiety: 10, actionsPerTick: 2, backend: TEST_BACKEND },
    ],
    rules: { satietyDecay: 1, maxGatherPerAction: 6, blightPercent: 0, blightMax: 0 },
  };
}

/**
 * A stand-in AI: it follows its principal's current approach literally,
 * written as "verb[:node[:amount]]". Real models decide for themselves; the
 * point here is only the plumbing — what reaches whom, and what the
 * validator does with whatever the AI submits.
 */
function followApproach(chat: ChatBox, agentToken: string, submit: (a: Action) => unknown): void {
  const approach = chat.currentApproach(agentToken);
  if (!approach) return;
  const [verb, node, amount] = approach.split(":");
  const args: Record<string, unknown> = {};
  if (node) args.node = node;
  if (amount) args.amount = Number(amount);
  void submit({ verb, args });
  chat.reply(agentToken, `doing ${approach}`);
}

async function setup() {
  const world = World.create(1, cfg());
  const creds = new CredentialRegistry();
  const chat = new ChatBox(world, creds);
  const gateway = new SeatGateway(world, creds);
  // Tier 0: Nexus, in-process — the owner's seat.
  const nexusSeat = new NexusEmbeddedSeat(world);
  const nexusHandle = await nexusSeat.connect({
    seatId: "nexus", tier: 0, providerId: "nexus-intelligence", backendVersion: "run25",
    budget: { tokensPerTick: 4096, actionsPerTick: 2 },
  });
  const owner = chat.enrol("owner", "nexus");
  const nexusAgent = chat.agentCredential("nexus");
  // Tier 2: a hosted AI through the gateway — another participant's seat.
  const rival = chat.enrol("rival-principal", "alpha");
  const alphaAgent = chat.agentCredential("alpha");
  const alphaAct = creds.issue("alpha", ["act", "observe"]);
  const nexusAct = (a: Action) => nexusSeat.submit(nexusHandle, a);
  const alphaActFn = (a: Action) => gateway.submit(alphaAct.token, a);
  return { world, creds, chat, owner, nexusAgent, rival, alphaAgent, nexusAct, alphaActFn };
}

const bodies = (msgs: { body: string }[]) => msgs.map((m) => m.body);

describe("T5 chat box — own AI only", () => {
  it("each principal's messages reach only their own seat's AI (both connection shapes)", async () => {
    const { chat, owner, nexusAgent, rival, alphaAgent } = await setup();
    chat.say(owner.token, "OWNER-TO-NEXUS");
    chat.say(rival.token, "RIVAL-TO-ALPHA");
    expect(bodies(chat.directives(nexusAgent.token))).toEqual(["OWNER-TO-NEXUS"]);
    expect(bodies(chat.directives(alphaAgent.token))).toEqual(["RIVAL-TO-ALPHA"]);
    expect(bodies(chat.transcript(owner.token))).toEqual(["OWNER-TO-NEXUS"]);
    expect(bodies(chat.transcript(rival.token))).toEqual(["RIVAL-TO-ALPHA"]);
  });

  it("there is no way to address another participant's AI", async () => {
    const { creds, chat } = await setup();
    // no seat parameter exists on any principal call
    expect(chat.say.length).toBe(2);
    expect(chat.setApproach.length).toBe(2);
    expect(chat.transcript.length).toBe(1);
    // a "chat" credential minted for alpha outside enrolment is refused
    const forged = creds.issue("alpha", ["chat"]);
    expect(() => chat.say(forged.token, "hi alpha")).toThrow(/not an enrolled principal/);
    // an act/observe credential can't chat
    const act = creds.issue("alpha", ["act"]);
    expect(() => chat.say(act.token, "x")).toThrow(AuthError);
  });

  it("the owner's Tier 0 seat gets no reach over other seats", async () => {
    const { chat, owner, alphaAgent } = await setup();
    chat.setApproach(owner.token, "wait");
    expect(chat.currentApproach(alphaAgent.token)).toBeNull();
    expect(() => chat.enrol("owner", "alpha")).toThrow(/already belongs to another principal/);
  });

  it("enrolment is one principal per seat and one seat per principal", async () => {
    const { chat } = await setup();
    expect(() => chat.enrol("rival-principal", "bravo")).toThrow(/already enrolled to another seat/);
    expect(() => chat.enrol("someone", "alpha")).toThrow(/already belongs to another principal/);
    expect(() => chat.enrol("someone", "ghost")).toThrow(/unknown seat/);
    expect(() => chat.enrol("rival-principal", "alpha")).not.toThrow(); // re-issue to the same pair is fine
  });

  it("principal and agent sides don't mix", async () => {
    const { chat, owner, nexusAgent } = await setup();
    expect(() => chat.directives(owner.token)).toThrow(AuthError);
    expect(() => chat.reply(owner.token, "x")).toThrow(AuthError);
    expect(() => chat.say(nexusAgent.token, "x")).toThrow(AuthError);
  });
});

describe("T5 chat box — guidance, not authority", () => {
  it("the principal can change the AI's approach at any moment", async () => {
    const { world, chat, rival, alphaAgent, alphaActFn } = await setup();
    chat.setApproach(rival.token, "gather:grove:2");
    followApproach(chat, alphaAgent.token, alphaActFn);
    world.tick();
    chat.setApproach(rival.token, "wait");
    followApproach(chat, alphaAgent.token, alphaActFn);
    world.tick();
    const verbs = world.entries().filter((e) => e.type === "ACTION_ACCEPTED" && e.payload.seat === "alpha").map((e) => e.payload.verb);
    expect(verbs).toEqual(["gather", "wait"]);
    expect(bodies(chat.transcript(rival.token))).toEqual(["gather:grove:2", "doing gather:grove:2", "wait", "doing wait"]);
  });

  it("a chat instruction that violates the validator is refused and journaled like any other — Nexus included", async () => {
    const { world, chat, owner, nexusAgent, nexusAct, rival, alphaAgent, alphaActFn } = await setup();
    chat.setApproach(owner.token, "teleport"); // not a verb
    chat.setApproach(rival.token, "gather:grove:99"); // over maxGatherPerAction
    followApproach(chat, nexusAgent.token, nexusAct);
    followApproach(chat, alphaAgent.token, alphaActFn);
    world.tick();
    const rej = world.entries().filter((e) => e.type === "ACTION_REJECTED");
    expect(rej.map((e) => [e.payload.seat, e.payload.reason])).toEqual([
      ["alpha", "invalid_amount"],
      ["nexus", "unknown_verb"],
    ]);
    expect(world.state.residents.alpha.inventory).toBe(0);
    // the rejection carries the provenance of the brain that acted
    expect(rej.find((e) => e.payload.seat === "nexus")!.payload.backend).toEqual({ providerId: "nexus-intelligence", version: "run25" });
  });

  it("the chat box itself has no way to act in the world", async () => {
    const { chat } = await setup();
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(chat)).sort();
    expect(surface).toEqual(
      ["agent", "agentCredential", "constructor", "currentApproach", "directives", "enrol", "post", "principal", "reply", "say", "setApproach", "transcript"].sort(),
    );
  });
});

describe("T5 chat box — privacy and lifecycle", () => {
  it("AA7: no chat text, approach, or token ever reaches the journal", async () => {
    const { world, chat, owner, nexusAgent, nexusAct, rival, alphaAgent, alphaActFn } = await setup();
    const SECRET = "ZK-PLAN-4471";
    chat.say(owner.token, `${SECRET} hold the bridge`);
    chat.setApproach(owner.token, "gather:grove:1");
    chat.setApproach(rival.token, "gather:grove:1");
    followApproach(chat, nexusAgent.token, nexusAct);
    followApproach(chat, alphaAgent.token, alphaActFn);
    world.tick();
    world.tick();
    const dump = JSON.stringify(world.entries());
    expect(dump).not.toContain(SECRET);
    expect(dump).not.toContain("hold the bridge");
    expect(dump).not.toContain("doing gather");
    for (const t of [owner.token, rival.token, nexusAgent.token, alphaAgent.token]) expect(dump).not.toContain(t);
    expect(world.entries().some((e) => /CHAT|MESSAGE|APPROACH/.test(e.type))).toBe(false);
    // the actions themselves ARE journaled — world-truth, not conversation
    expect(world.entries().filter((e) => e.type === "ACTION_ACCEPTED")).toHaveLength(2);
  });

  it("revoking a principal's credential cuts them off on the next call", async () => {
    const { creds, chat, rival } = await setup();
    chat.say(rival.token, "ok");
    creds.revoke(rival.credentialId);
    expect(() => chat.say(rival.token, "x")).toThrow(/revoked/);
    expect(() => chat.transcript(rival.token)).toThrow(/revoked/);
  });

  it("death closes the seat: a dead resident's AI receives nothing new", async () => {
    const { world, chat } = await setup();
    const p = chat.enrol("bravo-principal", "bravo");
    chat.say(p.token, "before");
    world.tick();
    world.tick(); // bravo starves
    expect(world.state.residents.bravo.alive).toBe(false);
    expect(() => chat.say(p.token, "after")).toThrow(ChatError);
    expect(bodies(chat.transcript(p.token))).toEqual(["before"]);
  });

  it("messages carry attribution to the sending credential", async () => {
    const { chat, owner, nexusAgent } = await setup();
    chat.say(owner.token, "hi");
    chat.reply(nexusAgent.token, "hello");
    expect(chat.transcript(owner.token).map((m) => [m.from, m.credentialId])).toEqual([
      ["principal", owner.credentialId],
      ["agent", nexusAgent.credentialId],
    ]);
  });
});
