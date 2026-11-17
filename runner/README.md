# Launch runner

Infrastructure only: it creates or resumes a world in a data directory and
keeps it ticking through the existing seat driver and world pipeline. It
changes no engine law, adds no journal event kinds, and registers exactly
one backend — the scripted test double, honestly labelled
(`test-double:scripted-policy`). A real backend adapter registers in
`runner/backends.ts` in code; a config file can name a provider, but an
unregistered provider is a refusal to start, never an improvisation.

## Launch a world

```bash
npx vite-node runner/main.ts \
  --data-dir ./world-data \
  --config runner/genesis.example.json \
  --interval-ms 1000
```

(vite-node is vitest's runner and already in this repo's dependency tree;
it resolves the repo's `.js` import specifiers against the `.ts` sources,
which plain Node cannot.)

- First run in a fresh directory creates the world from the genesis config
  (seed, Juarez map, seat list with backend identities) and journals
  `WORLD_GENESIS`. Later runs in the same directory resume from the
  journal: the hash chain is verified before any new tick, and a supplied
  config is cross-checked against the journaled genesis (seed + roster).
- `--ticks N` runs N driver ticks and exits (smoke runs). Without it the
  runner ticks until SIGINT/SIGTERM, finishing the in-flight tick first.
- One live runner per data directory: `runner.lock` holds the owner's pid.
  A lock left by a dead pid is taken over and the takeover is logged.

## Data directory

| File | What it is |
|---|---|
| `journal.jsonl` | The world journal — authoritative. (`.wal` beside it is the console write-ahead log, managed by the engine.) |
| `snapshot.json` | State cache for fast resume; validated against the journal by `World.restore`, ignored if it disagrees. |
| `runner.lock` | Live-runner lock (pid, host, start time). |

## Logs (stdout, one line per event)

```
RUNNER start mode=genesis tick=0 head=<hash> seats=nexus,scout
TICK tick=1 head=<hash> submitted=0 refused=0 closed=- prime=1
TICK tick=2 head=<hash> submitted=2 refused=0 closed=-
RUNNER stop reason=SIGINT tick=2 head=<hash>
```
