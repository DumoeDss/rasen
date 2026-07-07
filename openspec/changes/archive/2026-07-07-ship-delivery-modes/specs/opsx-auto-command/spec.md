# opsx-auto-command — Delta

## MODIFIED Requirements

### Requirement: Bug Fix Pipeline

The Bug-Fix pipeline SHALL use an adaptive verify policy: a green unit-test gate suffices for simple fixes, while complex fixes additionally engage a dedicated test/verification worker. The unit-test gate's evidence SHALL be recorded for the ship stage's evidence-based test gate.

#### Scenario: Simple fix passes on the unit-test gate

- **WHEN** a bug fix is simple (e.g. single file, non-core path, sufficient tests) and the unit-test gate is green
- **THEN** verify SHALL pass without entering the review loop
- **AND** the simple/complex determination SHALL be recorded in run-state

#### Scenario: Complex fix gets deeper verification

- **WHEN** a bug fix is complex (e.g. multiple files, core paths, insufficient coverage)
- **THEN** the LEAD SHALL spawn a dedicated test/verification worker and enter the review-cycle loop

#### Scenario: Unit-test gate evidence recorded

- **WHEN** the unit-test gate runs during adaptive verify
- **THEN** the gate's command, result, and the git code state it ran against SHALL be recorded in run-state
