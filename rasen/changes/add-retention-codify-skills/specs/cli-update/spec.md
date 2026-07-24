## ADDED Requirements

### Requirement: Update reconciles applicable learned skills without onboarding tools

`rasen update` SHALL reconcile active project-scoped learned skills from the canonical learned-skill store in the project's machine home and approved global learned skills from the canonical learned-skill store in the global data directory. It SHALL materialize only skills whose explicit path-exists applicability markers match the project under the learned-skills applicability rules, and SHALL operate only on tools already configured for that project. Learned-skill reconciliation SHALL never onboard a newly detected AI tool and SHALL never add learned-skill ids to a profile or workflow selection.

#### Scenario: Applicable learned skills are reconciled for configured tools

- **WHEN** user runs `rasen update`
- **AND** a configured tool can receive an active project learned skill or approved global learned skill whose applicability markers match
- **THEN** update SHALL create or refresh the tool's managed copy from the appropriate canonical store
- **AND** SHALL record the exact generated copy in the project artifact ledger

#### Scenario: Update never onboards a tool for learned skills

- **WHEN** an applicable learned skill exists
- **AND** an adapted tool is detected but is not already configured for the project
- **THEN** update SHALL NOT create workflow or learned-skill files for that tool
- **AND** existing new-tool notification behavior SHALL remain unchanged

#### Scenario: Inapplicable or retired generated copy is removed

- **WHEN** an exact ledger-tracked learned-skill copy is no longer active, approved, or applicable to the project
- **THEN** update SHALL remove that generated copy
- **AND** SHALL remove its artifact-ledger entry
- **AND** SHALL NOT remove any untracked skill with the same or a similar name

#### Scenario: Learned ids do not change profile selection

- **WHEN** update creates, refreshes, or removes learned-skill copies
- **THEN** the active profile and its workflow ids SHALL remain unchanged
- **AND** profile and workflow synchronization SHALL otherwise behave as before

### Requirement: Update preserves human-authored learned-skill targets

Update SHALL modify or prune a learned-skill materialization only when the exact target copy is recorded in Rasen's artifact ledger as generated from the same learned-skill identity. A human-authored or otherwise untracked skill occupying the target name SHALL block materialization, remain unchanged, and produce a collision diagnostic. Names, prefixes, directory scans, or content similarity alone SHALL NOT establish Rasen ownership.

#### Scenario: Human-authored collision is skipped and diagnosed

- **WHEN** an applicable learned skill targets an existing skill directory
- **AND** the exact target is not ledger-tracked as Rasen's generated copy of that learned skill
- **THEN** update SHALL preserve the existing directory unchanged
- **AND** SHALL report the learned skill as skipped with a diagnostic naming the tool and target path

#### Scenario: Exact ledger-tracked copy can update

- **WHEN** a target is ledger-tracked as Rasen's generated copy of the same learned-skill identity
- **AND** its canonical content or managed metadata has changed
- **THEN** update SHALL replace that exact copy and refresh its ledger entry

#### Scenario: Exact ledger-tracked copy can be pruned

- **WHEN** a target is ledger-tracked as Rasen's generated copy of the same learned-skill identity
- **AND** the skill is no longer active, approved, or applicable
- **THEN** update SHALL remove that exact copy
- **AND** SHALL NOT prune any neighboring or similarly named skill directory

### Requirement: Update handles global-only learned-skill homes by scope

For a tool whose skill adapter exposes only a global skill home, currently Hermes, update SHALL skip project-scoped learned skills and emit a warning rather than leaking project knowledge into a global location. It SHALL reconcile all active approved global learned skills through a machine-global learned-skill ledger; the current project's applicability result SHALL NOT decide whether a shared global copy is removed.

#### Scenario: Hermes skips project learned skills

- **WHEN** Hermes is already configured and update finds an applicable project-scoped learned skill
- **THEN** update SHALL NOT materialize it into the Hermes global skill home
- **AND** SHALL warn and report that learned skill as skipped for Hermes

#### Scenario: Hermes receives global learned skills

- **WHEN** Hermes is already configured and update finds active approved global learned skills
- **THEN** update SHALL reconcile their managed copies in the resolved Hermes skills home through the machine-global learned-skill ledger
- **AND** SHALL enforce exact-ledger ownership before updating or pruning them
- **AND** one project's non-matching applicability markers SHALL NOT remove a shared global copy

### Requirement: Retired retention artifacts use exact cleanup identities

