# change-submission Delta Specification

## REMOVED Requirements

### Requirement: Whitelisted operations only, bounded by the slice boundary rule

**Reason**: The requirement pins the whitelist to exactly one operation (create-change). The space-creation capability adds three bounded-CLI operations under the same eligibility rule. Replaced by "Whitelisted operations only, with an enumerated bounded-CLI tier".
**Migration**: create-change's admission, eligibility criteria, and the exclusion of agent commands are unchanged; the tier's enumeration grows.

## ADDED Requirements

### Requirement: Whitelisted operations only, with an enumerated bounded-CLI tier

The management platform's CLI-spawn bridges SHALL admit only operations from a single data-driven whitelist. The bounded-CLI tier SHALL contain exactly four operations: create-change (change submission), create-project-space, register-store-space, and setup-store-space (space creation). An operation is eligible for the bounded-CLI tier only if it terminates deterministically in bounded time without LLM or network dependency, leaves no resident process behind, and has its result observable through existing read endpoints. Long-running agent commands (auto runs, goal runs, agent sessions) SHALL NOT be admitted to this tier; they remain exclusively the session-supervision capability's supervised tier. Each endpoint's handler SHALL admit only entries of its own operation set — the change-submission endpoint serves only create-change, and the space-creation endpoint serves only the three space operations.

#### Scenario: The bounded tier enumerates exactly four operations

- **WHEN** the whitelist's bounded-CLI tier is enumerated
- **THEN** it contains exactly create-change, create-project-space, register-store-space, and setup-store-space, and no operation that spawns an agent session

#### Scenario: Endpoints cannot cross-admit operations

- **WHEN** the change-submission endpoint is asked to perform a space operation, or vice versa
- **THEN** the request is not admitted — each bridge serves only its own operations

#### Scenario: Agent commands remain excluded

- **WHEN** the bounded-CLI tier is checked for any operation that launches an agent session
- **THEN** no such operation is present; agent launches remain solely under the supervised tier's session endpoints
