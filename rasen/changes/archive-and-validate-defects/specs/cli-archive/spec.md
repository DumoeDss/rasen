## MODIFIED Requirements

### Requirement: Archive command respects on-merge timing for PR deliveries

Because the CLI never invokes `gh`, and uses git only for local read-only status checks (never to make a workflow decision like a merge determination), `rasen archive` cannot verify a merge itself; when the resolved archive timing is `on-merge` and the change's recorded ship log shows a `pr`-mode delivery, the command SHALL refuse to archive without an explicit override (`--yes`), directing the user to the archive skill (which performs the merge check) or to confirm the merge themselves. The assertion MAY be supplied while creating and directly applying a plan or while applying a previously saved plan; in either case it SHALL satisfy only the recorded PR merge-confirmation gate and SHALL NOT alter the immutable plan or suppress another blocker. This closes the path by which the CLI could bypass the merge-confirmation gate of the `archive-timing` capability.

#### Scenario: CLI blocks the merge-gate bypass

- **WHEN** `rasen archive <change>` runs for a change whose ship log records a `pr` delivery under `on-merge` timing, without `--yes`
- **THEN** the command SHALL refuse, explain that merge confirmation is required, and point to `/rasen-archive-change` or an explicit `--yes` after the user confirms the merge

#### Scenario: Explicit override archives anyway

- **WHEN** the same command runs with `--yes`
- **THEN** the archive SHALL proceed, treating the override as the user's merge confirmation

#### Scenario: Saved plan accepts apply-time merge confirmation

- **GIVEN** a saved immutable plan whose only blocker is the recorded PR merge-confirmation gate
- **WHEN** the user applies that exact token with `rasen archive --apply-plan <token> --yes`
- **THEN** apply SHALL treat `--yes` as the user's merge confirmation and proceed with the token's unchanged plan
- **AND** the plan hash, mutation actions, finalization outcome, and source fingerprints SHALL remain unchanged

#### Scenario: Apply-time confirmation cannot clear another blocker

- **WHEN** a saved plan contains an incomplete-task, validation, spec, identity, target, or non-merge timing blocker and is applied with `--yes`
- **THEN** that blocker SHALL remain effective
- **AND** no mutation SHALL begin merely because merge confirmation was supplied

## ADDED Requirements

### Requirement: Archive planning rejects engine-reserved ship-log content

Archive planning SHALL inspect the selected sticky-legacy `ship-log.md` before declaring a plan applicable. A pre-existing level-two `## Archive` heading SHALL produce a typed blocker naming the ship log and explaining that the section is reserved for the archive engine; a saved-preview invocation SHALL NOT return an applicable token until the section is removed or renamed. The apply-time collision guard SHALL remain as defense for legacy tokens and source races.

#### Scenario: Reserved heading blocks saved-plan creation

- **WHEN** `rasen archive <change> --dry-run --save-plan --json` reads a ship log that already contains `## Archive`
- **THEN** the output SHALL include an `archive_ship_log_reserved_section` blocker naming that file
- **AND** it SHALL instruct the operator to remove or rename the section before planning again
- **AND** no applicable plan token, stage, journal, spec write, or archive entry SHALL be created

#### Scenario: A legacy token reaches the apply-time collision guard

- **GIVEN** a token created by an older Rasen version for source whose ship log contains the reserved section
- **WHEN** the token is applied
- **THEN** apply SHALL leave canonical specs, publication, cleaner state, and the active source unchanged
- **AND** it SHALL report `abort-required` with the ownership-verified abort command rather than an exact-token recovery command

### Requirement: Archive spec preflight reports every independent reconciliation failure

Archive spec preparation SHALL analyze every independently parseable delta spec and every `MODIFIED` requirement before returning. It SHALL emit a deterministic typed blocker for each reconciliation failure, including every omitted current scenario, and SHALL perform no spec mutation when any blocker exists.

#### Scenario: One preview reports all stale modified requirements

