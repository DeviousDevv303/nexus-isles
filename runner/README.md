# Launch runner

Infrastructure only: it creates or resumes a world in a data directory and
keeps it ticking through the existing seat driver and world pipeline. It
changes no engine law and adds no journal event kinds. Three backends are
registered in `runner/backends.ts` in code: the scripted test double,
honestly labelled (`test-double:scripted-policy`, scratch worlds only);
the same survival policy under its production identity
(`scripted-policy:survival`), which is how the decided first-live roster's
scripted-policy residents are seated in a persistent world; and the real
Nexus adapter (below). A config file can name a provider, but an
unregistered provider is a refusal to start, never an improvisation.

`runner/genesis.live.example.json` expresses the decided first-live shape
— a persistent Juarez world seating Nexus (`nexus:run25-local`) plus two
`scripted-policy:survival` residents. It is an example: the launch seed,
exact roster and starting values are set in the real genesis config at
launch time, under the owner's launch word. This file authorizes nothing.

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
  config is cross-checked against the journaled genesis (seed + roster +
  world class).
- World class (`worldClass: "scratch" | "persistent"` in the genesis
  config): scratch worlds may seat the labeled test doubles; persistent
  worlds refuse them, and the two classes' histories never mix — a resume
  whose class disagrees with the journaled genesis is refused before the
  journal is loaded. A config that omits the field is treated fail-closed
  as persistent, and the runner's log says so
  (`RUNNER world-class config=omitted effective=persistent`).
- `--ticks N` runs N driver ticks and exits (smoke runs). Without it the
  runner ticks until SIGINT/SIGTERM, finishing the in-flight tick first.
- One live runner per data directory: `runner.lock` holds the owner's pid.
  A lock left by a dead pid is taken over and the takeover is logged.

## The Nexus backend (`nexus:run25-local`)

The real backend for the Nexus seat: Cristian's own LLM, the seated
Run 25 checkpoint, served by a Python sidecar (`runner/nexus_sidecar.py`)
that loads the checkpoint once and answers line-delimited JSON requests
over stdin/stdout, reusing the trainer's inference path
(`common.frame` + greedy decode). The TypeScript adapter
(`runner/nexusBackend.ts`) renders the prompt from ONLY the seat's own
observation and directives, and parses the model's raw text strictly —
the first JSON array, validated by the driver's own parser. Malformed
output, a sidecar error, or a timeout refuses the whole tick batch
(`malformed_backend_output`); nothing is repaired. The sidecar reports
the loaded checkpoint's sha256 at startup and the adapter refuses to
serve under this label if it does not match the Run 25 checkpoint
(`ckpt-c41852fb`).

Configuration is by environment (defaults suit this machine):

| Variable | Default |
|---|---|
| `NEXUS_PYTHON` | `~/workspace/nexus-taste/.venv/bin/python` |
| `NEXUS_CHECKPOINT` | `~/workspace/run25/ckpt/model.pt` |
| `NEXUS_TRAIN_DIR` | `~/workspace/run8-reads/nexus-llm/train` |
| `NEXUS_SIDECAR_TIMEOUT_MS` | `120000` |
| `NEXUS_SIDECAR_MAX_NEW` | `96` |

Seat it in a genesis config with
`"backend": {"providerId": "nexus:run25-local", "version": "ckpt-c41852fb"}`.

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
