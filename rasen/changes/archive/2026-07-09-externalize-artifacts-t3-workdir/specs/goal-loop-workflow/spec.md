# goal-loop-workflow Specification (delta)

## MODIFIED Requirements

### Requirement: Authoritative Round Record in goal-run.json

Each completed round SHALL append a record to the loop's run artifact (`loop.runArtifact`, default `goal-run.json`) in the change's work directory (the `workDir` reported by the CLI per the `change-work-dir` capability, with the change directory as the sticky-legacy fallback) containing `{round, score?, measurePassed?, evaluateSatisfied?, detail?, gaps?, error?, gitTreeFingerprint}`. This file SHALL be the authoritative loop spine that survives worker relay and session restart; `loopProgress` in run-state SHALL be a best-effort derived cache pointing to it via `historyRef`.

#### Scenario: Round record appended after each gate

- **WHEN** a goal-loop round's gate completes (satisfied, not-passed, or error)
- **THEN** a record SHALL be appended to the run artifact in the resolved location with the round number, the gate result, and the git tree fingerprint
- **AND** the record SHALL be readable by a successor worker after relay

#### Scenario: Legacy run continues in place

- **WHEN** a goal-loop resumes and its run artifact already exists in the change directory
- **THEN** subsequent round records SHALL continue to append to that file (sticky-legacy), keeping one authoritative spine
