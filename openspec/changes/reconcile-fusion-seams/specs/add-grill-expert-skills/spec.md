# add-grill-expert-skills — Delta

## REMOVED Requirements

### Requirement: Expert count assertions updated

**Reason**: Historical one-time migration record; the named count values (25→29) have been superseded repeatedly by later roster changes and the requirement no longer describes the live system. Count assertions are maintained per-change, not pinned by this capability.

## MODIFIED Requirements

### Requirement: Four grill expert skills exist as source templates

The system SHALL carry three expert skills adapted from the grill sources (MIT, Matt Pocock), by explicit name: `codebase-design`, `tdd`, `prototype`. (`domain-modeling` was part of the original adaptation but was removed 2026-07-07: its repo-root CONTEXT.md/ADR working style conflicts with the OpenSpec change-directory flow.) Each SHALL have `skills/gstack/<name>/SKILL.md.tmpl` whose body preserves the grill source substance (leading-word vocabulary and checkable completion criteria) and whose frontmatter follows the fork convention (`name`, `version`, a `description` with a "Use when …" trigger list, `allowed-tools`), with `{{PREAMBLE}}` placed after the frontmatter. Each SHALL carry its grill reference files as sidecars in the same directory.

#### Scenario: Each skill has a template and preamble placeholder

- **WHEN** `skills/gstack/codebase-design/SKILL.md.tmpl`, `tdd/SKILL.md.tmpl`, and `prototype/SKILL.md.tmpl` are inspected
- **THEN** each SHALL exist
- **AND** each SHALL contain a `{{PREAMBLE}}` placeholder after its YAML frontmatter
- **AND** `skills/gstack/domain-modeling/` SHALL NOT exist

#### Scenario: Reference sidecars carried in source

- **WHEN** the three skill source directories are inspected
- **THEN** `codebase-design/` SHALL contain `DEEPENING.md` and `DESIGN-IT-TWICE.md`
- **AND** `tdd/` SHALL contain `tests.md` and `mocking.md`
- **AND** `prototype/` SHALL contain `LOGIC.md` and `UI.md`

#### Scenario: Grill vocabulary preserved

- **WHEN** the regenerated `SKILL.md` files are inspected
- **THEN** `codebase-design` SHALL contain the deep-module vocabulary (`seam`, `deep module`, `adapter`, `leverage`, `locality`)
- **AND** `tdd` SHALL name the three anti-patterns (implementation-coupled, tautological, horizontal-slicing) and the tracer-bullet vertical-slice discipline
- **AND** `prototype` SHALL branch into LOGIC and UI questions

### Requirement: Four skills registered as expert templates

Each surviving grill skill SHALL be registered through the full expert wiring chain, by explicit file lookup: an expert template `src/core/templates/experts/<name>.ts` returning `name: 'gstack:<name>'`; an export in `src/core/templates/experts/index.ts`; a re-export in `src/core/templates/skill-templates.ts`; and an import plus a `getSkillTemplates()` entry in `src/core/shared/skill-generation.ts` with `dirName: 'openspec-gstack-<name>'` and `workflowId: '<name>'`. The `domain-modeling` wiring SHALL be absent at every point in that chain.

#### Scenario: getSkillTemplates returns the surviving experts

- **WHEN** `getSkillTemplates()` is called without a filter
- **THEN** the returned array SHALL include entries with dirNames `openspec-gstack-codebase-design`, `openspec-gstack-tdd`, and `openspec-gstack-prototype`
- **AND** SHALL NOT include `openspec-gstack-domain-modeling`

#### Scenario: init generates the surviving expert skill files

- **WHEN** `openspec init` is run and Claude Code is selected
- **THEN** `SKILL.md` files SHALL be generated at `.claude/skills/openspec-gstack-codebase-design/`, `openspec-gstack-tdd/`, and `openspec-gstack-prototype/`

#### Scenario: Build succeeds with the surviving template imports

- **WHEN** a TypeScript build is run after registration
- **THEN** compilation SHALL succeed with the surviving template imports resolving and no `domain-modeling` import remaining

### Requirement: MIT attribution on adapted content

Each surviving grill `.tmpl` SHALL carry an MIT attribution NOTICE (`adapted from mattpocock/skills (MIT, Copyright Matt Pocock)`) placed after the frontmatter so it survives the frontmatter strip and installs with the instructions. Sidecar files copied largely verbatim SHALL carry the same NOTICE at their head.

#### Scenario: Generated skills carry the NOTICE

- **WHEN** the three regenerated `SKILL.md` files are inspected
- **THEN** each SHALL contain the string `mattpocock/skills` and `MIT`

#### Scenario: AGENTS directory table lists the surviving skills

- **WHEN** `skills/gstack/docs/AGENTS.md` is inspected
- **THEN** it SHALL contain rows for `/codebase-design`, `/tdd`, and `/prototype`
- **AND** SHALL NOT contain a `/domain-modeling` row
