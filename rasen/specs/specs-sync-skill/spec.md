# specs-sync-skill Specification

## Purpose
Defines the agent skill for syncing delta specs from changes to main specs.

## Requirements

### Requirement: Specs Sync Skill
The system SHALL provide an `/rasen-sync-specs` skill that syncs delta specs from a change to the main specs.

#### Scenario: Sync delta specs to main specs
- **WHEN** agent executes `/rasen-sync-specs` with a change name
- **THEN** the agent reads delta specs from `rasen/changes/<name>/specs/`
- **AND** reads corresponding main specs from `rasen/specs/`
- **AND** reconciles main specs to match what the deltas describe

#### Scenario: Idempotent operation
- **WHEN** agent executes `/rasen-sync-specs` multiple times on the same change
- **THEN** the result is the same as running it once
- **AND** no duplicate requirements are created

#### Scenario: Change selection prompt
- **WHEN** agent executes `/rasen-sync-specs` without specifying a change
- **THEN** the agent prompts user to select from available changes
- **AND** shows changes that have delta specs

### Requirement: Delta Reconciliation Logic
The agent SHALL reconcile main specs with delta specs using the delta operation headers.

#### Scenario: ADDED requirements
- **WHEN** delta contains `## ADDED Requirements` with a requirement
- **AND** the requirement does not exist in main spec
- **THEN** add the requirement to main spec

#### Scenario: ADDED requirement already exists
- **WHEN** delta contains `## ADDED Requirements` with a requirement
- **AND** a requirement with the same name already exists in main spec
- **THEN** update the existing requirement to match the delta version

#### Scenario: MODIFIED requirements
- **WHEN** delta contains `## MODIFIED Requirements` with a requirement
- **AND** the requirement exists in main spec
- **THEN** replace the requirement in main spec with the delta version

#### Scenario: REMOVED requirements
- **WHEN** delta contains `## REMOVED Requirements` with a requirement name
- **AND** the requirement exists in main spec
- **THEN** remove the requirement from main spec

#### Scenario: RENAMED requirements
- **WHEN** delta contains `## RENAMED Requirements` with FROM:/TO: format
- **AND** the FROM requirement exists in main spec
- **THEN** rename the requirement to the TO name

#### Scenario: New capability spec
- **WHEN** delta spec exists for a capability not in main specs
- **THEN** create new main spec file at `rasen/specs/<capability>/spec.md`

### Requirement: Skill Output
The skill SHALL provide clear feedback on what was applied.

#### Scenario: Show applied changes
- **WHEN** reconciliation completes successfully
- **THEN** display summary of changes per capability:
  - Number of requirements added
  - Number of requirements modified
  - Number of requirements removed
  - Number of requirements renamed

#### Scenario: No changes needed
- **WHEN** main specs already match delta specs
- **THEN** display "Specs already in sync - no changes needed"

### Requirement: Sync Resolves The Main-Spec Target From The Planning Home

The sync-specs skill SHALL resolve the main-spec target directory from the planning home (the `specs/` directory that is the sibling of `planningHome.changesDir`, from `rasen status --json`) rather than the literal repo-relative `rasen/specs/<capability>/spec.md`, so that syncing delta specs writes to the correct location when specs live in a registered store instead of under the cwd. Delta spec inputs SHALL continue to be read from `artifactPaths.specs.existingOutputPaths`.

#### Scenario: Main-spec write resolves from the planning home

- **WHEN** the sync skill applies a delta spec to its main spec
- **THEN** it SHALL write to the main spec under the `specs/` directory resolved from the planning home (sibling of `planningHome.changesDir`)
- **AND** SHALL NOT write to a literal repo-relative `rasen/specs/<capability>/spec.md`

#### Scenario: Store-scoped sync targets the store's specs

- **WHEN** the sync skill runs for a change whose planning home is a registered store
- **THEN** the resolved main-spec target SHALL be the store's `specs/` directory, not the cwd's
