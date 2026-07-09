## ADDED Requirements

### Requirement: setup-browser-cookies expert skill removed
The `setup-browser-cookies` expert skill SHALL be fully removed. Specifically, by explicit file lookup:
- `skills/gstack/setup-browser-cookies/` (both `SKILL.md` and `SKILL.md.tmpl`) SHALL be deleted
- `src/core/templates/experts/setup-browser-cookies.ts` SHALL be deleted
- the export in `src/core/templates/experts/index.ts` SHALL be removed
- the re-export in `src/core/templates/skill-templates.ts` SHALL be removed
- the import and the `getSkillTemplates()` registry entry (`dirName: 'openspec-gstack-setup-browser-cookies'`) in `src/core/shared/skill-generation.ts` SHALL be removed
- the `setup-browser-cookies/SKILL.md` entry in `scripts/skill-check.ts` SHALL be removed

#### Scenario: openspec init does not generate setup-browser-cookies
- **WHEN** `openspec init` is run
- **THEN** no `openspec-gstack-setup-browser-cookies/` directory SHALL be created under the skills directory

#### Scenario: Build succeeds without setup-browser-cookies
- **WHEN** a TypeScript build is run after removal
- **THEN** compilation SHALL succeed with no unresolved-import errors

#### Scenario: skill-check passes without setup-browser-cookies
- **WHEN** `bun run skill:check` is run after removal
- **THEN** it SHALL exit 0
- **AND** SHALL NOT report a missing `setup-browser-cookies` skill

### Requirement: setup-browser-cookies references removed
References to the removed skill SHALL be removed by explicit lookup: the `/setup-browser-cookies` instruction in the `gen-skill-docs.ts` design-review auth-detection prose SHALL be softened to not reference the deleted command, and the `/setup-browser-cookies` row in `skills/gstack/docs/AGENTS.md` SHALL be removed.

#### Scenario: No setup-browser-cookies mention in generated skills
- **WHEN** all SKILL.md files are regenerated and inspected
- **THEN** none SHALL instruct running `/setup-browser-cookies`

#### Scenario: No setup-browser-cookies row in AGENTS directory table
- **WHEN** `skills/gstack/docs/AGENTS.md` is inspected
- **THEN** it SHALL NOT contain a `/setup-browser-cookies` entry
