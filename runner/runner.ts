// Nexus Isles — the launch runner (infrastructure only).
//
// Owns a data directory and keeps one world ticking through the EXISTING
// seat driver and world pipeline. It adds no engine behaviour: no new
// journal event kinds, no rule changes — genesis, resume, ticking,
// persistence and shutdown all go through World / SeatDriver / Journal as
// they already exist (including the PR #22/#23 durability machinery: the
// journal's per-tick fsync'd append and the console WAL inside World).
//
// Data directory layout:
//   journal.jsonl   the world journal (authoritative; .wal beside it)
//   snapshot.json   a state cache for fast resume (validated by World.restore)
//   runner.lock     held by the one live runner for this directory
//
// Log lines are stable and greppable, one per event, key=value fields:
//   RUNNER start mode=genesis|resumed tick=N head=HASH seats=a,b
//   RUNNER lock-takeover path=... previous=pid=N|unreadable
//   RUNNER seat-skipped seat=ID reason=dead
//   TICK tick=N head=HASH submitted=S refused=R closed=a,b|- [prime=1]
//   RUNNER stop reason=... tick=N head=HASH

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { World } from "../engine/world/world.js";
import { SeatDriver, type DrivenSeat } from "../seats/driver.js";
import { BUILTIN_BACKEND_FACTORIES, createBackend, type BackendFactory } from "./backends.js";
import { worldConfigFor, type GenesisConfig, type RunnerSeatSpec } from "./config.js";

export interface RunnerOptions {
  /** Directory holding this world's journal, snapshot and lock. */
  dataDir: string;
  /** Required to create a world; cross-checked when resuming one. */
  genesis?: GenesisConfig;
  /** Milliseconds between ticks in run() mode. Default 1000. */
  tickIntervalMs?: number;
  /** Log sink. Default: stdout, one line per call. */
  log?: (line: string) => void;
  /** Backend registry override (tests, future real adapters). */
  backendFactories?: Readonly<Record<string, BackendFactory>>;
}

interface LockInfo {
  pid: number;
  host: string;
  startedAt: string;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    // EPERM: the process exists but is not ours to signal — still alive.
    return (cause as NodeJS.ErrnoException).code === "EPERM";
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class LaunchRunner {
  private readonly dataDir: string;
  private readonly genesis?: GenesisConfig;
  private readonly intervalMs: number;
  private readonly logLine: (line: string) => void;
  private readonly factories: Readonly<Record<string, BackendFactory>>;

  private world: World | null = null;
  private driver: SeatDriver | null = null;
  private mode: "genesis" | "resumed" | null = null;
  private lockOwned = false;
  private started = false;
  private ticking = false;
  private stopRequested = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: RunnerOptions) {
    this.dataDir = opts.dataDir;
    this.genesis = opts.genesis;
    this.intervalMs = opts.tickIntervalMs ?? 1000;
    if (!Number.isSafeInteger(this.intervalMs) || this.intervalMs < 0) {
      throw new Error("tickIntervalMs must be an integer >= 0");
    }
    this.logLine = opts.log ?? ((line) => console.log(line));
    this.factories = opts.backendFactories ?? BUILTIN_BACKEND_FACTORIES;
  }

  private get journalPath(): string {
    return join(this.dataDir, "journal.jsonl");
  }
  private get snapshotPath(): string {
    return join(this.dataDir, "snapshot.json");
  }
  private get lockPath(): string {
    return join(this.dataDir, "runner.lock");
  }

  get currentTick(): number {
    return this.world ? this.world.tickNumber : -1;
  }
  get currentHead(): string {
    return this.world ? this.world.headHash : "-";
  }
  get startMode(): "genesis" | "resumed" | null {
    return this.mode;
  }

  /** Acquire the lock, open (or create) the world, build the seat driver. */
  async start(): Promise<void> {
    if (this.started) throw new Error("runner already started");
    this.started = true;
    mkdirSync(this.dataDir, { recursive: true });
    this.acquireLock();
    try {
      this.openWorld();
    } catch (cause) {
      // A world opened before the failure holds the engine writer lock;
      // close it so the lock dies with this runner, not with the process.
      this.closeWorld();
      this.releaseLock();
      throw cause;
    }
  }

