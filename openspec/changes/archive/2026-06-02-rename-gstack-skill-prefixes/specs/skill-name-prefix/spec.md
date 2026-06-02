## ADDED Requirements

### Requirement: Expert skill names use gstack: prefix
All 28 gstack expert skill templates SHALL have their `name` field prefixed with `gstack:`. The `name` field in the returned `SkillTemplate` object determines the skill's slash command name in Claude Code.

The mapping:
- `browse` → `gstack:browse`
- `cso` → `gstack:cso`
- `qa` → `gstack:qa`
- `qa-only` → `gstack:qa-only`
- `review` → `gstack:review`
- `ship` → `gstack:ship`
- `retro` → `gstack:retro`
- `office-hours` → `gstack:office-hours`
- `autoplan` → `gstack:autoplan`
- `benchmark` → `gstack:benchmark`
- `canary` → `gstack:canary`
- `careful` → `gstack:careful`
- `codex` → `gstack:codex`
- `design-consultation` → `gstack:design-consultation`
- `design-review` → `gstack:design-review`
- `document-release` → `gstack:document-release`
- `freeze` → `gstack:freeze`
- `unfreeze` → `gstack:unfreeze`
- `guard` → `gstack:guard`
- `investigate` → `gstack:investigate`
- `land-and-deploy` → `gstack:land-and-deploy`
- `plan-ceo-review` → `gstack:plan-ceo-review`
- `plan-design-review` → `gstack:plan-design-review`
- `plan-eng-review` → `gstack:plan-eng-review`
- `setup-browser-cookies` → `gstack:setup-browser-cookies`
- `setup-deploy` → `gstack:setup-deploy`
- `gstack-upgrade` → `gstack:upgrade`
- `browse` (root SKILL.md if exists) → `gstack:browse`

#### Scenario: Expert skill template returns prefixed name
- **WHEN** any expert skill template function (e.g., `getBrowseSkillTemplate()`) is called
- **THEN** the returned `SkillTemplate.name` field SHALL be `gstack:<base-name>` (e.g., `gstack:browse`)

#### Scenario: gstack-upgrade drops redundant prefix
- **WHEN** `getGstackUpgradeSkillTemplate()` is called
- **THEN** the returned name SHALL be `gstack:upgrade` (not `gstack:gstack-upgrade`)

#### Scenario: Generated SKILL.md frontmatter contains prefixed name
- **WHEN** `openspec init` generates a SKILL.md for an expert skill
- **THEN** the YAML frontmatter `name:` field SHALL be `gstack:<base-name>`

### Requirement: Expert skill dirNames use openspec-gstack- prefix
All 28 expert skill registrations in `getSkillTemplates()` SHALL use `openspec-gstack-<base-name>` as the `dirName` value.

The mapping:
- `openspec-browse` → `openspec-gstack-browse`
- `openspec-cso` → `openspec-gstack-cso`
- `openspec-gstack-upgrade` → `openspec-gstack-upgrade` (unchanged)
- All other skills: `openspec-<name>` → `openspec-gstack-<name>`

#### Scenario: Skill directory created with gstack prefix
- **WHEN** `openspec init` generates expert skill directories
- **THEN** the directories SHALL be named `openspec-gstack-<base-name>` under the tool's skills directory (e.g., `.claude/skills/openspec-gstack-browse/SKILL.md`)

#### Scenario: Cross-platform directory naming
- **WHEN** running on Windows, macOS, or Linux
- **THEN** the dirName SHALL NOT contain characters invalid for directory names (no `:`, `/`, `\`, `*`, `?`, `"`, `<`, `>`, `|`)

### Requirement: Metadata author field updated
All 28 expert skill templates SHALL use `metadata.author: 'openspec'` instead of `metadata.author: 'gstack'`.

#### Scenario: Generated SKILL.md has openspec author
- **WHEN** `openspec init` generates an expert skill SKILL.md
- **THEN** the YAML frontmatter SHALL contain `author: openspec`
