// Nexus Isles — the authenticated seat gateway.
//
// The credentialed path into the world for any seat that is not in-process.
// It adds authentication and attribution in front of the world's own
// submit path; it adds NO authority. A credential resolves to exactly one
// seat, so a caller can only ever act as, and observe as, their own seat —
// there is no parameter through which another seat could be named. Every
// action still goes to the world's single validator, and its journal record
// carries the credential id that authorized it.

import type { World } from "../engine/world/world.js";
import { CredentialRegistry } from "./credentials.js";
import type { Action, Observation } from "./seatProvider.js";

export class SeatGateway {
  constructor(
    private readonly world: World,
    private readonly credentials: CredentialRegistry,
  ) {}

  submit(token: string, action: Action): void {
    const p = this.credentials.authorize(token, "act");
    this.world.submit(p.seatId, action, { credentialId: p.credentialId });
  }

  observe(token: string): Observation | null {
    const p = this.credentials.authorize(token, "observe");
    return this.world.observe(p.seatId);
  }
}
