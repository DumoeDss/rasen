# rasen-cli-identity Specification

## Purpose

This spec defines the fork's brand identity as a distinct CLI product: the published package and binary name, the brand-visible surfaces (program name, help text, error/notice text, generated template examples), the `RASEN_`-prefixed environment variable namespace, and the workspace/ecosystem identifiers that the rename must NOT touch (the `openspec/` project directory, the `opsx:` command prefix, in-file markers, and schema identifiers).

## Requirements

### Requirement: Published package and binary identity
The system SHALL publish under the package name `rasen` and install a single command named `rasen`. The package version SHALL remain `0.1.0`, and `repository`, `homepage`, and `author` SHALL identify the fork (`github.com/DumoeDss/rasen`).

#### Scenario: Installed command name
- **WHEN** a user installs the package globally
- **THEN** a `rasen` executable is placed on their PATH
- **AND** no `openspec` executable is installed by this package

#### Scenario: Package identity fields
- **WHEN** the published package manifest is inspected
- **THEN** `name` is `rasen`, `bin` maps `rasen` to the CLI entry, and `repository`/`homepage` point at `github.com/DumoeDss/rasen`

#### Scenario: Version reported by the CLI
- **WHEN** a user runs `rasen --version`
- **THEN** the CLI prints `0.1.0`

### Requirement: Brand-visible CLI surface
The CLI SHALL identify itself as rasen in every user-facing surface: the program name, help and command descriptions, error and notice text, and the CLI-invocation examples embedded in generated skill and command templates.

#### Scenario: Program name and help
- **WHEN** a user runs `rasen --help`
- **THEN** the program is named `rasen`
- **AND** the help text refers to the product as rasen, not OpenSpec

#### Scenario: Generated template command examples
- **WHEN** the CLI generates skill or command files that contain example CLI invocations
- **THEN** those examples invoke `rasen <verb>` (e.g., `rasen update`, `rasen list`), not `openspec <verb>`

#### Scenario: Upstream repository references repointed
- **WHEN** the CLI prints a "learn more" or "feedback" link, or opens the feedback issue tracker
- **THEN** the link targets `github.com/DumoeDss/rasen`, not an upstream Fission-AI repository

### Requirement: Brand environment variable namespace
The system SHALL read brand-specific environment variables under the `RASEN_` prefix. The variables `RASEN_CONCURRENCY`, `RASEN_ENABLE_CLI_AGENT_OPENERS`, and `RASEN_NO_AUTO_CONFIG` SHALL control their respective behaviors, and the legacy `OPENSPEC_`-prefixed names SHALL NOT be read. Industry-standard non-brand variables (`DO_NOT_TRACK`, `CI`) SHALL be honored unchanged. (The telemetry opt-out variable `RASEN_TELEMETRY` is specified by the telemetry capability.)

#### Scenario: Concurrency override
- **WHEN** `RASEN_CONCURRENCY` is set to a valid positive integer
- **THEN** the system uses it as the concurrency limit
- **AND** setting `OPENSPEC_CONCURRENCY` has no effect

#### Scenario: Completion auto-config opt-out
- **WHEN** `RASEN_NO_AUTO_CONFIG` is set
- **THEN** the shell-completion installer skips automatic shell-config edits
- **AND** setting `OPENSPEC_NO_AUTO_CONFIG` has no effect

#### Scenario: Non-brand variables preserved
- **WHEN** `DO_NOT_TRACK=1` or `CI=true` is set
- **THEN** the system honors it exactly as before the rename

### Requirement: Brand namespace identifiers
The product SHALL own a complete rasen namespace across every user-visible identifier: the workspace directory SHALL be `rasen/`, the slash-command prefix SHALL be `rasen:` (hyphen form `rasen-` for tools without colon support), and skill directories SHALL use the `rasen-` prefix. Schema identifiers (e.g., `spec-driven`) SHALL be unchanged. The legacy marker pair `<!-- OPENSPEC:START -->` / `<!-- OPENSPEC:END -->` SHALL remain recognized solely for identifying legacy artifacts, and SHALL NOT be written into newly generated content.

#### Scenario: Workspace directory is rasen
- **WHEN** a user initializes a new project with `rasen init`
- **THEN** the workspace directory created is `rasen/`
- **AND** no `openspec/` directory is created

#### Scenario: Slash-command prefix is rasen
- **WHEN** generated command files are produced
- **THEN** their command identifiers use the `rasen:` prefix (or `rasen-` in hyphen-syntax tools)
- **AND** no generated identifier uses the `opsx` prefix

#### Scenario: No namespace collision with upstream OpenSpec
- **WHEN** a project also has upstream OpenSpec installed (its `openspec/` workspace, `/opsx:*` commands, `openspec-*` skills)
- **THEN** every path and identifier rasen generates is distinct from the upstream set
- **AND** neither tool overwrites the other's files
