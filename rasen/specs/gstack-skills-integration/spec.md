# gstack-skills-integration Specification

## Purpose
Integrate the expert skills into Rasen — their inline TypeScript template source, sidecar directory, registry entries, and installation via `rasen init`.
## Requirements
### Requirement: Skill Source Directory

The system SHALL maintain a `skills/experts/` directory at the project package root containing, for each expert skill that has them, only its sidecar reference files (`.md` other than `SKILL.md`, and `.sh`). The complete skill prompt for each expert SHALL be an inline TypeScript template string in `src/core/templates/experts/<name>.ts`, not a `SKILL.md.tmpl` source or a generated `SKILL.md` build product.

#### Scenario: Expert source directory exists at package root

- **WHEN** the Rasen package source tree is inspected
- **THEN** a `skills/experts/` directory exists containing sidecar subdirectories for the experts that carry sidecar files

#### Scenario: No SKILL.md or template under the source directory

- **WHEN** a skill subdirectory such as `skills/experts/review/` is inspected
- **THEN** it SHALL NOT contain a `SKILL.md` or a `SKILL.md.tmpl` file
- **AND** it SHALL contain only sidecar reference files (e.g. `checklist.md`)

#### Scenario: Complete prompt lives in the TypeScript template

- **WHEN** the source of an expert skill originally named `review` is located
- **THEN** its complete prompt SHALL be the inline template string in `src/core/templates/experts/review.ts`

### Requirement: TypeScript Template Functions
The system SHALL provide TypeScript template functions in `src/core/templates/experts/` that return `SkillTemplate` objects for each expert skill, using the same interface as existing workflow templates.

#### Scenario: Expert template function returns SkillTemplate
- **WHEN** `getReviewSkillTemplate()` is called
- **THEN** it returns a `SkillTemplate` with `name`, `description`, `instructions`, and `metadata` fields

#### Scenario: Expert templates parallel workflow templates
- **WHEN** `src/core/templates/experts/` is inspected
- **THEN** it contains one `.ts` file per expert skill, following the same pattern as `src/core/templates/workflows/`

#### Scenario: Expert templates exported from skill-templates
- **WHEN** `src/core/templates/skill-templates.ts` is imported
- **THEN** it exports both workflow templates and expert templates

### Requirement: Skill Registry Extension
The system SHALL register all expert skills in the `getSkillTemplates()` function in `src/core/shared/skill-generation.ts`, using the existing `SkillTemplateEntry` format.

#### Scenario: Expert skills registered in getSkillTemplates
- **WHEN** `getSkillTemplates()` is called without a workflow filter
- **THEN** the returned array includes entries for all expert skills with dirName pattern `rasen-<skill-name>`

#### Scenario: Expert skills not filtered by workflowFilter
- **WHEN** `getSkillTemplates(['propose', 'apply'])` is called with a workflow filter
- **THEN** the returned array includes all expert skill entries regardless of the filter (expert skills are always installed)

#### Scenario: Expert skill entry format
- **WHEN** an expert skill entry is inspected
- **THEN** it has `template` (SkillTemplate), `dirName` (string starting with `rasen-`), and `workflowId` (string matching the skill name)

### Requirement: Installation via rasen init
The system SHALL install expert skill SKILL.md files to target AI tool directories during `rasen init`, alongside existing workflow skills.

#### Scenario: Init generates expert skill files
- **WHEN** `rasen init` is run and Claude Code is selected
- **THEN** SKILL.md files for all expert skills are generated in `.claude/skills/rasen-<skill-name>/SKILL.md`

#### Scenario: Init without skills directory still succeeds
- **WHEN** `rasen init` is run and the `skills/` source directory is empty
- **THEN** init succeeds, generating only workflow skill files

#### Scenario: Update regenerates expert skills
- **WHEN** `rasen update` is run
- **THEN** expert skill SKILL.md files are regenerated alongside workflow skill files

### Requirement: Path References Updated
All migrated skill files SHALL have path references updated from gstack conventions to OpenSpec conventions.

#### Scenario: Home directory paths updated
- **WHEN** a migrated skill file originally contained `~/.gstack/`
- **THEN** the migrated file contains `~/.openspec/`

#### Scenario: Project directory paths updated
- **WHEN** a migrated skill file originally contained `.gstack/`
- **THEN** the migrated file contains `.openspec/`

#### Scenario: Non-path content preserved
- **WHEN** a migrated skill file contains text that is not a path reference
- **THEN** that text is preserved unchanged

