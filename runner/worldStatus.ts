// Nexus Isles — live-world status (read-only). CLI: runner/status.ts.
//
// Verifies the journal's hash chain, replays it (every TICK_COMMIT's state
// hash is checked against the replay — viewer/replay.ts), and prints one
// greppable line plus a JSON report: journal head, entry count, world tick,
// and each resident exactly as the replayed state holds it. With
// --expect-head it refuses (exit 1) unless the journal's head is the one
// named, so an operator can pin a session to the world they meant to drive.
// With --markdown it also writes the report as Markdown (the Actions job
// summary). Nothing is written to the world directory and no lock is taken.

import type { Journal } from "../ledger/journal.js";
import type { VerificationReceipt } from "../viewer/verificationReceipt.js";
import { replayFrames } from "../viewer/replay.js";

export interface ResidentStatus {
  id: string;
  alive: boolean;
  diedAtTick: number | null;
  position: string | null;
  satiety: number;
  maxSatiety: number;
  inventory: number;
  backend: string | null;
}

export interface WorldStatus {
  head: string;
  entries: number;
  tick: number;
  chainVerified: true;
  residents: ResidentStatus[];
}

/** The status of a journal, or a thrown error naming why it cannot be trusted. */
export function worldStatus(journal: Journal): WorldStatus {
  const verdict = journal.verify();
  if (!verdict.ok) throw new Error(`journal failed verification at index ${verdict.firstBadIndex}: ${verdict.reason}`);
  const frames = replayFrames(journal);
  const last = frames[frames.length - 1];
  const residents = Object.keys(last.state.residents).sort().map((id): ResidentStatus => {
    const r = last.state.residents[id];
    return {
      id,
      alive: r.alive,
      diedAtTick: r.diedAtTick,
      position: r.position,
      satiety: r.satiety,
      maxSatiety: r.maxSatiety,
      inventory: r.inventory,
      backend: r.backend ? `${r.backend.providerId}@${r.backend.version}` : null,
    };
  });
  return { head: journal.headHash(), entries: journal.length, tick: last.tick, chainVerified: true, residents };
}



export type { VerificationReceipt };
export function buildReceipt(status: WorldStatus, opts: { journalPath: string }): VerificationReceipt {
  const server = process.env.GITHUB_SERVER_URL;
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  const actionsRunUrl = server && repo && runId ? `${server}/${repo}/actions/runs/${runId}` : null;
  return {
    schema: "nexus-isles-verification/v1",
    verifiedAt: new Date().toISOString(),
    head: status.head,
    entries: status.entries,
    tick: status.tick,
    journalPath: opts.journalPath,
    chainVerified: true,
    replayStateHashesMatchedAtEveryCommit: true,
    actionsRunUrl,
    verifier: "runner/status.ts",
  };
}

export function statusMarkdown(s: WorldStatus, title = "Nexus Isles — world status"): string {
  const rows = s.residents.map((r) =>
    `| ${r.id} | ${r.alive ? "ALIVE" : `DEAD (tick ${r.diedAtTick ?? "?"})`} | ${r.position ?? "-"} | ${r.satiety}/${r.maxSatiety} | ${r.inventory} | \`${r.backend ?? "unbound"}\` |`,
  );
  return [
    `## ${title}`,
    "",
    `- World tick: **${s.tick}**`,
    `- Journal: **${s.entries}** entries, hash chain verified, replay matches every committed state hash`,
    `- Head: \`${s.head}\``,
    "",
    "| Resident | State | Region | Satiety | Inventory | Backend |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