Update SHALL clean retired retention workflow ids and generated directories through implementation-maintained named constants and exact artifact-ledger identities, never through prefixes, globs, regular expressions, or fuzzy name matching. `retro-command` SHALL be treated as a retired selectable id. Any `rasen-retro` compatibility wrapper intentionally shipped during its migration window SHALL be distinguished by its explicit current ledger identity; when that window ends, its exact directory SHALL be added to the named retirement set rather than discovered by pattern.

#### Scenario: Retired retro selection is healed

- **WHEN** stored profile configuration still contains selectable id `retro-command`
- **THEN** update SHALL drop that exact retired id with a warning
- **AND** SHALL continue with the remaining current workflow selection
- **AND** SHALL NOT remove ids merely because their names contain `retro`

#### Scenario: Exact retired generated directory is cleaned

- **WHEN** a configured tool contains a generated retro directory identified by the named retirement set or its exact artifact-ledger record
- **AND** that directory is not the currently shipped compatibility wrapper
- **THEN** update SHALL remove that exact generated directory and ledger entry
- **AND** SHALL leave similarly named or untracked directories unchanged

#### Scenario: Current compatibility wrapper survives its migration window

- **WHEN** the temporary `rasen-retro` compatibility wrapper is shipped for the current migration window
- **AND** its exact generated copy is recorded under the wrapper's current ledger identity
- **THEN** generic retired-artifact cleanup SHALL preserve it
- **AND** it SHALL remain outside profile and pipeline selection

### Requirement: Learned-skill paths are cross-platform

Update SHALL resolve canonical learned-skill stores, applicability paths, tool skill homes, target directories, and artifact-ledger identities with cross-platform path APIs. Path-exists and ownership checks SHALL use canonical path identity under the host platform and SHALL NOT depend on hard-coded separators or POSIX-only path assumptions.

#### Scenario: Reconciliation uses platform-canonical paths

- **WHEN** learned-skill reconciliation runs on Windows, macOS, or Linux
- **THEN** store and target paths SHALL be constructed with platform path primitives
- **AND** exact ledger ownership SHALL be compared using the platform's canonical path semantics

## MODIFIED Requirements

### Requirement: Update respects global profile config

The update command SHALL read global config and apply profile settings to the project. Learned-skill reconciliation SHALL run alongside profile synchronization without changing the selected workflow ids or the existing profile/workflow behavior.

#### Scenario: Update adds missing workflows from config

- **WHEN** user runs `rasen update`
- **AND** global config specifies workflows not currently installed in the project
- **THEN** the system SHALL generate skill files for missing workflows
- **THEN** the system SHALL display: "Added: <workflow-names>"

#### Scenario: Update refreshes existing workflows

- **WHEN** user runs `rasen update`
- **AND** workflows are already installed in the project
- **THEN** the system SHALL refresh those workflow files with latest templates
- **THEN** the system SHALL display: "Updated: <workflow-names>"

#### Scenario: Update with no changes needed

- **WHEN** user runs `rasen update`
- **AND** installed workflows match global config
- **AND** all templates are current
- **AND** no leftover rasen command files remain
- **AND** all desired learned-skill copies and ledger entries are current
- **AND** no learned-skill materialization is blocked or skipped with a diagnostic
- **THEN** the system SHALL display: "Already up to date."

#### Scenario: Profile or delivery drift with current templates

- **WHEN** user runs `rasen update`
- **AND** workflow templates are current for the installed skills
- **AND** project files do not match the current profile selection
- **THEN** the system SHALL treat this as an update-required state (not "Already up to date.")
- **THEN** the system SHALL add/remove files to match the current profile selection

#### Scenario: Update summary output

- **WHEN** update completes with changes
- **THEN** the system SHALL display a workflow/artifact summary:
  - "Added: propose, explore" (new workflows installed)
  - "Updated: apply, archive" (existing workflows refreshed)
  - "Removed: 4 command files" (leftover rasen command files cleaned up)
- **AND** the system SHALL separately report learned skills under created, updated, removed, and skipped categories
- **AND** an empty learned category SHALL remain distinguishable from the workflow summary rather than being merged into it
- **THEN** the system SHALL list affected tools: "Tools: Claude Code, Cursor"

#### Scenario: Learned-only reconciliation preserves workflow reporting

- **WHEN** update changes only learned-skill materializations
- **THEN** workflow added, updated, and removed results SHALL remain empty
- **AND** the separate learned-skill summary SHALL report each created, updated, removed, or skipped learned skill
- **AND** update SHALL NOT rewrite the active profile or its workflow selection
