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

## Chat box (Phase 1 task T5)

`chat.ts`: each principal talks only to their own seat's AI. `enrol(principal,
seat)` binds one principal to one seat and issues the principal's `chat`
credential; `agentCredential(seat)` issues the AI side (`chat:agent`). No call
takes a seat id. Messages are memory-only and never journaled. The chat box
cannot act in the world: the AI acts through the gateway (or the Tier 0 seat),
where the single validator decides.

Limits: enrolment is an operator-side call with no operator authentication;
messages and enrolments are lost on restart; there is no network transport.
