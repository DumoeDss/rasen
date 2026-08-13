# runtime-adapter-registry Specification

## Purpose
Define the capability-based runtime adapter registry so context probing, token auditing, pipeline dispatch, configuration, and wire surfaces consistently accept only runtimes with the required adapter capability while preserving existing runtime behavior.
## Requirements
### Requirement: Runtime adapters declare independent capabilities

Rasen SHALL maintain one runtime adapter registry in which every runtime id declares independent context-probe, token-audit, and pipeline-dispatch capabilities. The shipped registry SHALL declare Claude and Codex capable of all three operations, and Zed capable of audit only.

#### Scenario: Shipped capability matrix is reported consistently

- **WHEN** a consumer requests the registered runtimes for context probing, token auditing, or pipeline dispatch
- **THEN** the probe set SHALL be `claude` and `codex`
- **AND** the audit set SHALL be `claude`, `codex`, and `zed`
- **AND** the dispatch set SHALL be `claude` and `codex`

#### Scenario: Capabilities remain independent

- **WHEN** a registered runtime supports token auditing but has no context-probe or pipeline-dispatch adapter
- **THEN** Rasen SHALL include it only in audit-capable runtime results
- **AND** SHALL reject it at probe and dispatch validation boundaries

### Requirement: Runtime eligibility derives from the required capability

Every Rasen surface that validates a context-probe, token-audit, or pipeline-dispatch runtime SHALL derive its accepted values from the corresponding registry capability. This contract SHALL cover CLI validation, core schemas and types, configuration-key enum metadata and parsing, management services, and management wire types; those surfaces SHALL present the same capability-specific runtime set.

#### Scenario: Context probe accepts only probe-capable runtimes

- **WHEN** a user selects a runtime for `rasen agent context`
- **THEN** Claude and Codex SHALL be accepted from the probe-capable registry set
- **AND** Zed or an unknown runtime SHALL be rejected with an actionable error naming the accepted probe runtimes

#### Scenario: Audit surfaces accept only audit-capable runtimes

- **WHEN** a runtime is selected through the audit CLI, native audit management service, report validation, or its management wire contract
- **THEN** Claude, Codex, and Zed SHALL be accepted from the audit-capable registry set
- **AND** an unknown runtime SHALL be rejected without preventing valid runtimes from remaining usable

#### Scenario: Pipeline surfaces accept only dispatch-capable runtimes

- **WHEN** a runtime is declared in pipeline YAML or written through `pipelines.<name>.runtimes.<role>`
- **THEN** Claude and Codex SHALL be accepted from the dispatch-capable registry set across schema, configuration, inspection, and wire surfaces
- **AND** Zed or an unknown runtime SHALL be rejected as not dispatch-capable

### Requirement: LEAD host runtime detection is canonical and provenance-bearing

Rasen SHALL expose one shared host-runtime detector for pipeline execution and lifecycle consumers. It SHALL return both `runtime` (`claude`, `codex`, or `unknown`) and a stable source, resolving recognized fingerprints in this order: `RASEN_AGENT_RUNTIME` override, `CODEX_THREAD_ID`, `CODEX_SANDBOX`, `CLAUDECODE`, then unknown. Codex fingerprints SHALL outrank Claude fingerprints because a Codex process can inherit Claude environment values. Project feature flags such as `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` SHALL NOT identify the current host.

#### Scenario: Unrestricted Codex is detected from its thread id

- **WHEN** the environment contains a non-empty `CODEX_THREAD_ID` and does not contain `CODEX_SANDBOX`
- **THEN** the detector reports runtime `codex`
- **AND** reports source `codex-thread-id`

#### Scenario: Codex wins over inherited Claude fingerprints

- **WHEN** the environment contains both a Codex fingerprint and `CLAUDECODE`
- **THEN** the detector reports runtime `codex`
- **AND** does not misidentify the nested process as Claude

#### Scenario: Explicit diagnostic override wins

- **WHEN** `RASEN_AGENT_RUNTIME` is set to `claude` or `codex`
- **THEN** that supported value wins over host fingerprints
- **AND** the detector reports source `env-override`

#### Scenario: No recognized host is explicit

- **WHEN** no recognized override or host fingerprint is present
- **THEN** the detector reports runtime `unknown`
- **AND** reports source `unknown`

### Requirement: Dispatchability is resolved for a host and target pair

