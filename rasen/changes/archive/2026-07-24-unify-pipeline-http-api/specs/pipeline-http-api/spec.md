## MODIFIED Requirements

### Requirement: Pipelines inventory endpoint reports effective stage configuration with boolean gates

The server SHALL serve `GET /api/v1/pipelines` from the management route group, returning the pipelines available to the addressed space: the endpoint SHALL accept the management `space` selector exactly like the config endpoints (project and store selectors, launch-project fallback when omitted, the same space-error vocabulary), resolving the space's own root as the project layer of pipeline resolution. Each pipeline SHALL report its `name`, `description`, provenance (built-in or user), and resolved source layer (project, user, or package); each stage SHALL report its `id`, `role` (or null), `skill` (or null), its declared gate value as a boolean, and its EFFECTIVE gate, model, handoff threshold, and runtime — each effective value carrying the source layer that supplied it, computed by the same in-process resolvers the CLI's `pipeline show` uses, with no resolution logic reimplemented in the handler. The endpoint SHALL require the session token like every management path. Error responses SHALL use the unified management envelope `{ error: { code, message, fix? } }`; space-resolution errors SHALL keep their actionable `fix` hints. The response body and status for every previously specified success and error case SHALL be unchanged by the surface's route-group ownership.

#### Scenario: Effective values with sources

- **WHEN** a per-stage model override is set at project scope and a client sends `GET /api/v1/pipelines?space=project:<id>`
- **THEN** that stage reports the override as its effective model with a per-stage project source, while its declared fields are unchanged

#### Scenario: Space addressing resolves the project layer

- **WHEN** a pipeline exists only in one project's `rasen/pipelines/` and two different spaces are addressed
- **THEN** the pipeline appears only in the owning space's response, and user/package pipelines appear in both

#### Scenario: Declared gates are boolean

- **WHEN** any pipeline's stages are reported, including a user pipeline whose YAML still carries the legacy `gate: vet` spelling
- **THEN** every stage's declared gate value is `true` or `false` — the legacy spelling surfaces as `true` — and no `'vet'` string appears in the response

#### Scenario: Mask reflected in effective gates

- **WHEN** `autopilot.gates` resolves `off` for the addressed space and one stage has a per-stage gate `on` instance
- **THEN** that stage's effective gate is on and every other gate reports off, each naming its deciding layer

#### Scenario: Token guard applies

- **WHEN** a request to `/api/v1/pipelines` arrives without the session token or with an incorrect one
- **THEN** the response is 401 with error code `unauthorized` and no handler logic runs

#### Scenario: Space-resolution error keeps its fix hint

- **WHEN** a client sends `GET /api/v1/pipelines?space=project:<unregistered-id>`
- **THEN** the error response uses the envelope `{ error: { code, message, fix } }` with the same space-error code and an actionable fix hint, exactly as the config endpoints report the same failure

#### Scenario: Inventory unchanged by route-group ownership

- **WHEN** a client that worked against the previous release sends the same authorized `GET /api/v1/pipelines` request
- **THEN** it receives the same status and the same response shape with no client-side change required
