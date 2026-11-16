// Channel scopes (pair / ring / lineage / world) + scoped credentials.
// Leakage tests: a message reaches exactly its scope's members; nothing
// private reaches the journal; credentials are scoped, revocable,
// attributable, and can only ever speak for their own seat.

import { describe, expect, it } from "vitest";
import { ChannelError, ChannelHub } from "../../seats/channels.js";
import { AuthError, CredentialRegistry, type Scope } from "../../seats/credentials.js";
import { SeatGateway } from "../../seats/gateway.js";
import { standardGenesisGenome } from "../../lineage/genome.js";
import type { WorldConfig } from "../../engine/world/state.js";
import { World } from "../../engine/world/world.js";
import { TEST_BACKEND } from "../helpers/worldFixtures.js";

const IDS = ["don", "capo", "soldier", "runner", "courier", "rival"];
const FULL: Scope[] = ["act", "observe", "channel:send", "channel:read"];

function setup() {
  const cfg: WorldConfig = {
    nodes: [{ id: "grove", capacity: 200, amount: 200, regen: 20 }],
    residents: IDS.map((id) => ({
      id, satiety: id === "courier" ? 2 : 9, maxSatiety: 10, actionsPerTick: 3,
      genome: standardGenesisGenome(), backend: TEST_BACKEND,
    })),
    rules: { satietyDecay: 1, maxGatherPerAction: 6, blightPercent: 0, blightMax: 0 },
  };
  const world = World.create(1, cfg);
  const creds = new CredentialRegistry();
  const hub = new ChannelHub(world, creds);
  const gw = new SeatGateway(world, creds);
  const tok: Record<string, string> = {};
  const cid: Record<string, string> = {};
  for (const id of IDS) {
    const c = creds.issue(id, FULL);
    tok[id] = c.token;
    cid[id] = c.credentialId;
  }
  // The Order: don is Inner; capo + soldier Middle; runner + courier Outer; rival is outside.
  hub.createOrder(tok.don, "order", ["outer", "middle", "inner"]);
  hub.setRing(tok.don, "order", "capo", "middle");
  hub.setRing(tok.don, "order", "soldier", "middle");
  hub.setRing(tok.don, "order", "runner", "outer");
  hub.setRing(tok.don, "order", "courier", "outer");
  return { world, creds, hub, gw, tok, cid };
}
const bodies = (hub: ChannelHub, token: string) => hub.inbox(token).map((m) => m.body);
const readers = (hub: ChannelHub, tok: Record<string, string>, body: string) =>
  IDS.filter((id) => bodies(hub, tok[id]).includes(body)).sort();

describe("ring scope — the Order's compartments", () => {
  it("a ring message reaches exactly its ring's members", () => {
    const { hub, tok } = setup();
    hub.send(tok.capo, { scope: "ring", order: "order" }, "MIDDLE-ONLY");
    hub.send(tok.runner, { scope: "ring", order: "order" }, "OUTER-ONLY");
    hub.send(tok.don, { scope: "ring", order: "order" }, "INNER-ONLY");
    expect(readers(hub, tok, "MIDDLE-ONLY")).toEqual(["capo", "soldier"]);
    expect(readers(hub, tok, "OUTER-ONLY")).toEqual(["courier", "runner"]);
    expect(readers(hub, tok, "INNER-ONLY")).toEqual(["don"]);
  });

  it("an Outer Ring member cannot read Middle Ring traffic — and neither can the Inner ring by rank alone", () => {
    const { hub, tok } = setup();
    hub.send(tok.capo, { scope: "ring", order: "order" }, "MIDDLE-SECRET");
    expect(bodies(hub, tok.runner)).not.toContain("MIDDLE-SECRET");
    expect(bodies(hub, tok.courier)).not.toContain("MIDDLE-SECRET");
    expect(bodies(hub, tok.rival)).not.toContain("MIDDLE-SECRET");
    expect(bodies(hub, tok.don)).not.toContain("MIDDLE-SECRET");
  });

  it("promotion does not reveal earlier traffic; demotion stops future traffic", () => {
    const { hub, tok } = setup();
    hub.send(tok.capo, { scope: "ring", order: "order" }, "BEFORE-PROMOTION");
    hub.setRing(tok.don, "order", "runner", "middle");
    hub.send(tok.capo, { scope: "ring", order: "order" }, "AFTER-PROMOTION");
    expect(bodies(hub, tok.runner)).toEqual(["AFTER-PROMOTION"]);
    hub.setRing(tok.don, "order", "soldier", "outer");
    hub.send(tok.capo, { scope: "ring", order: "order" }, "AFTER-DEMOTION");
    expect(bodies(hub, tok.soldier)).toEqual(["BEFORE-PROMOTION", "AFTER-PROMOTION"]);
  });

  it("only the managing ring changes membership; outsiders cannot send to or probe an order", () => {
    const { hub, tok } = setup();
    expect(() => hub.setRing(tok.capo, "order", "rival", "middle")).toThrow(/managing ring/);
    expect(() => hub.setRing(tok.runner, "order", "runner", "inner")).toThrow(/managing ring/);
    expect(() => hub.expel(tok.rival, "order", "don")).toThrow(/managing ring/);
    const notMember = () => hub.send(tok.rival, { scope: "ring", order: "order" }, "x");
    const noSuchOrder = () => hub.send(tok.rival, { scope: "ring", order: "ghost-order" }, "x");
    expect(notMember).toThrow("not a member of that order");
    expect(noSuchOrder).toThrow("not a member of that order"); // indistinguishable
    expect(hub.myRing(tok.rival, "order")).toBeNull();
    expect(hub.myRing(tok.runner, "order")).toBe("outer");
  });

  it("expulsion: struck from the future, keeps only what already reached them", () => {
    const { hub, tok } = setup();
    hub.send(tok.capo, { scope: "ring", order: "order" }, "OLD");
    hub.expel(tok.don, "order", "soldier");
    hub.send(tok.capo, { scope: "ring", order: "order" }, "NEW");
    expect(bodies(hub, tok.soldier)).toEqual(["OLD"]);
    expect(() => hub.send(tok.soldier, { scope: "ring", order: "order" }, "x")).toThrow(/not a member/);
    expect(() => hub.expel(tok.don, "order", "don")).toThrow(/last managing member/);
  });
});

