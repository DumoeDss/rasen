## ADDED Requirements

### Requirement: Archive listing endpoint reports a space's archived changes

The management server SHALL expose a read-only endpoint that, given a planning space, lists that space's archived changes — the same sticky-union of the in-repo archive directory and the project's machine-home archive that the workflow's archived-change enumeration reports. For each archived change it SHALL report the un-dated change name, the archive date, the portfolio container it belongs to (by the same longest-prefix container rule the changes listing uses), and its task-checkbox progress. The endpoint SHALL be authenticated and space-addressed exactly like the changes listing — an explicit space selector resolves through the machine registries and an omitted selector falls back to the launch project, with no resolvable project rejected the same way the changes listing rejects it — and SHALL be strictly read-only: it creates no directory, mints no identity, and writes no file. A space with no archived changes SHALL yield an empty listing, not an error.

#### Scenario: Archived changes listed with date and portfolio membership

- **WHEN** a client requests the archive listing for a space that has archived changes, some of which belong to a portfolio container
- **THEN** the response lists each archived change with its un-dated name, its archive date, its task-checkbox progress, and — for changes under a container — the container name, matching the workflow's archived-change enumeration

#### Scenario: Both archive locations are unioned

- **WHEN** a space has changes archived both in its in-repo archive directory and in its machine-home archive
- **THEN** the listing reports the union of both, de-duplicated by name, regardless of which destination the current config selects

#### Scenario: Empty archive yields an empty listing

- **WHEN** a client requests the archive listing for a space that has no archived changes
- **THEN** the response is an empty listing rather than an error

#### Scenario: Space addressing matches the changes listing

- **WHEN** the archive listing is requested with an explicit space selector, and separately with none
- **THEN** an explicit selector resolves the space through the machine registries and an omitted selector falls back to the launch project, identically to the changes listing, and an unresolvable space is rejected the same way

#### Scenario: The endpoint never writes

- **WHEN** the archive listing serves any request
- **THEN** it performs only reads — no change directory, archive entry, run-state file, or identity is created or modified as a side effect
