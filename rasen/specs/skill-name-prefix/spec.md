# skill-name-prefix Specification

## Purpose
Standardize expert skill naming: every skill's `name` equals its `rasen-` dirName (unified hyphen form), with the metadata author field updated.
## Requirements
### Requirement: Metadata author field updated

All expert skill templates SHALL use `metadata.author: 'rasen'`.

#### Scenario: Generated SKILL.md has rasen author

- **WHEN** `rasen init` generates an expert skill SKILL.md
- **THEN** the YAML frontmatter SHALL contain `author: rasen`

### Requirement: Expert skill names use rasen: prefix

All expert skill templates SHALL have their `name` field prefixed with `rasen:`. The `name` field in the returned `SkillTemplate` object determines the skill's slash command name in Claude Code and the identifier that `pipelines/*.yaml` stages reference.

Representative mappings (the rule applies to every registered expert skill):
- `browse` → `rasen:browse`
- `cso` → `rasen:cso`
- `qa-only` → `rasen:qa-only`
- `review` → `rasen:review`
- `codebase-design` → `rasen:codebase-design`
- `design-consultation` → `rasen:design-consultation`

#### Scenario: Expert skill template returns prefixed name

- **WHEN** any expert skill template function (e.g., `getBrowseSkillTemplate()`) is called
- **THEN** the returned `SkillTemplate.name` field SHALL be `rasen:<base-name>` (e.g., `rasen:browse`)

#### Scenario: Generated SKILL.md frontmatter contains prefixed name

- **WHEN** `rasen init` generates a SKILL.md for an expert skill
- **THEN** the YAML frontmatter `name:` field SHALL be `rasen:<base-name>`

#### Scenario: Pipeline stages reference the prefixed name

- **WHEN** a `pipelines/*.yaml` stage references an expert skill
- **THEN** it SHALL use the `rasen:<base-name>` form (e.g., `skill: rasen:review`)
- **AND** no stage SHALL reference an `openspec:<base-name>` or `gstack:<base-name>` name

### Requirement: Expert skill dirNames use rasen- prefix

All expert skill registrations in `getSkillTemplates()` SHALL use `rasen-<base-name>` as the `dirName` value. Workflow skill directories SHALL likewise use the `rasen-` prefix, and names that previously carried a double brand segment SHALL collapse to a single one (e.g., `openspec-opsx-ship` → `rasen-ship`, not `rasen-opsx-ship`).

Representative mappings (the rule applies to every registered skill):
- `openspec-browse` → `rasen-browse`
- `openspec-explore` → `rasen-explore`
- `openspec-opsx-ship` → `rasen-ship`
- `openspec-opsx-office-hours` → `rasen-office-hours`

#### Scenario: Skill directory created with rasen prefix

- **WHEN** `rasen init` generates skill directories
- **THEN** the directories SHALL be named `rasen-<base-name>` under the tool's skills directory (e.g., `.claude/skills/rasen-browse/SKILL.md`)
- **AND** no `openspec-<base-name>` or `rasen-opsx-<base-name>` directory SHALL be created

#### Scenario: Cross-platform directory naming

- **WHEN** running on Windows, macOS, or Linux
- **THEN** the dirName SHALL NOT contain characters invalid for directory names (no `:`, `/`, `\`, `*`, `?`, `"`, `<`, `>`, `|`)

