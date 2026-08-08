## MODIFIED Requirements

### Requirement: Archive Process

The archive command SHALL expose one authoritative plan/apply operation used by direct CLI, single archive, bulk archive, and in-ship consumers. Planning SHALL complete validation, spec-update preparation, sidecar/handoff and probe validation, cleaner disposition, quality/evidence discovery, target selection, and blockers without mutation. Apply SHALL consume that exact plan without reclassifying paths or changing planned actions.

In a Store v2 project scope that operation SHALL be the change-finalization plan/apply, which additionally carries the declared outcome, the successor or reason it requires, the landed reachability proof, and the Archive v2 record, and whose published address is the project partition's stable target-line entry rather than a flat date-prefixed name. Standalone projects and legacy flat Stores SHALL keep the existing operation, address, and record unchanged, dispatched from the resolved scope rather than from a path shape.

A successful apply SHALL stage and verify the archive, publish it without clobbering, finalize cleaner outcomes and `archive.json`, and remove the active change last. A failed apply SHALL preserve the active source or leave a transaction journal that reports the recoverable state. Generated consumers SHALL invoke this operation and SHALL NOT move a change directory directly.

#### Scenario: Performing archive

- **WHEN** archiving a change
- **THEN** the command SHALL derive a complete archive plan before mutation
- **AND** SHALL apply the confirmed plan through the authoritative archive engine
- **AND** SHALL publish without overwrite to `YYYY-MM-DD-<change-name>` in the planning root, or, in a Store v2 project scope, to `YYYY-MM-DD-<change-name>--<instance-short>` below that project's stable target-line archive directory

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

### Requirement: Spec Update Process

Before moving the change to archive, the command SHALL apply delta changes to main specs to reflect the deployed reality. In a Store v2 project scope that application SHALL be conditional on the declared outcome: only `landed` SHALL apply deltas, and `superseded`, `cancelled`, and `abandoned` SHALL apply none. Standalone projects and legacy flat Stores SHALL continue to apply deltas unconditionally as they do today.

#### Scenario: Applying delta changes

- **WHEN** archiving a change with delta-based specs
- **THEN** parse and apply delta changes as defined in openspec-conventions
- **AND** validate all operations before applying

#### Scenario: Validating delta changes

- **WHEN** processing delta changes
- **THEN** perform validations as specified in openspec-conventions
- **AND** if validation fails, show specific errors and abort

#### Scenario: Conflict detection

- **WHEN** applying deltas would create duplicate requirement headers
- **THEN** abort with error message showing the conflict
- **AND** suggest manual resolution

#### Scenario: Zero-requirements spec deletion

- **WHEN** applying a change's deltas leaves an existing spec with zero requirements (every requirement REMOVED, none remaining)
- **THEN** the command SHALL delete that spec's directory from the main specs instead of writing an empty spec
- **AND** SHALL log a clear message naming the deleted capability
- **AND** SHALL treat this as a supported outcome, not a validation failure (no abort)
- **AND** `rasen validate --strict` SHALL pass afterward because the spec no longer exists rather than being left empty
- **AND** SHALL NOT delete a spec that still has any surviving requirement, nor a spec that did not already exist before this change

#### Scenario: Stale MODIFIED block dropping current scenarios is rejected

- **WHEN** a MODIFIED requirement block in a change delta omits one or more scenarios that the current main spec still contains for that requirement (scenario drift, e.g. two changes each MODIFY the same requirement and the second was authored before the first archived)
- **THEN** the command SHALL abort the spec rebuild with an error naming the requirement and the missing scenario(s), instructing the author to refresh the change spec before archiving
- **AND** SHALL NOT overwrite the main spec (no scenarios are silently dropped)
- **AND** the change SHALL remain unarchived

#### Scenario: A non-landed Store v2 outcome applies no delta

- **WHEN** a Store v2 project change carrying delta specs is archived with outcome `superseded`, `cancelled`, or `abandoned`
- **THEN** no delta SHALL be parsed for application and no main spec SHALL be created, updated, or deleted
- **AND** every file under that project's canonical specs SHALL remain byte-identical

### Requirement: Archive command always lands in the planning root

