## ADDED Requirements

### Requirement: Archive Resolves Artifact Paths From Status JSON

The archive skill SHALL resolve artifact paths from `rasen status --change <name> --json` rather than assuming repo-local literals, matching the resolution `bulk-archive-change` already uses, so archive operates correctly when specs/changes live in a registered store instead of under the cwd. Specifically, the task-completion check SHALL read the tasks file from `artifactPaths.tasks.existingOutputPaths`, and the delta-vs-main spec comparison SHALL locate main specs in the `specs/` directory resolved from the planning home (the sibling of `planningHome.changesDir`), not the literal `rasen/specs/<capability>/spec.md`.

#### Scenario: Task check uses resolved artifact path

- **WHEN** the archive skill checks task completion
- **THEN** it SHALL read the tasks file from `artifactPaths.tasks.existingOutputPaths` in the status JSON
- **AND** SHALL NOT assume the tasks artifact is literally `tasks.md`

#### Scenario: Main-spec comparison resolves from the planning home

- **WHEN** the archive skill compares a delta spec against its main spec
- **THEN** it SHALL locate the main spec under the `specs/` directory resolved from the planning home (sibling of `planningHome.changesDir`)
- **AND** SHALL NOT read a literal repo-relative `rasen/specs/<capability>/spec.md`
- **AND** in a registered store the main spec SHALL resolve to the store's specs

#### Scenario: Single archive matches bulk archive resolution

- **WHEN** the same change is archived via single `/rasen:archive` versus `/rasen:bulk-archive`
- **THEN** both SHALL resolve the tasks and specs paths the same way (from status JSON), so neither reports a spurious "no tasks" for a non-`tasks.md` schema
