## ADDED Requirements

### Requirement: Store-scoped calls address their Store by stable identity through the same client seam

Every Store aggregate read and Store-scoped mutation the UI issues SHALL go through the UI package's single API client seam and SHALL address its Store by the Store's stable identity. That identity SHALL be obtained from the spaces listing or the aggregate response and SHALL NOT be derived from the `store:<id>` space selector, whose id is the Store's local registry id rather than its stable identity. A Store-scoped call SHALL NOT fall back to the launch project, a recent space, or the only registered Store when the identity is unavailable; the view SHALL report that the Store is unresolved instead. The existing space-selector contract for space-scoped calls SHALL be unchanged.

#### Scenario: The space selector is not the Store identity

- **WHEN** the UI issues a Store aggregate read from a route whose space selector is `store:<id>`
- **THEN** the request's Store segment carries the Store's stable identity obtained from a response
- **AND** the selector's local id is not substituted for it

#### Scenario: An unresolved Store is reported rather than guessed

- **WHEN** the Store's stable identity is not available to the view
- **THEN** the view reports the Store as unresolved
- **AND** no request is issued against the launch project, a recent space, or the only registered Store

#### Scenario: Space-scoped calls are unaffected

- **WHEN** the board issues its existing space-scoped changes and runs requests
- **THEN** they still carry the route's `<type>:<id>` selector exactly as before
- **AND** no Store aggregate addressing is applied to them
