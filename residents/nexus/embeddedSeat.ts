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
//    bypass, never an un-journaled action (AA11, enforced in code: this
//    seat's submit goes to World.submit, and the world's single validator
//    decides — including the per-tick action budget, which the validator
//    owns; this layer never re-checks it).
//  - The model artifact is the checkpoint that holds the Nexus seat
//    (currently Run 25), loaded behind this interface so a future passing
//    run swaps in under replace-only-if-better.
//
// Wiring state (build step 3, seat half): the seat is bound to the world
// core — connect validates the seat against the world's own resident
// table, observe reads the journal-delivered observation, submit queues
// through the world's path. The Receipt's `accepted` attests queueing;
// the verdict is journaled at the tick as ACTION_ACCEPTED /
// ACTION_REJECTED, which is the record that governs. The model's own
// decisions (live inference from the checkpoint) arrive with live
// residents after the owner's freeze — nothing here fakes them, and
// token-budget metering lands with that binding.

import type { World } from "../../engine/world/world.js";
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
  constructor(private readonly world: World) {}

  async connect(spec: SeatSpec): Promise<SeatHandle> {
    if (spec.tier !== 0) {
      throw new Error("NexusEmbeddedSeat accepts Tier 0 specs only");
    }
    const resident = this.world.state.residents[spec.seatId];
    if (!resident) {
      throw new Error(`seat ${spec.seatId} is not a resident of this world`);
    }
    if (spec.budget.actionsPerTick > resident.actionsPerTick) {
      throw new Error(
        `spec budget (${spec.budget.actionsPerTick} actions/tick) exceeds the world's limit for ${spec.seatId} (${resident.actionsPerTick}) — the validator's budget governs`,
      );
    }
    return { spec };
  }

  async observe(handle: SeatHandle): Promise<Observation> {
    const observation = this.world.observe(handle.spec.seatId);
    if (!observation) {
      throw new Error(
        `no observation for ${handle.spec.seatId} — the resident is dead, or no tick has delivered one yet`,
      );
    }
    return observation;
  }

  async submit(handle: SeatHandle, action: Action): Promise<Receipt> {
    this.world.submit(handle.spec.seatId, action);
    return { accepted: true };
  }
}
