## MODIFIED Requirements

### Requirement: Every knowledge operation uses the same resolved owner

`rasen knowledge apply`, `list`, `show`, and `retire` SHALL use one shared
knowledge-owner resolution contract. A project-scoped operation SHALL require a
matching project owner, a store-scoped operation SHALL require one explicitly
resolved matching store owner, and a global operation SHALL use the global
owner. Human and JSON output SHALL identify typed canonical owner and
owner-resolution failures consistently. Existing valid version-1
project/global candidates SHALL remain accepted by the strict compatibility
parser, while store scope SHALL use the store-capable versioned contract.

#### Scenario: Apply and show agree on project ownership

- **WHEN** a user applies a project-scoped candidate and then shows its ID under the same resolved project
- **THEN** both commands address the same project owner and canonical project record

#### Scenario: Global operation does not borrow selected project ownership

- **WHEN** a global candidate is submitted together with an unrelated project or store owner selector
- **THEN** the CLI rejects the owner/scope mismatch before seeking global approval
- **AND** global and selected-owner state remain unchanged

#### Scenario: Store owner addresses store canonical state

- **WHEN** a user runs a store-scoped list, show, apply, or retire operation with one valid explicit store owner
- **THEN** the command addresses canonical state owned by that typed store
- **AND** does not coerce it into a project machine home or global storage

#### Scenario: Store owner requires store-capable candidate for mutation

- **WHEN** a version-1 project/global candidate is submitted as a store mutation
- **THEN** strict scope validation rejects the mismatch with store-capable-format guidance
- **AND** store state remains unchanged

#### Scenario: JSON ambiguity is actionable

- **WHEN** a non-interactive knowledge command cannot determine one authoritative owner
- **THEN** its JSON error includes a stable diagnostic code and typed selector guidance
- **AND** it does not prompt or choose an owner
