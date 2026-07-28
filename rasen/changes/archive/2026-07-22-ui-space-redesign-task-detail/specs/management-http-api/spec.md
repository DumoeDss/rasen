## ADDED Requirements

### Requirement: Task roster endpoint reports a Task's full active-and-archived membership

The management server SHALL expose a read-only endpoint that, given a Task id and a planning space, reports that Task's complete roster: its kind (portfolio or single-item), each constituent change with its lifecycle facts and task progress, whether each change is active or archived, and any declared per-child dependency hints. The endpoint SHALL be authenticated and space-addressed exactly like the changes listing — an explicit space selector resolves through the machine registries and an omitted selector falls back to the launch project — and SHALL be strictly read-only: it creates no directory, mints no identity, and writes no file. It SHALL report a portfolio Task even when every one of its children has been archived (and so none appear in the active changes listing), and SHALL report a Task-not-found result for an id that names no active, archived, or portfolio Task in the space.

#### Scenario: Portfolio roster includes active and archived children

- **WHEN** the endpoint is queried for a portfolio Task whose children are partly active and partly archived, within a resolvable space
- **THEN** it returns the Task as a portfolio kind with every child listed, each flagged active or archived, and each active child carrying its lifecycle facts and task progress

#### Scenario: Single-item Task returns its one change

- **WHEN** the endpoint is queried for a bare change that belongs to no portfolio
- **THEN** it returns the Task as a single-item kind whose sole child is that change, with its task progress and task items

#### Scenario: Dependency hints come from the recorded portfolio run

- **WHEN** a portfolio Task's recorded run state declares that a child depends on sibling children
- **THEN** the endpoint reports those dependency hints on that child; and when no run state is recorded it reports no dependencies without erroring

#### Scenario: Portfolio with only archived children is still reported

- **WHEN** the endpoint is queried for a portfolio container whose children have all been archived
- **THEN** it still returns the Task with its archived children rather than a not-found result

#### Scenario: Unknown Task id is a not-found result

- **WHEN** the endpoint is queried for an id that matches no active change, archived change, or portfolio container in the space
- **THEN** it responds with a not-found error and creates nothing

#### Scenario: The endpoint never writes

- **WHEN** the endpoint serves any request
- **THEN** it performs only reads — no change directory, run-state file, or identity is created or modified as a side effect
