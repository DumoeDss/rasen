## ADDED Requirements

### Requirement: Four grill expert skills exist as source templates
The system SHALL add four expert skills adapted from the grill sources (MIT, Matt Pocock), by explicit name: `domain-modeling`, `codebase-design`, `tdd`, `prototype`. Each SHALL have `skills/gstack/<name>/SKILL.md.tmpl` whose body preserves the grill source substance (leading-word vocabulary and checkable completion criteria) and whose frontmatter follows the fork convention (`name`, `version`, a `description` with a "Use when …" trigger list, `allowed-tools`), with `{{PREAMBLE}}` placed after the frontmatter. Each SHALL carry its grill reference files as sidecars in the same directory.

#### Scenario: Each skill has a template and preamble placeholder
- **WHEN** `skills/gstack/domain-modeling/SKILL.md.tmpl`, `codebase-design/SKILL.md.tmpl`, `tdd/SKILL.md.tmpl`, and `prototype/SKILL.md.tmpl` are inspected
- **THEN** each SHALL exist
- **AND** each SHALL contain a `{{PREAMBLE}}` placeholder after its YAML frontmatter

#### Scenario: Reference sidecars carried in source
- **WHEN** the four skill source directories are inspected
- **THEN** `domain-modeling/` SHALL contain `ADR-FORMAT.md` and `CONTEXT-FORMAT.md`
- **AND** `codebase-design/` SHALL contain `DEEPENING.md` and `DESIGN-IT-TWICE.md`
- **AND** `tdd/` SHALL contain `tests.md` and `mocking.md`
- **AND** `prototype/` SHALL contain `LOGIC.md` and `UI.md`

#### Scenario: Grill vocabulary preserved
- **WHEN** the regenerated `SKILL.md` files are inspected
- **THEN** `codebase-design` SHALL contain the deep-module vocabulary (`seam`, `deep module`, `adapter`, `leverage`, `locality`)
- **AND** `tdd` SHALL name the three anti-patterns (implementation-coupled, tautological, horizontal-slicing) and the tracer-bullet vertical-slice discipline
- **AND** `domain-modeling` SHALL describe the CONTEXT.md glossary and the three-part ADR test
- **AND** `prototype` SHALL branch into LOGIC and UI questions

### Requirement: Four skills registered as expert templates
Each new skill SHALL be registered through the full expert wiring chain, by explicit file lookup: an expert template `src/core/templates/experts/<name>.ts` returning `name: 'gstack:<name>'`; an export in `src/core/templates/experts/index.ts`; a re-export in `src/core/templates/skill-templates.ts`; and an import plus a `getSkillTemplates()` entry in `src/core/shared/skill-generation.ts` with `dirName: 'openspec-gstack-<name>'` and `workflowId: '<name>'`.

#### Scenario: getSkillTemplates returns the four new experts
- **WHEN** `getSkillTemplates()` is called without a filter
- **THEN** the returned array SHALL include entries with dirNames `openspec-gstack-domain-modeling`, `openspec-gstack-codebase-design`, `openspec-gstack-tdd`, and `openspec-gstack-prototype`

#### Scenario: init generates the four expert skill files
- **WHEN** `openspec init` is run and Claude Code is selected
- **THEN** `SKILL.md` files SHALL be generated at `.claude/skills/openspec-gstack-domain-modeling/`, `openspec-gstack-codebase-design/`, `openspec-gstack-tdd/`, and `openspec-gstack-prototype/`

#### Scenario: Build succeeds with the four new imports
- **WHEN** a TypeScript build is run after registration
- **THEN** compilation SHALL succeed with the four new template imports resolving

### Requirement: Expert count assertions updated
The four expert/total count assertions in `test/core/shared/skill-generation.test.ts` SHALL be updated from 25 experts to 29 experts by explicit edit: `toHaveLength(42)`→`(46)`, `toHaveLength(29)`→`(33)`, `toHaveLength(25)`→`(29)`, `toHaveLength(26)`→`(30)`, with matching comment strings.

#### Scenario: Count tests reflect 29 experts
- **WHEN** `test/core/shared/skill-generation.test.ts` is run
- **THEN** the total-templates assertion SHALL expect 46 (17 workflow + 29 expert)
- **AND** the expert-only assertion SHALL expect 29
- **AND** all four count assertions SHALL pass

### Requirement: MIT attribution on adapted content
Each new `.tmpl` SHALL carry an MIT attribution NOTICE (`adapted from mattpocock/skills (MIT, Copyright Matt Pocock)`) placed after the frontmatter so it survives the frontmatter strip and installs with the instructions. Sidecar files copied largely verbatim SHALL carry the same NOTICE at their head.

#### Scenario: Generated skills carry the NOTICE
- **WHEN** the four regenerated `SKILL.md` files are inspected
- **THEN** each SHALL contain the string `mattpocock/skills` and `MIT`

#### Scenario: AGENTS directory table lists the four skills
- **WHEN** `skills/gstack/docs/AGENTS.md` is inspected
- **THEN** it SHALL contain rows for `/domain-modeling`, `/codebase-design`, `/tdd`, and `/prototype`
