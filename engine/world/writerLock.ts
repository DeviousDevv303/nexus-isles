// Nexus Isles — one writer per journal, and an emergency stop.
//
// Muse's handout (#235, 6953621377; brief §12.4 item 1). Infrastructure,
// not world law: nothing here writes to the journal or changes what a tick
// does. It decides only WHETHER a tick may run.
//
// Writer lock. A persisted world takes `<journal>.lock` with O_EXCL before
// it reads or writes anything. A second world — another process, or a
// second World object in this one — that tries to open the same journal is
// refused loudly with the holder named. Two schedulers can never both tick
// one journal, so the journal can never fork. A lock left behind by a
// crashed process is never taken silently: the refusal says the holder is
// not running, and taking over needs an explicit `takeOverStaleLock`.
//
// Emergency stop. `<journal>.stop` (or World.requestStop) halts ticking at
// the next tick boundary — ticks are synchronous, so a stop can never land
// mid-tick. The journal is untouched and still ends at a commit. The stop
// survives a restart until it is cleared on purpose.

import { randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { hostname } from "node:os";

export const lockPathFor = (journalPath: string): string => `${journalPath}.lock`;
export const stopPathFor = (journalPath: string): string => `${journalPath}.stop`;

export interface LockHolder {
  pid: number;
  host: string;
  token: string;
}

export class WriterLockError extends Error {
  constructor(
    message: string,
    readonly holder: LockHolder | null,
    readonly holderRunning: boolean | null,
  ) {
    super(message);
  }
}

export class WorldStoppedError extends Error {
  constructor(readonly reason: string) {
    super(`world is stopped: ${reason}`);
  }
}

function pidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM"; // exists, not ours to signal
  }
}

function readHolder(path: string): LockHolder | null {
  try {
    const h = JSON.parse(readFileSync(path, "utf8")) as LockHolder;
    return typeof h.pid === "number" && typeof h.host === "string" && typeof h.token === "string" ? h : null;
  } catch {
    return null;
  }
}

export class WriterLock {
  private released = false;

  private constructor(
    readonly path: string,
    readonly holder: LockHolder,
  ) {}

  static acquire(journalPath: string, opts: { takeOverStaleLock?: boolean } = {}): WriterLock {
    const path = lockPathFor(journalPath);
    const holder: LockHolder = { pid: process.pid, host: hostname(), token: randomBytes(16).toString("hex") };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = openSync(path, "wx");
        try {
          writeSync(fd, JSON.stringify(holder), null, "utf8");
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        return new WriterLock(path, holder);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        const current = readHolder(path);
        const sameHost = current?.host === holder.host;
        const running = current && sameHost ? pidRunning(current.pid) : null;
        const stale = current !== null && sameHost && running === false;
        if (stale && opts.takeOverStaleLock && attempt === 0) {
          unlinkSync(path); // the holder is provably gone on this host; take over, once
          continue;
        }
        const who = current ? `pid ${current.pid} on ${current.host}` : "an unreadable lock file";
        const why = stale
          ? " That process is not running (a crash left the lock); restart with takeOverStaleLock to take over."
          : current && !sameHost
            ? " It is on another host; this host cannot tell whether it is still running."
            : " It is still running: two writers on one journal would fork it.";
        throw new WriterLockError(`journal ${journalPath} is held by ${who}.${why}`, current, running);
      }
    }
    throw new WriterLockError(`journal ${journalPath}: could not take over the stale lock`, null, null);
  }

  /** True while this lock file still carries our token (nobody took it over). */
  stillHeld(): boolean {
    return !this.released && readHolder(this.path)?.token === this.holder.token;
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    if (readHolder(this.path)?.token === this.holder.token) unlinkSync(this.path);
  }
}

/** The stop reason recorded at `<journal>.stop`, or null if no stop is in force. */
export function readStop(journalPath: string): string | null {
  const p = stopPathFor(journalPath);
  if (!existsSync(p)) return null;
  const text = readFileSync(p, "utf8").trim();
  return text.length > 0 ? text : "stop file present (no reason given)";
}

export function writeStop(journalPath: string, reason: string): void {
  const fd = openSync(stopPathFor(journalPath), "w");
  try {
    writeSync(fd, reason, null, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function clearStopFile(journalPath: string): void {
  const p = stopPathFor(journalPath);
  if (existsSync(p)) unlinkSync(p);
}

/**
 * A tick delivery that does not name the next tick. Thrown before anything
 * is written: a repeated delivery of a committed tick never ticks twice, and
 * a delivery from the future never skips one.
 */
export class TickDeliveryError extends Error {
  constructor(
    readonly expectTick: number,
    readonly nextTick: number,
  ) {
    super(
      expectTick < nextTick
        ? `tick ${expectTick} is already committed (next is ${nextTick}): a repeated delivery never ticks twice`
        : `tick ${expectTick} is not the next tick (next is ${nextTick}): refusing to skip or guess`,
    );
    this.name = "TickDeliveryError";
  }
}

/** Throws TickDeliveryError unless `expectTick` (when given) is exactly `nextTick`. */
export function checkTickDelivery(expectTick: number | undefined, nextTick: number): void {
  if (expectTick !== undefined && expectTick !== nextTick) throw new TickDeliveryError(expectTick, nextTick);
}
