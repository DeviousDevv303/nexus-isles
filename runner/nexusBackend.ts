// Nexus Isles — the real Nexus backend adapter (launch runner).
//
// Connects Cristian's own Nexus LLM (the seated Run 25 checkpoint) to a
// seat through the seat driver's RawOutputBackend contract:
//
//   observation + own directives -> prompt -> sidecar -> RAW model text
//   -> strict parse -> candidate actions -> World.submit() (by the driver)
//
// Faithful transport is the whole job:
//   * The model sees ONLY its own seat's observation and its own
//     directives — exactly what the driver hands this backend, nothing
//     more (no world state, no other seats, no journal).
//   * The model's raw text is parsed strictly: the first JSON array in
//     the text, validated by the driver's own parseBackendActions. No
//     repair, no reinterpretation — anything else throws, and the driver
//     refuses the WHOLE tick batch as malformed_backend_output.
//   * A sidecar timeout, crash, or error is the same refusal, never a
//     hang and never a silent empty batch.
//   * Provider-truth: the ref names the actual checkpoint
//     (nexus:run25-local, version = the checkpoint's sha256 prefix). The
//     sidecar reports the loaded checkpoint's sha256 at startup and this
//     adapter refuses to serve if it does not match the label.
//
// The model runs in a Python sidecar (runner/nexus_sidecar.py) that loads
// the checkpoint once and serves line-delimited JSON over stdin/stdout,
// reusing the trainer's own inference path (common.frame + model.greedy).

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RawOutputBackend, parseBackendActions, type DriverDirective, type SeatBackend } from "../seats/driver.js";
import type { Action, ActionProvenance, Observation } from "../seats/seatProvider.js";
import { createHash } from "node:crypto";

/** The seated checkpoint this adapter serves. sha256 c41852fb0ac11f47… */
export const NEXUS_RUN25_CHECKPOINT_SHA256 =
  "c41852fb0ac11f47c3ce2fc7715e816e" as const;

export const NEXUS_RUN25_REF = {
  providerId: "nexus:run25-local",
  version: "ckpt-c41852fb",
} as const;

export interface NexusSidecarOptions {
  /** Python interpreter with torch + sentencepiece (the trainer env). */
  python: string;
  /** Path to runner/nexus_sidecar.py. */
  sidecarPath: string;
  /** Path to the checkpoint file (model.pt). */
  checkpointPath: string;
  /** Directory holding the trainer's model.py / common.py. */
  trainDir: string;
  /** Max tokens generated per call. */
  maxNewTokens: number;
  /** Per-call timeout in ms. A timeout refuses the batch, never hangs. */
  timeoutMs: number;
}

/** Resolve sidecar options from the environment, with local defaults. */
export function resolveNexusSidecarOptions(
  env: NodeJS.ProcessEnv = process.env,
): NexusSidecarOptions {
  const home = env.HOME ?? homedir();
  const timeoutRaw = Number(env.NEXUS_SIDECAR_TIMEOUT_MS ?? "120000");
  const maxNewRaw = Number(env.NEXUS_SIDECAR_MAX_NEW ?? "96");
  return {
    python: env.NEXUS_PYTHON ?? join(home, "workspace/nexus-taste/.venv/bin/python"),
    sidecarPath:
      env.NEXUS_SIDECAR_PATH ??
      join(dirname(fileURLToPath(import.meta.url)), "nexus_sidecar.py"),
    checkpointPath: env.NEXUS_CHECKPOINT ?? join(home, "workspace/run25/ckpt/model.pt"),
    trainDir: env.NEXUS_TRAIN_DIR ?? join(home, "workspace/run8-reads/nexus-llm/train"),
    maxNewTokens: Number.isSafeInteger(maxNewRaw) && maxNewRaw > 0 ? maxNewRaw : 96,
    timeoutMs: Number.isSafeInteger(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 120_000,
  };
}

/**
 * Render the ONLY thing the model ever sees: its own seat's observation
 * and its own directives, plus the standing instruction for the reply
 * format. Deterministic for a given input.
 */
export function buildNexusPrompt(input: {
  observation: Observation;
  directives: readonly DriverDirective[];
}): string {
  const lines: string[] = [
    "You are Nexus, a resident in Nexus Isles, a persistent survival world.",
    "Each tick you may act through your seat. Reply with ONLY a JSON array of actions, " +
      'for example [{"verb":"gather","args":{"node":"mercado-centro","amount":1}}] ' +
      'or [{"verb":"eat","args":{"amount":1}}]. Reply [] to take no action.',
    `Your observation for tick ${input.observation.tick}:`,
    JSON.stringify(input.observation.visible),
  ];
  if (input.directives.length > 0) {
    lines.push("Your directives:");
    for (const d of input.directives) lines.push(`- [tick ${d.tick}] ${d.kind}: ${d.body}`);
  }
  lines.push("Your actions, as a JSON array:");
  return lines.join("\n");
}

function nexusPromptProvenance(input: {
  observation: Observation;
  directives: readonly DriverDirective[];
}): ActionProvenance {
  return {
    promptHash: createHash("sha256")
      .update(buildNexusPrompt(input), "utf8")
      .digest("hex"),
    inputReferences: [
      `observation:tick:${input.observation.tick}`,
      "observation:visible",
      ...input.directives.map((d) => `directive:tick:${d.tick}:${d.kind}`),
    ],
  };
}

/**
 * Strict parse of raw model text into candidate actions. The text must
 * contain a JSON array; the array is validated by the driver's own
 * parser. Anything else throws — the batch is refused whole, never
 * repaired into a different action.
 */
export function parseNexusRawActions(raw: unknown): Action[] {
  if (typeof raw !== "string") throw new Error("nexus backend output must be raw text");
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("nexus backend output contains no JSON array");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error("nexus backend output is not valid JSON");
  }
  return parseBackendActions(parsed);
}

