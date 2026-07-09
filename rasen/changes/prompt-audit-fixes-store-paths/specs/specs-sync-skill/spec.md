## ADDED Requirements

### Requirement: Sync Resolves The Main-Spec Target From The Planning Home

The sync-specs skill SHALL resolve the main-spec target directory from the planning home (the `specs/` directory that is the sibling of `planningHome.changesDir`, from `rasen status --json`) rather than the literal repo-relative `rasen/specs/<capability>/spec.md`, so that syncing delta specs writes to the correct location when specs live in a registered store instead of under the cwd. Delta spec inputs SHALL continue to be read from `artifactPaths.specs.existingOutputPaths`.

#### Scenario: Main-spec write resolves from the planning home

- **WHEN** the sync skill applies a delta spec to its main spec
- **THEN** it SHALL write to the main spec under the `specs/` directory resolved from the planning home (sibling of `planningHome.changesDir`)
- **AND** SHALL NOT write to a literal repo-relative `rasen/specs/<capability>/spec.md`

#### Scenario: Store-scoped sync targets the store's specs

- **WHEN** the sync skill runs for a change whose planning home is a registered store
- **THEN** the resolved main-spec target SHALL be the store's `specs/` directory, not the cwd's
