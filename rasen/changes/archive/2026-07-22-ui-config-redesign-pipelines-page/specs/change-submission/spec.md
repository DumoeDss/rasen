# change-submission Delta Specification

> Stacked delta: the REMOVED requirement below is the ADDED text of the pending `ui-config-redesign-workflows-page` (W4) change's delta to this spec — W4 (and transitively W6) must archive before this change.

## REMOVED Requirements

### Requirement: Whitelisted operations only, across the change, space, and workflow bounded-CLI operations

**Reason**: The requirement pins the bounded-CLI tier to exactly eight operations. The pipeline-library mutation capability adds four more under the same eligibility rule. Replaced by "Whitelisted operations only, across the change, space, workflow, and pipeline bounded-CLI operations".
**Migration**: Every existing operation's admission, the eligibility criteria, the exclusion of agent commands, and per-endpoint own-operation admission are unchanged; the tier's enumeration grows from eight to twelve.

## ADDED Requirements

### Requirement: Whitelisted operations only, across the change, space, workflow, and pipeline bounded-CLI operations

The management platform's CLI-spawn bridges SHALL admit only operations from a single data-driven whitelist. The bounded-CLI tier SHALL contain exactly twelve operations: create-change (change submission); create-project-space, register-store-space, and setup-store-space (space creation); import-workflow, init-workflow, export-workflow, and delete-workflow (workflow library mutation); and import-pipeline, init-pipeline, export-pipeline, and delete-pipeline (pipeline library mutation). An operation is eligible for the bounded-CLI tier only if it terminates deterministically in bounded time without LLM or network dependency, leaves no resident process behind, and has its result observable through existing read endpoints. Long-running agent commands (auto runs, goal runs, agent sessions) SHALL NOT be admitted to this tier; they remain exclusively the session-supervision capability's supervised tier. Each endpoint's handler SHALL admit only entries of its own operation set — the change-submission endpoint serves only create-change, the space-creation endpoint serves only the three space operations, the workflow mutation endpoint serves only the four workflow operations, and the pipeline mutation endpoint serves only the four pipeline operations.

#### Scenario: The bounded tier enumerates exactly twelve operations

- **WHEN** the whitelist's bounded-CLI tier is enumerated
- **THEN** it contains exactly the twelve operations above and no operation that spawns an agent session

#### Scenario: Endpoints cannot cross-admit operations

- **WHEN** any bridge endpoint is asked to perform an operation belonging to another bridge's set (change, space, workflow, or pipeline)
- **THEN** the request is not admitted — each bridge serves only its own operations

#### Scenario: Agent commands remain excluded

- **WHEN** the bounded-CLI tier is checked for any operation that launches an agent session
- **THEN** no such operation is present; agent launches remain solely under the supervised tier's session endpoints
