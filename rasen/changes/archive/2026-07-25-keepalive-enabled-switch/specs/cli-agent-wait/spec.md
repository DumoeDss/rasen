## MODIFIED Requirements

### Requirement: Runtime gating
The command SHALL detect the invoking agent runtime from the host environment (Claude Code and Codex fingerprints, reusing the existing runtime-detection utilities) and consult the resolved keepalive gates. When effective `keepalive.enabled` is `false`, the command SHALL return `{ "standDown": true, "reason": "keepalive-disabled" }` immediately, with no blocking and no beat-state mutation. Otherwise, with defaults, the `claude` runtime is enabled, the `codex` runtime is disabled, and an unrecognized runtime is disabled. When the runtime gate is closed the command SHALL return `{ "standDown": true, "reason": "runtime-not-gated" }` immediately, with no blocking and no beat-state mutation.

#### Scenario: Claude runtime is gated on
- **WHEN** the command runs under a Claude Code environment fingerprint with default configuration
- **THEN** the beat executes normally (blocking poll, beat counting)

#### Scenario: Codex runtime is gated off
- **WHEN** the command runs under a Codex environment fingerprint with default configuration
- **THEN** the command returns `{ "standDown": true, "reason": "runtime-not-gated" }` immediately and writes no beat state

#### Scenario: Unknown runtime fails safe
- **WHEN** neither runtime fingerprint is detected
- **THEN** the command returns `{ "standDown": true, "reason": "runtime-not-gated" }` immediately

#### Scenario: Configuration overrides the gate
- **WHEN** the resolved configuration sets `keepalive.runtimes.codex` to `true`
- **THEN** a Codex-fingerprinted invocation executes beats normally

#### Scenario: Disabled keepalive stands down before runtime gating
- **WHEN** the effective `keepalive.enabled` value is `false` and `rasen agent wait` is invoked under any runtime
- **THEN** the command returns `{ "standDown": true, "reason": "keepalive-disabled" }` immediately and writes no beat state

#### Scenario: Project switch overrides the global switch
- **WHEN** global configuration sets `keepalive.enabled` to `true` and the current project sets it to `false`
- **THEN** `rasen agent wait` returns the `keepalive-disabled` stand-down outcome without blocking
