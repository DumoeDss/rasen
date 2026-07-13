# List Command Specification (delta)

## ADDED Requirements

### Requirement: Detailed listing with --long
The command SHALL accept a `--long` flag that enriches the listing with each item's title and its counts, porting the capability previously offered only by the retired `rasen change list --long` / `rasen spec list --long` noun commands.

#### Scenario: Detailed change listing
- **WHEN** `rasen list --long` is executed
- **THEN** for each active change, display its id together with its title and delta/spec counts
- **AND** without `--long`, list change ids and task progress only (existing default behavior)

#### Scenario: Detailed spec listing
- **WHEN** `rasen list --specs --long` is executed
- **THEN** for each spec, display its id together with its title and requirement count
- **AND** without `--long`, list spec ids and requirement counts only (existing default behavior)

#### Scenario: Long flag is orthogonal to JSON
- **WHEN** `rasen list --long --json` is executed
- **THEN** the JSON payload is unchanged (it already carries titles and counts)
- **AND** `--long` affects only the human-readable text rendering
