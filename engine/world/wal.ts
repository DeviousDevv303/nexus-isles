// Nexus Isles — the write-ahead log for queued owner-console submissions.
//
// Muse's Ruling 1 (#235, 6950678244): what is WAITING lives here, in arrival
// order; what the world DID lives in the journal, in world order. Entries
// cross into the journal only when a tick processes them, so the journal's
// submission-order determinism (AT-01) is untouched.
//
// Scope, as ruled: queued console submissions (interventions waiting for
// their tick, and refusals waiting for the next boundary). Chat directives
// are OUT entirely: chat is private-layer (AA7) and is never journaled and
// never WAL'd.
//
// Durability: every append is fsync'd before the submit call returns. After
// each tick the WAL is rewritten (temp file + rename) to what is still
// waiting. Landed records carry their walId in the journal, so a crash
// between the journal write and the WAL rewrite can never land a record
// twice. A torn final WAL fragment is discarded; any complete line that is
// unparseable fails loudly, the same rule as the journal (6938908225).

import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, truncateSync, writeSync } from "node:fs";

export type WalKind = "console" | "console-rejection";

export interface WalRecord {
  walId: string;
  kind: WalKind;
  /** The payload that will be journaled when the record lands. */
  payload: Record<string, unknown>;
}

export interface WalRead {
  records: WalRecord[];
  /** Bytes of a torn final fragment that was discarded, or 0. */
  tornBytes: number;
}

export const walPathFor = (journalPath: string): string => `${journalPath}.wal`;

function writeDurably(path: string, text: string, flag: "a" | "w"): void {
  const fd = openSync(path, flag);
  try {
    writeSync(fd, text, null, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function appendWal(path: string, record: WalRecord): void {
  writeDurably(path, JSON.stringify(record) + "\n", "a");
}

/** Replace the WAL with exactly `records`, atomically. */
export function rewriteWal(path: string, records: readonly WalRecord[]): void {
  const tmp = `${path}.tmp`;
  writeDurably(tmp, records.map((r) => JSON.stringify(r) + "\n").join(""), "w");
  renameSync(tmp, path);
}

function isRecord(v: unknown): v is WalRecord {
  const r = v as WalRecord;
  return (
    typeof r === "object" && r !== null && typeof r.walId === "string" &&
    (r.kind === "console" || r.kind === "console-rejection") &&
    typeof r.payload === "object" && r.payload !== null && r.payload.walId === r.walId
  );
}

/** Read the WAL. With `repair`, a torn final fragment is truncated away. */
export function readWal(path: string, opts: { repair?: boolean } = {}): WalRead {
  if (!existsSync(path)) return { records: [], tornBytes: 0 };
  const raw = readFileSync(path, "utf8");
  const lastNewline = raw.lastIndexOf("\n");
  const complete = raw.slice(0, lastNewline + 1);
  const fragment = raw.slice(lastNewline + 1);
  const lines = complete.length === 0 ? [] : complete.slice(0, -1).split("\n");
  const records = lines.map((line, i) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`WAL line ${i + 1} is complete but unparseable — corruption, not a torn write`);
    }
    if (!isRecord(parsed)) throw new Error(`WAL line ${i + 1} is not a valid WAL record`);
    return parsed;
  });
  let tornBytes = 0;
  if (fragment.length > 0) {
    // An unterminated final record that parses whole only lost its newline.
    let whole: unknown;
    try {
      whole = JSON.parse(fragment);
    } catch {
      whole = undefined;
    }
    if (whole !== undefined && isRecord(whole)) {
      records.push(whole);
      if (opts.repair) writeDurably(path, "\n", "a");
    } else {
      tornBytes = Buffer.byteLength(fragment, "utf8");
      if (opts.repair) truncateSync(path, Buffer.byteLength(complete, "utf8"));
    }
  }
  const ids = new Set<string>();
  for (const r of records) {
    if (ids.has(r.walId)) throw new Error(`WAL record ${r.walId} appears twice`);
    ids.add(r.walId);
  }
  return { records, tornBytes };
}
