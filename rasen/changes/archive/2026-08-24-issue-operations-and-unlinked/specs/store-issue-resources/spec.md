# store-issue-resources Delta — issue-operations-and-unlinked

## ADDED Requirements

### Requirement: Plan publication may compare and publish under the Issue lock

A plan publication SHALL accept an optional latest revision the caller observed, including `null`
for no revision. When supplied, the Store Issue mutation SHALL compare that expectation with the actual
latest ordinal while holding the same Issue lock that serializes the publication, and SHALL publish
only when they match. A mismatch SHALL be a named conflict and SHALL write no file. Omitting the
expectation SHALL preserve the existing command-line and internal-caller behavior of allocating the
next revision without a comparison.

#### Scenario: Matching current revision publishes

- **WHEN** a publication expects the actual latest revision
- **THEN** the next immutable revision is written with the expected revision as its predecessor

#### Scenario: No-plan expectation publishes the first revision

- **WHEN** a publication expects no revision and the Issue has no plan
- **THEN** revision `0001` is published with no predecessor

#### Scenario: Concurrent publication makes the stale writer fail

- **WHEN** two callers base replacement plans on one revision and another publication wins first
- **THEN** the later conditional caller receives a revision conflict and no stale replacement is
  written

#### Scenario: Omitted expectation retains sequential publication

- **WHEN** an existing caller supplies no expected revision
- **THEN** publication keeps allocating the next gap-free ordinal under the Issue lock as before
