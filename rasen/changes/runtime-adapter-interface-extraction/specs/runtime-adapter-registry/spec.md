## ADDED Requirements

### Requirement: A session's owning harness is recognized independently of what Rasen can do with it

Rasen SHALL recognize which harness a session target belongs to as a registry concern separate from whether Rasen can probe, audit, or dispatch that harness. Every registered runtime that stores sessions on the user's machine SHALL declare how its own targets are recognized, and recognition SHALL be attempted across those declarations in a stable, inspectable order. When no registered runtime claims a target, recognition SHALL resolve to one named fallback runtime declared in the registry, so an unclaimed target follows a stated decision rather than the trailing branch of a chain.

Recognizing a target SHALL NOT imply that a reader for it exists. A target belonging to a recognized harness with no reader for the requested operation SHALL be reported as unsupported for that operation, naming the harness, rather than read with another harness's reader.

#### Scenario: A registered harness claims its own session file

- **WHEN** a session file written by a registered harness is presented to context probing or token auditing
- **THEN** recognition SHALL identify that harness as the owner
- **AND** SHALL do so even when the file extension matches another harness's convention

#### Scenario: An unclaimed target follows the declared fallback

- **WHEN** a target is claimed by no registered runtime
- **THEN** recognition SHALL resolve to the registry's declared fallback runtime
- **AND** every target that resolved to a given runtime before this capability SHALL resolve to the same runtime after it

#### Scenario: Recognition does not grant a reader

- **WHEN** recognition identifies a harness that has no reader for the requested operation
- **THEN** Rasen SHALL report the target as unsupported for that operation, naming the recognized harness
- **AND** SHALL NOT select another runtime's reader for it

## MODIFIED Requirements

### Requirement: Runtime adapters declare independent capabilities

Rasen SHALL maintain one runtime adapter registry in which every runtime id declares independent context-probe, token-audit, and pipeline-dispatch capabilities. A runtime SHALL hold a capability exactly when Rasen ships an implementation of that operation for it, so a declared capability and a shipped implementation are one fact rather than two that can disagree. The shipped registry SHALL declare Claude and Codex capable of all three operations, Zed capable of audit only, and Oh My Pi capable of none. A registry entry with no capability SHALL still be a recognized runtime for host identification and diagnostics.

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

### Requirement: Dispatchability is resolved for a host and target pair

Rasen SHALL resolve pipeline dispatch from the shipped dispatch adapters rather than from an enumerated host × target matrix. A dispatch-capable host targeting itself SHALL resolve to `native`; a dispatch-capable host targeting a different dispatch-capable runtime SHALL resolve to `exec-bridge` through the bridge that target's own adapter declares. A host that is unknown, or that is recognized but has no dispatch adapter, SHALL resolve to an observable `legacy-fallback` compatibility mode. The registry SHALL additionally carry a declared list of host/target pairs that are known to be unsupported, so an unsupported pair is a stated exception rather than an omission. The shipped result SHALL remain Claude→Claude `native`, Claude→Codex `exec-bridge` through `codex-exec`, Codex→Codex `native`, and Codex→Claude `exec-bridge` through `claude-print`. A runtime adapter capability flag SHALL NOT fabricate a route that has no shipped implementation.

Every user-facing fact about a bridge — the name of the tool it runs, the advice for installing that tool, and the check for whether it is present — SHALL come from that bridge's own adapter, so a diagnostic about one bridge never names another bridge's tool.

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

#### Scenario: Bridge diagnostics name the bridge's own tool

- **WHEN** a run cannot proceed because a required bridge's tool is unavailable
- **THEN** the message SHALL name that bridge's own tool and its own install advice
- **AND** the availability check performed SHALL be that bridge's own check, not another bridge's

#### Scenario: Route resolution is unchanged for every shipped pair

- **WHEN** any host and target pair that resolved before this change is resolved after it
- **THEN** the reported mode and bridge SHALL be identical
- **AND** no pair SHALL newly resolve to a route that has no shipped implementation

### Requirement: Adding an adapter has one capability source of truth

When shipped code adds a runtime adapter and marks one of its capabilities true, the corresponding derived type, value list, guard, schema choices, configuration metadata, and wire contract SHALL obtain that runtime from the registry without adding another consumer-owned allow-list. Runtime-specific parser, probe, or dispatch implementation lookup SHALL remain explicit and exhaustively checked. A capability declared with no shipped implementation, and a shipped implementation with no declared capability, SHALL each fail the project's build rather than surfacing at run time.

#### Scenario: A future probe adapter becomes binding-eligible

- **WHEN** a future shipped runtime has a working context-probe adapter and its registry entry declares `canProbeContext`
- **THEN** probe-capable runtime consumers SHALL include it from the registry
- **AND** later runtime-binding validation can use the same probe-capable set without duplicating runtime names

#### Scenario: Registration does not fabricate an implementation

- **WHEN** a runtime-specific consumer needs to read a transcript, database, or process protocol
- **THEN** that consumer SHALL use an explicit implementation for the selected registered runtime
- **AND** SHALL NOT infer an implementation solely from the presence of a capability flag

#### Scenario: A capability with no implementation fails the build

- **WHEN** a runtime declares a context-probe, token-audit, or pipeline-dispatch capability and no implementation of that operation is registered for it
- **THEN** the project build SHALL fail identifying the runtime and the missing operation

#### Scenario: An implementation with no capability fails the build

- **WHEN** an implementation of an operation is registered for a runtime whose registry entry does not declare that capability
- **THEN** the project build SHALL fail identifying the runtime and the undeclared operation
