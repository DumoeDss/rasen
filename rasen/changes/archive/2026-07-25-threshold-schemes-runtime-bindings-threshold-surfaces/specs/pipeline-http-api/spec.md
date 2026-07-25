## MODIFIED Requirements

### Requirement: Pipelines inventory endpoint reports effective stage configuration with boolean gates

The server SHALL serve `GET /api/v1/pipelines` from the management route group, returning the pipelines available to the addressed space: the endpoint SHALL accept the management `space` selector exactly like the config endpoints (project and store selectors, launch-project fallback when omitted, the same space-error vocabulary), resolving the space's own root as the project layer of pipeline resolution. Each pipeline SHALL report its `name`, `description`, provenance (built-in or user), resolved source layer (project, user, or package), and effective pipeline reuse config. Each stage SHALL report its `id`, `role` (or null), `skill` (or null), its declared gate value as a boolean, and its EFFECTIVE gate, model, handoff threshold, and runtime—each effective value carrying the source layer that supplied it, computed by the same in-process resolvers the CLI's `pipeline show` uses, with no resolution logic reimplemented in the handler.

An effective handoff value SHALL additionally carry the resolver's binding metadata (`scope`, selected runtime/default row, and scheme name) when a scheme supplied it, plus any missing/invalid-scheme diagnostics encountered before the winner. Effective pipeline reuse SHALL mirror the core result: planner/implementer modes, top-level and per-role thresholds, and optional sources, bindings, and diagnostics. The handler SHALL resolve each reuse role with that role's effective server-resolved runtime. These additions SHALL preserve every pre-existing inventory field and value.

The endpoint SHALL require the session token like every management path. Error responses SHALL use the unified management envelope `{ error: { code, message, fix? } }`; space-resolution errors SHALL keep their actionable `fix` hints.

#### Scenario: Effective values with sources

- **WHEN** a per-stage model override is set at project scope and a client sends `GET /api/v1/pipelines?space=project:<id>`
- **THEN** that stage reports the override as its effective model with a per-stage project source, while its declared fields are unchanged

#### Scenario: Space addressing resolves the project layer

- **WHEN** a pipeline exists only in one project's `rasen/pipelines/` and two different spaces are addressed
- **THEN** the pipeline appears only in the owning space's response, and user/package pipelines appear in both

#### Scenario: Declared gates are boolean

- **WHEN** any pipeline's stages are reported, including a user pipeline whose YAML still carries the legacy `gate: vet` spelling
- **THEN** every stage's declared gate value is `true` or `false`—the legacy spelling surfaces as `true`—and no `'vet'` string appears in the response

#### Scenario: Mask reflected in effective gates

- **WHEN** `autopilot.gates` resolves `off` for the addressed space and one stage has a per-stage gate `on` instance
- **THEN** that stage's effective gate is on and every other gate reports off, each naming its deciding layer

#### Scenario: Bound handoff exposes resolver metadata

- **WHEN** a reviewer stage's effective Codex runtime selects scheme `tight` from a store binding
- **THEN** the stage's effective handoff reports its value and scope-qualified source
- **AND** carries binding metadata `{ scope: "store", row: "codex", scheme: "tight" }`

#### Scenario: Dangling binding diagnostics survive fallback

- **WHEN** a project binding references a missing scheme and a lower binding or legacy layer supplies the threshold
- **THEN** the response reports the actual fallback value/source and includes the missing-scheme diagnostic from the resolver

#### Scenario: Reuse roles use their effective runtimes

- **WHEN** planner resolves to Claude and implementer resolves to Codex with different bound schemes
- **THEN** effective reuse reports the independently resolved role thresholds, sources, and binding metadata from those runtimes
- **AND** its top-level threshold continues to use only the default binding row

#### Scenario: Token guard applies

- **WHEN** a request to `/api/v1/pipelines` arrives without the session token or with an incorrect one
- **THEN** the response is 401 with error code `unauthorized` and no handler logic runs

#### Scenario: Space-resolution error keeps its fix hint

- **WHEN** a client sends `GET /api/v1/pipelines?space=project:<unregistered-id>`
- **THEN** the error response uses the envelope `{ error: { code, message, fix } }` with the same space-error code and an actionable fix hint, exactly as the config endpoints report the same failure

#### Scenario: Existing clients retain their established fields

- **WHEN** a client that ignores the new threshold metadata sends the same authorized `GET /api/v1/pipelines` request
- **THEN** every previously specified field retains its prior meaning and shape, while the additive reuse and optional binding/diagnostic fields require no change from that client
