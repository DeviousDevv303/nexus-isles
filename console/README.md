# Owner Console (build order step 5 — EXTERNAL_EVENT pipeline implemented)

console.ts implements the intervention pipeline (AA9): parsed intent +
diff shown, owner confirms, the event is journaled VERBATIM as an
EXTERNAL_EVENT before the tick it affects resolves. Classes C0–C4; C0 is
read-only and never journals; C3 (seat operations) enforces double-confirm
+ typed reason in code; rollback does not exist — corrections are new
events. The natural-language parsing front-end lands with the operator UI;
the journaling law it must feed is here and tested (tests/at09).

`identity.ts` provides `formatNunezIdentityForConsole()` for a read-only,
C0-style Charter identity card. It renders the Throne, spider-swarm sigil, and
black tactical presentation while explicitly disclaiming current world
presence, an assigned sitter, and any granted assets. It does not take a
journal, append an event, change state, or create an intervention.
