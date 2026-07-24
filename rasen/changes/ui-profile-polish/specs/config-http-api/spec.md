# config-http-api Delta

## ADDED Requirements

### Requirement: Serialized constraints carry per-scope enum domains

For an enum key whose allowed values differ by scope, each serialized config entry SHALL carry, alongside the existing static value list, a per-scope map of allowed values covering every scope the key is settable in — computed from the same registry source the write-path validation uses, so a client can render scope-accurate choices and the offered list can never disagree with what a write would accept. Keys whose enum domain does not vary by scope SHALL be unaffected, and the addition SHALL be backward-compatible: clients unaware of the per-scope map keep working from the static list.

#### Scenario: Profile entry serves both scope domains

- **WHEN** a client reads the config listing while saved profiles exist
- **THEN** the profile entry's constraints include a global domain of `full`, `core`, `custom`, and the saved names, and a project domain of `full`, `core`, and the saved names

#### Scenario: Offered values match write validation

- **WHEN** a client writes any value taken from the served per-scope domain for that scope
- **THEN** the write passes enum validation (other constraint failures notwithstanding), and a value outside the served domain for that scope is rejected

#### Scenario: Scope-invariant enums are unchanged

- **WHEN** a client reads an enum key whose values do not vary by scope
- **THEN** the entry serializes exactly as before this capability was added
