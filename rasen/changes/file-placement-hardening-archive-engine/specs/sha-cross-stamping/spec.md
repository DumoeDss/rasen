## MODIFIED Requirements

### Requirement: The ship log records a two-ended delivery chain

A change's ship log SHALL record the ship end (delivered commit, tree fingerprint, and PR when applicable) and a finalized archive end (archive outcome/path, timestamp, transaction identity, and the ship commit copied from the log's own facts). The archive engine SHALL write the archive end in the staged evidence tree before hashing and SHALL leave the ship-side section byte-identical.

The ship log SHALL NOT contain the commit SHA of the commit that contains that same finalized log. Instead, the archive/spec-sync commit message SHALL reference the recorded ship short SHA, and Git history SHALL provide the stable archive-side commit identity. When no ship log exists, the engine SHALL create a minimal archive-only log and SHALL not invent ship facts. No workflow SHALL append to the log after its evidence digest is recorded.

#### Scenario: Archive finalizes the chain record before hashing

- **WHEN** a change is archived after a recorded ship
- **THEN** its staged ship log SHALL gain an archive section carrying outcome/path, timestamp, transaction identity, and the recorded ship commit
- **AND** the ship-side section SHALL be byte-identical
- **AND** `archive.json` SHALL hash that final content

#### Scenario: Chain survives legacy evidence resolution

- **WHEN** a ship log is discovered through a supported sticky-legacy location
- **THEN** its facts SHALL be incorporated into the staged canonical archive evidence
- **AND** the finalized archive SHALL contain a stable hashed chain record

#### Scenario: Never-shipped change still gets an archive record

- **WHEN** a change with no ship log is archived
- **THEN** the engine SHALL create a minimal ship log containing only archive facts
- **AND** SHALL omit ship commit, PR, and other undemonstrated delivery facts

#### Scenario: Archive commit is not appended into hashed evidence

- **WHEN** post-bookkeeping commit guidance is followed
- **THEN** the commit message SHALL provide the reverse ship reference
- **AND** no follow-up append SHALL add that commit's SHA to `ship-log.md`
- **AND** the recorded ship-log digest SHALL remain valid
