## ADDED Requirements

### Requirement: Filename Completion Scope in Fish

The Fish completion script SHALL offer local filesystem paths only at argument positions where a path is a valid value, and SHALL NOT offer them at the command position or at non-path argument positions.

Fish completes filenames by default whenever no other completion applies. Rasen's Fish script SHALL suppress that default for the `rasen` command and re-enable filename completion explicitly only for arguments whose type is a filesystem path (the optional `path` argument accepted by `init`, `update`, and `migrate`). This behavior is Fish-specific; Zsh, Bash, and PowerShell already scope filename completion to path arguments and are unchanged.

#### Scenario: Command position offers only subcommands

- **WHEN** the user types `rasen ` and requests completion in Fish
- **THEN** the suggestions SHALL be Rasen subcommands (with descriptions)
- **AND** local files and directories in the current working directory SHALL NOT appear

#### Scenario: Non-path argument position does not offer local paths

- **WHEN** the user requests completion for an argument that accepts a change id, spec id, schema name, profile name, workflow id, or shell name (for example `rasen show `)
- **THEN** the suggestions SHALL be the dynamic values for that argument type
- **AND** local files and directories SHALL NOT be added to those suggestions

#### Scenario: Path argument still completes files

- **WHEN** the user requests completion for a command that accepts a filesystem path argument (`rasen init `, `rasen update `, or `rasen migrate `)
- **THEN** Fish SHALL complete local files and directories for that argument
