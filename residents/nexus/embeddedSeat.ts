// Nexus Isles — Tier 0: Nexus Intelligence, BUILT IN.
//
// Nexus is resident zero: embedded in the Isles process, part of the house
// (owner ruling, #235 comment 6908386307). Built-in is architectural, not a
// slogan:
//  - Engine-native seat: Nexus runs inside the engine process with native
//    tick-loop access and a native journal read path for its own memory.
//  - Same physics, same validator: Nexus submits actions through the
//    identical validation and resolution path as every other seat. Its
//    advantage is integration — never world-fact rewriting, never physics
//    bypass, never an un-journaled action (AA11, enforced in code).
//  - The model artifact is the checkpoint that holds the Nexus seat
//    (currently Run 25), loaded behind this interface so a future passing
//    run swaps in under replace-only-if-better.
//
// Skeleton state: the seat's shape is defined; the live model binding
// arrives with the engine core (build order step 3).

import type {
  Action,
  Observation,
  Receipt,
  SeatHandle,
  SeatProvider,
  SeatSpec,
} from "../../seats/seatProvider.js";

export interface NexusSeatSpec extends SeatSpec {
  tier: 0;
  /** Path to the seat checkpoint artifact (weights + tokenizer/config). */
  checkpointPath: string;
  /** Genesis genome for resident zero (see genesis-genome.json). */
  genesisGenomePath: string;
}

export class NexusEmbeddedSeat implements SeatProvider {
  async connect(spec: SeatSpec): Promise<SeatHandle> {
    if (spec.tier !== 0) {
      throw new Error("NexusEmbeddedSeat accepts Tier 0 specs only");
    }
    // TODO(build step 3): load the checkpoint behind this interface and
    // bind the seat to the engine's tick loop and validator.
    return { spec };
  }

  async observe(_handle: SeatHandle): Promise<Observation> {
    throw new Error("not implemented — skeleton (build order step 3)");
  }

  async submit(_handle: SeatHandle, _action: Action): Promise<Receipt> {
    throw new Error("not implemented — skeleton (build order step 3)");
  }
}
