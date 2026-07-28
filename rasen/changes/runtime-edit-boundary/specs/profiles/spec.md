## ADDED Requirements

### Requirement: Retired edit-boundary experts leave the profile surface

`freeze`, `guard`, and `unfreeze` SHALL not be built-in catalog units, profile
choices, full-profile members, localized expert metadata, or dependency
targets. Persisted global, project, and named selections containing exactly
those retired ids SHALL remain readable and SHALL normalize them away while
preserving all other selections and unknown-id diagnostics.

#### Scenario: Fresh profile surfaces omit retired experts

- **WHEN** a user lists or edits any built-in profile in any supported locale
- **THEN** none of the three retired ids or skill names SHALL appear

#### Scenario: Legacy named profile remains usable

- **WHEN** a saved profile contains `freeze`, `guard`, or `unfreeze`
- **THEN** profile loading SHALL remove those exact ids and preserve every current id
- **AND** an unrelated unknown id SHALL still produce the existing validation error