  /** One driver tick (plus snapshot + log line). Safe to call from tests. */
  async tickOnce(): Promise<void> {
    if (!this.world || !this.driver) throw new Error("runner not started");
    if (this.ticking) throw new Error("a tick is already in flight");
    this.ticking = true;
    try {
      const report = await this.driver.tick();
      this.world.writeSnapshot(this.snapshotPath);
      this.logLine(
        `TICK tick=${report.tick} head=${this.world.headHash} submitted=${report.submitted} ` +
          `refused=${report.refused} closed=${report.closedSeats.join(",") || "-"}`,
      );
    } finally {
      this.ticking = false;
    }
  }

  /** Tick forever on the configured interval until stop() is called. */
  run(): void {
    if (!this.world || !this.driver) throw new Error("runner not started");
    if (this.timer !== null || this.ticking) throw new Error("runner loop already running");
    const step = async (): Promise<void> => {
      if (this.stopRequested) return;
      try {
        await this.tickOnce();
      } catch (cause) {
        this.logLine(`RUNNER tick-error error=${cause instanceof Error ? cause.message : String(cause)}`);
        this.stopRequested = true;
        return;
      }
      if (!this.stopRequested) this.timer = setTimeout(step, this.intervalMs);
    };
    this.timer = setTimeout(step, this.intervalMs);
  }

