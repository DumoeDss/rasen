## ADDED Requirements

### Requirement: Read-only pipelines inventory endpoint
The CLI SHALL expose a read-only `GET /api/v1/pipelines` endpoint returning the available pipelines and, for each, the stages that carry a gate, so a client can render a gates inventory. Each pipeline SHALL report its `name`, `description`, and a `stages` list; each stage SHALL report its `id`, `role` (or null), `skill` (or null), and its gate value as `false`, `true`, or `'vet'`. The endpoint SHALL be GET-only (any other method yields 405) and SHALL draw its data from the same in-process pipeline registry loader the CLI uses, with no pipeline logic reimplemented in the handler. The endpoint SHALL require the session token exactly like the other `/api/` endpoints.

#### Scenario: Pipelines endpoint returns gated-stage metadata
- **WHEN** a client sends `GET /api/v1/pipelines` with a valid token
- **THEN** the response lists each available pipeline with its stages, and each stage carries its `id`, `role`, `skill`, and gate value (`false`, `true`, or `'vet'`)

#### Scenario: The vet gate is distinguishable in the response
- **WHEN** a pipeline contains a stage marked `gate: 'vet'`
- **THEN** that stage's gate value in the response is the string `'vet'`, distinct from an ordinary `true` gate, so a client can mark it as always-pausing

#### Scenario: Non-GET methods are rejected
- **WHEN** a client sends a `PUT`, `POST`, or `DELETE` to `/api/v1/pipelines`
- **THEN** the response is 405 with error code `method_not_allowed` and no state changes

#### Scenario: Token guard applies
- **WHEN** a request to `/api/v1/pipelines` arrives without the session token or with an incorrect one
- **THEN** the response is 401 with error code `unauthorized` and no handler logic runs
