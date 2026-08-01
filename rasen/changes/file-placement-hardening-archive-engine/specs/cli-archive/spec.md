## MODIFIED Requirements

### Requirement: Archive Process

The archive command SHALL expose one authoritative plan/apply operation used by direct CLI, single archive, bulk archive, and in-ship consumers. Planning SHALL complete validation, spec-update preparation, sidecar/handoff and probe validation, cleaner disposition, quality/evidence discovery, target selection, and blockers without mutation. Apply SHALL consume that exact plan without reclassifying paths or changing planned actions.

A successful apply SHALL stage and verify the archive, publish it without clobbering, finalize cleaner outcomes and `archive.json`, and remove the active change last. A failed apply SHALL preserve the active source or leave a transaction journal that reports the recoverable state. Generated consumers SHALL invoke this operation and SHALL NOT move a change directory directly.

#### Scenario: Performing archive

- **WHEN** archiving a change
- **THEN** the command SHALL derive a complete archive plan before mutation
- **AND** SHALL apply the confirmed plan through the authoritative archive engine
- **AND** SHALL publish to `YYYY-MM-DD-<change-name>` in the planning root without overwrite

#### Scenario: Archive already exists

- **WHEN** an unrelated target archive already exists
- **THEN** apply SHALL fail with a target-conflict error
- **AND** SHALL preserve the active change, ephemera, and existing target

#### Scenario: Successful archive

- **WHEN** staged payload verification, publication, cleaner disposition, and accounting all complete
- **THEN** the command SHALL display the archived name, updated specs, disposition totals, and recovery status
- **AND** the archived evidence hashes SHALL verify
- **AND** the active change SHALL be removed last

#### Scenario: Every entry point calls the engine

- **WHEN** generated single, bulk, and in-ship archive workflows are inspected
- **THEN** each SHALL invoke the authoritative archive command for bookkeeping
- **AND** none SHALL issue a direct archive `mv`, recursive source removal, or hand-written `archive.json`

#### Scenario: Interrupted apply resumes only its own transaction

- **WHEN** a retry encounters a stage or published archive with an incomplete journal
- **THEN** it SHALL resume only if the transaction id and plan hash match the newly supplied plan
- **AND** otherwise SHALL report both paths for recovery without deleting either copy

### Requirement: Ephemera cleaning at archive time

Archive planning SHALL consume the `file-placement` cleaner's complete immutable classification, including candidate fingerprints, effective preserved paths, `sourceSignals`, typed `blockers`, and `complete`. Apply SHALL never invoke cleaner deletion for an aborted or incomplete classification.

When the classification is complete and applicable, the engine SHALL dispose only the planned candidates, journal actual per-candidate progress, and record only actual outcomes in `archive.json`. A complete plan aborted by source signals SHALL preserve and report every effective path while the fully accounted archive may proceed. An incomplete classification or non-absence inspection blocker SHALL block all archive apply.

#### Scenario: Complete cleaner plan is applied and accounted

- **WHEN** `rasen archive <change>` consumes a complete, non-aborted cleaner plan containing schema-valid `auto-run.json`
- **THEN** apply SHALL use that exact candidate and fingerprint without reclassification
- **AND** a successful deletion SHALL appear in `archive.json`'s `ephemeraDiscarded`

#### Scenario: No ephemera directory is a no-op

- **WHEN** cleaner discovery confirms the execution-root ephemera directory is absent with `ENOENT`
- **THEN** the plan SHALL be complete with empty delete and preserve dispositions
- **AND** archive may proceed with an empty `ephemeraDiscarded`

#### Scenario: Source signal preserves the effective tree

- **WHEN** a complete cleaner plan reports a source manifest or source-tree signal
- **THEN** archive apply SHALL NOT call cleaner deletion
- **AND** every candidate and preserved path SHALL appear in the effective preserve disposition
- **AND** the archive result SHALL report all source signals

#### Scenario: Incomplete cleaner plan blocks archive

- **WHEN** cleaner classification reports `complete: false` or an `EACCES`, `EPERM`, or `EIO` blocker
- **THEN** the archive plan SHALL report the blocker with operation and path
- **AND** apply SHALL perform no spec write, handoff action, ephemera deletion, stage publication, or active-source removal

### Requirement: The --keep-ephemera flag preserves all ephemera

`rasen archive` SHALL accept `--keep-ephemera` and represent it in the archive plan. Planning SHALL still inspect and classify the ephemera tree so the preview can report every path and detect incomplete inspection. The effective delete disposition SHALL be empty and every cleaner candidate plus every already-preserved entry SHALL appear in the effective preserve disposition.

