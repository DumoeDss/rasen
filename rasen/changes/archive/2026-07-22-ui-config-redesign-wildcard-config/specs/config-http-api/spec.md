# config-http-api Delta Specification

> Deliberately ADDED-only: the pending `ui-config-redesign-store-scope` deltas to this spec are neither removed nor modified; family-instance behavior is defined as an additional requirement, order-independent with that change.

## ADDED Requirements

### Requirement: Wildcard family instances are first-class config API keys

The config API SHALL serve wildcard family instances like ordinary keys. List responses SHALL include, in addition to the family template entries, one entry per family instance set in any contributing layer, each carrying its full instance key, effective value, source annotation, and raw per-scope values under the family's declared scopes. Single-key get SHALL accept a fully-qualified instance path: a set instance returns its resolved entry; a well-formed but unset instance returns the absent shape (no effective value from any layer) rather than an unknown-key error. Set and unset SHALL accept instance paths with an explicit scope, validating the path and value through the registry's family declarations before any write — a scope outside the family's declared scopes SHALL be rejected naming the scopes the family is settable in, and a malformed instance path SHALL be rejected naming the family's pattern. No family SHALL be excluded from API writes: `featureFlags.<name>` instances are settable through the API at their global scope like any other family instance.

#### Scenario: Set instances appear in the list

- **WHEN** `pipelines.small-feature.gates.propose` is set to `on` in the addressed project's config and a client sends `GET /api/v1/config`
- **THEN** the response includes an entry for that instance with its instance key, effective value `on`, a project source annotation, and its raw per-scope values

#### Scenario: Instance write lands in the addressed scope

- **WHEN** a PUT sets `pipelines.bug-fix.models.review` to `fable` with scope `project` (or scope `store` when addressing a store space)
- **THEN** the value is validated through the family declaration, written to that scope's config through the existing write path, and the response returns the re-resolved instance entry

#### Scenario: Wrong scope names the settable scopes

- **WHEN** a PUT targets `featureFlags.someFlag` with scope `project`
- **THEN** the response is 400 naming `global` as the scope the family is settable in, and no file is modified

#### Scenario: Malformed instance path names the pattern

- **WHEN** a PUT targets `pipelines.small-feature.gates` (missing the stage segment)
- **THEN** the response is 400 with a message naming the `pipelines.<name>.gates.<stage>` shape, and no file is modified

#### Scenario: featureFlags instances become API-writable

- **WHEN** a PUT sets `featureFlags.someFlag` to `true` with scope `global`
- **THEN** the write succeeds through the API (the former not-supported carve-out no longer applies) and the re-resolved entry reports the flag

#### Scenario: Unset instance reads as absent

- **WHEN** a client sends `GET /api/v1/config/pipelines.small-feature.handoff.review` and no layer sets that instance
- **THEN** the response is the absent shape for a valid path — not an unknown-key error — with no effective value from any layer

#### Scenario: Instance unset reverts to the wider layer

- **WHEN** `pipelines.small-feature.gates.propose` is set globally to `off` and in the project to `on`, and a DELETE removes it with scope `project`
- **THEN** the returned re-resolved entry shows `off` with a global source annotation
