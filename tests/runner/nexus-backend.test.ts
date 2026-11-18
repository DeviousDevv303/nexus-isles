// Nexus backend adapter — protocol, parsing, timeout, and driver proof.
//
// The transport is mocked: these tests prove the adapter's contract
// (prompt contains only the seat's own observation + directives; raw
// text is parsed strictly; malformed output and timeouts refuse the
// whole batch through the real SeatDriver) without loading the model.
// The live sidecar itself is proven by the smoke run recorded with the
// adapter's delivery, not by unit tests.

import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { juarezConfig } from "../../engine/world/maps/juarez.js";
import { World } from "../../engine/world/world.js";
import { createBackend } from "../../runner/backends.js";
import {
  buildNexusPrompt,
  createNexusLocalBackend,
  NEXUS_RUN25_REF,
  parseNexusRawActions,
  type NexusTransport,
} from "../../runner/nexusBackend.js";
import { SeatDriver } from "../../seats/driver.js";
import { tempDir } from "../helpers/worldFixtures.js";

const OBS = {
  tick: 7,
  visible: { satiety: 6, maxSatiety: 10, inventory: 1, position: "centro", intel: 1,
             regions: { centro: { residents: [], nodes: { "mercado-centro": 12 } } } },
};

function mockTransport(handler: (prompt: string) => Promise<string> | string): NexusTransport & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    async request(prompt: string) {
      prompts.push(prompt);
      return handler(prompt);
    },
  };
}

describe("buildNexusPrompt", () => {
  it("renders only the seat's own observation and directives", () => {
    const prompt = buildNexusPrompt({
      observation: OBS,
      directives: [{ tick: 6, kind: "owner", body: "hold position" }],
    });
    expect(prompt).toContain('"satiety":6');
    expect(prompt).toContain("mercado-centro");
    expect(prompt).toContain("hold position");
    expect(prompt).toContain("tick 7");
  });

  it("is deterministic and omits the directives section when there are none", () => {
    const a = buildNexusPrompt({ observation: OBS, directives: [] });
    const b = buildNexusPrompt({ observation: OBS, directives: [] });
    expect(a).toBe(b);
    expect(a).not.toContain("Your directives:");
  });
});

describe("parseNexusRawActions", () => {
  it("parses a bare JSON array", () => {
    expect(parseNexusRawActions('[{"verb":"gather","args":{"node":"mercado-centro","amount":1}}]'))
      .toEqual([{ verb: "gather", args: { node: "mercado-centro", amount: 1 } }]);
  });

  it("parses an array embedded in surrounding prose", () => {
    expect(parseNexusRawActions('I will gather now. [{"verb":"eat","args":{"amount":1}}] done'))
      .toEqual([{ verb: "eat", args: { amount: 1 } }]);
  });

  it("accepts an empty array (no action)", () => {
    expect(parseNexusRawActions("[]")).toEqual([]);
  });

  it.each([
    ["plain prose", "I think I should gather food"],
    ["a JSON object, not an array", '{"verb":"gather","args":{}}'],
    ["invalid JSON in brackets", "[{verb: gather}]"],
    ["an action with no verb", '[{"args":{}}]'],
    ["an action with non-object args", '[{"verb":"gather","args":3}]'],
    ["non-string output", 42],
  ])("refuses %s", (_label, raw) => {
    expect(() => parseNexusRawActions(raw)).toThrow();
  });
});

