# Seats (build order step 3)

SeatProvider is the only integration point: connect / observe / submit.
Adapters: Tier 0 embedded (Nexus — residents/nexus/), Tier 1 local-runner,
Tier 2 hosted gateway. Budgets in tokens + actions per tick, never dollars;
latency never scored (AA8); provider identity journaled, never scored (AA11).

## Credentials, gateway, channels (Phase 1 task T4 + Addendum A block 3)

- `credentials.ts`: scoped, authenticated, revocable, attributable seat
  credentials. Only a token's hash is stored. A credential resolves to
  exactly one seat.
- `gateway.ts`: the credentialed path into the world. It adds authentication
  and attribution, never authority: actions still go to the single validator,
  and each journaled action record carries the authorizing credential id.
- `channels.ts`: private channels scoped pair / ring / lineage / world.
  Content is in memory only: never journaled, never written to disk, no
  export path. Delivery is fixed at send time.

Limits: nothing here persists across a restart (messages, orders, and
credentials are lost); there is no at-rest encryption because there is no
at-rest copy; issuing credentials is an engine-side call with no operator
authentication yet; ring names and ranks are whatever the founder declares.
