## MODIFIED Requirements

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
