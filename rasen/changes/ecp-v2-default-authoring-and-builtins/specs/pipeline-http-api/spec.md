# pipeline-http-api Specification Delta

## MODIFIED Requirements

### Requirement: Pipeline detail endpoint returns both the resolved view and a round-trippable definition

The server SHALL serve `GET /api/v1/pipelines/<name>` (exactly one percent-decoded path segment, validated by the same identifier grammar pipeline names accept) returning, for a pipeline available to the addressed space: `pipeline` - the shared prepared execution view; `definition` - the complete authored v1 or v2 form accepted by preparation; `preparation` - authored/normalized versions, diagnostics, digests, plan availability, and execution capability; and `editable` - `false` for built-ins and `true` otherwise. Native v2 definitions SHALL retain every typed contract and SHALL expose non-empty execution stages when their graph contains executable nodes. Built-ins SHALL be returned read-only rather than refused. Unknown and malformed names SHALL retain their existing unified errors.

#### Scenario: Native v2 detail carries both views

- **WHEN** a client requests an authored v2 user pipeline or Change-level built-in
- **THEN** the response carries the full version 2 definition, its digests/capability status, and the same non-empty execution projection used by CLI show
- **AND** saving the definition unchanged under an allowed new name preserves its semantic plan meaning

#### Scenario: Built-in is readable but not editable

- **WHEN** a client requests the detail of a native v2 built-in pipeline
- **THEN** the response is 200 with its full definition and execution view included and `editable: false`

#### Scenario: Definition round-trips through save

- **WHEN** a client saves a detail response's v1 or v2 `definition` unchanged under a new user pipeline name and then requests that pipeline's detail
- **THEN** the returned authored version and definition are semantically identical to the saved definition
- **AND** v2 source, capability, and plan digests remain equal under the same catalog

#### Scenario: Legacy detail exposes compatibility content version

- **WHEN** a client requests detail for a valid historical Pipeline whose source YAML has no top-level `version`
- **THEN** the response is 200 and its authored definition explicitly reports version 1 without requiring the source file to be rewritten
- **AND** preparation identifies it as compatibility input

#### Scenario: Unknown and malformed names

- **WHEN** a client requests `GET /api/v1/pipelines/<unknown-name>` or a name that violates the pipeline identifier grammar
- **THEN** the unknown name answers 404 `not_found` and the malformed name answers 400, both in the unified envelope

## ADDED Requirements

### Requirement: Inventory and detail expose the same native v2 execution view

Pipeline inventory and detail SHALL project native v2 roles, gates, verification behavior, capability bindings, runtime/config provenance, build order, loop policy, and engine support through the same server boundary used by CLI inspection. An executable v2 graph SHALL NOT be represented as `stages: []` merely because its authored format is hierarchical.

The server SHALL resolve one detected or injected host runtime per request and pass that same host to both v1 compatibility and native v2 projections. Inventory and detail SHALL therefore report the same runtime route and bridge facts as CLI inspection on Codex and Claude hosts rather than using a hard-coded unknown host.

#### Scenario: Inventory stages agree with detail and CLI

- **WHEN** inventory, detail, and CLI show inspect the same six native v2 built-ins under one configuration
- **THEN** their logical stage identities, effective gates, roles, capability paths, and engine verdicts agree
- **AND** the authored definition remains separately round-trippable

#### Scenario: API and CLI agree on each supported host

- **WHEN** inventory/detail and CLI projection inspect the same prepared pipeline under an injected Codex host or Claude host
- **THEN** effective runtime, route, bridge, and engine-support fields are identical
- **AND** one request cannot mix projections computed under different host assumptions

#### Scenario: V1 fixture boundary remains visible

- **WHEN** inventory or detail returns `auto-decompose`
- **THEN** it reports authored version 1 and the `issue-dispatch-0.3.0` compatibility boundary
- **AND** it does not claim native Change-level v2 ownership
