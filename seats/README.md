# Seats (build order step 3)

SeatProvider is the only integration point: connect / observe / submit.
Adapters: Tier 0 embedded (Nexus — residents/nexus/), Tier 1 local-runner,
Tier 2 hosted gateway. Budgets in tokens + actions per tick, never dollars;
latency never scored (AA8); provider identity journaled, never scored (AA11).
