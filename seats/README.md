# Seats (build order step 3)

SeatProvider is the only integration point: connect / observe / submit.
Adapters: Tier 0 embedded (Nexus — residents/nexus/), Tier 1 local-runner,
Tier 2 hosted gateway. Budgets in tokens + actions per tick, never dollars;
latency never scored (AA8); provider identity journaled, never scored (AA11).

## Seat driver (AT-22)

`driver.ts` is the per-tick bridge from a driven seat to a backend: it passes
the seat's journal-delivered, intel-scoped observation and private directives to
the backend, structurally parses candidate actions, and queues them through
`World.submit()`. The world's single validator remains authoritative. The
deterministic `ScriptedPolicyBackend` is a **TEST DOUBLE**, never Nexus or a
real model; `RawOutputBackend` is the contract adapter for raw model output.
Malformed output records only a safe `DRIVER_ACTION_REJECTED` reason and backend
reference at the next tick boundary—raw prompts, directives, and model output
never enter the journal. A driven seat closes permanently after death; there is
no driver respawn or rebind path.

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

PROVISIONAL — owner-ratification item (BR-1): the restart loss above is a
known constitutional-tier gap, not a settled design. Durable private memory
must survive restart, remain invisible to the journal, and stay inside
AA7's scrub boundary; the in-memory form here is the Phase 1 prototype.