describe("createNexusLocalBackend", () => {
  it("carries the truthful Run 25 provider ref", () => {
    const backend = createNexusLocalBackend({ transport: mockTransport(() => "[]") });
    expect(backend.ref).toEqual(NEXUS_RUN25_REF);
    expect(backend.ref.providerId).toBe("nexus:run25-local");
    expect(backend.ref.version).toBe("ckpt-c41852fb");
  });

  it("is registered in the builtin registry under its providerId", () => {
    const backend = createBackend({
      seatId: "nexus",
      backend: { ...NEXUS_RUN25_REF },
      position: "centro", satiety: 8, maxSatiety: 10, actionsPerTick: 2, intel: 1,
    });
    expect(backend.ref).toEqual(NEXUS_RUN25_REF);
  });

  it("returns parsed actions from raw model text", async () => {
    const transport = mockTransport(() => '[{"verb":"gather","args":{"node":"mercado-centro","amount":2}}]');
    const backend = createNexusLocalBackend({ transport });
    await expect(backend.propose({ observation: OBS, directives: [] }))
      .resolves.toEqual([{ verb: "gather", args: { node: "mercado-centro", amount: 2 } }]);
    expect(transport.prompts).toHaveLength(1);
    expect(transport.prompts[0]).toContain("mercado-centro");
  });

  it("rejects malformed model text instead of repairing it", async () => {
    const backend = createNexusLocalBackend({ transport: mockTransport(() => "gather at the mercado, probably") });
    await expect(backend.propose({ observation: OBS, directives: [] })).rejects.toThrow();
  });

  it("rejects on sidecar error", async () => {
    const backend = createNexusLocalBackend({
      transport: mockTransport(() => { throw new Error("nexus sidecar error: generation_failed"); }),
    });
    await expect(backend.propose({ observation: OBS, directives: [] })).rejects.toThrow();
  });

  it("times out instead of hanging when the transport never answers", async () => {
    const backend = createNexusLocalBackend({
      transport: mockTransport(() => new Promise<string>(() => undefined)),
      timeoutMs: 25,
    });
    await expect(backend.propose({ observation: OBS, directives: [] })).rejects.toThrow(/timed out/);
  });
});

describe("Nexus backend through the real SeatDriver", () => {
  function makeWorld(dir: string) {
    const journalPath = join(dir, "journal.jsonl");
    const world = World.create(
      4242,
      juarezConfig([{
        id: "nexus", satiety: 8, maxSatiety: 10, actionsPerTick: 2,
        position: "centro", intel: 1, backend: { ...NEXUS_RUN25_REF },
      }]),
      { persistPath: journalPath },
    );
    return { world, journalPath };
  }

  it("submits a parsed action with the adapter's provenance, and journals no prompt text", async () => {
    const dir = tempDir();
    try {
      const { world, journalPath } = makeWorld(dir);
      const canary = "NEXUS_ADAPTER_CANARY_DO_NOT_JOURNAL";
      const transport = mockTransport(() => '[{"verb":"gather","args":{"node":"mercado-centro","amount":1}}]');
      const backend = createNexusLocalBackend({ transport });
      const driver = new SeatDriver(world, [{
        seatId: "nexus",
        backend,
        directives: () => [{ tick: world.tickNumber, kind: "owner", body: canary }],
      }]);
      world.tick(); // prime the first observation
      const report = await driver.tick();
      expect(report).toMatchObject({ submitted: 1, refused: 0 });
      const accepted = world.entries().filter(
        (e) => e.type === "ACTION_ACCEPTED" && e.payload.seat === "nexus",
      );
      expect(accepted).toHaveLength(1);
      expect(accepted[0].payload.backend).toEqual(NEXUS_RUN25_REF);
      // The canary rode the prompt (transport saw it) but never the journal.
      expect(transport.prompts[0]).toContain(canary);
      expect(readFileSync(journalPath, "utf8")).not.toContain(canary);
      world.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses the whole batch when the model text is malformed", async () => {
    const dir = tempDir();
    try {
      const { world } = makeWorld(dir);
      const backend = createNexusLocalBackend({
        transport: mockTransport(() => "certainly, gathering right away"),
      });
      const driver = new SeatDriver(world, [{ seatId: "nexus", backend }]);
      world.tick();
      const report = await driver.tick();
      expect(report).toMatchObject({ submitted: 0, refused: 1 });
      expect(world.entries().filter((e) => e.type === "ACTION_ACCEPTED")).toHaveLength(0);
      world.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
