## MODIFIED Requirements

### Requirement: Reconciler Runs settle workspace contention durably

Rasen's `ChangePipelineRuntime` SHALL serialize workspace contention by
committing one durable `workspace-reservation` wait for the blocked local
candidate set whenever the reconciler's workspace-compatible admission
selection leaves ready candidates out of the admit batch, and whenever a
cross-Run workspace reservation registry denies a workspace admit. The
wait SHALL carry only the WorkspaceInstanceId and the stable local
candidate identities (NodeId, InvocationId, occurrence, access) — it
SHALL NOT carry the conflicting Run identity, ActionId, or AttemptId of
either Run. The wait SHALL be resumable through the ordinary
resume-wait stimulus path so the stable compatible subset is admitted
once the workspace is observably free.

#### Scenario: await-workspace candidate commits a durable wait

- **WHEN** the reconciler emits an `await-workspace` candidate because
  one ready writer excludes another ready writer/reader under the
  workspace lease
- **THEN** `start`, `resume`, and `complete` each commit a
  `workspace-reservation` wait in the same Record revision as the
  admitted writer
- **AND** the wait's intents carry exactly the blocked candidates'
  NodeId, InvocationId, occurrence, and access — never their ActionId or
  AttemptId
- **AND** the receipt's `actions` list excludes the blocked candidates
  and the projected view offers a resume control for the new WaitId

#### Scenario: Workspace reservation wait is retryable and non-churning

- **WHEN** start is blocked before its first workspace admission
- **THEN** it may publish version zero waiting with `actions: []`
- **AND** resume/control while still blocked is idempotent without a new
  version, because re-settling the same `await-workspace` candidate
  re-derives the identical WaitId and the facade skips the suspend
  stimulus when that WaitId is already present

#### Scenario: Reservation release admits deterministically

- **WHEN** the external reservation releases and exact facade resume or a
  version+WaitId resume control rechecks the workspace-reservation wait
- **THEN** the wait closes and the stable compatible subset is admitted
- **AND** defer-mode browser control leaves those Actions undelivered for
  trusted CLI claim

#### Scenario: Cross-Run registry serializes workspace contention

- **WHEN** two Runs share one reservation registry and each attempts to
  admit a workspace-write Action against the same WorkspaceInstanceId
- **THEN** the first Run's facade reserves successfully and admits its
  writer; the second Run's facade observes the reservation conflict and
  commits a `workspace-reservation` wait for its blocked writer instead
- **AND** the second Run performs no conflicting workspace write while
  the first Run's reservation is held
- **AND** completing the first Run's writer releases its reservation so
  a subsequent resume of the second Run admits the previously-blocked
  writer in one revision

#### Scenario: complete settles the next candidate batch

- **WHEN** a typed completion closes one Action and the reconciler
  identifies downstream candidates that become admissible, awaitable, or
  terminal as a direct consequence
- **THEN** `complete` reconciles and settles the resulting Record in the
  same revision as the `commit-action-result` stimulus
- **AND** the receipt exposes any granted Action, the projected view
  exposes any newly-committed wait, and the Run reaches its next
  quiescent point without a separate `resume` call
