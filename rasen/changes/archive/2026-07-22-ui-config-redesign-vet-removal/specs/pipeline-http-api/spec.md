# pipeline-http-api Delta Specification

> Stacked delta: the REMOVED requirement below is the ADDED text of the pending `ui-config-redesign-pipelines-page` (W3) change's delta creating this spec — W3 must archive before this change. (The pipelines-endpoint contract moved out of `config-http-api` in W3, which is why that spec needs no delta here.)

## REMOVED Requirements

### Requirement: Pipelines inventory endpoint with effective stage configuration

**Reason**: The declared gate value's `'vet'` literal is retired along with the vet gate type; the declared gate becomes a plain boolean and the vet-distinguishable scenario has nothing left to distinguish. Replaced by "Pipelines inventory endpoint reports effective stage configuration with boolean gates".
**Migration**: Every other element — space addressing, provenance and source reporting, effective values with sources, in-process resolution, the token guard — carries over verbatim. Clients reading `gate` receive `true`/`false` only; a legacy `'vet'` declaration surfaces as `true` per the gate-policy capability's legacy-coercion requirement.

## ADDED Requirements

### Requirement: Pipelines inventory endpoint reports effective stage configuration with boolean gates

The server SHALL serve `GET /api/v1/pipelines` returning the pipelines available to the addressed space: the endpoint SHALL accept the management `space` selector exactly like the config endpoints (project and store selectors, launch-project fallback when omitted, the same space-error vocabulary), resolving the space's own root as the project layer of pipeline resolution. Each pipeline SHALL report its `name`, `description`, provenance (built-in or user), and resolved source layer (project, user, or package); each stage SHALL report its `id`, `role` (or null), `skill` (or null), its declared gate value as a boolean, and its EFFECTIVE gate, model, handoff threshold, and runtime — each effective value carrying the source layer that supplied it, computed by the same in-process resolvers the CLI's `pipeline show` uses, with no resolution logic reimplemented in the handler. The endpoint SHALL require the session token like every management path.

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
