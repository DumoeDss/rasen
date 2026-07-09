# skill-name-prefix Specification

## Purpose
Standardize expert skill naming: `openspec:` skill names and `openspec-` dirNames, with the metadata author field updated.
## Requirements
### Requirement: Metadata author field updated

All expert skill templates SHALL use `metadata.author: 'openspec'` instead of `metadata.author: 'gstack'`.

#### Scenario: Generated SKILL.md has openspec author

- **WHEN** `openspec init` generates an expert skill SKILL.md
- **THEN** the YAML frontmatter SHALL contain `author: openspec`

### Requirement: Expert skill names use openspec: prefix

All expert skill templates SHALL have their `name` field prefixed with `openspec:`. The `name` field in the returned `SkillTemplate` object determines the skill's slash command name in Claude Code and the identifier that `pipelines/*.yaml` stages reference.

Representative mappings (the rule applies to every registered expert skill):
- `browse` → `openspec:browse`
- `cso` → `openspec:cso`
- `qa-only` → `openspec:qa-only`
- `review` → `openspec:review`
- `codebase-design` → `openspec:codebase-design`
- `design-consultation` → `openspec:design-consultation`

#### Scenario: Expert skill template returns prefixed name

- **WHEN** any expert skill template function (e.g., `getBrowseSkillTemplate()`) is called
- **THEN** the returned `SkillTemplate.name` field SHALL be `openspec:<base-name>` (e.g., `openspec:browse`)

#### Scenario: Generated SKILL.md frontmatter contains prefixed name

- **WHEN** `openspec init` generates a SKILL.md for an expert skill
- **THEN** the YAML frontmatter `name:` field SHALL be `openspec:<base-name>`

#### Scenario: Pipeline stages reference the prefixed name

- **WHEN** a `pipelines/*.yaml` stage references an expert skill
- **THEN** it SHALL use the `openspec:<base-name>` form (e.g., `skill: openspec:review`)
- **AND** no stage SHALL reference a `gstack:<base-name>` name

### Requirement: Expert skill dirNames use openspec- prefix

All expert skill registrations in `getSkillTemplates()` SHALL use `openspec-<base-name>` as the `dirName` value (the `gstack` brand segment removed).

Representative mappings (the rule applies to every registered expert skill):
- `openspec-gstack-browse` → `openspec-browse`
- `openspec-gstack-cso` → `openspec-cso`
- All other expert skills: `openspec-gstack-<name>` → `openspec-<name>`

#### Scenario: Skill directory created without gstack segment

- **WHEN** `openspec init` generates expert skill directories
- **THEN** the directories SHALL be named `openspec-<base-name>` under the tool's skills directory (e.g., `.claude/skills/openspec-browse/SKILL.md`)
- **AND** no `openspec-gstack-<base-name>` directory SHALL be created

#### Scenario: Cross-platform directory naming

- **WHEN** running on Windows, macOS, or Linux
- **THEN** the dirName SHALL NOT contain characters invalid for directory names (no `:`, `/`, `\`, `*`, `?`, `"`, `<`, `>`, `|`)

