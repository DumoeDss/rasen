# workflow-http-api Delta

## ADDED Requirements

### Requirement: Workflow dependency graph read

The management API SHALL offer an authenticated read that serves, for every workflow in the catalog, its strong dependency closure and its weak enhancement associations, derived from existing registry data: a workflow's declared required workflows and required skills, plus — through its required pipelines — the workflows owning each unconditional pipeline stage's skill, form the strong set (served transitively closed, so a client can cascade without walking the graph); the workflows owning condition-gated stages' skills form the weak set, served inverted as the list of workflows each unit enhances. The computation SHALL be tolerant of imperfect data: self-references are dropped, dependency cycles do not fail the read, and a pipeline that cannot be loaded or a skill with no owning catalog unit is skipped rather than erroring — the graph is advisory. The read SHALL reflect the current catalog freshly on each request and SHALL write nothing.

#### Scenario: Strong closure is transitive and complete for a driver

- **WHEN** a client requests the dependency graph
- **THEN** the auto driver's entry lists a strong closure including the workflows owning its pipelines' unconditional stage skills (proposal, apply, review-cycle, ship, archive, retro, office-hours, and the always-dispatched review expert), each listed once, with no self-reference

#### Scenario: Conditional experts appear as enhancements

- **WHEN** a client requests the dependency graph
- **THEN** experts dispatched only under a condition in some workflow's pipelines (for example the security expert in the full-feature pipeline) list that workflow in their enhances list and do not appear in its strong closure

#### Scenario: Broken references degrade silently

- **WHEN** the catalog contains a workflow whose required pipeline is missing, or a pipeline stage naming a skill no catalog unit owns
- **THEN** the read succeeds, that reference contributes nothing, and every resolvable edge is still served
