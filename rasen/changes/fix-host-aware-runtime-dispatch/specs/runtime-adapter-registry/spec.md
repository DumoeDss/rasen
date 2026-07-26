## ADDED Requirements

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

Rasen SHALL resolve pipeline dispatch through an explicit host × target route table in addition to target runtime capability eligibility. The shipped routes SHALL be Claude→Claude `native`, Claude→Codex `exec-bridge`, Codex→Codex `native`, and Codex→Claude `unsupported`. An unknown host SHALL resolve to an observable `legacy-fallback` compatibility mode. A runtime adapter capability flag SHALL NOT fabricate a route that the host cannot execute.

#### Scenario: Same-host dispatch is native

- **WHEN** host and target are both Claude or both Codex
- **THEN** the route resolver reports `native`

#### Scenario: Claude can bridge to Codex

- **WHEN** the host is Claude and the target is Codex
- **THEN** the route resolver reports `exec-bridge`
- **AND** identifies the shipped Codex exec bridge as the required implementation

#### Scenario: Known unsupported pair is explicit

- **WHEN** the host is Codex and the target is Claude
- **THEN** the route resolver reports `unsupported`
- **AND** does not infer support merely because Claude is a dispatch-capable target runtime

#### Scenario: Unknown host remains diagnosable

- **WHEN** the host detector reports `unknown`
- **THEN** the route resolver reports `legacy-fallback`
- **AND** the result remains distinguishable from a verified native or exec-bridge route

## MODIFIED Requirements

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
