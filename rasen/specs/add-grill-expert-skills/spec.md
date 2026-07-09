# add-grill-expert-skills Specification

## Purpose
Establishes three grill methodology expert skills — `codebase-design`, `tdd`, and `prototype` — as source templates adapted from Matt Pocock's grill skills (MIT). These fill the fork's gap in method-level design primitives (deep-module design vocabulary, what a test worth keeping is, and throwaway prototyping) that the workflow skills lean on but never spell out. Covers their template/preamble shape, expert registration, and MIT attribution.
## Requirements
### Requirement: Four grill expert skills exist as source templates

The system SHALL carry three expert skills adapted from the grill sources (MIT, Matt Pocock), by explicit name: `codebase-design`, `tdd`, `prototype`. (`domain-modeling` was part of the original adaptation but was removed 2026-07-07: its repo-root CONTEXT.md/ADR working style conflicts with the Rasen change-directory flow.) Each SHALL have its prompt as an inline template string in `src/core/templates/experts/<name>.ts` whose body preserves the grill source substance (leading-word vocabulary and checkable completion criteria) and whose emitted frontmatter follows the fork convention (`name`, a `description`, `allowed-tools`), with the `${PREAMBLE}` shared constant interpolated near the top. Each SHALL carry its grill reference files as sidecars in `skills/experts/<name>/`.

#### Scenario: Each skill has a template and preamble reference

- **WHEN** `src/core/templates/experts/codebase-design.ts`, `tdd.ts`, and `prototype.ts` are inspected
- **THEN** each SHALL exist and build its instructions from an inline template string
- **AND** each SHALL interpolate the `${PREAMBLE}` shared constant
- **AND** `skills/experts/domain-modeling/` SHALL NOT exist

#### Scenario: Reference sidecars carried in source

- **WHEN** the three skill source directories under `skills/experts/` are inspected
- **THEN** `skills/experts/codebase-design/` SHALL contain `DEEPENING.md` and `DESIGN-IT-TWICE.md`
- **AND** `skills/experts/tdd/` SHALL contain `tests.md` and `mocking.md`
- **AND** `skills/experts/prototype/` SHALL contain `LOGIC.md` and `UI.md`

#### Scenario: Grill vocabulary preserved

- **WHEN** the installed `SKILL.md` files are inspected
- **THEN** `codebase-design` SHALL contain the deep-module vocabulary (`seam`, `deep module`, `adapter`, `leverage`, `locality`)
- **AND** `tdd` SHALL name the three anti-patterns (implementation-coupled, tautological, horizontal-slicing) and the tracer-bullet vertical-slice discipline
- **AND** `prototype` SHALL branch into LOGIC and UI questions

### Requirement: Four skills registered as expert templates

Each surviving grill skill SHALL be registered through the full expert wiring chain, by explicit file lookup: an expert template `src/core/templates/experts/<name>.ts` returning `name: 'rasen:<name>'`; an export in `src/core/templates/experts/index.ts`; a re-export in `src/core/templates/skill-templates.ts`; and an import plus a `getSkillTemplates()` entry in `src/core/shared/skill-generation.ts` with `dirName: 'rasen-<name>'` and `workflowId: '<name>'`. The `domain-modeling` wiring SHALL be absent at every point in that chain.

#### Scenario: getSkillTemplates returns the surviving experts

- **WHEN** `getSkillTemplates()` is called without a filter
- **THEN** the returned array SHALL include entries with dirNames `rasen-codebase-design`, `rasen-tdd`, and `rasen-prototype`
- **AND** SHALL NOT include `openspec-domain-modeling` or any `openspec-gstack-*` dirName

#### Scenario: init generates the surviving expert skill files

- **WHEN** `rasen init` is run and Claude Code is selected
- **THEN** `SKILL.md` files SHALL be generated at `.claude/skills/rasen-codebase-design/`, `rasen-tdd/`, and `rasen-prototype/`

#### Scenario: Build succeeds with the surviving template imports

- **WHEN** a TypeScript build is run after registration
- **THEN** compilation SHALL succeed with the surviving template imports resolving and no `domain-modeling` import remaining

### Requirement: MIT attribution on adapted content

Each surviving grill expert template SHALL carry an MIT attribution NOTICE (`adapted from mattpocock/skills (MIT, Copyright Matt Pocock)`) in its inline body so it installs with the instructions. Sidecar files copied largely verbatim SHALL carry the same NOTICE at their head.

#### Scenario: Generated skills carry the NOTICE

- **WHEN** the three installed `SKILL.md` files are inspected
- **THEN** each SHALL contain the string `mattpocock/skills` and `MIT`

#### Scenario: AGENTS directory table lists the surviving skills

- **WHEN** `skills/experts/docs/AGENTS.md` is inspected
- **THEN** it SHALL contain rows for `/codebase-design`, `/tdd`, and `/prototype`
- **AND** SHALL NOT contain a `/domain-modeling` row

