## ADDED Requirements

### Requirement: Runtime preflight probes agent-runtime availability

Before a pipeline is dispatched for execution, the execution preflight SHALL resolve each stage's effective agent runtime — using the precedence stage runtime, then the pipeline's per-role runtime, then the default — across all stages, including the stages of any decompose child pipeline. When any resolved effective runtime is `codex`, the preflight SHALL probe the codex CLI's availability at most once per invocation through an injectable prober, and SHALL fail before dispatch if codex is required but unavailable. The failure message SHALL name both remedies: overriding the affected role to the default runtime, or installing the codex CLI. When no stage resolves to `codex`, the preflight SHALL NOT probe and SHALL NOT fail on runtime-availability grounds.

#### Scenario: Codex required but unavailable fails before dispatch

- **WHEN** a pipeline has a stage whose effective runtime resolves to `codex`
- **AND** the codex CLI is unavailable
- **THEN** the execution preflight SHALL fail before dispatch
- **AND** the error SHALL name both remedies (override the role to the default runtime, or install codex)

#### Scenario: Decompose child runtime is covered

- **WHEN** a decompose stage's child pipeline has a stage whose effective runtime resolves to `codex`
- **AND** the codex CLI is unavailable
- **THEN** the execution preflight SHALL fail before dispatch

#### Scenario: Pure-default pipeline does not probe

- **WHEN** no stage in the pipeline or its decompose children resolves to `codex`
- **THEN** the preflight SHALL NOT probe codex availability
- **AND** it SHALL NOT fail on runtime-availability grounds

#### Scenario: Probe is injectable and runs at most once

- **WHEN** the preflight runs with an injected availability prober over a pipeline containing several `codex` stages
- **THEN** the prober SHALL be consulted at most once for that invocation
