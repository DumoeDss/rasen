## MODIFIED Requirements

### Requirement: The change-finalization endpoint requires a complete scope and one explicit outcome

`POST /api/v1/stores/:storeUid/projects/:projectId/lines/:targetLineId/changes/:instance/finalize` SHALL finalize exactly one Change and SHALL require its complete scope — Store, project, stable target line, and Change instance — in the path, plus the outcome and the reason or successor that outcome requires in the body. The body MAY also contain `mergeConfirmed`, which SHALL be an explicit boolean and SHALL be `true` only after the caller independently verifies the recorded PR merge. The server SHALL NOT complete a missing or ambiguous scope field from a query filter, a session, a launch project, or a previously viewed selection, and SHALL reject the request instead.

The endpoint SHALL mutate only by spawning the CLI and SHALL produce the same immutable finalization plan the command-line and workflow surfaces produce for the same inputs. `mergeConfirmed: true` SHALL admit only a preview whose sole blocker is the typed `archive_merge_confirmation_required` blocker, directly or nested as the Store finalization blocker's `archiveBlocker.code`; it SHALL NOT suppress any other blocker or alter the saved plan. The successful response contract remains unchanged: it SHALL return the recorded outcome, published entry path, whether spec synchronization was applied, and the established finalization identity and commit fields.

A refused finalization SHALL use the established error envelope `{ error: { code, message, cliExitCode?, stderr?, finalization? } }`. When the CLI returns a structured incomplete finalization, `error.finalization` SHALL preserve its nested `status`, complete `blockers` array, and the applicable typed disposition field — `recoveryCommand`, `abortCommand`, or `manualRecoveryAction` — without flattening it into a generic CLI error or inventing replay advice.

#### Scenario: An incomplete scope is rejected, not inferred

- **WHEN** a finalization request omits the target line or the Change instance, or names one that disagrees with the Change's committed identity
- **THEN** the server responds with an error naming the disagreement
- **AND** no CLI subprocess that would mutate is spawned and no file is modified

#### Scenario: A finalization is fulfilled by the CLI and reported

- **WHEN** an authorized finalization request supplies a complete scope and a valid outcome
- **THEN** the mutation is performed by a spawned CLI subprocess
- **AND** the response reports the recorded outcome, the published entry path, and whether spec synchronization was applied

#### Scenario: A refused finalization surfaces its diagnostic unchanged

- **WHEN** the CLI refuses the finalization because the outcome is invalid, the landed commit is unreachable, or the successor cannot be verified
- **THEN** the response carries that diagnostic code and message unchanged
- **AND** no partial archive entry, spec write, or record file exists afterward

#### Scenario: Verified merge assertion admits only the merge gate

- **GIVEN** the caller has independently verified the recorded PR merge
- **WHEN** it submits `mergeConfirmed: true` and the saved preview contains exactly one typed `archive_merge_confirmation_required` blocker
- **THEN** the endpoint applies that exact immutable plan with the merge assertion
- **AND** another blocker, or the merge blocker accompanied by any other blocker, still refuses the request without mutation

#### Scenario: Merge assertion has a strict request shape

- **WHEN** a request supplies a non-boolean `mergeConfirmed` value
- **THEN** the endpoint responds with the existing invalid-input error envelope before spawning a mutating subprocess
- **AND** omission or `false` does not satisfy a merge-confirmation blocker

#### Scenario: Incomplete finalization preserves its nested disposition

- **WHEN** apply returns `recoverable`, `abort-required`, or a blocked ownership or integrity disposition
- **THEN** the error envelope preserves `error.finalization.status`, every structured blocker, and respectively the exact `recoveryCommand`, exact `abortCommand`, or typed `manualRecoveryAction`
- **AND** the endpoint does not replace that disposition with `cli_error`, a generic recovery command, or a flattened message
