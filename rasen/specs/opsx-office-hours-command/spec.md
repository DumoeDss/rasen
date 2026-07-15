# opsx-office-hours-command Specification

## Purpose
Provide the `/rasen:office-hours` command for YC-style product validation in Startup and Builder modes, dual-writing output that propose consumes downstream.
## Requirements
### Requirement: Office-Hours Skill and Command Templates

The system SHALL provide a SkillTemplate and CommandTemplate for office-hours in `src/core/templates/workflows/office-hours.ts`.

#### Scenario: Template file exports

- **WHEN** the template file is loaded
- **THEN** it SHALL export `getOfficeHoursCommandSkillTemplate()` returning a SkillTemplate
- **AND** it SHALL export `getOpsxOfficeHoursCommandTemplate()` returning a CommandTemplate
- **AND** both templates SHALL follow the same pattern as existing workflow templates (e.g., `explore.ts`, `apply-change.ts`)

#### Scenario: Skill installation via rasen init

- **WHEN** user runs `rasen init`
- **THEN** the office-hours skill SHALL be generated into `.claude/skills/`
- **AND** the office-hours command SHALL be generated into `.claude/commands/`

### Requirement: Dual-Write Output

Output SHALL be dual-written: the project-scoped default location (`~/.rasen/projects/<slug>/`) AND `rasen/changes/<name>/office-hours-design.md`.

#### Scenario: Output when active change exists

- **WHEN** office-hours completes
- **AND** an active Rasen change context exists
- **THEN** the output document SHALL be written to `rasen/changes/<name>/office-hours-design.md`
- **AND** the output SHALL also be written to the project-scoped default location (`~/.rasen/projects/<slug>/`)

#### Scenario: Output when no active change exists

- **WHEN** office-hours completes
- **AND** no active change exists
- **THEN** the output SHALL go to `rasen/office-hours/<topic-slug>.md`, where `<topic-slug>` is a kebab-case slug derived from the session topic (the same way `/rasen:propose` derives a change name)
- **AND** the filename SHALL NOT be a single fixed name, so that separate validation sessions do not overwrite one another
- **AND** if the derived filename already exists for an unrelated topic, the agent SHALL disambiguate with a short suffix rather than overwriting

### Requirement: Downstream Consumption by Propose

The `/rasen:propose` command SHALL auto-detect and consume `office-hours-design.md` as context when it exists.

#### Scenario: Propose detects office-hours output

- **WHEN** user invokes `/rasen:propose` for a change
- **AND** `rasen/changes/<name>/office-hours-design.md` exists in the change directory
- **THEN** the propose command SHALL automatically read and incorporate the office-hours design as input context
- **AND** the generated proposal SHALL reference insights from the office-hours session

#### Scenario: Propose without office-hours output

- **WHEN** user invokes `/rasen:propose` for a change
- **AND** no `office-hours-design.md` exists in the change directory
- **THEN** the propose command SHALL proceed normally without office-hours context

### Requirement: Facilitation Delegates to the Office-Hours Expert

The office-hours workflow command SHALL treat the `/office-hours` expert skill as the single authority for session facilitation. The inline product-routed description in the command template (six forcing questions for the Diagnosis product; fork-first discipline for the Design product) SHALL serve only as a fallback pre-brief, used when the expert skill is unavailable, and SHALL NOT be run as a second facilitation pass. The design document SHALL be produced exactly once. Precedence: when both the inline description and the expert exist, the expert wins.

#### Scenario: Expert skill drives the session

- **WHEN** the office-hours workflow command runs and the `/office-hours` expert skill is available
- **THEN** the command SHALL delegate session facilitation to the `/office-hours` expert
- **AND** SHALL NOT run the inline description as a separate second pass
- **AND** SHALL produce the design document in a single step

#### Scenario: Fallback when the expert is unavailable

- **WHEN** the `/office-hours` expert skill is not available
- **THEN** the command MAY run the inline product-routed description (Diagnosis product's six questions, or the Design product's fork-first description) as a fallback
- **AND** SHALL still produce the design document exactly once

### Requirement: Office-Hours Resolves Its Output Paths From Status JSON

The office-hours workflow command SHALL resolve its design-document write paths from `rasen status --json` rather than hardcoded repo-local literals, so the output lands in the correct location when the change lives in a registered store. The active-change document SHALL be written under `changeRoot`; the no-active-change document SHALL be written under the `office-hours/` directory resolved from the planning home (the sibling of `planningHome.changesDir`) — the same location `propose` scans when it consumes office-hours output as input context. Office-hours output remains in-repo/in-store permanent knowledge; this requirement changes only how its path is resolved, not that it is committed.

#### Scenario: Active-change output resolves under changeRoot

- **WHEN** office-hours writes its design document and an active change context exists
- **THEN** it SHALL write to `office-hours-design.md` under `changeRoot` from the status JSON
- **AND** SHALL NOT assume a literal repo-relative `rasen/changes/<name>/` path

#### Scenario: No-active-change output resolves from the planning home

- **WHEN** office-hours writes its design document and no active change exists
- **THEN** it SHALL write to `<topic-slug>.md` under the `office-hours/` directory resolved from the planning home (sibling of `planningHome.changesDir`)
- **AND** SHALL NOT assume a literal repo-relative `rasen/office-hours/` path
- **AND** this SHALL be the same location that `propose` scans for office-hours input context, so producer and consumer agree in store mode

### Requirement: Diagnosis and Design Products

The skill SHALL route sessions to one of two products: the Diagnosis product (six forcing questions covering demand reality, status quo, target user, wedge, observation, and future-fit) and the Design product (fork-first discipline that asks weight-bearing forks before delivering a stance, then converges to a design doc). Routing is decided by the object of the user's request, not by a mode the user selects.

#### Scenario: Diagnosis product invocation

- **WHEN** agent executes `/rasen:office-hours` and the request routes to the Diagnosis product
- **THEN** the agent SHALL walk the user through six forcing questions covering demand reality, status quo, target user, wedge, observation, and future-fit
- **AND** each question SHALL require a substantive answer before proceeding

#### Scenario: Design product invocation

- **WHEN** agent executes `/rasen:office-hours` and the request routes to the Design product
- **THEN** the agent SHALL run the fork-scan procedure for the session's topics, asking weight-bearing forks before delivering any stance
- **AND** SHALL converge to a single design document once the discussion settles

#### Scenario: Product routing prompt

- **WHEN** agent executes `/rasen:office-hours` and the opening message does not unambiguously indicate which product the user wants
- **THEN** the agent SHALL prompt the user with a goal question and map the answer to a product (Diagnosis or Design), not to a named mode

