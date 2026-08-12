## MODIFIED Requirements

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