describe("pair / lineage / world scopes", () => {
  it("pair reaches exactly the two parties", () => {
    const { hub, tok } = setup();
    hub.send(tok.don, { scope: "pair", to: "rival" }, "PAIR");
    expect(readers(hub, tok, "PAIR")).toEqual(["don", "rival"]);
    expect(() => hub.send(tok.don, { scope: "pair", to: "don" }, "x")).toThrow(ChannelError);
    expect(() => hub.send(tok.don, { scope: "pair", to: "nobody" }, "x")).toThrow(ChannelError);
  });

  it("lineage reaches the sender's lineage only — a blended child is NOT in a parent's lineage channel", () => {
    const { world, creds, hub, tok } = setup();
    for (const s of ["don", "capo"]) world.submit(s, { verb: "gather", args: { node: "grove", amount: 4 } });
    world.tick();
    world.submit("don", { verb: "fork", args: {} }); // res-1, lineage:don
    world.tick();
    for (const s of ["don", "capo"]) world.submit(s, { verb: "gather", args: { node: "grove", amount: 4 } });
    world.tick();
    world.submit("don", { verb: "blend", args: { partner: "capo" } });
    world.submit("capo", { verb: "blend", args: { partner: "don" } });
    world.tick(); // res-2, its own lineage
    expect(world.state.residents["res-1"].lineage).toBe("lineage:don");
    expect(world.state.residents["res-2"].lineage).toBe("lineage:res-2");
    const heir = creds.issue("res-1", FULL).token;
    const blend = creds.issue("res-2", FULL).token;
    hub.send(tok.don, { scope: "lineage" }, "BLOOD");
    expect(bodies(hub, heir)).toContain("BLOOD");
    expect(bodies(hub, blend)).not.toContain("BLOOD");
    expect(bodies(hub, tok.capo)).not.toContain("BLOOD");
  });

  it("world reaches every living resident; the dead can neither read nor send", () => {
    const { world, hub, tok } = setup();
    hub.send(tok.courier, { scope: "world" }, "ALIVE-BROADCAST");
    world.tick();
    world.tick(); // courier starves
    expect(world.state.residents.courier.alive).toBe(false);
    hub.send(tok.don, { scope: "world" }, "AFTER-DEATH");
    const living = IDS.filter((id) => id !== "courier");
    expect(living.filter((id) => bodies(hub, tok[id]).includes("AFTER-DEATH"))).toEqual(living);
    expect(() => hub.inbox(tok.courier)).toThrow(/not a living resident/);
    expect(() => hub.send(tok.courier, { scope: "world" }, "x")).toThrow(/not a living resident/);
    hub.send(tok.runner, { scope: "ring", order: "order" }, "OUTER-AFTER");
    expect(living.filter((id) => bodies(hub, tok[id]).includes("OUTER-AFTER"))).toEqual(["runner"]);
  });
});

