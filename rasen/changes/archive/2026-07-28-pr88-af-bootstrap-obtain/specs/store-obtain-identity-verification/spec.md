## ADDED Requirements

### Requirement: An alias-only Store obtain verifies the cloned Store's identity against the declared alias

When a Store is obtained by alias-only declaration (no permanent UID), the system SHALL verify that the cloned Store's metadata ID matches the declared alias before publishing or registering. A mismatch SHALL fail closed: the checkout SHALL NOT be published to the target path, the registry SHALL NOT be written, and the staging directory SHALL be left in place for inspection. The failure diagnostic SHALL name the expected alias, the found identity, and the staging path.

#### Scenario: An alias-only obtain with a mismatched remote ID writes nothing

- **WHEN** a project declares alias `expected-store` for a Store, the cloned remote's metadata identifies as `other-store`, and no permanent UID was declared
- **THEN** the checkout is not published to the target path
- **AND** the registry is not written
- **AND** the staging directory is left for inspection
- **AND** the diagnostic names both the expected and found identities

#### Scenario: An alias-only obtain with a matching remote ID succeeds

- **WHEN** a project declares alias `my-store` and the cloned remote's metadata identifies as `my-store`
- **THEN** the checkout is published and registered normally
- **AND** bootstrap reports the entry as obtained
