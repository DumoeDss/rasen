## ADDED Requirements

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

### Requirement: Preserved workspace and ecosystem identifiers
The rename SHALL NOT alter identifiers that existing on-disk user projects or the workflow ecosystem depend on. The user-project workspace directory SHALL remain `openspec/`, the slash-command prefix SHALL remain `opsx:`, the in-file marker pair SHALL remain `<!-- OPENSPEC:START -->` / `<!-- OPENSPEC:END -->`, and schema identifiers (e.g., `spec-driven`) SHALL be unchanged.

#### Scenario: Existing workspace still recognized
- **WHEN** the CLI runs in a project initialized before the rename that has an `openspec/` directory
- **THEN** the CLI locates and operates on that workspace without requiring migration

#### Scenario: Marker blocks still detected
- **WHEN** the CLI updates or cleans a user file containing `<!-- OPENSPEC:START -->` / `<!-- OPENSPEC:END -->`
- **THEN** the CLI recognizes and manages that marker block exactly as before

#### Scenario: Slash-command prefix unchanged
- **WHEN** generated command files are produced
- **THEN** their command identifiers keep the `opsx:` prefix
