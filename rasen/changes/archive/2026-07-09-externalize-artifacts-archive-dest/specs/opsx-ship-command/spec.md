# opsx-ship-command Specification (delta)

## ADDED Requirements

### Requirement: In-ship bookkeeping honors the destination axis

When ship runs archive's bookkeeping inside the ship stage (timing `in-ship`), the bookkeeping SHALL follow the resolved destination from the status JSON: `in-repo` — move to the in-repo archive so the archived directory rides the delivery; `external` — move to the machine-home archive so the repo-side REMOVAL rides the delivery while the archive copy stays machine-local; `prune` — delete so the removal rides the delivery. The destructive-destination preconditions apply, except that the committed-state precondition is inherently satisfied because in-ship bookkeeping happens immediately before ship's own commit of the change's files. The ship log SHALL record the destination outcome (archived path or pruned state).

#### Scenario: In-ship external delivery carries the removal

- **WHEN** a change ships with timing `in-ship` and destination `external`
- **THEN** the change directory SHALL be moved to the machine-home archive before the ship commit
- **AND** the delivered commit SHALL contain the synced specs and the change-directory removal, with no archive-dir additions

#### Scenario: In-ship prune records the pruned state

- **WHEN** a change ships with timing `in-ship` and destination `prune`
- **THEN** the change directory SHALL be deleted before the ship commit after the prune confirmation
- **AND** the ship log SHALL record the pruned state so later archive invocations recognize the outcome