Rasen SHALL resolve pipeline dispatch through an explicit host × target route table in addition to target runtime capability eligibility. For stages without an external inference binding, the shipped routes SHALL be Claude→Claude `native`, Claude→Codex `exec-bridge` through `codex-exec`, Codex→Codex `native`, and Codex→Claude `exec-bridge` through `claude-print`. A stage with OmniCross inference SHALL use the target runtime's controllable process bridge (`claude-print` or `codex-exec`) even when host and target match, because a native subagent cannot receive a distinct per-stage process environment. An unknown host SHALL resolve to an observable `legacy-fallback` compatibility mode only for unbound stages; an OmniCross-routed stage on an unknown host SHALL fail execution preflight if its process bridge cannot be established. A runtime adapter capability flag SHALL NOT fabricate a route that has no shipped implementation.

#### Scenario: Same-host dispatch is native

- **WHEN** host and target are both Claude or both Codex and the stage has no external inference binding
- **THEN** the route resolver reports `native`
- **AND** reports no external bridge

#### Scenario: Same-host routed dispatch uses a process bridge

- **WHEN** host and target are both Claude or both Codex and the stage selects OmniCross inference
- **THEN** the route resolver reports `exec-bridge`
- **AND** identifies the target runtime's `claude-print` or `codex-exec` implementation so the lease environment is isolated to that stage process

#### Scenario: Claude can bridge to Codex

- **WHEN** the host is Claude and the target is Codex
- **THEN** the route resolver reports `exec-bridge`
- **AND** identifies `codex-exec` as the required implementation

#### Scenario: Codex can bridge to Claude

- **WHEN** the host is Codex and the target is Claude
- **THEN** the route resolver reports `exec-bridge`
- **AND** identifies `claude-print` as the required implementation

#### Scenario: Unknown host remains diagnosable

- **WHEN** the host detector reports `unknown` for a stage without an external inference binding
- **THEN** the route resolver reports `legacy-fallback`
- **AND** the result remains distinguishable from a verified native or exec-bridge route

#### Scenario: Unknown host cannot bypass a routed process boundary

- **WHEN** the host detector reports `unknown` for an OmniCross-routed stage
- **THEN** execution preflight SHALL require the target runtime's supported process bridge
- **AND** SHALL fail before dispatch rather than using `legacy-fallback` without the lease environment

### Requirement: Registry-backed consumers preserve existing runtime behavior

Moving runtime eligibility and host routing to the registry SHALL preserve existing explicit runtime values, serialized values, configuration values, and runtime-specific processing. The registry SHALL select which target runtime ids are valid and which host × target routes are implemented; the existing probe readers, audit parsers/discoverers, Claude-native dispatcher, and Codex exec bridge SHALL continue to perform their runtime-specific work. Pipeline stages with no explicit runtime SHALL use the detected host as their target, while an unknown host SHALL retain the annotated legacy Claude fallback.

#### Scenario: Existing explicit values round-trip unchanged

- **WHEN** existing context, audit, pipeline, configuration, or management API flows explicitly use a runtime that was valid before this change
- **THEN** the same runtime value SHALL be accepted and serialized unchanged
- **AND** an explicit pipeline runtime SHALL continue to outrank host inheritance

#### Scenario: Non-pipeline detection behavior remains capability-checked

- **WHEN** context or audit runtime detection receives no explicit runtime selector
- **THEN** its existing filename, content, and path detection behavior SHALL remain unchanged
- **AND** the detected runtime SHALL still be checked against the capability required by that consumer

#### Scenario: Implicit pipeline runtime follows the host

- **WHEN** a stage has no configured, stage-level, or role-level runtime and the LEAD host is recognized
- **THEN** the target runtime SHALL equal that host runtime
- **AND** the runtime-specific dispatcher selected by the host × target route SHALL process it

#### Scenario: Unknown host preserves the legacy fallback visibly

- **WHEN** a stage has no explicit runtime and the LEAD host is unknown
- **THEN** the target runtime SHALL remain Claude for compatibility
- **AND** provenance SHALL identify a legacy fallback rather than claiming that Claude was explicitly configured or natively verified

### Requirement: Adding an adapter has one capability source of truth

When shipped code adds a runtime adapter and marks one of its capabilities true, the corresponding derived type, value list, guard, schema choices, configuration metadata, and wire contract SHALL obtain that runtime from the registry without adding another consumer-owned allow-list. Runtime-specific parser, probe, or dispatch implementation lookup SHALL remain explicit and exhaustively checked.

#### Scenario: A future probe adapter becomes binding-eligible

- **WHEN** a future shipped runtime has a working context-probe adapter and its registry entry declares `canProbeContext`
- **THEN** probe-capable runtime consumers SHALL include it from the registry
- **AND** later runtime-binding validation can use the same probe-capable set without duplicating runtime names

#### Scenario: Registration does not fabricate an implementation

- **WHEN** a runtime-specific consumer needs to read a transcript, database, or process protocol
- **THEN** that consumer SHALL use an explicit implementation for the selected registered runtime
- **AND** SHALL NOT infer an implementation solely from the presence of a capability flag
