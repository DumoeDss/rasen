## MODIFIED Requirements

### Requirement: Dispatchability is resolved for a host and target pair

Rasen SHALL resolve pipeline dispatch through an explicit host × target route table in addition to target runtime capability eligibility. The shipped routes SHALL be Claude→Claude `native`, Claude→Codex `exec-bridge` through `codex-exec`, Codex→Codex `native`, and Codex→Claude `exec-bridge` through `claude-print`. An unknown host SHALL resolve to an observable `legacy-fallback` compatibility mode. A runtime adapter capability flag SHALL NOT fabricate a route that has no shipped implementation.

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
