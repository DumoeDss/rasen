## ADDED Requirements

### Requirement: Runtime adapters classify edit-boundary enforcement

The runtime adapter registry SHALL be the single source of truth for
edit-boundary support and SHALL classify each shipped runtime as `hard`,
`soft`, or `unsupported`. Consumers SHALL be allowed to downgrade a runtime
when required integration is absent, but SHALL NOT upgrade it beyond the
registry classification.

#### Scenario: Shipped classifications are conservative

- **WHEN** the shipped adapter matrix is inspected
- **THEN** Claude SHALL be eligible for `hard` only with its usable exact hook registration
- **AND** Codex SHALL report no stronger than `soft`
- **AND** Zed and unknown hosts SHALL report `unsupported`

#### Scenario: Missing registration downgrades rather than fabricates support

- **WHEN** a runtime could enforce covered writes but its Rasen hook is missing, disabled, invalid, or untrusted
- **THEN** status SHALL not report `hard`