`rasen archive <change>` SHALL plan, stage, verify, and publish the change to the planning root's archive directory unconditionally — no configuration is consulted and no destination is resolved (`archive-destination` capability). In a Store v2 project scope the entry's address within that planning root SHALL be computed from the change's frozen stable target line and verified change instance through the layout contract; that is an address derivation from frozen scope facts, not a configurable destination, and no configuration participates in it. A project whose config still carries `archive.destination: external` or `prune` SHALL archive in-repo exactly as a project with no such key; the deprecated value produces only a parse-time warning (`config-loading` capability). The engine SHALL neither publish to the machine home nor remove the active source before the archive and recovery/accounting state are durable, and its JSON output SHALL report the archived name and absolute archived path.

#### Scenario: Legacy destination config does not redirect the CLI

- **WHEN** `rasen archive <change> --yes --json` runs in a project whose config still carries `archive.destination: external` or `prune`
- **THEN** the engine SHALL publish the verified archive to the planning root's archive directory
- **AND** the JSON result SHALL report the archived name and the absolute archived path
- **AND** nothing SHALL be written under the machine home and no change directory SHALL be deleted

## ADDED Requirements

### Requirement: Store v2 archiving declares its outcome on the command line

`rasen archive` SHALL accept `--outcome <landed|superseded|cancelled|abandoned>`, `--reason <text>`, `--by <changeInstanceId>`, `--by-target-line <id>`, and `--commit <oid>`. In a Store v2 project scope `--outcome` SHALL be required; its absence SHALL fail with `finalization_outcome_required` before any mutation, naming all four outcomes and their reason and successor requirements. `--reason` SHALL be required by every non-landed outcome and refused for `landed`; `--by` SHALL be required by `superseded` and refused otherwise; `--by-target-line` SHALL only narrow the successor search and SHALL never substitute for successor verification; `--commit` SHALL only supply the candidate commit for a landed proof and SHALL never bypass it. There SHALL be no flag that declares a change planning-only at archive time. Outside a Store v2 project scope these options SHALL be rejected as inapplicable rather than silently ignored.

#### Scenario: Missing outcome refuses before mutation

- **WHEN** `rasen archive <change> --yes --json` runs in a Store v2 project scope with no `--outcome`
- **THEN** the command SHALL exit non-zero with `finalization_outcome_required` and name the four outcomes
- **AND** no spec, change directory, or archive entry SHALL be written

#### Scenario: Outcome options outside Store v2 are rejected, not ignored

- **WHEN** `--outcome` is supplied in a standalone project or a legacy flat Store
- **THEN** the command SHALL reject the option explaining where it applies
- **AND** it SHALL NOT archive while discarding the option

#### Scenario: A supplied commit still has to prove reachability

- **WHEN** `--outcome landed --commit <oid>` names a commit that is not an ancestor of the target line's code ref
- **THEN** the command SHALL refuse naming the commit and the ref
- **AND** the change SHALL remain active

### Requirement: Store v2 archive output reports the finalization record

In a Store v2 project scope, `rasen archive --json` SHALL report the declared outcome, the change instance, the workspace pair, the stable target line, the absolute published entry path, whether spec synchronization was applied and how many actions it carried, and, for a code-backed landed archive, the proven commit and the target code ref with its commit identifier at proof time. `--dry-run` SHALL emit the same immutable finalization plan that apply consumes, including the record draft and every blocker, and SHALL write nothing. The human output SHALL state the same facts.

#### Scenario: A landed JSON result is auditable

- **WHEN** a Store v2 change is archived with `--outcome landed --json`
- **THEN** the payload SHALL name the outcome, the change instance, the workspace pair, the target line, the published entry path, the applied spec-sync action count, the proven commit, and the target code ref
- **AND** the human form SHALL state the same facts

#### Scenario: Dry-run previews the finalization plan and writes nothing

- **WHEN** `rasen archive <change> --outcome abandoned --reason <text> --dry-run --json` runs in a Store v2 project scope
- **THEN** the output SHALL contain the immutable finalization plan including the record draft and every blocker
- **AND** no archive entry, spec write, journal, or record file SHALL be created
