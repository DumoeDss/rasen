## ADDED Requirements

### Requirement: Oh My Pi is an adapted agent

Rasen SHALL treat Oh My Pi (the `omp` CLI) as an adapted agent: it SHALL appear in the install/selection surface, SHALL be included in `--tools all`, and SHALL be accepted when named explicitly via `--tools omp`.

#### Scenario: Oh My Pi is offered and selectable

- **WHEN** the set of installable tools is computed for any selection surface
- **THEN** Oh My Pi SHALL be included among the offered adapted agents

#### Scenario: Explicit Oh My Pi selection is accepted

- **WHEN** a user runs init with `--tools omp`
- **THEN** the system SHALL proceed with Oh My Pi setup
- **AND** SHALL NOT reject Oh My Pi as "not yet adapted"

### Requirement: Rasen skills install to the project-local Oh My Pi skills root

Because Oh My Pi's own highest-priority discovery provider reads a project-local skills directory, Rasen SHALL install its workflow skills for Oh My Pi at `<projectRoot>/.omp/skills/rasen-<workflow>/SKILL.md`, so each installed skill is discovered at the highest precedence Oh My Pi offers and surfaces as a skill command with no configuration step. Rasen SHALL scope the skills it writes with the `rasen-` name prefix so it does not overwrite user-authored Oh My Pi skills.

#### Scenario: Skills written to the project-local Oh My Pi skills root

- **WHEN** init sets up Oh My Pi
- **THEN** each generated skill SHALL be written under `<projectRoot>/.omp/skills/`
- **AND** SHALL NOT be written to any machine-global skills home

#### Scenario: Installed skills carry the description Oh My Pi requires to discover them

- **WHEN** a Rasen skill is installed for Oh My Pi
- **THEN** its front matter SHALL carry a non-empty description
- **AND** the skill SHALL therefore be discoverable by the provider that owns that directory

#### Scenario: User-authored Oh My Pi skills are preserved

- **WHEN** Rasen installs or updates Oh My Pi skills
- **THEN** it SHALL only create, refresh, or remove skills under the `rasen-` prefix
- **AND** SHALL leave any non-`rasen-` skills in the Oh My Pi skills root untouched

### Requirement: Oh My Pi performs no command-file generation

Oh My Pi discovers installed skills directly and exposes each as a skill command. Rasen SHALL install skills for Oh My Pi without generating command files for it, and SHALL NOT remove files under an Oh My Pi command directory that Rasen never wrote.

#### Scenario: Command files skipped for Oh My Pi

- **WHEN** init or update runs for Oh My Pi
- **THEN** the system SHALL install Oh My Pi skills
- **AND** SHALL NOT generate command files for Oh My Pi
- **AND** SHALL NOT delete any file under an Oh My Pi command directory

### Requirement: An Oh My Pi setup is recognized from configuration content, not from a bare directory

Rasen SHALL report Oh My Pi as present in a project only when the project's Oh My Pi directory actually holds configuration content. An empty Oh My Pi directory — which the harness or an unrelated action can leave behind — SHALL NOT cause Rasen to report the tool as detected or to prompt the user to add it.

#### Scenario: An empty Oh My Pi directory is not a detection

- **GIVEN** a project contains an Oh My Pi directory with no entries
- **WHEN** Rasen computes detected tools for init, or checks for newly appeared tool directories during update
- **THEN** Oh My Pi SHALL NOT be reported as detected
- **AND** update SHALL NOT prompt the user to add Oh My Pi

#### Scenario: A populated Oh My Pi directory is a detection

- **GIVEN** a project's Oh My Pi directory holds recognizable Oh My Pi configuration content
- **WHEN** Rasen computes detected tools
- **THEN** Oh My Pi SHALL be reported as detected

### Requirement: Init discloses that a nested Oh My Pi install captures project-context discovery

Oh My Pi resolves its project instruction file and its sticky project rules from the nearest populated Oh My Pi directory found while walking from the working directory toward the repository root, and does not continue past it. Creating that directory in a nested package therefore stops an enclosing directory's instruction and rule files from loading. When Rasen's install would newly populate an Oh My Pi directory below a repository root that already carries Oh My Pi project instructions or project rules, Rasen SHALL tell the user which enclosing files stop being loaded, so the consequence is learned from Rasen rather than from missing instructions.

#### Scenario: Nested install warns about the captured enclosing files

- **GIVEN** an enclosing directory nearer the repository root carries Oh My Pi project instructions or project rules
- **WHEN** init newly populates an Oh My Pi directory in a nested directory
- **THEN** the output SHALL name the enclosing files that will no longer load
- **AND** the install SHALL still complete

#### Scenario: No warning when nothing is captured

- **WHEN** init populates an Oh My Pi directory and no enclosing Oh My Pi project instructions or project rules exist
- **THEN** no such warning SHALL be shown

### Requirement: Update recognizes and refreshes an installed Oh My Pi

`rasen update` SHALL treat Oh My Pi as configured when Rasen skills are already installed under the project's Oh My Pi skills root, and SHALL refresh those skills in place.

#### Scenario: Update refreshes Oh My Pi skills

- **WHEN** Rasen skills are already installed under the project's Oh My Pi skills root
- **AND** the user runs `rasen update`
- **THEN** the system SHALL treat Oh My Pi as configured
- **AND** SHALL refresh the `rasen-` skills under that root
