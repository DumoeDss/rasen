## MODIFIED Requirements

### Requirement: The capability matrix declares exact turn continuation support

Every executor backend declaration SHALL include a `continuableTurns` fact visible to every driver before Action start. In 0.2.0 the hosted backend SHALL declare `continuableTurns: true` because it owns a stable wakeable Session, and the in-tool backend SHALL declare `continuableTurns: false` because launcher-owned worker continuation is not a durable ECP authority. The separate `consultable-leaf` contract SHALL be selectable only on a runtime/backend route that supplies this stable hosted continuation authority. Current Codex exec dispatch SHALL reject `consultable-leaf` before binary resolution or process start. A consultation-eligible Action SHALL require an available cell whose declaration is true; failure SHALL be typed and SHALL NOT silently reroute.

#### Scenario: Matrix distinguishes hosted and in-tool continuation
- **WHEN** the current-host capability cells are queried
- **THEN** hosted SHALL report `continuableTurns: true` and in-tool SHALL report `continuableTurns: false`
- **AND** the existing durability, headless, cancel, scope-empty, and usage-attribution facts SHALL remain unchanged

#### Scenario: Uncontinuable selection fails before Action dispatch
- **WHEN** an eligible source Action is resolved against an unavailable hosted cell or an in-tool cell
- **THEN** the executor SHALL return typed `consultation-continuation-unavailable`
- **AND** SHALL NOT run the source Action or select another backend in response

#### Scenario: Codex consultable dispatch is rejected before work
- **WHEN** an agent dispatch selects runtime `codex` with contract `consultable-leaf`
- **THEN** the dispatch SHALL return a typed invalid-input result before resolving or spawning the Codex binary
- **AND** SHALL NOT downgrade the contract, start a replacement Session, or silently reroute the request to Claude

#### Scenario: Existing Codex terminal contracts remain available
- **WHEN** a Codex dispatch selects the existing `leaf` or `evaluate` contract
- **THEN** its established exec dispatch and strict structured-result behavior SHALL remain available
- **AND** the consultation guard SHALL NOT change its model, effort, sandbox, resume-thread, or failure attribution
