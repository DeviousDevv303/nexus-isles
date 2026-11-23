// Nexus Isles — verification receipt type (viewer-visible).
//
// The receipt is produced by runner/status.ts (runner/worldStatus.ts: buildReceipt)
// and consumed by viewer/render.ts. The type lives here, in the viewer module, so
// the viewer's read-only import allowlist stays intact: runner may import from
// viewer (as runner/worldStatus.ts already imports replayFrames), but the reverse
// is not allowed. ChatGPT's P1 audit (forgeclaw #235) grounds the shape: the page
// must not present displayed-matching hashes as verification; it names, instead,
// who verified, when, and under which run.
export interface VerificationReceipt {
  schema: "nexus-isles-verification/v1";
  verifiedAt: string;
  head: string;
  entries: number;
  tick: number;
  journalPath: string;
  chainVerified: true;
  replayStateHashesMatchedAtEveryCommit: true;
  /** GitHub Actions run URL when GITHUB_SERVER_URL + GITHUB_REPOSITORY + GITHUB_RUN_ID are set; else null. */
  actionsRunUrl: string | null;
  verifier: string;
  /**
   * The source journal's torn-tail state at load. `Journal.loadFromFile()` discards an incomplete
   * final fragment and records offset/bytes/sha256 in `loadReport.tornTail`; without this field in
   * the receipt, worldStatus() would attest "chain verified" while silently dropping bytes
   * (GPT's torn-tail finding on PR #54). When present, the viewer treats the receipt as
   * INCOMPLETE and refuses to display green.
   */
  sourceTornTail: null | { offset: number; bytes: number; sha256: string };
  /** The final entry was complete but lost its newline; it was kept. Reported for symmetry. */
  sourceUnterminatedFinalEntry: boolean;
}
