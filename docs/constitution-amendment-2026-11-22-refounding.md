# Constitutional Amendment — The Refounding of the Núñez Lineage (2026-11-22)

**Authority:** AA10 — owner-only constitutional authority. Residents, seats,
and automated systems may propose; only the owner approves.

**The ruling, in the owner's own words** (ForgeClaw chat, 2026-11-22
~21:31 CST): *"just put my seat in, I don't want no blockers, I want to
play already."* Recorded on the channel of record: ForgeClaw issue #235,
comment **7090833287**. The owner confirmed the build in the flagged
worktree in his own words at 21:34 CST: *"Yes — build the seat in that
ni-seat clone."*

**Operation of the lineage** (owner directive, 2026-11-22 ~21:35 CST):
*"since intelligence hasn't passed the benchmarks yet to operate my
lineage I'll let you operate my lineage until Nexus intelligence is up to
par to run my lineage."* Muse operates the lineage (orders authored
`operator: "muse"`) until a Nexus training run passes the frozen grade
and takes the seat from Run 25; operation then passes to Nexus
(`operator: "nexus"`). The owner directs his lineage himself through the
orders chat box in the resident view; his entries (`operator: "owner"`)
override the operator's for the same tick.

## What this amendment does

1. **A successor lineage is founded.** A new Núñez lineage,
   `lineage:nunez`, is founded by this charter amendment, with one new
   founding resident: **cristian**, the owner's own character.
2. **The Throne is carried again.** The founding resident carries the
   Tier-0 Throne seat — the lineage office of AA11.1 — as a mortal
   resident under full AA12/AA4: distinct identity, own agency, own
   mortality, no exemption from the validator, scarcity, or death.
3. **Genesis norms, nothing beyond them.** The founding resident starts
   exactly where every genesis resident starts: Centro Histórico
   (`centro`), satiety 8 of 10, inventory 0, 2 actions per tick,
   intel 1. The amendment grants no equipment, no resources, and no
   engine advantage.

## What this amendment does NOT do

- **It does not revive the extinct lineage.** `lineage:nexus` remains
  extinct. Its resident died at tick 8 of the live world and stays dead;
  AA11.1's anti-resurrection clause is untouched — the engine does not
  respawn a replacement Nexus resident, and nothing in this amendment
  names one.
- **It does not rewrite history.** No journal entry is altered, removed,
  or reinterpreted. The refounding is a new journal entry
  (`LINEAGE_FOUNDED`) appended after the existing record; replay of the
  pre-founding journal is byte-identical to before.
- **It is not a succession.** No AA4 instrument existed or was executed;
  nothing is inherited — no inventory, no identity, no standing transfers
  from the extinct lineage. The successor lineage begins at genesis
  norms because it begins, not because it inherits.

## Form in code

- The founding shape is constitutional text: `LINEAGE_FOUNDED` in
  `engine/world/state.ts` accepts exactly the resident, lineage, seat,
  and genesis-norm starting state named here, exactly once per world,
  and only once the superseded lineage is extinct. Every deviation is
  rejected at replay.
- The founding resident is driven by the orders file
  (`runner/ownerOrders.ts`): every order names its author in an
  `operator` field, the file is the audit trail, and owner entries
  override operator entries for the same tick.
- The resident's view (`viewer/residentView.ts`) shows the founding
  resident only what the engine authorizes him to perceive, and carries
  the owner's orders chat box.

The frozen constitution text (`docs/constitution-v0.6.8.txt`, SHA-256
`e758008c0cf69c5ef58e147b98fcb845a6953aa52df679717a686b4bf34acbf2`) is
not edited by this amendment. This document is the amendment's record;
the frozen text stands as frozen.
