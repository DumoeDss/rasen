# skill-authoring-guide Specification

## Purpose
TBD - created by archiving change phase0c-grill-add. Update Purpose after archive.
## Requirements
### Requirement: Skill authoring guide added as a repository doc
The system SHALL add `docs/skill-authoring.md`, a repository document (not an installable skill) adapted from the grill `writing-great-skills` source (SKILL.md + GLOSSARY.md, MIT, Matt Pocock). It SHALL capture the skill-writing standard: leading-words, checkable completion criteria, the failure-mode clinic, and no-op deletion. It SHALL NOT be registered as an expert template and SHALL NOT affect skill counts.

#### Scenario: Guide exists at docs path
- **WHEN** the source tree is inspected
- **THEN** `docs/skill-authoring.md` SHALL exist

#### Scenario: Guide is not an installable skill
- **WHEN** `getSkillTemplates()` is called
- **THEN** it SHALL NOT include an entry for a skill-authoring skill
- **AND** no `skills/gstack/skill-authoring/` directory SHALL exist

#### Scenario: Guide carries MIT attribution
- **WHEN** `docs/skill-authoring.md` is inspected
- **THEN** it SHALL contain an attribution NOTICE referencing `mattpocock/skills` and `MIT`

