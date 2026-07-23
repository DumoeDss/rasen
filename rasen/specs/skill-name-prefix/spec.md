# skill-name-prefix Specification

## Purpose
Standardize expert skill naming: every skill's `name` equals its `rasen-` dirName (unified hyphen form), with the metadata author field updated.
## Requirements
### Requirement: Metadata author field updated

All expert skill templates SHALL use `metadata.author: 'rasen'`.

#### Scenario: Generated SKILL.md has rasen author

- **WHEN** `rasen init` generates an expert skill SKILL.md
- **THEN** the YAML frontmatter SHALL contain `author: rasen`

### Requirement: Skill names use the rasen- hyphen form and match the skill directory

Every registered skill template (expert and workflow alike) SHALL have a `name` equal to its `rasen-<base-name>` directory name. The `name` field determines the identifier shown in Claude Code's slash-completion popup and the identifier that `pipelines/*.yaml` stages reference, so name and directory SHALL never diverge.

Representative mappings (the rule applies to every registered skill):
- `rasen:cso` → `rasen-cso`
- `rasen:qa-only` → `rasen-qa-only`
- `rasen:review` → `rasen-review`
- `rasen:office-hours` → `rasen-office-hours`

#### Scenario: Skill template name equals dirName

- **WHEN** any registered skill template is loaded from the workflow catalog
- **THEN** the template's `name` SHALL equal the registration's `dirName` (`rasen-<base-name>`)
- **AND** no registered skill SHALL carry a `rasen:<base-name>` colon-form name

#### Scenario: Generated SKILL.md frontmatter shows the invokable identifier

- **WHEN** `rasen init` or `rasen update` generates a SKILL.md for any skill
- **THEN** the YAML frontmatter `name:` field SHALL be the hyphen form `rasen-<base-name>`
- **AND** the slash-completion popup entry therefore SHALL match the identifier that invocation inserts

#### Scenario: Bundled pipeline stages reference the hyphen name

- **WHEN** a bundled `pipelines/*.yaml` stage references a skill
- **THEN** it SHALL use the `rasen-<base-name>` form (e.g., `skill: rasen-review`)
- **AND** no bundled stage SHALL reference a `rasen:<base-name>`, `openspec:<base-name>`, or `gstack:<base-name>` name

### Requirement: Legacy colon skill references resolve to hyphen names

Skill references written in the retired colon namespaces SHALL keep resolving: `rasen:<x>` and `openspec:<x>` identifiers found in user-authored pipelines or workflow-package skill requirements SHALL map to `rasen-<x>`, so pre-existing assets keep working and resume flows can print an actionable old→new hint.

#### Scenario: User pipeline authored with colon reference resumes with a hint

- **WHEN** `rasen pipeline resume` loads a project-local or user-override pipeline whose stage references `rasen:<x>` or `openspec:<x>`
- **THEN** the reference SHALL resolve to the `rasen-<x>` skill
- **AND** the user SHALL see an old→new mapping hint rather than a silent dispatch to an unknown skill

#### Scenario: Workflow package requiring a colon skill identity still protects its dependency

- **WHEN** a workflow package's skill requirements name a skill by its retired colon identity
- **THEN** the catalog SHALL resolve the requirement to the same workflow as the hyphen identity when recording dependency usage

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

