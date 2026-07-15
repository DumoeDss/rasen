## ADDED Requirements

### Requirement: Hermes is an adapted agent

Rasen SHALL treat Hermes (the Nous Research `hermes` CLI) as an adapted agent: it SHALL appear in the install/selection surface, SHALL be included in `--tools all`, and SHALL be accepted when named explicitly via `--tools hermes`.

#### Scenario: Hermes is offered and selectable

- **WHEN** the set of installable tools is computed for any selection surface
- **THEN** Hermes SHALL be included among the offered adapted agents

#### Scenario: Explicit Hermes selection is accepted

- **WHEN** a user runs init with `--tools hermes`
- **THEN** the system SHALL proceed with Hermes setup
- **AND** SHALL NOT reject Hermes as "not yet adapted"

### Requirement: Rasen skills install to the Hermes global skills home

Because Hermes discovers skills only from its global home, Rasen SHALL install its workflow skills for Hermes under the Hermes skills home (`HERMES_HOME`, defaulting to `~/.hermes`), at `<hermesHome>/skills/rasen-<workflow>/SKILL.md`, so that each installed skill is discoverable by Hermes and surfaces as a slash command. Rasen SHALL scope the skills it writes with the `rasen-` name prefix so it does not overwrite user-authored Hermes skills.

#### Scenario: Skills written to the Hermes home, not a project directory

- **WHEN** init sets up Hermes
- **THEN** each generated skill SHALL be written under the resolved Hermes skills home (`<HERMES_HOME or ~/.hermes>/skills/`)
- **AND** SHALL NOT be written under a project-local `.hermes/` directory

#### Scenario: HERMES_HOME override is honored

- **WHEN** `HERMES_HOME` is set
- **THEN** Rasen SHALL install Hermes skills under `<HERMES_HOME>/skills/` rather than `~/.hermes/skills/`

#### Scenario: User-authored Hermes skills are preserved

- **WHEN** Rasen installs or updates Hermes skills
- **THEN** it SHALL only create, refresh, or remove skills under the `rasen-` prefix
- **AND** SHALL leave any non-`rasen-` skills in the Hermes skills home untouched

### Requirement: Hermes performs no command-file generation

Hermes has no per-file custom-command directory; installed skills auto-register as slash commands. Rasen SHALL NOT generate command files for Hermes, while still always installing skills.

#### Scenario: Command files skipped for Hermes

- **WHEN** init runs for Hermes under any delivery setting
- **THEN** the system SHALL install Hermes skills
- **AND** SHALL NOT generate command files for Hermes
- **AND** SHALL report Hermes among tools with skipped command generation

### Requirement: Update recognizes an installed Hermes from its global home

`rasen update` SHALL determine whether Hermes is configured by inspecting the Hermes skills home, and SHALL refresh Rasen's Hermes skills there.

#### Scenario: Update refreshes Hermes skills in the global home

- **WHEN** Rasen skills are already installed under the Hermes skills home
- **AND** the user runs `rasen update`
- **THEN** the system SHALL treat Hermes as configured
- **AND** SHALL refresh the `rasen-` skills under the Hermes skills home
