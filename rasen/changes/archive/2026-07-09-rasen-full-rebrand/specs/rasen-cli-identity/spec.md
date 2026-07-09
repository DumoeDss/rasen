## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Preserved workspace and ecosystem identifiers
**Reason**: The carve-out that kept the `openspec/` workspace directory and `opsx:` command prefix unchanged is reversed — sharing those identifiers with upstream OpenSpec makes side-by-side installation impossible and forced the README to demand uninstalling upstream.
**Migration**: The workspace directory becomes `rasen/` (legacy `openspec/` workspaces migrate via `rasen migrate`, copy-only — see `workspace-migration`), the command prefix becomes `rasen:`, and skill directories become `rasen-*`. Marker constants remain only as legacy-detection identifiers.
