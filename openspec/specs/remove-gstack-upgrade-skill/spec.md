# remove-gstack-upgrade-skill Specification

## Purpose
Remove the deprecated `gstack-upgrade` expert skill.

## Requirements
### Requirement: gstack-upgrade expert skill removed
The gstack-upgrade expert skill template SHALL be deleted. Specifically:
- `src/core/templates/experts/gstack-upgrade.ts` SHALL be deleted
- The export in `src/core/templates/experts/index.ts` SHALL be removed
- The barrel export in `src/core/templates/skill-templates.ts` SHALL be removed
- The registration in `src/core/shared/skill-generation.ts` expertSkills array SHALL be removed

#### Scenario: openspec init does not generate gstack-upgrade
- **WHEN** `openspec init` is run
- **THEN** no `openspec-gstack-upgrade/` directory SHALL be created under the skills directory

#### Scenario: Build succeeds without gstack-upgrade
- **WHEN** `pnpm build` is run after removal
- **THEN** TypeScript compilation SHALL succeed with no errors

