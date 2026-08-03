## MODIFIED Requirements

### Requirement: Authoritative Round Record in goal-run.json

Each completed round SHALL append a record to the loop's run artifact (`loop.runArtifact`, default `goal-run.json`) in the execution root's ephemera directory (`<executionRoot>/.rasen/changes/<change>/ephemera/`, the `ephemeraDir` reported by the CLI per the `file-placement` capability), with the sticky-legacy fallback: a run artifact that already exists in the legacy machine-home work directory or the change directory continues to append there. The record SHALL contain `{round, score?, measurePassed?, evaluateSatisfied?, detail?, gaps?, error?, gitTreeFingerprint}`. This file SHALL be the authoritative loop spine that survives worker relay and session restart; `loopProgress` in run-state SHALL be a best-effort derived cache pointing to it via `historyRef`.

#### Scenario: Round record appended after each gate

- **WHEN** a goal-loop round's gate completes (satisfied, not-passed, or error)
- **THEN** a record SHALL be appended to the run artifact in the resolved location with the round number, the gate result, and the git tree fingerprint
- **AND** the record SHALL be readable by a successor worker after relay

#### Scenario: Legacy run continues in place

- **WHEN** a goal-loop resumes and its run artifact already exists in the legacy work directory or the change directory
- **THEN** subsequent round records SHALL continue to append to that file (sticky-legacy), keeping one authoritative spine
