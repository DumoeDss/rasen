# opsx-office-hours-command Specification

## Purpose
Provide the `/opsx:office-hours` command for YC-style product validation in Startup and Builder modes, dual-writing output that propose consumes downstream.

## Requirements
### Requirement: Office-Hours Skill and Command Templates

The system SHALL provide a SkillTemplate and CommandTemplate for office-hours in `src/core/templates/workflows/office-hours.ts`.

#### Scenario: Template file exports

- **WHEN** the template file is loaded
- **THEN** it SHALL export `getOfficeHoursCommandSkillTemplate()` returning a SkillTemplate
- **AND** it SHALL export `getOpsxOfficeHoursCommandTemplate()` returning a CommandTemplate
- **AND** both templates SHALL follow the same pattern as existing workflow templates (e.g., `explore.ts`, `apply-change.ts`)

#### Scenario: Skill installation via openspec init

- **WHEN** user runs `openspec init`
- **THEN** the office-hours skill SHALL be generated into `.claude/skills/`
- **AND** the office-hours command SHALL be generated into `.claude/commands/`

### Requirement: Startup and Builder Modes

The skill SHALL support two distinct modes: Startup mode (six forcing questions) and Builder mode (design brainstorm).

#### Scenario: Startup mode invocation

- **WHEN** agent executes `/opsx:office-hours` with Startup mode selected
- **THEN** the agent SHALL walk the user through six forcing questions covering problem, audience, existing alternatives, unique value, risks, and success metrics
- **AND** each question SHALL require a substantive answer before proceeding

#### Scenario: Builder mode invocation

- **WHEN** agent executes `/opsx:office-hours` with Builder mode selected
- **THEN** the agent SHALL conduct a design brainstorm session
- **AND** the session SHALL explore architecture options, trade-offs, and implementation approaches

#### Scenario: Mode selection prompt

- **WHEN** agent executes `/opsx:office-hours` without specifying a mode
- **THEN** the agent SHALL prompt the user to select between Startup mode and Builder mode
- **AND** provide a brief description of each mode's purpose

### Requirement: Dual-Write Output

Output SHALL be dual-written: gstack default location AND `openspec/changes/<name>/office-hours-design.md`.

#### Scenario: Output when active change exists

- **WHEN** office-hours completes
- **AND** an active OpenSpec change context exists
- **THEN** the output document SHALL be written to `openspec/changes/<name>/office-hours-design.md`
- **AND** the output SHALL also be written to the gstack default location

#### Scenario: Output when no active change exists

- **WHEN** office-hours completes
- **AND** no active change exists
- **THEN** the output SHALL go to `openspec/office-hours/<topic-slug>.md`, where `<topic-slug>` is a kebab-case slug derived from the session topic (the same way `/opsx:propose` derives a change name)
- **AND** the filename SHALL NOT be a single fixed name, so that separate validation sessions do not overwrite one another
- **AND** if the derived filename already exists for an unrelated topic, the agent SHALL disambiguate with a short suffix rather than overwriting

### Requirement: Downstream Consumption by Propose

The `/opsx:propose` command SHALL auto-detect and consume `office-hours-design.md` as context when it exists.

#### Scenario: Propose detects office-hours output

- **WHEN** user invokes `/opsx:propose` for a change
- **AND** `openspec/changes/<name>/office-hours-design.md` exists in the change directory
- **THEN** the propose command SHALL automatically read and incorporate the office-hours design as input context
- **AND** the generated proposal SHALL reference insights from the office-hours session

#### Scenario: Propose without office-hours output

- **WHEN** user invokes `/opsx:propose` for a change
- **AND** no `office-hours-design.md` exists in the change directory
- **THEN** the propose command SHALL proceed normally without office-hours context

