// Nexus Isles — launch runner entrypoint.
//
//   npx vite-node runner/main.ts \
//     --data-dir ./world-data --config runner/genesis.example.json \
//     [--interval-ms 1000] [--ticks N]
//
// Without --ticks the runner ticks on the interval until SIGINT/SIGTERM,
// finishing the in-flight tick before exiting. With --ticks N it runs N
// driver ticks and exits (smoke runs, supervised launches). Exit code 1 on
// any refusal to start: lock held by a live runner, journal failed
// verification, genesis/config mismatch, unregistered backend provider.
//
// (vite-node — vitest's runner, already in this repo's dependency tree — is
// the execution mechanism: the repo's modules import each other by ".js"
// specifiers under bundler resolution, which plain Node cannot resolve
// against the ".ts" sources.)

import { loadGenesisConfig } from "./config.js";
import { LaunchRunner } from "./runner.js";

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function intArg(name: string): number | undefined {
  const raw = argValue(name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`--${name} must be an integer >= 0`);
  return n;
}

async function main(): Promise<void> {
  const dataDir = argValue("data-dir") ?? "./world-data";
  const configPath = argValue("config");
  const intervalMs = intArg("interval-ms");
  const maxTicks = intArg("ticks");
  const genesis = configPath ? loadGenesisConfig(configPath) : undefined;

  const runner = new LaunchRunner({ dataDir, genesis, tickIntervalMs: intervalMs });
  await runner.start();

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    void runner.stop(signal).then(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  if (maxTicks !== undefined) {
    for (let i = 0; i < maxTicks && !stopping; i++) await runner.tickOnce();
    await runner.stop("ticks-complete");
    return;
  }
  runner.run();
}

main().catch((cause: unknown) => {
  console.error(`RUNNER fatal ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exit(1);
});
