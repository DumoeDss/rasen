# opsx-retro-command Specification

## Purpose
Provide the `/rasen-retro` command — three retro scopes that read change-scoped artifacts and emit a retrospective report.

## Requirements
### Requirement: Retro Skill and Command Templates

The system SHALL provide a SkillTemplate and CommandTemplate for retro in `src/core/templates/workflows/retro.ts`.

#### Scenario: Template file exports

- **WHEN** the template file is loaded
- **THEN** it SHALL export `getRetroCommandSkillTemplate()` returning a SkillTemplate
- **AND** it SHALL export `getOpsxRetroCommandTemplate()` returning a CommandTemplate
- **AND** both templates SHALL follow the same pattern as existing workflow templates

#### Scenario: Skill installation via rasen init

- **WHEN** user runs `rasen init`
- **THEN** the retro skill SHALL be generated into `.claude/skills/`
- **AND** the retro command SHALL be generated into `.claude/commands/`

### Requirement: Three Retro Scopes

The command SHALL support 3 scopes: change-scoped, general, and global. The general and global scopes SHALL run a self-contained git-analysis contract absorbed into the `/rasen-retro` workflow template and SHALL NOT delegate to a legacy `/retro` expert skill.

#### Scenario: Change-scoped retro invocation

- **WHEN** agent executes `/rasen-retro <change-name>`
- **THEN** the retro SHALL run in change-scoped mode
- **AND** SHALL read artifacts from the specified change directory

#### Scenario: General retro invocation

- **WHEN** agent executes `/rasen-retro` without a change name
- **AND** the user selects general scope
- **THEN** the retro SHALL gather recent commit, author, and LOC data from git and compute metrics itself
- **AND** SHALL produce insights based on commit patterns, frequency, code areas touched, and a per-author breakdown
- **AND** SHALL complete without invoking any legacy `/retro` expert skill

#### Scenario: Global retro invocation

- **WHEN** agent executes `/rasen-retro global`
- **THEN** the retro SHALL run cross-project analysis using its own git-analysis contract
- **AND** SHALL produce insights spanning multiple repositories if available
- **AND** SHALL complete without invoking any legacy `/retro` expert skill

### Requirement: Change-Scoped Artifact Reading

Change-scoped retro SHALL read all available change artifacts: review material (proposal, design, tasks, delta specs) from the change directory, and process ephemera (review/qa/cso reports, ship-log, verification report, run-state) from the change's work directory (the `workDir` reported by the CLI per the `change-work-dir` capability), falling back to the change directory for ephemera that live there (legacy changes).

#### Scenario: Full artifact set available

- **WHEN** running a change-scoped retro
- **AND** the change directory contains proposal.md, design.md, and tasks.md, and the resolved ephemera location contains review-report.md, qa-report.md, and ship-log.md
- **THEN** the retro SHALL read and analyze all of these artifacts
- **AND** SHALL correlate planning artifacts (proposal, design) with outcome artifacts (review, qa, ship-log)

#### Scenario: Partial artifact set

- **WHEN** running a change-scoped retro
- **AND** some artifacts are missing from both the work directory and the change directory
- **THEN** the retro SHALL analyze whatever artifacts are available
- **AND** SHALL note which artifacts were missing and what analysis was skipped

#### Scenario: Legacy change reads its change-dir ephemera

- **WHEN** running a change-scoped retro on a change whose reports predate the work directory
- **THEN** the retro SHALL find and analyze those reports in the change directory via the fallback

#### Scenario: Specs directory reading

- **WHEN** running a change-scoped retro
- **AND** `specs/` directory exists in the change
- **THEN** the retro SHALL read delta specs to understand what was specified vs what was delivered

### Requirement: Retro Report Output

The retro report SHALL be written to the change directory as `retro.md`.

#### Scenario: Report written for change-scoped retro

- **WHEN** a change-scoped retro completes
- **THEN** the report SHALL be written to `rasen/changes/<name>/retro.md`
- **AND** the report SHALL include: what went well, what could improve, key metrics (time from proposal to ship, number of review iterations), and actionable takeaways

#### Scenario: Report written for general retro

- **WHEN** a general retro completes
- **THEN** the report SHALL be written to `rasen/retro-latest.md`
- **AND** the report SHALL include: commit pattern analysis, areas of high churn, and improvement suggestions

#### Scenario: Report display

- **WHEN** the retro report is written
- **THEN** the agent SHALL also display the report summary to the user
- **AND** SHALL highlight the top 3 actionable takeaways

