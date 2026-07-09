## MODIFIED Requirements

### Requirement: Brand namespace identifiers
The product SHALL own a complete rasen namespace across every user-visible identifier: the workspace directory SHALL be `rasen/`, the slash-command prefix SHALL be `rasen:` (hyphen form `rasen-` for tools without colon support), and skill directories SHALL use the `rasen-` prefix. Schema identifiers (e.g., `spec-driven`) SHALL be unchanged. The legacy marker pair `<!-- OPENSPEC:START -->` / `<!-- OPENSPEC:END -->` SHALL remain recognized solely for identifying legacy artifacts, and SHALL NOT be written into newly generated content.

#### Scenario: Workspace directory is rasen
- **WHEN** a user initializes a new project with `rasen init`
- **THEN** the workspace directory created is `rasen/`
- **AND** no `openspec/` directory is created

#### Scenario: Slash-command prefix is rasen
- **WHEN** generated command files are produced
- **THEN** their command identifiers use the `rasen:` prefix (or `rasen-` in hyphen-syntax tools)
- **AND** no generated identifier uses the `opsx` prefix

#### Scenario: No namespace collision with upstream OpenSpec
- **WHEN** a project also has upstream OpenSpec installed (its `openspec/` workspace, `/opsx:*` commands, `openspec-*` skills)
- **THEN** every path and identifier rasen generates is distinct from the upstream set
- **AND** neither tool overwrites the other's files

#### Scenario: Shell-completion profile markers use the current brand
- **WHEN** the bash, zsh, or PowerShell completion installer configures a shell profile that has no existing managed block
- **THEN** it writes a `RASEN`-branded marker pair (e.g. `# RASEN:START` / `# RASEN:END`) around the managed block, not the legacy `OPENSPEC` marker pair

#### Scenario: Shell-completion profile upgrade replaces a legacy marker block
- **WHEN** the bash, zsh, or PowerShell completion installer configures a shell profile that already contains a legacy `# OPENSPEC:START` / `# OPENSPEC:END` block from an older install
- **THEN** it replaces that block in place with the current `RASEN`-branded marker pair
- **AND** the profile ends up with exactly one managed block, not two

#### Scenario: Shell-completion uninstall removes either marker family
- **WHEN** a user uninstalls shell completions
- **AND** the shell profile contains a managed block under either the legacy `OPENSPEC` marker pair or the current `RASEN` marker pair
- **THEN** the installer removes that block regardless of which marker family it used
