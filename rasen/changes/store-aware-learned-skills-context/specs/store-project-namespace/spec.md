## MODIFIED Requirements

### Requirement: --project selects the project namespace and is exclusive with --store

Every command that accepts `--store <id>` SHALL also accept `--project <id>`,
selecting the entry of that id in the project namespace. `--store` and
`--project` SHALL be mutually exclusive on a single invocation; passing both
SHALL fail with a friendly error naming both flags, before any root or
knowledge-owner resolution. A bare id (no flag, or an unprefixed reference)
SHALL continue to mean the store namespace. On specs/changes and pipeline
inspection commands, a project-selected root SHALL resolve to a normal Rasen
root with the same capabilities as a store-selected root: the type governs
namespace and display only, never capability. On `rasen knowledge`, the same
typed flags SHALL select the knowledge owner independently from the operation's
planning root.

#### Scenario: --project resolves the project-namespace root

- **WHEN** a user runs a specs/changes command or a `pipeline` inspection command with `--project elftia`
- **THEN** the command resolves the project `elftia`'s Rasen root and behaves exactly as it would for a store root
- **AND** list/show/instructions/status/validate/archive/context operate identically

#### Scenario: Passing both --store and --project is rejected

- **WHEN** a command is invoked with both `--store x` and `--project y`
- **THEN** it fails before resolving any root or knowledge owner with an error naming the two mutually exclusive flags
- **AND** no store or project root or owner is selected

#### Scenario: Hints and banner for a project root use --project

- **WHEN** a command resolves a project-selected root and prints a verification banner or a pasteable follow-up hint
- **THEN** the banner identifies the project and the follow-up hint carries `--project <id>`, not `--store <id>`

#### Scenario: Knowledge selector addresses owner rather than planning root

- **WHEN** a user runs `rasen knowledge list --project elftia` while the active change planning root is a store
- **THEN** the knowledge command resolves `project:elftia` as the knowledge owner
- **AND** leaves the active planning-root identity unchanged
