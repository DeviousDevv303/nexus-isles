// Nexus Isles — Ledger (build order step 1)
//
// The append-only, hash-chained event journal. Everything in the world —
// every death, every dynasty, every benchmark point — is a deterministic
// derivation from this journal (Constitution Annex A.1: a report is never a
// separate score computed off-ledger).
//
// Invariants enforced here:
//  - Append-only: entries are immutable once appended; there is no update or
//    delete path. Corrections are new entries (AA9: no retrospective
//    rewriting — originals remain).
//  - Hash chain: each entry's hash covers its content and the previous
//    entry's hash, so any tampering with history is detectable at the exact
//    index where the chain breaks (AT-09).
//  - Replay: folding the journal through a reducer from genesis reproduces
//    state deterministically (AT-14). Same journal -> same state, always.

import { createHash } from "node:crypto";
import { closeSync, fsyncSync, openSync, readFileSync, truncateSync, writeSync } from "node:fs";

export const GENESIS_PREV_HASH = "GENESIS";

export interface JournalEntry {
  /** Zero-based position in the chain. Index 0 is the genesis entry. */
  readonly index: number;
  /** World tick at which the entry was appended. */
  readonly tick: number;
  /** Entry type, e.g. "WORLD_GENESIS", "ACTION", "DEATH", "EXTERNAL_EVENT". */
  readonly type: string;
  /** Who caused the entry: a resident id, "engine", or "owner-console". */
  readonly actor: string;
  /** Entry body. Must be JSON-serializable. */
  readonly payload: Readonly<Record<string, unknown>>;
  /** Hash of the previous entry, or GENESIS_PREV_HASH at index 0. */
  readonly prevHash: string;
  /** sha256 over the canonical form of this entry's content + prevHash. */
  readonly hash: string;
}

export interface AppendInput {
  tick: number;
  type: string;
  actor: string;
  payload: Record<string, unknown>;
}

/** Deterministic JSON: object keys sorted recursively, no whitespace. */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalStringify).join(",") + "]";
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts = keys.map(
    (k) => JSON.stringify(k) + ":" + canonicalStringify(record[k]),
  );
  return "{" + parts.join(",") + "}";
}

export function computeEntryHash(
  entry: Omit<JournalEntry, "hash">,
): string {
  const material = canonicalStringify({
    index: entry.index,
    tick: entry.tick,
    type: entry.type,
    actor: entry.actor,
    payload: entry.payload,
    prevHash: entry.prevHash,
  });
  return createHash("sha256").update(material, "utf8").digest("hex");
}

/**
 * What a load found at the end of the file. Muse's ledger ruling
 * (#235, 6938908225): a final incomplete or unparseable fragment is a torn
 * write from a crash mid-append; the loader discards ONLY that fragment and
 * reports it. A complete (newline-terminated) line that is corrupt still
 * fails loudly, and no complete entry is ever dropped.
 */
export interface LoadReport {
  tornTail: null | {
    /** Byte offset where the fragment started (the file's valid length). */
    offset: number;
    /** Size of the discarded fragment in bytes. */
    bytes: number;
    /** sha256 of the discarded bytes, so the report is checkable. */
    sha256: string;
  };
  /** The final entry was complete but had lost its newline; it was kept. */
  unterminatedFinalEntry: boolean;
}

export type VerifyResult =
  | { ok: true; length: number }
  | { ok: false; firstBadIndex: number; reason: string };

export class Journal {
  private readonly chain: JournalEntry[] = [];

  get length(): number {
    return this.chain.length;
  }

  /** Hash of the most recent entry, or GENESIS_PREV_HASH when empty. */
  headHash(): string {
    return this.chain.length === 0
      ? GENESIS_PREV_HASH
      : this.chain[this.chain.length - 1].hash;
  }

  /** Append a new entry. Returns the sealed (frozen) entry. */
  append(input: AppendInput): JournalEntry {
    const draft: Omit<JournalEntry, "hash"> = {
      index: this.chain.length,
      tick: input.tick,
      type: input.type,
      actor: input.actor,
      payload: Object.freeze({ ...input.payload }),
      prevHash: this.headHash(),
    };
    const entry: JournalEntry = Object.freeze({
      ...draft,
      hash: computeEntryHash(draft),
    });
    this.chain.push(entry);
    return entry;
  }

  /** A snapshot of the chain. Entries themselves are frozen. */
  entries(): readonly JournalEntry[] {
    return [...this.chain];
  }

