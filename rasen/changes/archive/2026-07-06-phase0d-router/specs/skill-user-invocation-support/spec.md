## ADDED Requirements

### Requirement: SkillTemplate can declare user-invocation
The `SkillTemplate` type SHALL gain an optional `disableModelInvocation?: boolean` field, and `generateSkillContent` SHALL emit `disable-model-invocation: true` in the generated skill frontmatter when that field is set, and omit the line otherwise. This is the mechanism by which a skill is installed user-invoked (per `docs/skill-authoring.md`), which the fixed-frontmatter generation path previously could not express.

#### Scenario: Flag set emits the frontmatter line
- **WHEN** `generateSkillContent` is called with a template whose `disableModelInvocation` is `true`
- **THEN** the generated content frontmatter SHALL contain `disable-model-invocation: true`

#### Scenario: Flag unset omits the line
- **WHEN** `generateSkillContent` is called with a template whose `disableModelInvocation` is unset or `false`
- **THEN** the generated content frontmatter SHALL NOT contain `disable-model-invocation`
- **AND** all existing skills' generated frontmatter SHALL be unchanged

#### Scenario: Existing frontmatter fields preserved
- **WHEN** `generateSkillContent` emits frontmatter with the flag set
- **THEN** it SHALL still emit `name`, `description`, `license`, `compatibility`, and `metadata` as before
