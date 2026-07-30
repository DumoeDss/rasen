## MODIFIED Requirements

### Requirement: Runtime preflight probes agent-runtime availability

Before a pipeline is dispatched for execution, the execution preflight SHALL detect the LEAD host once, resolve every stage's effective target runtime with all configured runtime layers, and resolve the host × target dispatch mode and bridge across all stages, including stages of any decompose child pipeline. A known `unsupported` route SHALL fail before dispatch with an actionable error naming the host, target, affected stage or role, and a supported override. For every required `exec-bridge`, preflight SHALL probe that bridge's CLI availability at most once per bridge kind per invocation through injectable probers and SHALL fail before dispatch if the required bridge is unavailable. Native stages SHALL NOT require or probe an external CLI bridge. An unknown host SHALL retain the legacy fallback with an actionable diagnostic rather than being represented as a verified native route.

#### Scenario: Claude-to-Codex bridge unavailable fails before dispatch

- **WHEN** a Claude-hosted pipeline has a stage whose effective runtime resolves to Codex
- **AND** the Codex CLI is unavailable
- **THEN** execution preflight fails before dispatch
- **AND** the error names both remedies: use a supported runtime override or install the Codex CLI

#### Scenario: Codex-to-Claude bridge unavailable fails before dispatch

- **WHEN** a Codex-hosted pipeline has a stage whose effective runtime resolves to Claude
- **AND** the Claude CLI is unavailable
- **THEN** execution preflight fails before dispatch
- **AND** the error names both remedies: use a supported runtime override or install Claude Code

#### Scenario: Native pipeline does not probe an external bridge

- **WHEN** every stage resolves to the recognized host runtime
- **THEN** each stage resolves dispatch mode `native`
- **AND** neither the Codex nor Claude bridge availability prober is called

#### Scenario: Configured runtime instances participate in preflight

- **WHEN** project, store, global, or invocation runtime configuration changes a role's effective target
- **THEN** preflight validates the route and required bridge for that configured target
- **AND** it does not validate a different target obtained by ignoring configuration

#### Scenario: Decompose child routes are covered

- **WHEN** a decompose child pipeline contains an exec-bridge or unsupported route after effective runtime resolution
- **THEN** the parent execution preflight applies the same bridge availability or rejection rule before fan-out

#### Scenario: Each required bridge probe is injectable and runs at most once

- **WHEN** preflight runs with injected availability probers over a pipeline containing several stages that use the same exec bridge
- **THEN** the required bridge's prober is consulted at most once for that invocation
- **AND** a prober for an unused bridge is not called

#### Scenario: Unknown host keeps compatibility with a diagnostic

- **WHEN** host detection returns unknown
- **THEN** execution retains the legacy runtime/bridge behavior
- **AND** reports how to select a deterministic host with `RASEN_AGENT_RUNTIME`
