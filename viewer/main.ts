// Nexus Isles — world viewer entrypoint (read-only).
//
//   npx vite-node viewer/main.ts --journal ./world-data/journal.jsonl \
//     [--out ./world-view.html]
//
// Replays the journal and writes ONE static HTML file: the auditor's
// world view, with a tick scrubber over every committed tick. The
// journal is only ever read — no lock, no repair, no writes — and the
// world is never opened, so viewing cannot disturb a running world.
//
// (vite-node, as with runner/main.ts: the repo's modules import each
// other by ".js" specifiers under bundler resolution.)

import { writeFileSync } from "node:fs";
import { loadJournalForViewing, replayFrames } from "./replay.js";
import { readFileSync } from "node:fs";
import { renderViewerHtml } from "./render.js";

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const journalPath = argValue("journal");
  if (!journalPath) throw new Error("usage: viewer/main.ts --journal <journal.jsonl> [--out <file.html>] [--verification <receipt.json>]");
  const out = argValue("out") ?? "./world-view.html";
  const verificationPath = argValue("verification");
  const verification = verificationPath ? JSON.parse(readFileSync(verificationPath, "utf8")) : null;

  const journal = loadJournalForViewing(journalPath);
  const frames = replayFrames(journal);
  const html = renderViewerHtml(frames, {
    journalLabel: journalPath,
    journalEntries: journal.length,
    journalHeadHash: journal.headHash(),
    verification,
  });
  writeFileSync(out, html, "utf8");
  const last = frames[frames.length - 1];
  console.log(
    `VIEWER wrote ${out} ticks=0..${last.tick} frames=${frames.length} ` +
      `finalStateHash=${last.stateHash} journalHead=${journal.headHash()}`,
  );
}

try {
  main();
} catch (cause) {
  console.error(`VIEWER fatal ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exit(1);
}