  /**
   * Clean shutdown: no new ticks, the in-flight tick (if any) finishes and
   * persists, a final snapshot is written, the world is closed (releasing
   * the engine writer lock it holds), and the runner lock is released.
   */
  async stop(reason = "requested"): Promise<void> {
    this.stopRequested = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.ticking) await sleep(5);
    if (this.world) {
      try {
        this.world.writeSnapshot(this.snapshotPath);
      } catch {
        // A failed final snapshot is a cache miss next resume, never corruption.
      }
      this.logLine(`RUNNER stop reason=${reason} tick=${this.world.tickNumber} head=${this.world.headHash}`);
      this.closeWorld();
    }
    this.releaseLock();
  }

  /** Close the held world, releasing its engine writer lock. Idempotent. */
  private closeWorld(): void {
    if (!this.world) return;
    const world = this.world;
    this.world = null;
    this.driver = null;
    world.close();
  }

  // ---- world open / create ----------------------------------------------

  private openWorld(): void {
    const hasJournal = existsSync(this.journalPath) && statSync(this.journalPath).size > 0;
    let world: World;
    if (hasJournal) {
      // Resume. restoreFromFile loads + verifies the whole hash chain and
      // refuses loudly on any failure or a mid-tick tail — no tick is ever
      // taken on an unverified journal.
      world = World.restoreFromFile(this.journalPath, { snapshotPath: this.snapshotPath });
      this.mode = "resumed";
    } else {
      if (!this.genesis) {
        throw new Error(
          `no journal in ${this.dataDir} and no genesis config supplied — nothing to resume, nothing to create`,
        );
      }
      world = World.create(this.genesis.seed, worldConfigFor(this.genesis), { persistPath: this.journalPath });
      this.mode = "genesis";
    }
    // Assign before any check that can throw (genesis cross-check, seat
    // checks): from here on start()'s cleanup owns closing this world and
    // releasing the engine writer lock it holds.
    this.world = world;
    if (this.mode === "resumed" && this.genesis) this.crossCheckGenesis(world);

    const seats = this.genesis?.seats ?? this.seatsFromWorld(world);
    const driven: DrivenSeat[] = [];
    for (const seat of seats) {
      const resident = world.state.residents[seat.seatId];
      if (!resident) throw new Error(`seat ${seat.seatId} is not a resident of this world`);
      if (!resident.alive) {
        // Death is permanent: a dead resident's seat is never re-driven.
        this.logLine(`RUNNER seat-skipped seat=${seat.seatId} reason=dead`);
        continue;
      }
      driven.push({ seatId: seat.seatId, backend: createBackend(seat, this.factories) });
    }
    this.driver = new SeatDriver(world, driven);
    this.logLine(
      `RUNNER start mode=${this.mode} tick=${world.tickNumber} head=${world.headHash} ` +
        `seats=${driven.map((d) => d.seatId).join(",") || "-"}`,
    );
    if (world.tickNumber === 0) {
      // Prime: one engine tick delivers the first observations, so the
      // first driver tick asks backends about a real observation instead of
      // journaling a no_observation refusal (the AT-22 harness pattern).
      world.tick();
      world.writeSnapshot(this.snapshotPath);
      this.logLine(`TICK tick=${world.tickNumber} head=${world.headHash} submitted=0 refused=0 closed=- prime=1`);
    }
  }

  /** A supplied genesis must describe the world the journal actually holds. */
  private crossCheckGenesis(world: World): void {
    const genesis = this.genesis as GenesisConfig;
    const first = world.entries()[0];
    const journaledSeed = first?.type === "WORLD_GENESIS" ? first.payload.seed : undefined;
    if (journaledSeed !== genesis.seed) {
      throw new Error(
        `genesis config seed ${genesis.seed} does not match the journal's genesis seed ${String(journaledSeed)} — refusing to drive the wrong world`,
      );
    }
    for (const seat of genesis.seats) {
      if (!world.state.residents[seat.seatId]) {
        throw new Error(`genesis config seat ${seat.seatId} is not a resident of the journaled world`);
      }
    }
  }

  /** Resume without a config: drive every living resident that has a backend bound. */
  private seatsFromWorld(world: World): RunnerSeatSpec[] {
    const out: RunnerSeatSpec[] = [];
    for (const id of Object.keys(world.state.residents).sort()) {
      const r = world.state.residents[id];
      if (!r.backend) continue;
      out.push({
        seatId: id,
        backend: r.backend,
        position: r.position ?? "centro",
        satiety: r.satiety,
        maxSatiety: r.maxSatiety,
        actionsPerTick: r.actionsPerTick,
        intel: r.intel,
      });
    }
    return out;
  }

  // ---- data-directory lock -----------------------------------------------

  private acquireLock(): void {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = openSync(this.lockPath, "wx");
        try {
          const info: LockInfo = { pid: process.pid, host: hostname(), startedAt: new Date().toISOString() };
          writeFileSync(fd, JSON.stringify(info) + "\n", "utf8");
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        this.lockOwned = true;
        return;
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
      }
      let info: LockInfo | null = null;
      try {
        info = JSON.parse(readFileSync(this.lockPath, "utf8")) as LockInfo;
      } catch {
        info = null; // an unreadable lock is treated as stale, and the takeover is logged
      }
      if (info && Number.isSafeInteger(info.pid) && info.pid === process.pid) {
        throw new Error(`data directory ${this.dataDir} is already held by this process (pid ${info.pid}) — refusing a second runner`);
      }
      if (info && Number.isSafeInteger(info.pid) && pidAlive(info.pid)) {
        throw new Error(
          `data directory ${this.dataDir} is already held by a live runner (pid ${info.pid} on ${info.host}, since ${info.startedAt}) — refusing to start`,
        );
      }
      this.logLine(
        `RUNNER lock-takeover path=${this.lockPath} previous=${info ? `pid=${info.pid}` : "unreadable"}`,
      );
      rmSync(this.lockPath, { force: true });
    }
    throw new Error(`could not acquire runner lock ${this.lockPath}`);
  }

  private releaseLock(): void {
    if (!this.lockOwned) return;
    this.lockOwned = false;
    try {
      const info = JSON.parse(readFileSync(this.lockPath, "utf8")) as LockInfo;
      if (info.pid === process.pid) rmSync(this.lockPath, { force: true });
    } catch {
      // Lock already gone or unreadable — nothing of ours to release.
    }
  }
}
