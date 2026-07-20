## MODIFIED Requirements

### Requirement: Whitelisted operations only, bounded by the slice boundary rule
The submission bridge SHALL admit only operations from a data-driven whitelist. The whitelist SHALL be tiered:

- **Bounded CLI tier** — operations that terminate deterministically in bounded time without LLM or network dependency, leave no resident process behind, and have their result observable through existing read endpoints. This tier SHALL contain exactly one operation: create-change, served by `POST /api/v1/changes` with unchanged semantics.
- **Supervised long-runner tier** — long-running agent operations, admissible only because the session-supervision capability replaces the bounded-termination guarantee with supervision guarantees: registry tracking, an overall duration cap, a no-output watchdog, and reliable process-tree termination. This tier SHALL contain exactly two operations: `auto` (the `/rasen:auto` pipeline) and `goal` (the `/rasen:goal` loop), served exclusively by the sessions endpoints — never by `POST /api/v1/changes`.

Each tier's endpoint SHALL admit only entries of its own tier. Operations in neither tier SHALL NOT be reachable through any write endpoint.

#### Scenario: Whitelist tiers are exact
- **WHEN** the admission whitelist is enumerated
- **THEN** the bounded CLI tier contains exactly create-change, the supervised long-runner tier contains exactly auto and goal, and no other operation exists

#### Scenario: Long-runner not launchable through the submission endpoint
- **WHEN** a client attempts to invoke an auto or goal run via `POST /api/v1/changes`
- **THEN** the request is rejected without spawning any agent session

#### Scenario: Bounded operation not launchable through the sessions endpoint
- **WHEN** a client sends `POST /api/v1/sessions` with `kind` set to create-change or any value outside the supervised long-runner tier
- **THEN** the server responds 400 with a validation error and spawns nothing
