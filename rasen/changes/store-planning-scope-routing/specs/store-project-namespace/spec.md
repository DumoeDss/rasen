## REMOVED Requirements

### Requirement: --project selects the project namespace and is exclusive with --store

**Reason**: Store v2 makes the flags orthogonal: `--store` selects a Store while `--project` selects a project planning partition inside that Store. Mutual exclusion prevents complete scope selection.

**Migration**: Continue using `--project <id>` alone for the registered-project namespace. Use `--store <store> --project <project>` when selecting a project inside a specific Store, and add `--target-line <id>` when the project operation requires a stable target line.

## ADDED Requirements

### Requirement: Store and project selectors address orthogonal scope dimensions

Every planning command that accepts `--store <id>` SHALL also accept `--project <id>`, and project-scoped planning commands SHALL accept `--target-line <id>`. `--store` SHALL select an entry in the Store namespace; when used with it, `--project` SHALL select and verify a project from that Store's project catalog rather than selecting a second registry root. `--project` without `--store` SHALL continue to select the registered-project namespace, then follow that project's verified planning binding: an unbound project uses its standalone planning root and a Store-bound project uses its project partition in the bound Store. `--target-line` SHALL select a stable target-line identity, not a branch name. Explicit selectors SHALL agree with durable binding, Change metadata, session, and worktree facts; a conflict SHALL fail before planning access.

#### Scenario: Project alone selects the project namespace

- **WHEN** a user runs a planning command with `--project elftia` and no Store selector
- **THEN** the project-namespace registration for `elftia` SHALL be selected
- **AND** its verified planning binding SHALL determine whether planning is standalone or Store-backed

#### Scenario: Store and project select one Store partition

- **WHEN** a user runs a planning command with `--store team --project elftia`
- **THEN** `team` SHALL resolve in the Store namespace and `elftia` SHALL resolve from that Store's project catalog
- **AND** the command SHALL use `elftia`'s planning partition in that Store

#### Scenario: Store and project can share one display id

- **WHEN** a Store and one of its projects are both displayed as `elftia` and the user passes `--store elftia --project elftia`
- **THEN** each selector SHALL resolve in its own dimension without ambiguity
- **AND** neither value SHALL be treated as a substitute for the other

#### Scenario: Project is not in the selected Store

- **WHEN** `--store team --project outsider` names a project not present and planning-bound in Store `team`
- **THEN** resolution SHALL fail with a diagnostic naming the Store and project
- **AND** it SHALL NOT fall back to a standalone `outsider` registration or another Store

#### Scenario: Target line is stable identity

- **WHEN** a user passes `--target-line line-0.2` and its catalog later maps to a renamed Git ref
- **THEN** the same stable target line SHALL remain selected
- **AND** no command SHALL reinterpret the ref name as target-line identity

#### Scenario: Explicit selectors conflict with recorded scope

- **WHEN** an explicit Store, project, or target line disagrees with the selected Change or frozen session scope
- **THEN** the command SHALL fail before resolving a planning path
- **AND** no stronger explicit selector SHALL silently rewrite the recorded scope

#### Scenario: Follow-up hint preserves the complete selection

- **WHEN** a command selected Store S, project P, and target line L and prints a pasteable project-scoped follow-up
- **THEN** the hint SHALL carry `--store S --project P --target-line L` in that order
- **AND** a project-only or standalone hint SHALL carry only the selectors needed to reproduce its scope
