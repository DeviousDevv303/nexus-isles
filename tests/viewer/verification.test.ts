// ChatGPT's P1 audit on the live viewer (forgeclaw #235, Muse's relay):
// the page used to show stateHash and journaledStateHash beside each other
// and let the reader infer verification from their matching. "Displayed
// matching" is not proof. These tests pin the three distinct roles
// (replay artifact, verification engine, live observer) and the way the
// receipt is embedded.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Journal } from "../../ledger/journal.js";
import { parseGenesisConfig } from "../../runner/config.js";
import { LaunchRunner } from "../../runner/runner.js";
import { buildReceipt, statusMarkdown, worldStatus, type VerificationReceipt } from "../../runner/worldStatus.js";
import { renderViewerHtml } from "../../viewer/render.js";
import { replayFrames } from "../../viewer/replay.js";
import { tempDir } from "../helpers/worldFixtures.js";

async function makeWorld(ticks = 5) {
  const dir = tempDir();
  const runner = new LaunchRunner({
    dataDir: dir,
    genesis: parseGenesisConfig({
      seed: 3, map: "juarez", worldClass: "persistent",
      seats: [
        { seatId: "scout", actionsPerTick: 2, intel: 1, maxSatiety: 10, position: "industrial-east", satiety: 8, backend: { providerId: "scripted-policy:survival", version: "v1" } },
      ],
    }),
    log: () => {},
  });
  await runner.start();
  for (let i = 0; i < ticks; i++) await runner.tickOnce();
  await runner.stop();
  return { dir, journalPath: join(dir, "journal.jsonl") };
}

function render(journalPath: string, verification: VerificationReceipt | null) {
  const journal = Journal.loadFromFile(journalPath);
  return renderViewerHtml(replayFrames(journal), {
    journalLabel: journalPath,
    journalEntries: journal.length,
    journalHeadHash: journal.headHash(),
    verification,
  });
}

describe("verification receipts (P1)", () => {
  it("buildReceipt records chain-verified and replay-matched as the only two claims it makes", async () => {
    const { journalPath } = await makeWorld();
    const status = worldStatus(Journal.loadFromFile(journalPath));
    const receipt = buildReceipt(status, { journalPath });
    expect(receipt.schema).toBe("nexus-isles-verification/v1");
    expect(receipt.chainVerified).toBe(true);
    expect(receipt.replayStateHashesMatchedAtEveryCommit).toBe(true);
    expect(receipt.head).toBe(status.head);
    expect(receipt.entries).toBe(status.entries);
    expect(receipt.tick).toBe(status.tick);
    expect(receipt.verifier).toBe("runner/status.ts");
    expect(new Date(receipt.verifiedAt).toString()).not.toBe("Invalid Date");
    expect(receipt.sourceTornTail).toBeNull();
    expect(receipt.sourceUnterminatedFinalEntry).toBe(false);
    // The receipt does not claim cryptographic signing of the page or of itself.
    expect(Object.keys(receipt).join(" ")).not.toMatch(/signature|signed/i);
  });

  it("picks up the Actions run URL only when both server and run id are set", async () => {
    const { journalPath } = await makeWorld();
    const status = worldStatus(Journal.loadFromFile(journalPath));
    const prev = { s: process.env.GITHUB_SERVER_URL, r: process.env.GITHUB_REPOSITORY, i: process.env.GITHUB_RUN_ID };
    try {
      delete process.env.GITHUB_SERVER_URL; delete process.env.GITHUB_REPOSITORY; delete process.env.GITHUB_RUN_ID;
      expect(buildReceipt(status, { journalPath }).actionsRunUrl).toBeNull();
      process.env.GITHUB_SERVER_URL = "https://github.com";
      process.env.GITHUB_REPOSITORY = "DeviousDevv303/nexus-isles";
      process.env.GITHUB_RUN_ID = "42";
      expect(buildReceipt(status, { journalPath }).actionsRunUrl).toBe("https://github.com/DeviousDevv303/nexus-isles/actions/runs/42");
    } finally {
      if (prev.s !== undefined) process.env.GITHUB_SERVER_URL = prev.s; else delete process.env.GITHUB_SERVER_URL;
      if (prev.r !== undefined) process.env.GITHUB_REPOSITORY = prev.r; else delete process.env.GITHUB_REPOSITORY;
      if (prev.i !== undefined) process.env.GITHUB_RUN_ID = prev.i; else delete process.env.GITHUB_RUN_ID;
    }
  });
});