describe("AA7 — private content never reaches the journal", () => {
  it("no message body, channel name, or token appears anywhere in the journal", () => {
    const { world, hub, gw, tok } = setup();
    const SECRET = "XQ-SECRET-7731-PLAN";
    hub.send(tok.capo, { scope: "ring", order: "order" }, SECRET);
    hub.send(tok.don, { scope: "pair", to: "capo" }, SECRET + "-pair");
    hub.send(tok.don, { scope: "lineage" }, SECRET + "-line");
    hub.send(tok.don, { scope: "world" }, SECRET + "-world");
    gw.submit(tok.don, { verb: "gather", args: { node: "grove", amount: 1 } });
    world.tick();
    world.tick();
    const dump = JSON.stringify(world.entries());
    expect(dump).not.toContain("XQ-SECRET");
    expect(dump).not.toContain("ring:order");
    for (const t of Object.values(tok)) expect(dump).not.toContain(t);
    expect(world.entries().some((e) => /MESSAGE|CHANNEL|CHAT/.test(e.type))).toBe(false);
  });

  it("the hub exposes no way to read without being a recipient", () => {
    const { hub } = setup();
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(hub)).sort();
    expect(surface).toEqual(
      ["constructor", "createOrder", "expel", "inbox", "manage", "myRing", "requireAlive", "send", "setRing"].sort(),
    );
  });
});

describe("credentials — scoped, authenticated, revocable, attributable", () => {
  it("scoped: a read-only credential cannot send or act", () => {
    const { creds, hub, gw } = setup();
    const ro = creds.issue("don", ["channel:read", "observe"]).token;
    expect(hub.inbox(ro)).toEqual([]);
    expect(() => hub.send(ro, { scope: "world" }, "x")).toThrow(AuthError);
    expect(() => gw.submit(ro, { verb: "wait", args: {} })).toThrow(/lacks scope act/);
  });

  it("authenticated: unknown or guessed tokens are refused, and nothing is queued", () => {
    const { world, hub, gw } = setup();
    expect(() => gw.submit("deadbeef", { verb: "wait", args: {} })).toThrow(/unknown credential/);
    expect(() => hub.inbox("")).toThrow(AuthError);
    world.tick();
    expect(world.entries().filter((e) => e.type.startsWith("ACTION_"))).toHaveLength(0);
  });

  it("revocable: revocation takes effect on the next call", () => {
    const { creds, hub, gw, tok, cid } = setup();
    hub.send(tok.capo, { scope: "world" }, "ok");
    creds.revoke(cid.capo);
    expect(() => hub.send(tok.capo, { scope: "world" }, "x")).toThrow(/revoked/);
    expect(() => hub.inbox(tok.capo)).toThrow(/revoked/);
    expect(() => gw.submit(tok.capo, { verb: "wait", args: {} })).toThrow(/revoked/);
    expect(creds.revokeSeat("don")).toBe(1);
    expect(() => gw.observe(tok.don)).toThrow(/revoked/);
  });

  it("attributable: journaled actions and messages carry the credential id; direct engine submits carry null", () => {
    const { world, hub, gw, tok, cid } = setup();
    gw.submit(tok.don, { verb: "gather", args: { node: "grove", amount: 1 } });
    gw.submit(tok.capo, { verb: "teleport", args: {} });
    world.submit("rival", { verb: "wait", args: {} });
    world.tick();
    const rec = Object.fromEntries(
      world.entries().filter((e) => e.type.startsWith("ACTION_")).map((e) => [e.payload.seat, e.payload.credential]),
    );
    expect(rec).toEqual({ don: cid.don, capo: cid.capo, rival: null });
    hub.send(tok.don, { scope: "pair", to: "capo" }, "hi");
    expect(hub.inbox(tok.capo)[0]).toMatchObject({ from: "don", credentialId: cid.don, scope: "pair" });
  });

  it("agency isolation: a credential can only ever act and observe as its own seat", () => {
    const { world, gw, tok } = setup();
    // An action that names another seat in its args is still the caller's action.
    gw.submit(tok.rival, { verb: "gather", args: { node: "grove", amount: 2, seat: "don", seatId: "don" } });
    world.tick();
    expect(world.state.residents.rival.inventory).toBe(2);
    expect(world.state.residents.don.inventory).toBe(0);
    expect(gw.submit.length).toBe(2); // (token, action): no seat parameter exists
    world.tick();
    const own = gw.observe(tok.rival)!.visible as { inventory: number };
    expect(own.inventory).toBe(2);
  });

  it("gateway actions still pass the single validator (no bypass)", () => {
    const { world, gw, tok } = setup();
    for (let i = 0; i < 4; i++) gw.submit(tok.don, { verb: "gather", args: { node: "grove", amount: 1 } });
    world.tick();
    const rej = world.entries().filter((e) => e.type === "ACTION_REJECTED");
    expect(rej.map((e) => e.payload.reason)).toEqual(["budget_exceeded"]);
  });
});
