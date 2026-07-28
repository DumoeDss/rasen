# Delta: workflow-library

## ADDED Requirements

### Requirement: Workflow registry scan ignores OS metadata entries

The user workflow library scan SHALL silently skip directory entries that are operating-system metadata: entries whose name begins with `.`, and entries whose case-insensitive name is `Thumbs.db` or `desktop.ini`. Skipped entries SHALL NOT appear as workflows or invalid records in any output. Every other non-directory entry and every invalid workflow directory SHALL continue to be reported as an invalid record. The same exclusion SHALL apply when a workflow source tree is loaded for validation, packaging, digest computation, or export, so OS metadata files are never embedded in a workflow's file set or `.rasenpkg`.

#### Scenario: Finder metadata does not appear in the list

- **WHEN** the user workflow library contains a `.DS_Store` file
- **AND** the user runs `rasen workflow list`, with or without `--json`
- **THEN** no `.DS_Store` entry SHALL appear as a workflow or as an invalid record

#### Scenario: A stray non-hidden file is still reported

- **WHEN** the user workflow library contains a regular file `notes.txt`
- **THEN** the scan SHALL report it as an invalid record stating that registry entries must be directories

#### Scenario: Metadata inside a workflow directory is not packaged

- **WHEN** a workflow source directory contains a `.DS_Store` file
- **AND** the workflow is validated and exported
- **THEN** the workflow's file set, digest, and exported package SHALL NOT include the metadata file

### Requirement: User workflows may declare skill presentation metadata

The `workflow.yaml` manifest MAY declare a `skill:` block carrying presentation metadata for the workflow's skill surface: a required `name` — the human-readable display title — and optional `category` and `tags`. Each value SHALL satisfy the same single-line frontmatter constraints as other manifest scalars. The block SHALL NOT carry an `enabled` field — the skill surface is always delivered — and strict validation SHALL reject unknown fields inside the block. Declaring the block SHALL NOT require a manifest version bump and SHALL NOT introduce a digest input beyond the manifest file content itself.

When a user workflow declares a display title, human-facing pickers SHALL present the title in place of the skill name, in the author's original language and never translated. `rasen workflow list --json` and `rasen workflow show` SHALL expose the title as a stable machine field, with title-less workflows distinguishable. A workflow without the block SHALL continue to present its skill name. A manifest MAY carry both a legacy `command:` block — which remains ignored per "Workflow definitions carry no command surface" — and a `skill:` block, which is honored; the ignored-command warning SHALL direct authors to `skill:`.

#### Scenario: Picker shows the declared title

- **WHEN** a user workflow's manifest declares `skill.name: Example Local Verify`
- **AND** the profile picker displays that workflow
- **THEN** the row SHALL present `Example Local Verify` as the display name, untranslated under every CLI locale
- **AND** the stored selection value SHALL remain the workflow id

#### Scenario: Absent title falls back to the skill name

- **WHEN** a user workflow's manifest declares no `skill:` block
- **THEN** pickers SHALL present the workflow's skill name

#### Scenario: An enabled field is rejected

- **WHEN** a manifest declares `skill.enabled`
- **THEN** strict validation SHALL reject the manifest with a schema error

#### Scenario: Legacy command block coexists with the skill block

- **WHEN** a manifest declares both a `command:` block and a `skill:` block
- **THEN** installation SHALL succeed
- **AND** the command content SHALL be ignored with a warning that recommends `skill:`
- **AND** the declared skill title SHALL be honored

#### Scenario: JSON exposes the title verbatim

- **WHEN** `rasen workflow list --json` runs under any supported CLI locale
- **THEN** each entry with a declared title SHALL carry it verbatim
- **AND** entries without a declared title SHALL be distinguishable from titled entries

## MODIFIED Requirements

### Requirement: Workflow list groups by kind and hides internal workflows by default

The human-readable `rasen workflow list` output SHALL group workflows by kind, presenting the `task` and `driver` groups under localized headings, and SHALL hide `internal` workflows by default. A `--all` flag SHALL additionally reveal the `internal` group; `--all` SHALL affect only the human-readable output. Group headings SHALL be Rasen-owned localized presentation, not translations of user-authored content. Within the human-readable output, the workflow id and source-label columns SHALL be padded with spaces so every row across all rendered groups and invalid records aligns vertically, and column separation SHALL NOT rely on tab characters.

#### Scenario: Default list hides internal sub-units

- **WHEN** a user runs `rasen workflow list` without `--all`
- **THEN** the output SHALL present the task and driver groups under localized headings
- **AND** the internal goal sub-units SHALL NOT appear

#### Scenario: List with --all reveals internal group

- **WHEN** a user runs `rasen workflow list --all`
- **THEN** the internal group SHALL additionally appear under its localized heading

#### Scenario: Rows align across mixed id lengths

- **WHEN** `rasen workflow list` renders workflows whose ids differ in length (for example `new` and `verify-enhanced-command`)
- **THEN** each column SHALL begin at the same display position on every row
- **AND** the human-readable output SHALL contain no tab characters
