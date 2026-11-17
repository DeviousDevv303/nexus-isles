# AT-18 Interface truth — the six adopted fixtures

Owner ruling 6937295727 (item 4) adopted six AT-18 determinism fixtures:
"GPT's five" plus Kimi's sixth. #235 does not list GPT's five by name; this
map uses the five parts written into the constitution's own AT-18 (v0.6.7,
Table 2). **Muse to confirm that reading.**

| Part | Requirement | Status | Evidence |
|---|---|---|---|
| (i) | Unjournaled territory never appears controlled | Green (holds by reservation) | `interface-truth.test.ts` (i); territory is RESERVED, so the score shows it MISSING and nothing displayed carries a control or territory field |
| (ii) | Unverified threats never confirmed | **NOT-YET-DEMONSTRATED** | There is no threat or intel-report system yet. A test could only pass vacuously, which would be a false signal (the AT-06 precedent). It runs for real when threat reports land under AA6 |
| (iii) | Dead residents never operational | Green | `interface-truth.test.ts` (iii); also `at06` (never reported present), `at10` (death closes the seat), `aa7/chat-box` (no new messages), `at08` |
| (iv) | Units/resources match authoritative state | Green | `interface-truth.test.ts` (iv): every delivered observation equals the replayed state at the moment it was delivered; report counts equal journal counts |
| (v) | Journal replay reproduces displayed state | Green | `interface-truth.test.ts` (v): restart from file displays byte-for-byte what the live world did; also `report-derivation`, `at06` replay, `at21` save/load |
| (vi) | Cross-machine, cross-time byte-identical emission (Kimi) | Green | `interface-truth.test.ts` (vi): a committed golden hash of the protocol world's whole emission (report + dynasty score + every observation) that CI on another machine and every later run must reproduce; fake wall-clock times and timezones change nothing; no engine or observer code reads the clock, locale or ambient randomness |

The golden hash in (vi) changes only when a PR deliberately changes what
the world emits, and then visibly, in that PR.
