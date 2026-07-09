## MODIFIED Requirements

### Requirement: Expert skill names use gstack: prefix
All gstack expert skill templates SHALL have their `name` field prefixed with `gstack:`. The `name` field in the returned `SkillTemplate` object determines the skill's slash command name in Claude Code.

Representative mappings (the rule applies to every registered expert skill):
- `browse` → `gstack:browse`
- `cso` → `gstack:cso`
- `qa-only` → `gstack:qa-only`
- `review` → `gstack:review`
- `codebase-design` → `gstack:codebase-design`
- `design-consultation` → `gstack:design-consultation`

#### Scenario: Expert skill template returns prefixed name
- **WHEN** any expert skill template function (e.g., `getBrowseSkillTemplate()`) is called
- **THEN** the returned `SkillTemplate.name` field SHALL be `gstack:<base-name>` (e.g., `gstack:browse`)

#### Scenario: Generated SKILL.md frontmatter contains prefixed name
- **WHEN** `openspec init` generates a SKILL.md for an expert skill
- **THEN** the YAML frontmatter `name:` field SHALL be `gstack:<base-name>`

### Requirement: Expert skill dirNames use openspec-gstack- prefix
All expert skill registrations in `getSkillTemplates()` SHALL use `openspec-gstack-<base-name>` as the `dirName` value.

Representative mappings (the rule applies to every registered expert skill):
- `openspec-browse` → `openspec-gstack-browse`
- `openspec-cso` → `openspec-gstack-cso`
- All other expert skills: `openspec-<name>` → `openspec-gstack-<name>`

#### Scenario: Skill directory created with gstack prefix
- **WHEN** `openspec init` generates expert skill directories
- **THEN** the directories SHALL be named `openspec-gstack-<base-name>` under the tool's skills directory (e.g., `.claude/skills/openspec-gstack-browse/SKILL.md`)

#### Scenario: Cross-platform directory naming
- **WHEN** running on Windows, macOS, or Linux
- **THEN** the dirName SHALL NOT contain characters invalid for directory names (no `:`, `/`, `\`, `*`, `?`, `"`, `<`, `>`, `|`)

### Requirement: Metadata author field updated
All expert skill templates SHALL use `metadata.author: 'openspec'` instead of `metadata.author: 'gstack'`.

#### Scenario: Generated SKILL.md has openspec author
- **WHEN** `openspec init` generates an expert skill SKILL.md
- **THEN** the YAML frontmatter SHALL contain `author: openspec`