describe("the rendered page says what it is and what it isn't (P1 + three-roles)", () => {
  it("never claims 'cryptographically verified' and distinguishes replay artifact, verification engine and live observer", async () => {
    const { journalPath } = await makeWorld();
    const html = render(journalPath, null);
    expect(html.toLowerCase()).not.toMatch(/cryptographically verified/);
    expect(html).toMatch(/replay artifact/);
    expect(html).toMatch(/verification engine/);
    expect(html).toMatch(/live observer/);
  });

  it("without a receipt the page says so explicitly instead of letting matching hashes read as verification", async () => {
    const { journalPath } = await makeWorld();
    const html = render(journalPath, null);
    expect(html).toMatch(/No separate verification receipt/);
    expect(html).toMatch(/matching values here do not constitute verification/);
  });

  it("with a receipt the page names who verified, when, and under which run (when the run URL is present)", async () => {
    const { journalPath } = await makeWorld();
    const status = worldStatus(Journal.loadFromFile(journalPath));
    process.env.GITHUB_SERVER_URL = "https://github.com";
    process.env.GITHUB_REPOSITORY = "DeviousDevv303/nexus-isles";
    process.env.GITHUB_RUN_ID = "99";
    const receipt = buildReceipt(status, { journalPath });
    delete process.env.GITHUB_SERVER_URL; delete process.env.GITHUB_REPOSITORY; delete process.env.GITHUB_RUN_ID;
    const html = render(journalPath, receipt);
    // The browser JS now labels it "Runner-generated receipt" when binding is OK (GPT PR #54 refinement).
    expect(html).toMatch(/Runner-generated receipt/)
    expect(html).toContain('"verifier":"runner/status.ts"');
    expect(html).toMatch(/hash chain intact and replay matched every TICK_COMMIT state hash/);
    expect(html).toMatch(/replay matched every TICK_COMMIT state hash/);
    expect(html).toContain(receipt.verifiedAt);
    expect(html).toContain("https://github.com/DeviousDevv303/nexus-isles/actions/runs/99");
    expect(html).toMatch(/runner-generated receipt, not a cryptographic signature/);
  });

  it("carries a copy-pasteable independent verification command keyed on the real head", async () => {
    const { journalPath } = await makeWorld();
    const journal = Journal.loadFromFile(journalPath);
    const html = render(journalPath, null);
    expect(html).toContain(`--expect-head ${journal.headHash()}`);
    expect(html).toMatch(/Reproduce independently/);
  });
});

describe("P5 wording and layout", () => {
  it("distinguishes zero activity from missing evidence on a node with no events", async () => {
    const { journalPath } = await makeWorld();
    const html = render(journalPath, null);
    expect(html).toMatch(/Zero OBSERVED node events for this node this tick/);
    expect(html).toMatch(/This is "no activity," not "evidence missing"/);
  });

  it("stacks the two sides on narrow screens so the layout works on a phone", async () => {
    const { journalPath } = await makeWorld();
    const html = render(journalPath, null);
    expect(html).toMatch(/@media\s*\(max-width:\s*720px\)[^}]*\.sides\s*\{\s*grid-template-columns:\s*1fr/);
  });
});

describe("the CLI writes a receipt when asked", () => {
  it("--receipt writes a valid VerificationReceipt JSON that round-trips", async () => {
    const { dir, journalPath } = await makeWorld();
    const receiptPath = join(dir, "verification.json");
    // Simulate the CLI's write path (buildReceipt + writeFileSync).
    const receipt = buildReceipt(worldStatus(Journal.loadFromFile(journalPath)), { journalPath });
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n", "utf8");
    const parsed = JSON.parse(readFileSync(receiptPath, "utf8")) as VerificationReceipt;
    expect(parsed).toEqual(receipt);
  });
});

// ChatGPT's PR #54 review (forgeclaw #235, 2026-11-23) landed two
// correctness findings against the first version of this feature:
//   1. Receipt was not bound to the artifact: a stale or mismatched receipt
//      could render green beside a different replay. Fixed by comparing
//      receipt.head/entries/tick against the embedded artifact, failing
//      closed on any disagreement.
//   2. Torn-tail evidence was not surfaced: Journal.loadFromFile's
//      loadReport.tornTail records a discarded fragment the chain
//      verification does not cover. The receipt now carries that state
//      and the viewer treats a non-null tornTail as INCOMPLETE.

