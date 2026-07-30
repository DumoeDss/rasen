## MODIFIED Requirements

### Requirement: The ship log records a two-ended delivery chain

A change's ship log (in the evidence directory `<changeRoot>/evidence/` per the `file-placement` capability, or a legacy location per its sticky-legacy chain) SHALL record both ends of the delivery chain: the ship end (the delivered commit, tree fingerprint, and PR when applicable — as ship already records) and an archive end appended by the archive workflow after bookkeeping — the archive/spec-sync commit SHA, the outcome (archived location, pruned state, or archived-in-ship), a timestamp, and the ship commit SHA it corresponds to, copied from the log's own recorded facts rather than re-derived. The append SHALL never rewrite the ship-side section. When no ship log exists (never-shipped or legacy change), the archive workflow SHALL create one containing only the archive section. When the archive commit is created after the append, its SHA SHALL be journaled in a follow-up append immediately after committing.

#### Scenario: Archive appends the chain record

- **WHEN** a change is archived after a recorded ship
- **THEN** its ship log SHALL gain an archive section carrying the archive commit SHA, the outcome, and the ship commit SHA from the log's recorded facts
- **AND** the ship-side section SHALL be byte-identical to before the append

#### Scenario: Chain survives every destination

- **WHEN** a legacy change was archived to the external home or recorded as pruned before those destinations were retired
- **THEN** the ship log (at its resolved location) SHALL still hold the complete chain record afterward

#### Scenario: Never-shipped change still gets an archive record

- **WHEN** a change with no ship log is archived
- **THEN** the archive workflow SHALL create the ship log with the archive section and omit ship-side references rather than inventing them
