// Nexus Isles — live-world status CLI (read-only).
//
//   npx vite-node runner/status.ts --journal <journal.jsonl>
//     [--expect-head <hash>] [--markdown <file>] [--receipt <file>]
//
// Verifies the hash chain, replays the journal and prints the head, entry
// count, world tick and every resident (runner/worldStatus.ts). Exit 1 if
// the chain or replay fails, or if --expect-head names a different head.

import { writeFileSync } from "node:fs";
import { loadJournalForViewing } from "../viewer/replay.js";
import { buildReceipt, statusMarkdown, worldStatus } from "./worldStatus.js";

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const path = argValue("journal");
  if (!path) throw new Error("usage: runner/status.ts --journal <journal.jsonl> [--expect-head <hash>] [--markdown <file>] [--receipt <file>]");
  const status = worldStatus(loadJournalForViewing(path));
  const expected = argValue("expect-head");
  if (expected && expected !== status.head) {
    throw new Error(`journal head ${status.head} is not the expected head ${expected} — refusing to treat this as the named world`);
  }
  const markdownPath = argValue("markdown");
  if (markdownPath) writeFileSync(markdownPath, statusMarkdown(status), "utf8");
  const receiptPath = argValue("receipt");
  if (receiptPath) writeFileSync(receiptPath, JSON.stringify(buildReceipt(status, { journalPath: path }), null, 2) + "\n", "utf8");
  const alive = status.residents.filter((r) => r.alive).map((r) => r.id).join(",") || "-";
  console.log(`STATUS tick=${status.tick} entries=${status.entries} head=${status.head} alive=${alive}`);
  console.log(JSON.stringify(status, null, 2));
}

try {
  main();
} catch (cause) {
  console.error(`STATUS fatal ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exit(1);
}
