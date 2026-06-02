# gstack-skills-integration Specification

## Purpose
Integrate the gstack expert skills into OpenSpec — their source directory, TypeScript template functions, registry entries, and installation via `openspec init`.

## Requirements
### Requirement: Skill Source Directory
The system SHALL maintain a `skills/` directory at the project package root containing SKILL.md.tmpl source files and generated SKILL.md files for each expert skill.

#### Scenario: Skills directory exists at package root
- **WHEN** the OpenSpec package source tree is inspected
- **THEN** a `skills/` directory exists containing subdirectories for each expert skill

#### Scenario: Each skill subdirectory has SKILL.md
- **WHEN** a skill subdirectory such as `skills/review/` is inspected
- **THEN** it contains at minimum a `SKILL.md` file with the complete skill prompt

#### Scenario: Gstack skill directory names preserved
- **WHEN** a gstack skill originally named `review` is migrated
- **THEN** it appears as `skills/review/` in the OpenSpec source tree

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
- **THEN** the returned array includes entries for all expert skills with dirName pattern `openspec-<skill-name>`

#### Scenario: Expert skills not filtered by workflowFilter
- **WHEN** `getSkillTemplates(['propose', 'apply'])` is called with a workflow filter
- **THEN** the returned array includes all expert skill entries regardless of the filter (expert skills are always installed)

#### Scenario: Expert skill entry format
- **WHEN** an expert skill entry is inspected
- **THEN** it has `template` (SkillTemplate), `dirName` (string starting with `openspec-`), and `workflowId` (string matching the skill name)

### Requirement: Installation via openspec init
The system SHALL install expert skill SKILL.md files to target AI tool directories during `openspec init`, alongside existing workflow skills.

#### Scenario: Init generates expert skill files
- **WHEN** `openspec init` is run and Claude Code is selected
- **THEN** SKILL.md files for all expert skills are generated in `.claude/skills/openspec-<skill-name>/SKILL.md`

#### Scenario: Init without skills directory still succeeds
- **WHEN** `openspec init` is run and the `skills/` source directory is empty
- **THEN** init succeeds, generating only workflow skill files

#### Scenario: Update regenerates expert skills
- **WHEN** `openspec update` is run
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

