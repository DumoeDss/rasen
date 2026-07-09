# remove-gstack-upgrade-skill Specification

## Purpose
Remove the deprecated `gstack-upgrade` expert skill.
## Requirements
### Requirement: gstack-upgrade expert skill removed
The gstack-upgrade expert skill SHALL be fully removed. The expert template and registrations were removed by a prior change; this change removes the remaining source and references, by explicit file lookup:
- `src/core/templates/experts/gstack-upgrade.ts` SHALL NOT exist (already removed)
- the export in `src/core/templates/experts/index.ts` SHALL NOT exist (already removed)
- the barrel export in `src/core/templates/skill-templates.ts` SHALL NOT exist (already removed)
- the registration in `src/core/shared/skill-generation.ts` expertSkills array SHALL NOT exist (already removed)
- `skills/gstack/gstack-upgrade/` (both `SKILL.md` and `SKILL.md.tmpl`) SHALL be deleted
- the `gstack-upgrade/SKILL.md` entry in `scripts/skill-check.ts` SHALL be removed
- the `/gstack-upgrade` row in `skills/gstack/docs/AGENTS.md` SHALL be removed
- the `gstack-update-check` reference in `skills/gstack/docs/ARCHITECTURE.md` SHALL be removed

#### Scenario: rasen init does not generate gstack-upgrade
- **WHEN** `rasen init` is run
- **THEN** no `openspec-gstack-upgrade/` directory SHALL be created under the skills directory

#### Scenario: Build succeeds without gstack-upgrade
- **WHEN** a TypeScript build is run after removal
- **THEN** compilation SHALL succeed with no errors

#### Scenario: No gstack-upgrade source directory
- **WHEN** the source tree is inspected
- **THEN** `skills/gstack/gstack-upgrade/` SHALL NOT exist

#### Scenario: skill-check passes without gstack-upgrade
- **WHEN** `bun run skill:check` is run after removal
- **THEN** it SHALL exit 0
- **AND** SHALL NOT report a missing `gstack-upgrade` skill

#### Scenario: No gstack-upgrade references in docs
- **WHEN** `skills/gstack/docs/AGENTS.md` and `skills/gstack/docs/ARCHITECTURE.md` are inspected
- **THEN** neither SHALL contain `/gstack-upgrade` or `gstack-update-check`

