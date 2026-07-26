## ADDED Requirements

### Requirement: Effective stage runtime resolves independently from other stage fields

The effective runtime for a stage SHALL resolve independently from model, sandbox, effort, and session-reuse fields. Runtime precedence SHALL be: the per-role runtime configuration instance (project over store over global), then an explicit stage runtime, then an explicit pipeline `agents.<role>.runtime`, then the detected LEAD host, then the legacy Claude fallback when the host is unknown. A declaration that configures only a non-runtime field SHALL NOT count as an explicit runtime source.

#### Scenario: Model-only stage inherits the Codex host

- **WHEN** a stage declares `model` but no runtime and the detected LEAD host is Codex
- **THEN** the stage resolves runtime `codex` with runtime source `host`
- **AND** its model retains the stage model source

#### Scenario: Model-only role object does not manufacture Claude

- **WHEN** `agents.reviewer` is an object containing a model or lifecycle field but no `runtime`
- **AND** no higher runtime configuration instance or stage runtime exists
- **THEN** reviewer stages inherit the detected host
- **AND** do not treat the object’s omitted runtime as an explicit Claude declaration

#### Scenario: Explicit runtime layers retain precedence

- **WHEN** a configured role runtime, stage runtime, pipeline role runtime, and host default provide different values
- **THEN** the configured role runtime wins over the stage runtime
- **AND** the stage runtime wins over the pipeline role runtime
- **AND** every explicit layer wins over host inheritance

#### Scenario: Unknown host uses the annotated legacy default

- **WHEN** no explicit runtime layer exists and host detection returns unknown
- **THEN** the stage resolves runtime `claude`
- **AND** reports runtime source `legacy-default`

### Requirement: Pipeline execution inspection reports host and dispatch provenance

`rasen pipeline show` and `rasen pipeline agents` SHALL report the detected host runtime and its source, and SHALL report each resolved stage runtime with its independent runtime source and dispatch mode. JSON output SHALL use stable locale-neutral values; human output SHALL present the same facts in the active locale. These fields SHALL be additive to the existing pipeline output.

#### Scenario: Codex-native default is observable

- **WHEN** a Codex-hosted user inspects a pipeline stage with no explicit runtime
- **THEN** output reports host runtime `codex` with its detection source
- **AND** the stage reports runtime `codex`, runtime source `host`, and dispatch mode `native`

#### Scenario: Cross-runtime bridge is observable

- **WHEN** a Claude-hosted pipeline stage explicitly resolves to Codex
- **THEN** the stage reports runtime `codex`
- **AND** reports its explicit runtime source and dispatch mode `exec-bridge`

#### Scenario: Unknown host is not presented as native

- **WHEN** pipeline inspection runs outside a recognized host
- **THEN** output reports host runtime `unknown`
- **AND** implicit stages report runtime source `legacy-default` and dispatch mode `legacy-fallback`

#### Scenario: Existing JSON consumers keep established fields

- **WHEN** a client ignores host and dispatch provenance fields
- **THEN** every pre-existing pipeline and stage field retains its established type and meaning

## MODIFIED Requirements

### Requirement: Per-role runtime updates persist as configuration, not pipeline copies

`rasen pipeline agents <name>` SHALL keep its command surface (per-role runtime flags, `--json`, root selection) while persisting per-role runtime updates as `pipelines.<name>.runtimes.<role>` configuration instances written to the resolved root's configuration through the standard config write path — it SHALL NOT write a pipeline definition file. The effective runtime for a role SHALL resolve: the per-role runtime family instance (project over store over global) first, then an explicit pipeline `agents.<role>.runtime`, then the detected host runtime, then the legacy Claude fallback when the host is unknown. Reads SHALL report each role's resolved runtime with the layer that supplied it and its host × target dispatch mode. A pipeline definition copy previously frozen into a project by the old behavior SHALL remain untouched and SHALL keep resolving as that project's definition (the project layer of pipeline resolution) — the inspection surface's source badge makes the frozen copy visible, and removing it is the user's explicit action, never an automatic migration.

