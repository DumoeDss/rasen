## ADDED Requirements

### Requirement: Retired command files are pruned on init and update

The command delivery surface is retired: Rasen no longer generates any command files. `rasen init` and `rasen update` SHALL remove every previously installed built-in rasen command file from each configured AI tool, unconditionally (no delivery setting gates the removal). Because the live command adapter registry and the workflow definitions' `command` field no longer exist, this prune SHALL key on a static, frozen list of the built-in command file identifiers and each tool's command file-path rules — modeled on the existing retired-identifier prunes — rather than any live registry or workflow definition. The prune SHALL cover the current file path, the legacy `-command`-suffixed variant, and the legacy `opsx`-prefixed variants (both the `commands/opsx/<id>.md` subdirectory form and the `opsx-<id>.md` hyphen form). The prune SHALL be scoped to exactly these known rasen command identifiers so it cannot remove a user-authored file, SHALL be idempotent (a no-op when no such file exists), and SHALL run so an install is healed even when nothing else needs updating.

#### Scenario: Existing command files removed on update

- **WHEN** `rasen update` runs in a project that still has installed rasen command files for a configured tool (for example `.claude/commands/rasen/apply.md`, `.cursor/commands/rasen-apply.md`)
- **THEN** every such built-in rasen command file SHALL be removed
- **AND** the count of removed command files SHALL be reported with a message stating commands have been consolidated into skills
- **AND** the tool's skill files SHALL remain installed

#### Scenario: Fresh init leaves no command files

- **WHEN** `rasen init` completes for a configured tool
- **THEN** only skill files SHALL be generated
- **AND** no rasen command file SHALL exist in the tool's command directory
- **AND** any pre-existing rasen command file in the target directory SHALL have been removed

#### Scenario: Legacy path variants are removed

- **WHEN** the prune runs against a tool that has a legacy `-command`-suffixed file or an `opsx`-prefixed command file (`commands/opsx/<id>.md` or `opsx-<id>.md`)
- **THEN** each legacy variant SHALL be removed
- **AND** the prune SHALL resolve these paths from the frozen static command-path knowledge, not from a live adapter registry

#### Scenario: User-authored files are never touched

- **WHEN** the prune runs in a project whose command directory also contains a non-rasen, user-authored command file
- **THEN** only files matching the known built-in rasen command identifiers SHALL be removed
- **AND** the user-authored file SHALL remain untouched

#### Scenario: No command files is a no-op

- **WHEN** `rasen init` or `rasen update` runs and no rasen command files exist for any configured tool
- **THEN** the prune SHALL complete without error and remove nothing
