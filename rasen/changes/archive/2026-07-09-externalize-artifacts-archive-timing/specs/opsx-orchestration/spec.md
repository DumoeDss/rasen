# opsx-orchestration Specification (delta)

## ADDED Requirements

### Requirement: Archive Stage Resolves Per the Archive Timing Axis

The playbook SHALL interpret a pipeline's archive stage per the resolved archive timing and the recorded delivery mode: under `in-ship` the LEAD records the archive stage as satisfied with the reason "archived in ship" and dispatches nothing; under `on-merge` with a `push`/`local` delivery the archive stage runs immediately as today; under `on-merge` with a `pr` delivery the LEAD dispatches archive, and when it returns an unmerged refusal the LEAD SHALL record the stage as `pending` with an awaiting-merge note (including the PR URL) in run-state and end the run cleanly surfacing the open frontier — never busy-waiting or polling. A later `pipeline resume` re-enters the stage and re-attempts the check-on-invocation.

#### Scenario: Unmerged PR parks the archive stage without failing the run

- **WHEN** an orchestrated run reaches the archive stage of an on-merge `pr`-delivered change and the merge check reports the PR still open
- **THEN** the LEAD SHALL record the archive stage as pending with an awaiting-merge note in run-state
- **AND** SHALL end the run cleanly, surfacing the awaiting-merge state rather than looping or failing

#### Scenario: Resume re-attempts the merge check

- **WHEN** `pipeline resume` runs later for that change
- **THEN** the archive stage SHALL be re-attempted, performing a fresh merge check on invocation

#### Scenario: In-ship archive stage is a recorded no-op

- **WHEN** an orchestrated run under `in-ship` timing reaches the archive stage after ship recorded the in-ship archive
- **THEN** the LEAD SHALL record the stage as satisfied with the archived-in-ship reason and dispatch no worker