/** The minimal transport the backend needs — injectable for tests. */
export interface NexusTransport {
  request(prompt: string): Promise<string>;
}

interface PendingRequest {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
}

/**
 * A spawned sidecar process. Lazily started on the first request; the
 * checkpoint loads once and serves every later request. If the process
 * dies, pending requests reject and the next request respawns it.
 */
export class NexusSidecar implements NexusTransport {
  private child: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private buffer = "";
  /** The checkpoint sha256 the sidecar reported at startup. */
  loadedCheckpointSha256: string | null = null;

  constructor(private readonly opts: NexusSidecarOptions) {}

  async request(prompt: string): Promise<string> {
    await this.ensureStarted();
    const child = this.child;
    if (!child) throw new Error("nexus sidecar is not running");
    const id = this.nextId++;
    const result = new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    child.stdin.write(JSON.stringify({ id, prompt }) + "\n");
    return result;
  }

  /** Kill the sidecar. Pending requests reject. Safe to call repeatedly. */
  close(): void {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    this.ready = null;
    child.kill();
  }

  private ensureStarted(): Promise<void> {
    if (this.child && this.ready) return this.ready;
    for (const [label, path] of [
      ["python", this.opts.python],
      ["sidecar", this.opts.sidecarPath],
      ["checkpoint", this.opts.checkpointPath],
      ["train dir", this.opts.trainDir],
    ] as const) {
      if (!existsSync(path)) {
        return Promise.reject(new Error(`nexus sidecar: ${label} not found at ${path}`));
      }
    }
    const child = spawn(
      this.opts.python,
      [
        this.opts.sidecarPath,
        "--ckpt", this.opts.checkpointPath,
        "--train-dir", this.opts.trainDir,
        "--max-new", String(this.opts.maxNewTokens),
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    this.child = child;
    this.buffer = "";
    let settleReady: { resolve: () => void; reject: (e: Error) => void } | null = null;
    this.ready = new Promise<void>((resolve, reject) => {
      settleReady = { resolve, reject };
    });
    // A rejected ready promise with no awaiter yet must not crash the
    // process as an unhandled rejection; request() awaits the original.
    this.ready.catch(() => undefined);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let nl = this.buffer.indexOf("\n");
      while (nl >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        nl = this.buffer.indexOf("\n");
        if (line) this.onLine(line, settleReady);
      }
    });
    child.on("error", (error) => {
      this.failAll(new Error(`nexus sidecar failed to start: ${error.message}`));
      settleReady?.reject(new Error("nexus sidecar failed to start"));
    });
    child.on("exit", (code) => {
      if (this.child === child) {
        this.child = null;
        this.ready = null;
      }
      this.failAll(new Error(`nexus sidecar exited (code ${String(code)})`));
      settleReady?.reject(new Error("nexus sidecar exited before ready"));
    });
    return this.ready;
  }

  private onLine(
    line: string,
    settleReady: { resolve: () => void; reject: (e: Error) => void } | null,
  ): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return; // Non-protocol noise on stdout is ignored, never parsed as output.
    }
    if (msg.ready === true) {
      const sha = typeof msg.checkpointSha256 === "string" ? msg.checkpointSha256 : "";
      this.loadedCheckpointSha256 = sha;
      if (!sha.startsWith(NEXUS_RUN25_CHECKPOINT_SHA256.slice(0, 8))) {
        settleReady?.reject(
          new Error("nexus sidecar loaded a checkpoint that does not match its label"),
        );
        this.failAll(new Error("nexus sidecar checkpoint mismatch"));
        this.close();
        return;
      }
      settleReady?.resolve();
      return;
    }
    const id = typeof msg.id === "number" ? msg.id : null;
    if (id === null) return;
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (typeof msg.text === "string") pending.resolve(msg.text);
    else pending.reject(new Error(`nexus sidecar error: ${String(msg.error ?? "unknown")}`));
  }

  private failAll(error: Error): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const p of pending) p.reject(error);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export interface NexusBackendOptions {
  transport?: NexusTransport;
  timeoutMs?: number;
}

/**
 * The Nexus backend for a seat: a RawOutputBackend whose invoke renders
 * the prompt, asks the sidecar (bounded by a timeout), and returns the
 * RAW text; the parser is the strict parseNexusRawActions. A timeout is
 * a malformed batch (the driver refuses it whole), never a hang.
 */
export function createNexusLocalBackend(options: NexusBackendOptions = {}): SeatBackend {
  const sidecarOpts = resolveNexusSidecarOptions();
  const transport = options.transport ?? new NexusSidecar(sidecarOpts);
  const timeoutMs = options.timeoutMs ?? sidecarOpts.timeoutMs;
  return new RawOutputBackend(
    { providerId: NEXUS_RUN25_REF.providerId, version: NEXUS_RUN25_REF.version },
    async (input) => {
      const prompt = buildNexusPrompt(input);
      return withTimeout(transport.request(prompt), timeoutMs, () => {
        if (transport instanceof NexusSidecar) transport.close();
        return new Error(`nexus sidecar timed out after ${timeoutMs}ms`);
      });
    },
    (raw) => parseNexusRawActions(raw),
    nexusPromptProvenance,
  );
}