#### Scenario: Setting a runtime writes config, not YAML

- **WHEN** the user runs `rasen pipeline agents small-feature --reviewer codex` in a project
- **THEN** a `pipelines.small-feature.runtimes.reviewer` instance is written to the project's configuration, no `pipeline.yaml` is created or modified, and subsequent upstream changes to the built-in pipeline keep applying in that project

#### Scenario: Runtime chain resolves config over declaration and host

- **WHEN** a pipeline declares `agents.reviewer.runtime: claude`, the detected host is Codex, and the project sets the reviewer runtime instance to `codex`
- **THEN** reviewer-role stages resolve to `codex` with a config-layer source
- **AND** unsetting the instance reverts to the explicit Claude declaration rather than the host

#### Scenario: Undeclared role runtime inherits the host

- **WHEN** no runtime configuration instance or explicit pipeline role runtime exists
- **THEN** the role resolves to the detected host with a host source
- **AND** an unknown host resolves to the visibly labelled legacy default

#### Scenario: Existing frozen copies stay visible, not silently migrated

- **WHEN** a project carries a full pipeline copy written by the old `agents` behavior
- **THEN** that copy still resolves as the project's definition with its project source badge shown, and no automatic deletion or rewrite occurs

### Requirement: Runtime preflight probes agent-runtime availability

Before a pipeline is dispatched for execution, the execution preflight SHALL detect the LEAD host once, resolve every stage's effective target runtime with all configured runtime layers, and resolve the host × target dispatch mode across all stages, including stages of any decompose child pipeline. A known `unsupported` route SHALL fail before dispatch with an actionable error naming the host, target, affected stage or role, and a supported override. When any route is `exec-bridge`, the preflight SHALL probe Codex CLI availability at most once per invocation through an injectable prober and SHALL fail before dispatch if the bridge is required but unavailable. Codex-native stages SHALL NOT require or probe the external Codex CLI. An unknown host SHALL retain the legacy fallback with an actionable diagnostic rather than being represented as a verified native route.

#### Scenario: Claude-to-Codex bridge unavailable fails before dispatch

- **WHEN** a Claude-hosted pipeline has a stage whose effective runtime resolves to Codex
- **AND** the Codex CLI is unavailable
- **THEN** execution preflight fails before dispatch
- **AND** the error names both remedies: use a supported runtime override or install the Codex CLI

#### Scenario: Codex-native pipeline does not probe the CLI

- **WHEN** the host is Codex and one or more stages inherit or explicitly select Codex
- **THEN** each such stage resolves dispatch mode `native`
- **AND** the Codex CLI availability prober is not called

#### Scenario: Known unsupported route fails early

- **WHEN** the host is Codex and an explicit runtime layer selects Claude for a stage
- **THEN** execution preflight fails before any worker starts
- **AND** the error identifies the unsupported Codex→Claude pair and explains that removing or changing the explicit runtime allows a supported route

#### Scenario: Configured runtime instances participate in preflight

- **WHEN** project, store, or global runtime configuration changes a role's effective target
- **THEN** preflight validates the route for that configured target
- **AND** it does not validate a different target obtained by ignoring configuration

#### Scenario: Decompose child routes are covered

- **WHEN** a decompose child pipeline contains an exec-bridge or unsupported route after effective runtime resolution
- **THEN** the parent execution preflight applies the same availability or rejection rule before fan-out

#### Scenario: Bridge probe is injectable and runs at most once

- **WHEN** the preflight runs with an injected availability prober over a pipeline containing several `exec-bridge` stages
- **THEN** the prober is consulted at most once for that invocation

#### Scenario: Unknown host keeps compatibility with a diagnostic

- **WHEN** host detection returns unknown
- **THEN** execution retains the legacy runtime/bridge behavior
- **AND** reports how to select a deterministic host with `RASEN_AGENT_RUNTIME`
