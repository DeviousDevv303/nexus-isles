# Ledger

Append-only, hash-chained event journal + replay engine (build order step 1).
Every world fact is a journal entry; every report is a deterministic
derivation from the journal — never an off-ledger score (Annex A.1).
Implemented: journal.ts (chain, verify, JSONL persistence, replay).