- **WHEN** five `MODIFIED` requirements across one or more capabilities each omit current scenarios
- **THEN** one archive preview SHALL report five blockers naming each capability, requirement, source file, and complete missing-scenario list
- **AND** the operator SHALL NOT need to repair and re-plan one requirement at a time to discover the rest

#### Scenario: An unreadable delta does not hide independent failures

- **WHEN** one delta spec cannot be parsed and another independently parseable delta omits current scenarios
- **THEN** preflight SHALL report the root parse failure for the unreadable spec and the preservation failures from the other spec
- **AND** no prepared action SHALL be applied

### Requirement: Archive intent diagnostics identify failed constraints

Strict archive-intent validation SHALL report each independent shape or binding failure with a stable code, structured location, and actionable message. Unexpected keys SHALL be named exactly at the object where they occur; schema version, change binding, handoff completeness, decision, and probe failures SHALL remain distinguishable in human and JSON output.

#### Scenario: Unexpected root key is named

- **WHEN** an otherwise valid intent contains an unsupported root key such as `mergeConfirmed`
- **THEN** the blocker SHALL name `mergeConfirmed`, its root location, and the accepted root keys
- **AND** it SHALL NOT replace that fact with the generic archive-input schema summary

#### Scenario: Multiple intent constraints fail together

- **WHEN** one intent has a wrong schema version, mismatched change name, and unexpected nested handoff key
- **THEN** validation SHALL report all three constraints in deterministic order
- **AND** both human and JSON views SHALL preserve their distinct locations and messages

### Requirement: Archive recovery guidance reflects whether exact-token replay can advance

An incomplete archive result SHALL distinguish a pre-mutation blocker, a replayable failure, a deterministic early conflict requiring abort and re-plan, and an integrity failure requiring its verified manual action. An exact-token recovery command SHALL appear only when replaying that token can advance after the stated repair; deterministic plan-bound conflicts SHALL expose an abort command instead.

#### Scenario: Replayable failure retains exact-token recovery

- **WHEN** apply stops on a transient or externally repairable condition while the immutable source remains valid
- **THEN** the result SHALL be `recoverable`
- **AND** the recovery command SHALL reuse the exact token

#### Scenario: Deterministic plan conflict never loops recovery

- **WHEN** apply detects a typed conflict that the immutable source guarantees will recur
- **THEN** the result SHALL be `abort-required`
- **AND** it SHALL include `rasen archive --abort-plan <token> --yes`
- **AND** it SHALL NOT label exact-token replay as recovery

### Requirement: Early stored archive transactions can be safely aborted

`rasen archive --abort-plan <token> --yes` SHALL retire an unapplied or early failed stored plan only after verifying the token, plan hash, transaction identity, phase, progress, path containment, and ownership of every state item it removes. Abort SHALL be idempotent and serialized against apply. It SHALL refuse once canonical-spec progress, publication, cleaner progress, association progress, or source-removal progress exists.

#### Scenario: Unapplied plan is retired

- **WHEN** a valid saved token has never begun apply and the user confirms `--abort-plan`
- **THEN** the command SHALL retire the stored plan without touching the active change, canonical specs, archive directory, or ephemera
- **AND** later apply of that token SHALL report that it was aborted

#### Scenario: Owned early stage is removed

- **WHEN** a failed transaction has only a plan-owned stage and journal at or before `evidence-finalized`
- **THEN** confirmed abort SHALL verify their identities, remove only that owned state, and record an idempotent abort tombstone
- **AND** the active change SHALL remain available for correction and re-planning

#### Scenario: Durable progress blocks abort

- **WHEN** the journal records any canonical-spec, publication, cleaner, association, or source-removal progress
- **THEN** abort SHALL refuse and name the phase and retained paths
- **AND** it SHALL direct the operator to exact-token resume or the existing verified manual-recovery action

#### Scenario: Abort paths are contained on every platform

- **WHEN** abort evaluates transaction paths on Windows, macOS, or Linux
- **THEN** it SHALL derive and compare paths with platform-aware path operations and canonical identities
- **AND** no sibling or ancestor path SHALL become eligible through separator, case, or traversal differences
