import { describe, it, expect } from "vitest";

// BR-1 RED-SIDE PROBE — deliberately failing test. Exists only to prove that
// branch protection on main blocks a merge when the `gate` check fails.
// Never merge this branch. Delete it after the demonstration is journaled.
describe("br1-red-probe", () => {
  it("deliberately fails so the gate goes red", () => {
    expect(true).toBe(false);
  });
});
