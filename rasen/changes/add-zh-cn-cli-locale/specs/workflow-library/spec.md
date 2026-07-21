## MODIFIED Requirements

### Requirement: CLI locale does not rewrite user-authored workflow content

Rasen SHALL treat user-authored workflow content as a single source authored in the user's chosen language. Locale resolution SHALL apply only to Rasen-owned presentation and SHALL NOT translate, replace, or select locale variants for user-authored workflow content.

User-authored content includes the `SKILL.md` frontmatter, description, instructions, sidecars, and `workflow.yaml` command metadata. Existing tool-adapter and configuration transformations that are unrelated to locale remain permitted.

#### Scenario: Switching the CLI locale preserves user-authored content

- **WHEN** a valid user workflow is installed with a user-authored name, description, instructions, command metadata, or sidecar content
- **AND** the resolved CLI locale changes among English, Japanese, and Simplified Chinese
- **THEN** Rasen-owned labels, prompts, results, and diagnostics SHALL use the resolved locale
- **AND** every user-authored workflow value SHALL remain in its original language
- **AND** generated skill and command artifacts SHALL NOT change solely because the CLI locale changed

#### Scenario: User workflow package round-trip preserves authored language

- **WHEN** a user workflow is exported and imported through a workflow or profile package
- **THEN** its user-authored content SHALL be preserved without translation or locale-based substitution
- **AND** package identity and digest calculation SHALL NOT depend on the importing machine's CLI locale

#### Scenario: Initial schema rejects locale variants

- **WHEN** a user workflow declares an unsupported `locales` field or locale-specific file mapping in `workflow.yaml` or `SKILL.md` frontmatter
- **THEN** strict workflow validation SHALL reject the unknown field
- **AND** Rasen SHALL NOT silently select, merge, or ignore a locale variant

### Requirement: Rasen-owned workflow presentation is localized

Rasen SHALL localize its own workflow-library help, option descriptions, prompts, result text, diagnostics, source labels, and built-in workflow presentation metadata through the English, Japanese, and Simplified Chinese locale catalogs.

#### Scenario: User workflow appears in a localized picker

- **WHEN** a user workflow is displayed in the profile picker under any supported CLI locale
- **THEN** the picker prompt, instructions, dependency messages, and user-source label SHALL use the resolved CLI locale
- **AND** the workflow's user-authored name and description SHALL be presented without translation
- **AND** the picker MAY apply the bounded display-only truncation defined by the `profiles` specification without modifying the authored source

#### Scenario: Workflow machine output remains locale-neutral

- **WHEN** a workflow library command emits JSON under English, Japanese, or Simplified Chinese
- **THEN** field names, IDs, source and kind enum values, paths, digests, diagnostic codes, and user-authored values SHALL be identical across locales
