# opsx-ship-command Specification (delta)

## ADDED Requirements

### Requirement: Ship honors the archive timing axis

The ship workflow SHALL resolve the archive timing from the status JSON (`archive.timing`, default `on-merge`) and act on it. Under `in-ship`, ship SHALL run archive's two steps inside the ship stage, ordered before the ship commit so their results ride the same delivery: first capture content later ship steps need from the change directory (PR body sections, task completion), then sync delta specs to main specs, then move the change directory to the archive location, then commit — and record the archived location in the ship log. Under `on-merge`, ship SHALL NOT sync or move anything; its post-delivery guidance SHALL be mode-aware: after a `pr` delivery it states the change stays ACTIVE and archive follows merge confirmation; after a `push` or `local` delivery it directs archiving immediately.

#### Scenario: In-ship delivery carries sync and bookkeeping

- **WHEN** the generated ship workflow runs with resolved timing `in-ship`
- **THEN** it SHALL sync delta specs and move the change directory to the archive location before the ship commit
- **AND** the ship log SHALL record the archived path
- **AND** PR-body content SHALL be captured before the directory moves so later steps still have it

#### Scenario: On-merge pr delivery leaves the change active

- **WHEN** the generated ship workflow completes a `pr` delivery with resolved timing `on-merge`
- **THEN** its post-ship guidance SHALL state the change remains active during PR review and archive proceeds after merge confirmation
- **AND** SHALL NOT sync specs or move the change directory

#### Scenario: On-merge local or push delivery chains to archive

- **WHEN** the generated ship workflow completes a `push` or `local` delivery with resolved timing `on-merge`
- **THEN** its post-ship guidance SHALL direct running archive immediately, since delivery is complete at ship
