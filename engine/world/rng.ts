// Nexus Isles — seeded RNG (build order step 2).
//
// Stateless by design: every random draw comes from a stream derived from
// (seed, tick, stream-name). There is no RNG state to persist, so a restart
// can never desynchronise it from the journal — the seed (journaled in
// WORLD_GENESIS) plus the tick fully determines every draw. Streams are
// independent: adding a draw to one stream never shifts another (AT-01).

import { createHash } from "node:crypto";

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(a: number, b: number, c: number, d: number) {
    this.a = a >>> 0;
    this.b = b >>> 0;
    this.c = c >>> 0;
    this.d = d >>> 0;
    for (let i = 0; i < 12; i++) this.next(); // warm-up
  }

  /** sfc32: uniform float in [0, 1). */
  next(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    if (!Number.isSafeInteger(n) || n <= 0) {
      throw new Error(`Rng.int requires a positive integer, got ${n}`);
    }
    return Math.floor(this.next() * n);
  }

  /** Fisher–Yates on a copy; the input is never mutated. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}

/** The stream for (seed, tick, name). Same inputs -> same sequence, always. */
export function rngFor(seed: number, tick: number, stream: string): Rng {
  if (!Number.isSafeInteger(seed)) {
    throw new Error(`seed must be a safe integer, got ${seed}`);
  }
  const h = createHash("sha256").update(`${seed}|${tick}|${stream}`).digest();
  return new Rng(
    h.readUInt32LE(0),
    h.readUInt32LE(4),
    h.readUInt32LE(8),
    h.readUInt32LE(12),
  );
}
