## MODIFIED Requirements

### Requirement: The ship log records a two-ended delivery chain

A change's ship log SHALL record the ship end (delivered commit, tree fingerprint, and PR when applicable) and a finalized archive end (archive outcome/path, timestamp, transaction identity, and the ship commit copied from the log's own facts). The archive engine SHALL write the archive end in the staged evidence tree before hashing and SHALL leave the ship-side section byte-identical.

The recorded ship commit SHALL be read from the log's `**Commit:**` lines independently of how the hash is presented in Markdown. A bare hash and a hash enclosed in a matched pair of backticks SHALL yield the same recorded commit. A value SHALL be read only from the line that carries its `**Commit:**` label; a value on a following line SHALL NOT be read. When a log carries more than one `**Commit:**` line, the recorded ship commit SHALL be the first value in document order that reads as a hash, and later lines SHALL NOT be consulted once one has been read. LF or CRLF line endings, trailing spaces or tabs, and the letter case of the hexadecimal digits SHALL NOT affect the reading. A value enclosed in a single unmatched backtick, a hash carrying a trailing qualifier, an empty field, and any other value that is not a 7-to-64 character hexadecimal hash SHALL NOT be read as a ship commit, and nothing SHALL be substituted for it — not the execution `HEAD`, not a merge commit, and not any other commit.

Archive planning and archive finalization SHALL read the field through one shared rule, so a plan saved and applied under the same reading rule can never record different ship commits for the same log. A plan saved under an earlier reading rule MAY carry no recorded commit for a log the current rule reads; finalization SHALL then complete the archive section from its own reading rather than leave the provenance absent, and SHALL NOT rewrite the saved plan.

The ship log SHALL NOT contain the commit SHA of the commit that contains that same finalized log. Instead, the archive/spec-sync commit message SHALL reference the recorded ship short SHA, and Git history SHALL provide the stable archive-side commit identity. When no ship log exists, the engine SHALL create a minimal archive-only log and SHALL not invent ship facts. No workflow SHALL append to the log after its evidence digest is recorded.

#### Scenario: Archive finalizes the chain record before hashing

- **WHEN** a change is archived after a recorded ship
- **THEN** its staged ship log SHALL gain an archive section carrying outcome/path, timestamp, transaction identity, and the recorded ship commit
- **AND** the ship-side section SHALL be byte-identical
- **AND** `archive.json` SHALL hash that final content

#### Scenario: A hash written as a code span records the same ship commit

- **WHEN** the ship log records its commit as `**Commit:**` followed by the hash enclosed in a matched pair of backticks
- **THEN** the archive SHALL record the same ship commit it would record for the bare hash
- **AND** the archive section SHALL carry that ship commit

#### Scenario: An unreadable commit field records no ship commit

- **WHEN** the ship log's `**Commit:**` field is present but holds an unmatched backtick, a trailing qualifier, an empty value, or any other non-hexadecimal value, and no other `**Commit:**` line holds a readable hash
- **THEN** the archive SHALL record no ship commit
- **AND** the archive section SHALL omit the ship commit rather than substituting the execution `HEAD`, a merge commit, or any other commit

#### Scenario: An unreadable commit field followed by a readable one records the readable hash

- **WHEN** the ship log's first `**Commit:**` line holds a value that does not read as a hash and a later `**Commit:**` line holds a bare or code-span hash
- **THEN** the archive SHALL record the first such later line's hash as the ship commit
- **AND** the archive section SHALL carry that ship commit

#### Scenario: The first readable commit field is authoritative

- **WHEN** the ship log carries two `**Commit:**` lines that each hold a readable hash
- **THEN** the archive SHALL record the first line's hash as the ship commit
- **AND** the later line SHALL NOT be consulted

#### Scenario: A hash on the line after the label is not read

- **WHEN** the ship log's `**Commit:**` label is followed by a line break, the hash sits on the following line, and no other `**Commit:**` line holds a readable hash
- **THEN** the archive SHALL record no ship commit
- **AND** the archive section SHALL omit the ship commit rather than substituting the execution `HEAD`, a merge commit, or any other commit

#### Scenario: Planning and finalization agree on the recorded commit

- **WHEN** an archive plan is saved and applied under the same reading rule
- **THEN** the ship commit recorded in the plan and the ship commit written into the archive section SHALL be the same value for every accepted and rejected presentation of the field

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
