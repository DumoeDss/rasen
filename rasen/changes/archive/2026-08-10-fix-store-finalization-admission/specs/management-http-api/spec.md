## MODIFIED Requirements

### Requirement: The change-finalization endpoint requires a complete scope and one explicit outcome

`POST /api/v1/stores/:storeUid/projects/:projectId/lines/:targetLineId/changes/:instance/finalize` SHALL finalize exactly one Change and SHALL require its complete scope — Store, project, stable target line, and Change instance — in the path, plus the outcome and the reason or successor that outcome requires in the body. The body MAY also contain `mergeConfirmed`, which SHALL be an explicit boolean and SHALL be `true` only after the caller independently verifies the recorded PR merge. The server SHALL NOT complete a missing or ambiguous scope field from a query filter, a session, a launch project, or a previously viewed selection.

The endpoint SHALL mutate only by spawning the CLI. It SHALL first run a non-saving finalization inspection and SHALL compare the plan's committed Change instance and complete blocker array with the request. Only after that admission passes SHALL it save a plan, recheck the saved plan, and apply that exact saved token. A refused inspection SHALL leave the machine transaction-store byte inventory unchanged. `mergeConfirmed: true` SHALL admit only a preview whose sole blocker is the typed `archive_merge_confirmation_required` blocker, directly or nested as the Store finalization blocker's `archiveBlocker.code`; it SHALL NOT suppress any other blocker, alter the saved plan, or become true by omission.

The successful response SHALL return the recorded outcome, published entry path, spec-sync result, established finalization identity, and commit fields. A refused finalization SHALL use `{ error: { code, message, cliExitCode?, stderr?, finalization? } }`. When apply returns a structured incomplete finalization, `error.finalization` SHALL preserve its nested status, complete ordered blocker array, and the exact applicable `recoveryCommand`, `abortCommand`, or `manualRecoveryAction` without flattening or inventing advice.

#### Scenario: An incomplete scope is rejected, not inferred

- **WHEN** a finalization request omits the target line or the Change instance, or names one that disagrees with the Change's committed identity
- **THEN** the server responds with an error naming the disagreement
- **AND** no saving or applying subprocess is spawned, the transaction store remains byte-for-byte unchanged, and no project file is modified

#### Scenario: A finalization is fulfilled by the CLI and reported

- **WHEN** an authorized finalization request supplies a complete scope and a valid outcome
- **THEN** a non-saving inspection is followed by saving and applying the exact admitted plan through spawned CLI subprocesses
- **AND** the response reports the recorded outcome, published entry path, and whether spec synchronization was applied

#### Scenario: A refused finalization surfaces its diagnostic unchanged

- **WHEN** inspection refuses finalization because the outcome is invalid, the landed commit is unreachable, the successor cannot be verified, project selection conflicts, or another blocker exists
- **THEN** the response carries that diagnostic code and message unchanged and retains every blocker
- **AND** no transaction plan, partial archive entry, spec write, or record file is created

#### Scenario: Omitted or false merge confirmation does not persist a plan

- **WHEN** the sole inspection blocker is `archive_merge_confirmation_required` and the HTTP body omits `mergeConfirmed` or supplies `false`
- **THEN** the endpoint refuses before saving or applying a plan
- **AND** the transaction-store byte inventory remains unchanged in both cases

#### Scenario: Verified merge assertion admits only the sole merge gate

- **GIVEN** the caller has independently verified the recorded PR merge
- **WHEN** it submits `mergeConfirmed: true` and both the unsaved and saved previews contain exactly one typed `archive_merge_confirmation_required` blocker
- **THEN** the endpoint applies that exact saved token with the merge assertion
- **AND** the transaction store contains only the transaction state produced by that admitted finalization

#### Scenario: A second blocker survives true merge confirmation

- **WHEN** `mergeConfirmed: true` accompanies a merge blocker and any second blocker
- **THEN** the endpoint returns both blockers in deterministic order and does not save or apply a plan
- **AND** the transaction store and project trees remain unchanged

#### Scenario: Merge assertion has a strict request shape

- **WHEN** a request supplies a non-boolean `mergeConfirmed` value
- **THEN** the endpoint responds with the existing invalid-input error envelope before spawning a planning or mutating subprocess
- **AND** omission or `false` never adds `--yes` to an apply invocation

#### Scenario: Incomplete apply preserves its nested disposition

- **WHEN** the spawned apply process returns `recoverable`, `abort-required`, or a blocked ownership or integrity disposition with several blockers
- **THEN** the loopback HTTP error preserves `error.finalization.status`, every blocker and nested typed issue, and respectively the exact `recoveryCommand`, exact `abortCommand`, or complete `manualRecoveryAction`
- **AND** the endpoint does not replace that disposition with `cli_error`, a generic recovery command, or a flattened first-error response
