// Child process for the two-process writer-lock test: tries to open the
// journal named in argv and tick it once. Prints one JSON line.
import { World } from "../../../engine/world/world.js";
import { WriterLockError } from "../../../engine/world/writerLock.js";

const path = process.argv[process.argv.length - 1];
try {
  const w = World.restoreFromFile(path);
  w.tick();
  w.close();
  console.log(JSON.stringify({ outcome: "ticked" }));
} catch (err) {
  console.log(JSON.stringify({
    outcome: err instanceof WriterLockError ? "refused" : "error",
    message: String((err as Error).message),
    holderPid: err instanceof WriterLockError ? err.holder?.pid ?? null : null,
  }));
}
