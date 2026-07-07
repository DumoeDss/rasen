# navigator-router-skill Specification

## Purpose
Adds the user-invoked `navigator` router skill (adapted from grill `ask-matt`, MIT) that maps the OPSX main flow plus the expert skills — main flow, on-ramps, a vocabulary layer, and standalone specialists, each with a one-line "when to reach for it". It cures the cognitive-load problem of holding the full expert set in mind, reflects the post-absorb reality (investigate is feedback-loop-first, review is two-axis), and registers as an expert with the count incremented by one.
## Requirements
### Requirement: Navigator router skill exists and is user-invoked
The system SHALL add a router skill `navigator` at `skills/gstack/navigator/SKILL.md.tmpl` (adapted from grill `ask-matt`, MIT), installed user-invoked (`disable-model-invocation: true`) with a human-facing one-line `description` (no model-facing trigger list). Its frontmatter SHALL follow the fork convention and place `{{PREAMBLE}}` after the frontmatter, with an MIT attribution NOTICE.

#### Scenario: Navigator template exists
- **WHEN** `skills/gstack/navigator/SKILL.md.tmpl` is inspected
- **THEN** it SHALL exist with `{{PREAMBLE}}` after its frontmatter and an MIT attribution NOTICE

#### Scenario: Generated navigator is user-invoked
- **WHEN** `skills/gstack/navigator/SKILL.md` is generated and inspected
- **THEN** its frontmatter SHALL contain `disable-model-invocation: true`
- **AND** its `description` SHALL be a one-line human-facing summary without a "Use when …" trigger list

### Requirement: Navigator maps OPSX and the experts, reflecting the post-absorb state

The navigator body SHALL present a four-part map: a main flow (`/opsx:explore` or `/opsx:office-hours` → `/opsx:propose` → `/opsx:apply` → review/verify → `/opsx:ship` → `/opsx:archive` → `/opsx:retro`, with `/opsx:auto` as the driver), on-ramps, a vocabulary layer (`/codebase-design`), and standalone specialists, each with a one-line "when to reach for it". It SHALL reflect the post-absorb reality and SHALL NOT reference grill skills absent from this fork, nor any of the removed parallel-lifecycle skills, nor the removed `/domain-modeling` methodology skill. The map SHALL NOT contain a Deploy family section, a Plan family section, a standalone `/retro` entry, or a `/document-release` entry.

#### Scenario: Four-part map present

- **WHEN** the generated navigator skill is inspected
- **THEN** it SHALL contain a main flow, on-ramps, a vocabulary layer, and a standalone section
- **AND** each named skill SHALL have a one-line "when to use"

#### Scenario: Reflects absorbed skills

- **WHEN** the navigator map is inspected
- **THEN** `/investigate` SHALL be described as refusing to hypothesise before a red-capable feedback loop
- **AND** `/review` SHALL be described as a two-axis (Standards + Spec) review

#### Scenario: No fork-absent grill skills referenced

- **WHEN** the navigator map is inspected
- **THEN** it SHALL NOT reference `/to-prd`, `/to-issues`, `/implement`, `/triage`, `/improve-codebase-architecture`, `/research`, `/teach`, `/grill-me`, `/grill-with-docs`, or `/setup-matt-pocock-skills`

#### Scenario: No removed parallel-lifecycle skills referenced

- **WHEN** the navigator map is inspected
- **THEN** it SHALL NOT reference `/autoplan`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/land-and-deploy`, `/setup-deploy`, `/canary`, `/document-release`, or a standalone `/retro` expert
- **AND** the `/opsx:ship` and `/opsx:retro` entries in the main flow SHALL remain

#### Scenario: No removed methodology skill referenced

- **WHEN** the navigator map is inspected
- **THEN** it SHALL NOT reference `/domain-modeling`

### Requirement: Navigator registered as an expert with count +1
The navigator SHALL be registered through the expert chain: `src/core/templates/experts/navigator.ts` (setting `disableModelInvocation: true`), an export in `experts/index.ts`, a re-export in `skill-templates.ts`, and an import plus `getSkillTemplates()` entry (`dirName: 'openspec-gstack-navigator'`, `workflowId: 'navigator'`) in `skill-generation.ts`. The expert count in `test/core/shared/skill-generation.test.ts` SHALL increase by one (applied as a delta to current committed values, per the sibling-conflict guidance). An AGENTS.md row SHALL be added.

#### Scenario: getSkillTemplates includes navigator
- **WHEN** `getSkillTemplates()` is called
- **THEN** the returned array SHALL include an entry with `dirName: 'openspec-gstack-navigator'`

#### Scenario: Expert count increased by one
- **WHEN** `test/core/shared/skill-generation.test.ts` runs
- **THEN** the expert-count component of each affected assertion SHALL be one greater than before this change
- **AND** all count assertions SHALL pass

#### Scenario: Build succeeds and AGENTS lists navigator
- **WHEN** a TypeScript build is run and `skills/gstack/docs/AGENTS.md` is inspected
- **THEN** compilation SHALL succeed
- **AND** AGENTS.md SHALL contain a `/navigator` row

