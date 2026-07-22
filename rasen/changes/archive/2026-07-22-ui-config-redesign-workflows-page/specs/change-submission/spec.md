# change-submission Delta Specification

> Stacked delta: the REMOVED requirement below is the ADDED text of the pending `ui-config-redesign-spaces-page` change's delta to this spec. That change must archive before this one (portfolio ship order guarantees it).

## REMOVED Requirements

### Requirement: Whitelisted operations only, with an enumerated bounded-CLI tier

**Reason**: The requirement pins the bounded-CLI tier to exactly four operations (create-change plus the three space operations). The workflow-library mutation capability adds four more bounded-CLI operations under the same eligibility rule. Replaced by "Whitelisted operations only, across the change, space, and workflow bounded-CLI operations".
**Migration**: Every existing operation's admission, the eligibility criteria, the exclusion of agent commands, and per-endpoint own-operation admission are unchanged; the tier's enumeration grows from four to eight.

## ADDED Requirements

### Requirement: Whitelisted operations only, across the change, space, and workflow bounded-CLI operations

The management platform's CLI-spawn bridges SHALL admit only operations from a single data-driven whitelist. The bounded-CLI tier SHALL contain exactly eight operations: create-change (change submission); create-project-space, register-store-space, and setup-store-space (space creation); and import-workflow, init-workflow, export-workflow, and delete-workflow (workflow library mutation). An operation is eligible for the bounded-CLI tier only if it terminates deterministically in bounded time without LLM or network dependency, leaves no resident process behind, and has its result observable through existing read endpoints. Long-running agent commands (auto runs, goal runs, agent sessions) SHALL NOT be admitted to this tier; they remain exclusively the session-supervision capability's supervised tier. Each endpoint's handler SHALL admit only entries of its own operation set — the change-submission endpoint serves only create-change, the space-creation endpoint serves only the three space operations, and the workflow mutation endpoint serves only the four workflow operations.

#### Scenario: The bounded tier enumerates exactly eight operations

- **WHEN** the whitelist's bounded-CLI tier is enumerated
- **THEN** it contains exactly create-change, create-project-space, register-store-space, setup-store-space, import-workflow, init-workflow, export-workflow, and delete-workflow, and no operation that spawns an agent session

#### Scenario: Endpoints cannot cross-admit operations

- **WHEN** the change-submission endpoint is asked to perform a space or workflow operation, or the workflow endpoint a change or space operation, or any other cross-tier pairing
- **THEN** the request is not admitted — each bridge serves only its own operations

#### Scenario: Agent commands remain excluded

- **WHEN** the bounded-CLI tier is checked for any operation that launches an agent session
- **THEN** no such operation is present; agent launches remain solely under the supervised tier's session endpoints
