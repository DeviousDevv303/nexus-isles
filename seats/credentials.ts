// Nexus Isles — seat credentials (Addendum A block 3).
//
// API access is scoped, authenticated, revocable, and attributable:
//  - scoped:        a credential carries an explicit scope list; a call
//                   outside it is refused.
//  - authenticated: every gateway/channel call presents a secret token;
//                   only its sha256 is stored, never the token.
//  - revocable:     revocation takes effect on the very next call.
//  - attributable:  a credential resolves to exactly one seat and has a
//                   non-secret id that is stamped on what it authorizes.
//
// This is private-layer machinery: tokens are never journaled. Only the
// opaque credential id appears on journaled action records.

import { createHash, randomBytes } from "node:crypto";

export type Scope = "act" | "observe" | "channel:send" | "channel:read" | "chat";

export const ALL_SCOPES: readonly Scope[] = ["act", "observe", "channel:send", "channel:read", "chat"];

export interface Principal {
  credentialId: string;
  seatId: string;
  scopes: readonly Scope[];
}

export class AuthError extends Error {
  constructor(
    readonly code: "invalid_token" | "revoked" | "scope_denied",
    message: string,
  ) {
    super(message);
  }
}

interface Stored {
  credentialId: string;
  seatId: string;
  scopes: Scope[];
  tokenHash: string;
  revoked: boolean;
}

const sha = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

export class CredentialRegistry {
  private readonly byHash = new Map<string, Stored>();
  private readonly byId = new Map<string, Stored>();
  private seq = 0;

  /** Issue a credential for one seat. The token is returned once, here only. */
  issue(seatId: string, scopes: readonly Scope[]): { credentialId: string; token: string } {
    if (scopes.length === 0) throw new Error("a credential needs at least one scope");
    for (const s of scopes) {
      if (!ALL_SCOPES.includes(s)) throw new Error(`unknown scope ${String(s)}`);
    }
    const token = randomBytes(32).toString("hex");
    const stored: Stored = {
      credentialId: `cred-${++this.seq}`,
      seatId,
      scopes: [...new Set(scopes)],
      tokenHash: sha(token),
      revoked: false,
    };
    this.byHash.set(stored.tokenHash, stored);
    this.byId.set(stored.credentialId, stored);
    return { credentialId: stored.credentialId, token };
  }

  revoke(credentialId: string): void {
    const s = this.byId.get(credentialId);
    if (!s) throw new Error(`unknown credential ${credentialId}`);
    s.revoked = true;
  }

  /** Revoke everything a seat holds (e.g. the seat is closed). */
  revokeSeat(seatId: string): number {
    let n = 0;
    for (const s of this.byId.values()) {
      if (s.seatId === seatId && !s.revoked) {
        s.revoked = true;
        n++;
      }
    }
    return n;
  }

  /** Authenticate a token and require a scope. Throws AuthError otherwise. */
  authorize(token: string, scope: Scope): Principal {
    const s = typeof token === "string" ? this.byHash.get(sha(token)) : undefined;
    if (!s) throw new AuthError("invalid_token", "unknown credential");
    if (s.revoked) throw new AuthError("revoked", `credential ${s.credentialId} is revoked`);
    if (!s.scopes.includes(scope)) {
      throw new AuthError("scope_denied", `credential ${s.credentialId} lacks scope ${scope}`);
    }
    return { credentialId: s.credentialId, seatId: s.seatId, scopes: [...s.scopes] };
  }
}
