## ADDED Requirements

### Requirement: Init materializes applicable learned skills from canonical stores

After establishing the project's machine-home identity, `rasen init` SHALL materialize active project-scoped learned skills from the canonical learned-skill store in that project machine home and approved global learned skills from the canonical learned-skill store in the global data directory. A learned skill SHALL be materialized only when its explicit path-exists applicability markers match the initialized project under the learned-skills applicability rules. Learned-skill ids SHALL remain registry identities and SHALL NOT be added to the active profile's workflow selection.

#### Scenario: Applicable project learned skill is materialized

- **WHEN** an active project-scoped learned skill exists in the project's machine-home canonical store
- **AND** its explicit path-exists applicability markers match the initialized project
- **THEN** init SHALL materialize it for each selected tool that supports project-scoped skills
- **AND** SHALL record each generated copy in the project's artifact ledger

#### Scenario: Approved applicable global learned skill is materialized

- **WHEN** an approved global learned skill exists in the global data canonical store
- **AND** its explicit path-exists applicability markers match the initialized project
- **THEN** init SHALL materialize it for each selected tool whose skill home can receive global learned skills

#### Scenario: Learned skill without matching applicability is not materialized

- **WHEN** a project or global learned skill has no explicit path-exists applicability marker that matches the initialized project
- **THEN** init SHALL NOT materialize that skill into the selected tools

#### Scenario: Learned ids do not enter workflow selection

- **WHEN** init materializes one or more learned skills
- **THEN** the active profile's workflow ids SHALL remain unchanged
- **AND** no learned-skill id SHALL be appended to a profile, workflow selection, or workflow dependency closure

### Requirement: Init preserves human-authored skill ownership

Init SHALL update or prune a learned-skill materialization only when the exact target copy is recorded in Rasen's artifact ledger as generated from the same learned-skill identity. If a target skill name is occupied by a human-authored or otherwise untracked skill, init SHALL block that learned-skill materialization, preserve the existing directory unchanged, and emit a diagnostic naming the collision. Learned-skill target paths and ledger identities SHALL be constructed and compared with cross-platform path APIs and platform-canonical path semantics.

#### Scenario: Human-authored name collision blocks materialization

- **WHEN** an applicable learned skill would materialize to a target skill name that already exists
- **AND** the exact existing target is not ledger-tracked as Rasen's generated copy of that learned skill
- **THEN** init SHALL leave the existing skill unchanged
- **AND** SHALL skip the generated copy with a diagnostic naming the learned skill, tool, and target path

#### Scenario: Exact generated copy can be refreshed

- **WHEN** the exact target is ledger-tracked as Rasen's generated copy of the same learned-skill identity
- **AND** the canonical learned skill has changed
- **THEN** init MAY replace that generated copy and update its ledger metadata

#### Scenario: Similar names do not establish ownership

- **WHEN** an existing skill has a prefix, suffix, or normalized name similar to a learned skill but lacks the exact matching ledger identity
- **THEN** init SHALL treat it as unowned
- **AND** SHALL NOT update or remove it by pattern

#### Scenario: Learned-skill paths are cross-platform

- **WHEN** init resolves a canonical store, applicability path, tool skill home, target directory, or artifact-ledger path on Windows, macOS, or Linux
- **THEN** it SHALL construct the path with platform path primitives
- **AND** ownership and path-exists checks SHALL use the platform's canonical path identity rather than hard-coded separators

### Requirement: Init respects global-only tool homes for learned skills

For a tool whose skill adapter exposes only a global skill home, currently Hermes, init SHALL NOT materialize project-scoped learned skills into that global home. It SHALL warn that the tool cannot receive project-scoped learned skills. Approved and applicable global learned skills MAY be installed there under the same ownership safeguards.

#### Scenario: Hermes skips project learned skills with a warning

- **WHEN** Hermes is selected during init
- **AND** an applicable project-scoped learned skill exists
- **THEN** init SHALL NOT write that project-scoped skill to the Hermes global skill home
- **AND** SHALL emit a warning identifying Hermes and the skipped project-scoped learned skill

#### Scenario: Hermes accepts approved global learned skills

- **WHEN** Hermes is selected during init
- **AND** one or more active approved global learned skills exist
- **THEN** init SHALL reconcile those global learned skills in the resolved Hermes skills home through the machine-global learned-skill ledger
- **AND** SHALL apply exact-ledger ownership and collision checks without using the current project's applicability markers to remove shared global copies

## MODIFIED Requirements

### Requirement: Skill Generation

The init command SHALL generate workflow skills based on the active profile plus workflow dependency closure, not a fixed set. Learned skills SHALL be resolved and materialized separately from workflow selection.

#### Scenario: Core profile skill generation

- **WHEN** user runs init with profile `core`
- **THEN** the system SHALL generate skills for workflows in CORE_WORKFLOWS constant: propose, explore, apply, sync, archive, auto-command, help
- **AND** the system SHALL generate workflow skills required by dependency closure, including `rasen-retain` for `auto-command`, even when retention is `off`
- **THEN** the system SHALL NOT generate workflow skills outside the profile or its dependency closure

#### Scenario: Custom profile skill generation

- **WHEN** user runs init with profile `custom`
- **THEN** the system SHALL generate skills only for workflows listed in config `workflows` array and workflow skills pulled by their dependency closure

#### Scenario: Propose workflow included in skill templates

- **WHEN** generating skills
- **THEN** the system SHALL include the `propose` workflow as an available skill template

#### Scenario: Learned skills remain outside profile closure

- **WHEN** init finds applicable learned skills
- **THEN** it SHALL materialize them through the learned-skill registry and artifact-ledger path
- **AND** SHALL NOT add their ids to the active profile or workflow dependency closure
