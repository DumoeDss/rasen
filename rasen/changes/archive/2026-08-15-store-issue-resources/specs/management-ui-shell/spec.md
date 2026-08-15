## ADDED Requirements

### Requirement: Store-scoped calls address their Store by stable identity through the same client seam

Every Store-scoped call the operations UI makes SHALL address its Store by the Store's stable
identity, and SHALL go through the same client seam every other call uses, so authentication, error
reporting, and base-address resolution behave identically. A Store SHALL NOT be addressed by a
filesystem path, a display name, or a position in a list.

#### Scenario: A Store is addressed by identity

- **WHEN** the UI issues any Store-scoped call
- **THEN** the Store is identified by its stable identity
- **AND** no filesystem path, display name, or list position is used to address it

#### Scenario: Store-scoped calls share the common client behavior

- **WHEN** a Store-scoped call fails authentication or cannot reach the server
- **THEN** it reports the failure the same way every other call in the shell does
