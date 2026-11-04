## MODIFIED Requirements

### Requirement: Skip Specs Option

The archive command SHALL support a `--skip-specs` flag that skips all canonical spec writes and spec-update confirmation while retaining validation and the other archive gates. A valid ADDED requirement already present in the selected canonical spec with an identical complete requirement block SHALL be accepted in this skipped-synchronization context. Matching SHALL use the existing parser's line-ending and trailing-block-whitespace normalization and SHALL compare the complete block, including its header, requirement text, and scenarios.

Preview and apply SHALL preserve every canonical spec byte when synchronization is skipped. The historical delta spec bytes SHALL remain unchanged in the active Change during preview and in the archived Change after successful apply. These guarantees SHALL hold on macOS, Linux, and Windows.

#### Scenario: Skipping spec updates with flag

- **WHEN** executing `rasen archive <change> --skip-specs`
- **THEN** validate the Change against the selected canonical specs while skipping spec writes and spec-update confirmation
- **AND** proceed through the authoritative archive plan/apply workflow when validation and all other gates pass
- **AND** display a message indicating specs were skipped

#### Scenario: Identical existing ADDED requirements can be archived

- **GIVEN** a valid Change has completed tasks and its ADDED requirements already exist as identical complete blocks in the corresponding canonical specs
- **WHEN** the operator previews archive with `--skip-specs` and validation enabled
- **THEN** those matching requirements SHALL pass validation and the preview SHALL contain no spec-write actions
- **AND** the active Change and canonical spec content SHALL remain unchanged
- **WHEN** the resulting saved plan is applied with all other archive gates satisfied
- **THEN** the authoritative workflow SHALL publish the archive and remove the active Change through its normal successful lifecycle
- **AND** the canonical spec bytes and archived delta spec bytes SHALL equal their respective pre-preview bytes

#### Scenario: Same-name content conflict remains blocking

- **GIVEN** an ADDED requirement has the same name as a canonical requirement but different requirement text or scenarios
- **WHEN** archive is previewed with `--skip-specs` and validation enabled
- **THEN** validation SHALL block archive and identify the conflicting requirement and its source spec
- **AND** the Change SHALL remain active and canonical specs SHALL remain unchanged

#### Scenario: Equality does not waive malformed or ambiguous deltas

- **GIVEN** an existing ADDED block matches canonical content but the Change has malformed requirement text, missing required scenarios, duplicate requirements, or conflicting operations
- **WHEN** archive is previewed with `--skip-specs` and validation enabled
- **THEN** the applicable validation errors SHALL still block archive
- **AND** no spec-write action SHALL be prepared

#### Scenario: Independent conflicts remain visible beside synchronized requirements

- **GIVEN** a Change contains identical existing ADDED requirements and an independent conflicting requirement in another capability
- **WHEN** archive is previewed with `--skip-specs` and validation enabled
- **THEN** the matching requirements SHALL be accepted and the independent conflict SHALL remain a blocking diagnostic
- **AND** no canonical spec SHALL be changed

#### Scenario: Unsynchronized valid additions remain skippable

- **GIVEN** a valid ADDED requirement is absent from the selected canonical specs
- **WHEN** the operator archives with `--skip-specs` and all archive gates pass
- **THEN** the requirement SHALL remain unapplied and the Change SHALL be archived
- **AND** skipped synchronization SHALL NOT create a missing canonical spec

#### Scenario: Windows-authored line endings preserve the same decision

- **GIVEN** corresponding valid ADDED and canonical blocks differ only in LF versus CRLF line endings or trailing block whitespace already normalized by the parser
- **WHEN** archive with `--skip-specs` resolves those specs through the selected planning scope on Windows, macOS, or Linux
- **THEN** their equality decision SHALL be the same
- **AND** native path separators SHALL NOT alter which capability is compared
- **AND** the original canonical and historical delta bytes SHALL be preserved

#### Scenario: Ordinary application retains strict addition semantics

- **GIVEN** an ADDED requirement name already exists in canonical specs
- **WHEN** archive prepares ordinary spec application without `--skip-specs`
- **THEN** the existing-name collision SHALL remain blocking even when the blocks match
- **AND** standalone `rasen validate` SHALL retain its existing canonical-reconciliation behavior

### Requirement: Archive Validation

The archive command SHALL validate changes before applying them to ensure data integrity. When validation blocks the archive in human (non-`--json`) mode, the command SHALL set a non-zero process exit code so scripts and CI can distinguish a blocked archive from a successful one, matching the existing `--json`-mode behavior.

Human previews, JSON previews, and saved plans SHALL retain the blocking validation issues with their source spec, stable issue code when available, and actionable capability and requirement context. The generic validation summary SHALL be accompanied by those details. Validation under `--skip-specs` SHALL admit only the identical existing ADDED case defined by the Skip Specs Option; all other applicable validation rules and archive gates SHALL remain effective.

#### Scenario: Pre-archive validation

- **WHEN** executing `rasen archive change-name`
- **THEN** validate the change structure first
- **AND** only proceed if validation passes
- **AND** show validation errors if it fails

#### Scenario: Force archive without validation

- **WHEN** executing `rasen archive change-name --no-validate`
- **THEN** skip validation (unsafe mode)
- **AND** show warning about skipping validation

#### Scenario: Blocked archive sets a non-zero exit code in human mode

- **WHEN** a non-`--json` archive is blocked at any human-mode abort point — delta-spec validation failure, spec-rebuild failure, or rebuilt-spec validation failure — and nothing is archived
- **THEN** the command sets `process.exitCode = 1` before returning
- **AND** the failure is still printed to the console
- **AND** a legitimate user cancellation (declining a confirmation prompt, selecting no change) leaves the exit code at 0

#### Scenario: Validation details survive JSON preview and plan saving

- **GIVEN** a Change has conflicting same-name ADDED content
- **WHEN** the operator runs archive with `--skip-specs --dry-run --save-plan --json` and validation enabled
- **THEN** the preview and saved plan SHALL include `spec_added_requirement_exists`, the delta source path, and the conflicting capability and requirement in the diagnostic
- **AND** the command SHALL exit non-zero and preserve the active Change and canonical specs
- **AND** a human preview SHALL explain the same conflict

#### Scenario: Independent validation errors are not collapsed into a summary

- **GIVEN** validation finds independent errors in multiple delta specs
- **WHEN** an archive preview is rendered or saved
- **THEN** every blocking issue SHALL remain available in deterministic order with its source and applicable requirement context
- **AND** a generic validation summary SHALL NOT replace those issues

#### Scenario: Synchronized specs do not waive merge confirmation

- **GIVEN** valid identical ADDED requirements pass skipped-synchronization validation but a recorded PR delivery still requires merge confirmation
- **WHEN** archive is previewed without the required confirmation
- **THEN** the merge-confirmation gate SHALL still block archive independently of validation
- **AND** confirming a merge SHALL NOT waive any remaining validation failure