#### Scenario: --keep-ephemera projects complete preservation

- **WHEN** `rasen archive <change> --keep-ephemera` plans or applies
- **THEN** the plan SHALL show an empty delete list and the complete effective preserved-path list
- **AND** no ephemera file SHALL be deleted
- **AND** `archive.json` SHALL record no `ephemeraDiscarded` entries

#### Scenario: --keep-ephemera does not hide inspection failure

- **WHEN** ephemera inspection under `--keep-ephemera` fails with a non-`ENOENT` error
- **THEN** the plan SHALL report the blocker
- **AND** archive apply SHALL remain blocked

### Requirement: The --dry-run flag previews all planned actions without executing

`rasen archive --dry-run` SHALL emit the same immutable archive plan that apply consumes. Human and JSON output SHALL include the final target; spec-sync actions; archive-level blocking conditions; sidecar presence/schema status; handoff and probe decisions; cleaner completeness, source signals, and blockers; `keepEphemera`; exact effective delete and preserve lists; quality/evidence inputs; staging/publication intent; and recovery identity. Dry-run SHALL create, move, delete, or write nothing.

#### Scenario: Dry-run reports complete disposition

- **WHEN** dry-run sees deletable, unknown, malformed, nested, or source-signal ephemera
- **THEN** output SHALL list every effective delete or preserve path with its reason
- **AND** SHALL include cleaner completeness, source signals, and typed blockers
- **AND** no ephemera byte SHALL change

#### Scenario: Dry-run reports sidecar and handoff decisions

- **WHEN** a valid archive-input sidecar is present
- **THEN** dry-run SHALL show its schema/change binding, every handoff outcome, every validated probe path/commit, and any blocker
- **AND** SHALL NOT delete or move handoff files or remove the sidecar

#### Scenario: Dry-run reports the spec sync plan

- **WHEN** a change has delta specs
- **THEN** dry-run SHALL list each prepared create, update, or delete action
- **AND** no main spec file SHALL be written

#### Scenario: Dry-run reports target blockers in JSON and human modes

- **WHEN** the final target is occupied or another archive precondition is unsatisfied
- **THEN** both output modes SHALL report the same blocker codes, paths, and messages
- **AND** JSON SHALL NOT omit blockers shown in human output

#### Scenario: Dry-run moves nothing

- **WHEN** dry-run completes
- **THEN** the active change and all execution-root state SHALL remain byte-identical
- **AND** no stage, journal, archive target, spec write, quality metadata, or `archive.json` SHALL be created

#### Scenario: Apply consumes the displayed plan

- **WHEN** a displayed dry-run plan is subsequently confirmed for apply
- **THEN** apply SHALL consume byte-equivalent planned actions
- **AND** source drift or a newly appearing target SHALL change only runtime outcomes, never introduce undisclosed actions

### Requirement: archive.json is written to the archived directory

The archive engine SHALL finalize `archive.json` from confirmed Git facts, the finalized recursive evidence inventory, validated sidecar intent, and actual cleaner outcomes. It SHALL write and verify the file atomically before removing the active change. A confirmed non-Git root may use its defined null/clean representation; Git ambiguity, sidecar failure, evidence read/hash failure, or accounting write failure SHALL block completion and remain recoverable through the transaction journal.

#### Scenario: archive.json is finalized before active-source removal

- **WHEN** archive completes successfully
- **THEN** the published directory SHALL contain a parsed and verified `archive.json`
- **AND** its evidence digests SHALL match the final evidence tree
- **AND** only then may the active change be removed

#### Scenario: Store-selected run records the code project's commit

- **WHEN** a store-selected change is archived with a confirmed Git execution project
- **THEN** `codeCommit` SHALL be that code project's HEAD SHA, not the store's HEAD SHA

#### Scenario: Confirmed non-git planning root records null branch

- **WHEN** Git confirms the planning root is not a work tree
- **THEN** `planningBranch` SHALL be `null` and `planningTreeState` SHALL be `clean`

#### Scenario: Ambiguous Git state blocks accounting

- **WHEN** Git is unavailable, metadata is corrupt, or a branch/status/HEAD query fails unexpectedly
- **THEN** the engine SHALL report a Git blocker
- **AND** SHALL NOT guess `null`, `clean`, or a commit value

#### Scenario: Accounting write failure keeps recovery evidence

- **WHEN** atomic `archive.json` write or verification fails after publication
- **THEN** the active change SHALL remain
- **AND** the archive-local journal SHALL identify the failed phase and planned accounting
- **AND** completion SHALL NOT be reported
