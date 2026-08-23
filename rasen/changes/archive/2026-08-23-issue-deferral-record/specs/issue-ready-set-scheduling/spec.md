# issue-ready-set-scheduling Specification — Delta

## MODIFIED Requirements

### Requirement: Every non-member is named with a reason

Every node of the revision the ready set does not contain SHALL be reported with a reason
drawn from one closed vocabulary derived from the node's own projection facts: a `cancelled`
node with its recorded reason; a `superseded` node with its recorded reason; a `deferred`
node with its recorded reason — postponed work is outside the set whatever its recorded
observation, exactly as abandoned or replaced work is; an intent node as
pending Change creation with its target project and target line; a node whose observation is
`in-flight`, `advanced`, or `waiting-human` as running with that observation named; a `failed`
node as failed; a node whose work is complete — `finalized` or `run-terminal` — as complete; a
not-started node whose dependencies are not all complete as blocked, naming each non-terminal
dependency with its node identifier, its target project, and its observed state in the same
refinement vocabulary the node line uses; and an `unknown` node as unknown with its diagnostic.
No node SHALL be silently dropped from the answer, and no reason SHALL name a state the
projection did not observe.

#### Scenario: A cancelled node exits with its reason visible

- **WHEN** the revision carries a `cancelled` node with a recorded reason
- **THEN** the ready answer names that node outside the set as cancelled with its recorded reason
- **AND** the node is not omitted from the answer

#### Scenario: A superseded node exits with its reason visible

- **WHEN** the revision carries a `superseded` node with a recorded reason
- **THEN** the ready answer names that node outside the set as superseded with its recorded reason
- **AND** the node's history remains queryable on the read surfaces that carry it

#### Scenario: An intent node is named pending Change creation

- **WHEN** the revision carries an intent node
- **THEN** the ready answer names it outside the set as pending Change creation with its target project and target line
- **AND** it is never a ready-set member, because no Change exists to run

#### Scenario: A blocked node names each blocker with project and state

- **WHEN** a not-started node depends on two nodes whose work is not complete, one targeting another member project
- **THEN** the node is reported outside the set as blocked, naming both blockers
- **AND** each blocker is named with its node identifier, its target project, and its observed state, cross-project blockers included

#### Scenario: A running node is named running, not excluded silently

- **WHEN** a wanted node's observation is `in-flight`
- **THEN** the ready answer names it outside the set as running with the in-flight observation
- **AND** its dependency facts, if any, are not reported as the reason — the observation is

#### Scenario: An unknown node is never ready

- **WHEN** a wanted not-started node's observation is `unknown` with a diagnostic
- **THEN** the node is reported outside the set as unknown with its diagnostic
- **AND** no ready-set membership is derived from unreadable facts

#### Scenario: A deferred node exits with its reason visible

- **WHEN** the revision carries a not-started `deferred` node with a recorded reason and no incomplete dependencies
- **THEN** the ready answer names that node outside the set as deferred with its recorded reason
- **AND** the node is never a member and is not reported as blocked, running, or any state the projection did not observe

#### Scenario: A node behind a deferred dependency stays blocked with the dependency named

- **WHEN** a wanted not-started node depends on a `deferred` node whose work is not complete
- **THEN** the downstream node is reported outside the set as blocked, naming the deferred dependency with its node identifier, target project, and observed state
- **AND** the deferral does not silently release the downstream node — re-edging or deferring the dependent is the next revision's explicit act