  /** Verify the whole chain: linkage, indices, and every hash. */
  verify(): VerifyResult {
    let prevHash = GENESIS_PREV_HASH;
    for (let i = 0; i < this.chain.length; i++) {
      const entry = this.chain[i];
      if (entry.index !== i) {
        return { ok: false, firstBadIndex: i, reason: "index mismatch" };
      }
      if (entry.prevHash !== prevHash) {
        return { ok: false, firstBadIndex: i, reason: "prevHash mismatch" };
      }
      if (entry.hash !== computeEntryHash(entry)) {
        return { ok: false, firstBadIndex: i, reason: "hash mismatch" };
      }
      prevHash = entry.hash;
    }
    return { ok: true, length: this.chain.length };
  }

  /**
   * Append this journal's not-yet-written tail to a JSONL file as ONE
   * buffered write, then flush (Muse's Ruling 2, #235 6950678244: a tick's
   * entries are composed in memory and appended as one write at commit).
   * Every entry is still its own newline-terminated line, and torn-tail
   * recovery handles a torn final line. Residual risk, stated plainly: a
   * single write is not atomic on every filesystem; if a crash persists
   * only a prefix of it, restore still refuses loudly and names the
   * uncommitted entries — nothing is ever dropped.
   */
  saveToFile(path: string, fromIndex = 0): void {
    const tail = this.chain.slice(fromIndex);
    if (tail.length === 0) return;
    const fd = openSync(path, "a");
    try {
      writeSync(fd, tail.map((e) => JSON.stringify(e) + "\n").join(""), null, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  /** Report from the load that produced this journal, if any. */
  loadReport: LoadReport = { tornTail: null, unterminatedFinalEntry: false };

  /**
   * Load a journal from a JSONL file and verify it before trusting it.
   * A torn final fragment is discarded and reported in `loadReport`; with
   * `repair`, the file is also truncated to its last complete line so the
   * next append starts clean. Anything else wrong fails loudly.
   */
  static loadFromFile(path: string, opts: { repair?: boolean } = {}): Journal {
    const raw = readFileSync(path, "utf8");
    const journal = new Journal();
    const lastNewline = raw.lastIndexOf("\n");
    const complete = raw.slice(0, lastNewline + 1);
    let fragment = raw.slice(lastNewline + 1);
    const lines = complete.length === 0 ? [] : complete.slice(0, -1).split("\n");
    // An unterminated final segment that parses is a complete entry that
    // only lost its newline: keep it. One that doesn't parse is torn.
    if (fragment.length > 0) {
      let parses = true;
      try {
        JSON.parse(fragment);
      } catch {
        parses = false;
      }
      if (parses) {
        lines.push(fragment);
        fragment = "";
        journal.loadReport = { ...journal.loadReport, unterminatedFinalEntry: true };
      }
    }
    lines.forEach((line, i) => {
      let parsed: JournalEntry;
      try {
        parsed = JSON.parse(line) as JournalEntry;
      } catch {
        throw new Error(`Journal line ${i + 1} is complete but unparseable — corruption, not a torn write`);
      }
      journal.chain.push(Object.freeze(parsed));
    });
    const result = journal.verify();
    if (!result.ok) {
      throw new Error(
        `Journal failed verification at index ${result.firstBadIndex}: ${result.reason}`,
      );
    }
    if (journal.loadReport.unterminatedFinalEntry && opts.repair) {
      const fd = openSync(path, "a");
      try {
        writeSync(fd, "\n", null, "utf8");
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    }
    if (fragment.length > 0) {
      const offset = Buffer.byteLength(complete, "utf8");
      journal.loadReport = {
        ...journal.loadReport,
        tornTail: {
          offset,
          bytes: Buffer.byteLength(fragment, "utf8"),
          sha256: createHash("sha256").update(fragment, "utf8").digest("hex"),
        },
      };
      if (opts.repair) truncateSync(path, offset);
    }
    return journal;
  }
}

/**
 * Replay: fold the journal through a reducer from an initial state.
 * Deterministic by construction — the same journal always folds to the
 * same state (AT-14). Reducers must be pure functions of (state, entry).
 */
export function replay<S>(
  journal: Journal,
  initial: S,
  reducer: (state: S, entry: JournalEntry) => S,
): S {
  let state = initial;
  for (const entry of journal.entries()) {
    state = reducer(state, entry);
  }
  return state;
}
