# runtime-adapter-registry Specification

## Purpose
Define the capability-based runtime adapter registry so context probing, token auditing, pipeline dispatch, configuration, and wire surfaces consistently accept only runtimes with the required adapter capability while preserving existing runtime behavior.
## Requirements
### Requirement: Runtime adapters declare independent capabilities

Rasen SHALL maintain one runtime adapter registry in which every runtime id declares independent context-probe, token-audit, and pipeline-dispatch capabilities. The shipped registry SHALL declare Claude and Codex capable of all three operations, Zed capable of audit only, and Oh My Pi capable of none. A registry entry with no capability SHALL still be a recognized runtime for host identification and diagnostics.

#### Scenario: Shipped capability matrix is reported consistently

- **WHEN** a consumer requests the registered runtimes for context probing, token auditing, or pipeline dispatch
- **THEN** the probe set SHALL be `claude` and `codex`
- **AND** the audit set SHALL be `claude`, `codex`, and `zed`
- **AND** the dispatch set SHALL be `claude` and `codex`
- **AND** `omp` SHALL appear in none of the three sets

#### Scenario: Capabilities remain independent

- **WHEN** a registered runtime supports token auditing but has no context-probe or pipeline-dispatch adapter
- **THEN** Rasen SHALL include it only in audit-capable runtime results
- **AND** SHALL reject it at probe and dispatch validation boundaries

#### Scenario: A registered runtime with no capability is still recognized

- **WHEN** a runtime is registered with every capability declared false
- **THEN** Rasen SHALL treat it as a recognized runtime for host identification, provenance, and diagnostic messages
- **AND** SHALL reject it wherever a probe-capable, audit-capable, or dispatch-capable runtime is required, with the existing actionable error naming the accepted runtimes for that operation

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

Rasen SHALL expose one shared host-runtime detector for pipeline execution and lifecycle consumers. It SHALL return both `runtime` — any registered runtime id, or `unknown` — and a stable source, so identifying the harness a session runs in does not depend on Rasen being able to dispatch workers to that harness. Recognized fingerprints SHALL resolve in this order: `RASEN_AGENT_RUNTIME` override, `CODEX_THREAD_ID`, `CODEX_SANDBOX`, `OMPCODE`, `CLAUDECODE`, then unknown. Codex fingerprints SHALL outrank the Oh My Pi fingerprint because a Codex process launched from Oh My Pi inherits its environment values, and the Oh My Pi fingerprint SHALL outrank Claude fingerprints because Oh My Pi sets Claude environment values of its own. The `RASEN_AGENT_RUNTIME` override SHALL accept any registered runtime id. Project feature flags such as `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` SHALL NOT identify the current host.

#### Scenario: Unrestricted Codex is detected from its thread id

- **WHEN** the environment contains a non-empty `CODEX_THREAD_ID` and does not contain `CODEX_SANDBOX`
- **THEN** the detector reports runtime `codex`
- **AND** reports source `codex-thread-id`

#### Scenario: Codex wins over inherited Claude fingerprints

- **WHEN** the environment contains both a Codex fingerprint and `CLAUDECODE`
- **THEN** the detector reports runtime `codex`
- **AND** does not misidentify the nested process as Claude

#### Scenario: Oh My Pi is detected from its own fingerprint

- **WHEN** the environment contains a non-empty `OMPCODE`
- **AND** contains no Codex fingerprint and no `RASEN_AGENT_RUNTIME` override
- **THEN** the detector reports runtime `omp`
- **AND** reports a source identifying the Oh My Pi fingerprint
- **AND** SHALL report `omp` even when `CLAUDECODE` is also present

#### Scenario: Codex launched from Oh My Pi is still Codex

- **WHEN** the environment contains both a Codex fingerprint and a non-empty `OMPCODE`
- **THEN** the detector reports runtime `codex`
- **AND** does not misidentify the nested Codex process as its Oh My Pi parent

#### Scenario: Explicit diagnostic override wins

- **WHEN** `RASEN_AGENT_RUNTIME` names any registered runtime id
- **THEN** that value wins over host fingerprints
- **AND** the detector reports source `env-override`

#### Scenario: No recognized host is explicit

- **WHEN** no recognized override or host fingerprint is present
- **THEN** the detector reports runtime `unknown`
- **AND** reports source `unknown`

### Requirement: Dispatchability is resolved for a host and target pair

Rasen SHALL resolve pipeline dispatch through an explicit host × target route table in addition to target runtime capability eligibility. Only a dispatch-capable host SHALL own a route row. The shipped routes SHALL be Claude→Claude `native`, Claude→Codex `exec-bridge` through `codex-exec`, Codex→Codex `native`, and Codex→Claude `exec-bridge` through `claude-print`. A host that is unknown, or that is recognized but has no dispatch adapter, SHALL resolve to an observable `legacy-fallback` compatibility mode. A runtime adapter capability flag SHALL NOT fabricate a route that has no shipped implementation.

Whenever a run resolves to the legacy compatibility route because the host has no dispatch adapter, Rasen SHALL report that fallback so it is visible rather than silent. The report SHALL distinguish an unidentified host from a recognized host with no dispatch adapter, naming the recognized host in the latter case. When the report advises forcing a host runtime for deterministic dispatch, it SHALL also state that forcing a host runtime makes context probing report that runtime.

#### Scenario: Same-host dispatch is native

- **WHEN** host and target are both Claude or both Codex
- **THEN** the route resolver reports `native`
- **AND** reports no external bridge

#### Scenario: Claude can bridge to Codex

- **WHEN** the host is Claude and the target is Codex
- **THEN** the route resolver reports `exec-bridge`
- **AND** identifies `codex-exec` as the required implementation

#### Scenario: Codex can bridge to Claude

- **WHEN** the host is Codex and the target is Claude
- **THEN** the route resolver reports `exec-bridge`
- **AND** identifies `claude-print` as the required implementation

#### Scenario: Unknown host remains diagnosable

- **WHEN** the host detector reports `unknown`
- **THEN** the route resolver reports `legacy-fallback`
- **AND** the result remains distinguishable from a verified native or exec-bridge route
- **AND** Rasen reports the fallback with guidance to force a host runtime

#### Scenario: Recognized host with no dispatch adapter is diagnosable

- **WHEN** the host detector reports a recognized runtime that has no dispatch adapter
- **THEN** the route resolver reports `legacy-fallback`
- **AND** Rasen reports the fallback in a message naming that host rather than calling the host unidentified
- **AND** the message states that forcing a host runtime also makes context probing report that runtime

#### Scenario: Fallback report copy is available in every shipped locale

- **WHEN** either fallback report is rendered under any supported CLI locale
- **THEN** the localized copy SHALL be present and non-empty with matching placeholders
- **AND** machine-readable JSON output SHALL stay identical across locales

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