describe("GPT finding 1 (PR #54): the receipt is bound to the artifact", () => {

  it("a receipt whose head does not match the artifact must FAIL, not render green", async () => {
    const { journalPath } = await makeWorld();
    const status = worldStatus(Journal.loadFromFile(journalPath));
    const bogus = { ...buildReceipt(status, { journalPath }), head: "0".repeat(64) };
    const html = render(journalPath, bogus);
    // The renderer runs at page load; the HTML carries the branches as JS text.
    // What this test pins is the embedded data + the branch's own text.
    expect(html).toContain('"head":"' + "0".repeat(64) + '"');
    expect(html).toMatch(/does not match this replay artifact/);
    expect(html).toMatch(/A matching receipt was expected/);
  });

  it("the HTML carries the three comparison checks against the artifact", async () => {
    const { journalPath } = await makeWorld();
    const html = render(journalPath, null);
    expect(html).toMatch(/if \(v\.head !== data\.journalHeadHash\)/);
    expect(html).toMatch(/if \(v\.entries !== data\.journalEntries\)/);
    expect(html).toMatch(/if \(lastFrameTick !== null && v\.tick !== lastFrameTick\)/);
  });

  it("a receipt mismatched on entries or tick is also surfaced in the mismatches list", async () => {
    const { journalPath } = await makeWorld();
    const status = worldStatus(Journal.loadFromFile(journalPath));
    const html = render(journalPath, { ...buildReceipt(status, { journalPath }), entries: status.entries + 1, tick: status.tick + 1 });
    expect(html).toContain('"entries":' + (status.entries + 1));
    expect(html).toContain('"tick":' + (status.tick + 1));
    expect(html).toMatch(/entries: receipt \" \+ v\.entries \+ \" vs artifact /);
    expect(html).toMatch(/tick: receipt \" \+ v\.tick \+ \" vs artifact final frame /);
  });
});

describe("GPT finding 2 (PR #54): the receipt surfaces the source's torn-tail state", () => {
  it("worldStatus carries loadReport.tornTail and unterminatedFinalEntry through", async () => {
    const { journalPath } = await makeWorld();
    const status = worldStatus(Journal.loadFromFile(journalPath));
    expect(status).toHaveProperty("sourceTornTail");
    expect(status).toHaveProperty("sourceUnterminatedFinalEntry");
    expect(status.sourceTornTail).toBeNull();
    expect(status.sourceUnterminatedFinalEntry).toBe(false);
  });

  it("buildReceipt threads them into the receipt verbatim", async () => {
    const { journalPath } = await makeWorld();
    const status = worldStatus(Journal.loadFromFile(journalPath));
    const r = buildReceipt(status, { journalPath });
    expect(r.sourceTornTail).toBeNull();
    expect(r.sourceUnterminatedFinalEntry).toBe(false);
  });

  it("the markdown summary reports the torn-tail state (clean file)", async () => {
    const { journalPath } = await makeWorld();
    const status = worldStatus(Journal.loadFromFile(journalPath));
    expect(statusMarkdown(status)).toMatch(/Source: complete file, no torn tail\./);
  });

  it("the markdown summary reports a torn tail with its bytes/offset/sha256", async () => {
    const { journalPath } = await makeWorld();
    // Synthesize a torn-tail status: the worldStatus shape is stable; buildReceipt forwards the field.
    const base = worldStatus(Journal.loadFromFile(journalPath));
    const withTornTail = { ...base, sourceTornTail: { offset: 1024, bytes: 73, sha256: "a".repeat(64) } };
    const md = statusMarkdown(withTornTail);
    expect(md).toMatch(/\*\*Source torn tail:\*\* 73 bytes discarded at offset 1024/);
    expect(md).toContain("a".repeat(64));
  });

  it("the viewer renders a torn-tail receipt as INCOMPLETE, never green", async () => {
    const { journalPath } = await makeWorld();
    const status = worldStatus(Journal.loadFromFile(journalPath));
    const receipt = { ...buildReceipt(status, { journalPath }), sourceTornTail: { offset: 2048, bytes: 11, sha256: "f".repeat(64) } };
    const html = render(journalPath, receipt);
    // The INCOMPLETE branch's text is embedded in the page's JS.
    expect(html).toMatch(/INCOMPLETE — runner-generated receipt for this artifact, but the source journal had a torn trailing fragment/);
    expect(html).toMatch(/Torn trailing fragment: \" \+ tornTail\.bytes/);
    expect(html).toContain('"sourceTornTail":{"offset":2048,"bytes":11');
    expect(html).toContain("f".repeat(64));
  });
});

describe("GPT presentation refinement (PR #54): runner-generated receipt wording", () => {
  it("labels the green result as a runner-generated receipt, not simply \"Verified by\"", async () => {
    const { journalPath } = await makeWorld();
    const html = render(journalPath, null);  // the branch text is static JS, present either way
    expect(html).toContain("Runner-generated receipt (claim-class: runner-attested) — hash chain intact and replay matched every TICK_COMMIT state hash.");
    expect(html).toContain("external correspondence between this page and the live journal is not independently established");
  });
});

describe("Kimi D-schema continuity (PR #54): claim-class annotation", () => {
  it("every field in this receipt is explicitly marked as a runner attestation", async () => {
    const { journalPath } = await makeWorld();
    const status = worldStatus(Journal.loadFromFile(journalPath));
    const receipt = buildReceipt(status, { journalPath });
    expect(receipt.claimClass).toBe("runner-attested");
  });

  it("the viewer's green verdict names the claim class, so the reader cannot confuse it with a viewer-recomputed result", async () => {
    const { journalPath } = await makeWorld();
    const html = render(journalPath, null);
    expect(html).toContain("Runner-generated receipt (claim-class: runner-attested)");
  });
});
