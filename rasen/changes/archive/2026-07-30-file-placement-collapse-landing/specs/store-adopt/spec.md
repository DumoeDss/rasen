## MODIFIED Requirements

### Requirement: Archive handling is an explicit choice on adopt

Adopt SHALL accept `--archive move|leave` (default `move`): `move` migrates the existing archive into the store with everything else; `leave` keeps it in the source repo. `--archive external` SHALL be rejected with an error explaining that the external archive destination is retired (`archive-destination` capability) and that archives always land in a planning root — the source repo's or the store's. Adopt SHALL NOT write an `archive.destination` configuration value under any mode, and SHALL NOT move archived changes to the machine home.

#### Scenario: Default moves the archive

- **WHEN** the user runs adopt without `--archive`
- **THEN** the repo's archived changes appear under the store's archive location

#### Scenario: External archive on adopt

- **WHEN** the user passes `--archive external`
- **THEN** the command exits with an error explaining that the external destination is retired
- **AND** no archived change is moved to the machine home and no `archive.destination` value is written to the config
