// AA7 — replay after deliberation deletion.
//
// The seat driver journals the parsed action and the backend identity/version
// that produced it. Raw backend deliberation belongs outside the journal (in
// the future encrypted deliberation store). This test uses a plain file as a
// stand-in for that store, deletes the whole store, and then proves that a
// from-scratch journal replay still reproduces the live world exactly.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalStringify, Journal } from "../../ledger/journal.js";
import { juarezConfig } from "../../engine/world/maps/juarez.js";
import { hashState } from "../../engine/world/state.js";
import { World } from "../../engine/world/world.js";
import { deriveDynastyScore } from "../../observer/dynastyScore.js";
import { deriveReport } from "../../observer/report.js";
import { RawOutputBackend, SeatDriver, parseBackendActions } from "../../seats/driver.js";
import { rebuildJournal, tempDir } from "../helpers/worldFixtures.js";

const CANARY = "AA7_RAW_DELIBERATION_CANARY_7f42_DO_NOT_JOURNAL";
const BACKEND = { providerId: "test-double:raw-output", version: "replay-after-deletion-v1" } as const;
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** The observer-facing emission used by AT-18 (v)/(vi), for one world. */
function emission(world: World): string {
  const journal = rebuildJournal(world);
  const seats = Object.keys(world.state.residents).sort();
  return canonicalStringify({
    report: deriveReport(journal),
    score: deriveDynastyScore(journal, "replay-after-deletion"),
    observations: Object.fromEntries(seats.map((seat) => [seat, world.observe(seat)])),
  });
}

describe("AA7 replay after deliberation deletion", () => {
  it("replays the identical head, state, and observer emission after the deliberation store is deleted", async () => {
    const dir = tempDir();
    const journalPath = join(dir, "journal.jsonl");
    const deliberationStorePath = join(dir, "deliberation-store.jsonl");
    let backendCalls = 0;

    try {
      const backend = new RawOutputBackend(
        BACKEND,
        (input) => {
          backendCalls += 1;
          const rawOutput =
            `${CANARY} private deliberation for delivered tick ${input.observation.tick}: ` +
            JSON.stringify([{ verb: "gather", args: { node: "mercado-centro", amount: 1 } }]);

          // The stand-in deliberation store captures both sides of the raw
          // backend exchange. It is deliberately outside the journal file.
          appendFileSync(
            deliberationStorePath,
            JSON.stringify({ backendInput: input, rawOutput }) + "\n",
            "utf8",
          );
          return rawOutput;
        },
        (raw) => {
          if (typeof raw !== "string") throw new Error("test backend must return raw text");
          return parseBackendActions(JSON.parse(raw.slice(raw.indexOf("["))));
        },
      );

      const world = World.create(
        77,
        // Declared scratch: the seat is driven by a labeled test double,
        // which only a declared scratch world may seat (world-class-v1).
        {
          ...juarezConfig([
            {
              id: "nexus",
              satiety: 9,
              maxSatiety: 10,
              actionsPerTick: 2,
              position: "centro",
              intel: 1,
              backend: BACKEND,
            },
          ]),
          worldClass: "scratch",
        },
        { persistPath: journalPath },
      );

      const driver = new SeatDriver(world, [{ seatId: "nexus", backend }]);
      world.tick(); // Deliver the first observation through the journal.
      for (let i = 0; i < 3; i++) {
        const report = await driver.tick();
        expect(report).toMatchObject({ submitted: 1, refused: 0 });
      }

      expect(backendCalls).toBe(3);
      expect(
        world.entries().filter(
          (entry) => entry.type === "ACTION_ACCEPTED" && entry.payload.seat === "nexus",
        ),
      ).toHaveLength(3);

      const liveHeadHash = world.headHash;
      const liveStateHash = hashState(world.state);
      const liveEmission = emission(world);
      const journalBytes = readFileSync(journalPath, "utf8");
      const deliberationBytes = readFileSync(deliberationStorePath, "utf8");

      // The raw exchange really was captured outside the journal, and its
      // canary never crossed into the journal's bytes.
      expect(deliberationBytes.match(new RegExp(CANARY, "g"))).toHaveLength(3);
      expect(journalBytes).not.toContain(CANARY);

      rmSync(deliberationStorePath);
      expect(existsSync(deliberationStorePath)).toBe(false);

      world.close();
      const loadedJournal = Journal.loadFromFile(journalPath);
      expect(loadedJournal.verify()).toEqual({ ok: true, length: world.entries().length });
      const replayed = World.restore(loadedJournal);

      expect(replayed.headHash).toBe(liveHeadHash);
      expect(hashState(replayed.state)).toBe(liveStateHash);
      expect(sha256(emission(replayed))).toBe(sha256(liveEmission));
      expect(emission(replayed)).toBe(liveEmission);
      expect(readFileSync(journalPath, "utf8")).toBe(journalBytes);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
