# remove-parallel-lifecycle-skills Specification

## Purpose
Removes the ten gstack parallel-lifecycle expert skills (`autoplan`, `plan-ceo-review`, `plan-eng-review`, `plan-design-review`, `land-and-deploy`, `setup-deploy`, `canary`, `ship`, `retro`, `document-release`) whose responsibilities were absorbed into the `/rasen:auto`, `/rasen:ship`, and `/rasen:retro` workflow templates, and ensures no wiring, generated docs, curated skill-check lists, catalogs, navigator sections, or installed directories retain residue of the removed skills.

## Requirements
### Requirement: Parallel-lifecycle experts are removed
The system SHALL NOT register or ship the ten gstack parallel-lifecycle expert skills: `autoplan`, `plan-ceo-review`, `plan-eng-review`, `plan-design-review`, `land-and-deploy`, `setup-deploy`, `canary`, `ship`, `retro`, and `document-release`. Each removal SHALL delete the expert template file `src/core/templates/experts/<name>.ts`, its export in `src/core/templates/experts/index.ts`, its re-export in `src/core/templates/skill-templates.ts`, and its import plus `getSkillTemplates()` roster entry in `src/core/shared/skill-generation.ts`.

#### Scenario: Removed experts absent from the registry
- **WHEN** `getSkillTemplates()` is called without a workflow filter
- **THEN** the returned array SHALL NOT contain any entry whose `dirName` is `openspec-gstack-autoplan`, `openspec-gstack-plan-ceo-review`, `openspec-gstack-plan-eng-review`, `openspec-gstack-plan-design-review`, `openspec-gstack-land-and-deploy`, `openspec-gstack-setup-deploy`, `openspec-gstack-canary`, `openspec-gstack-ship`, `openspec-gstack-retro`, or `openspec-gstack-document-release`

#### Scenario: Build succeeds after wiring removal
- **WHEN** a TypeScript build is run after deleting the ten expert `.ts` files and their three registration references each
- **THEN** compilation SHALL succeed with no unresolved imports or exports

### Requirement: Removed expert source directories are deleted
The system SHALL delete the source skill directory `skills/gstack/<name>/` (its `SKILL.md.tmpl`, generated `SKILL.md`, and any sidecar files) for each of the ten removed experts.

#### Scenario: Source directories absent
- **WHEN** the `skills/gstack/` tree is inspected
- **THEN** there SHALL be no `autoplan/`, `plan-ceo-review/`, `plan-eng-review/`, `plan-design-review/`, `land-and-deploy/`, `setup-deploy/`, `canary/`, `ship/`, `retro/`, or `document-release/` subdirectory

#### Scenario: Generated docs remain fresh
- **WHEN** `bun run gen:skill-docs` and `bun run skill:check` are run after the source directories are deleted
- **THEN** the freshness check SHALL pass with no stale or missing generated files

### Requirement: Curated skill-check list drops removed entries
The `SKILL_FILES` list in `scripts/skill-check.ts` SHALL NOT reference any removed skill. The nine removed entries present in that list SHALL be deleted: `ship/SKILL.md`, `retro/SKILL.md`, `plan-ceo-review/SKILL.md`, `plan-eng-review/SKILL.md`, `plan-design-review/SKILL.md`, `canary/SKILL.md`, `land-and-deploy/SKILL.md`, `setup-deploy/SKILL.md`, and `document-release/SKILL.md`.

#### Scenario: skill:check passes without stale curated entries
- **WHEN** `bun run skill:check` is run after the source directories are deleted and `SKILL_FILES` is updated
- **THEN** it SHALL exit successfully with no entry pointing at a missing SKILL.md

### Requirement: Catalog and navigator drop removed skills
The `skills/gstack/docs/AGENTS.md` skill catalog SHALL NOT list any removed skill, and the navigator map SHALL NOT route to any removed skill.

#### Scenario: AGENTS.md rows removed
- **WHEN** `skills/gstack/docs/AGENTS.md` is inspected
- **THEN** it SHALL NOT contain a table row for `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/ship`, `/retro`, or `/document-release`

#### Scenario: Navigator sections removed
- **WHEN** the generated `skills/gstack/navigator/SKILL.md` is inspected
- **THEN** it SHALL NOT contain a "Deploy family" section, a "Plan family" section, a standalone `/retro` entry, or a `/document-release` entry
- **AND** it SHALL NOT reference `/autoplan`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/land-and-deploy`, `/setup-deploy`, `/canary`, or `/document-release`

### Requirement: Expert-count assertions reflect the removal
The four expert-count assertions in `test/core/shared/skill-generation.test.ts` SHALL be reduced by ten experts, from 30 to 20, applied as a delta to the current committed values.

#### Scenario: Count assertions pass
- **WHEN** `test/core/shared/skill-generation.test.ts` runs
- **THEN** the full-roster assertion SHALL expect 38 templates (18 workflow + 20 expert)
- **AND** the four-workflow-filter assertion SHALL expect 24 (4 workflow + 20 expert)
- **AND** the no-workflow-match assertion SHALL expect 20 (0 workflow + 20 expert)
- **AND** the single-workflow-filter assertion SHALL expect 21 (1 workflow + 20 expert)
- **AND** all count assertions SHALL pass

### Requirement: Install side carries no removed-skill residue
After regeneration, the installed skill directories for the ten removed experts SHALL NOT remain on the install side. Because `rasen update --force` regenerates only the current roster and does not prune orphaned expert directories, the orphaned directories SHALL be removed explicitly.

#### Scenario: No orphaned installed directories
- **WHEN** `rasen update --force` is run and the install target's skills directory is inspected
- **THEN** there SHALL be no `openspec-gstack-autoplan`, `openspec-gstack-plan-ceo-review`, `openspec-gstack-plan-eng-review`, `openspec-gstack-plan-design-review`, `openspec-gstack-land-and-deploy`, `openspec-gstack-setup-deploy`, `openspec-gstack-canary`, `openspec-gstack-ship`, `openspec-gstack-retro`, or `openspec-gstack-document-release` directory remaining

### Requirement: No dangling references to removed skills
No live surface (`src/`, `skills/`, `docs/`, `skills/gstack/docs/AGENTS.md`) SHALL retain a dangling reference to any of the ten removed skills. Historical archives under `openspec/changes/archive/` are exempt.

#### Scenario: Whole-repo grep is clean
- **WHEN** the live surfaces are searched for `/autoplan`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/land-and-deploy`, `/setup-deploy`, `/canary`, `/document-release`, the `/ship` expert invocation, or the `/retro` expert delegation
- **THEN** no match SHALL remain outside historical archive directories
