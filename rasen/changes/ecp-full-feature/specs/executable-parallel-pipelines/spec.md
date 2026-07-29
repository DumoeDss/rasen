## ADDED Requirements

### Requirement: Reconciler executes choice nodes with persisted selection

The deterministic reconciler SHALL recognize `choice` plan nodes and admit the condition evaluator when the choice's dependencies are satisfied. Upon commit of an evaluator result naming one of the choice's DECLARED outcomes, the reconciler SHALL add the choice's own nodeId to the succeeded set — which makes the selected branch's entry node eligible for admission — and SHALL treat every node reachable only from a rejected branch entry as permanently ineligible. Un-selected branches SHALL never become eligible for admission, SHALL never be admitted after the selected branch completes, and SHALL NOT block the Run's implicit finish. The selected branch is an ordinary plan node: it enters the succeeded set by committing its OWN Action, never by being selected, so nodes downstream of it SHALL NOT become ready until the branch itself has completed. A committed result that does not name a declared outcome SHALL NOT count as a selection. The selection SHALL be persisted in the canonical Record as a committed domain result, ensuring deterministic replay on restart.

#### Scenario: Choice admitted when dependencies satisfied

- **WHEN** a Run with a `choice` node whose `requires` are in the succeeded set is reconciled
- **AND** no committed result exists for the choice's nodeId
- **THEN** the reconciler SHALL emit exactly one `admit` candidate for the choice's condition evaluator
- **AND** the admit SHALL carry the choice's admissionKind, workspace access, and profilePath

#### Scenario: Selected branch activated on commit

- **WHEN** the choice's condition evaluator completes with `{ outcome: 'complex' }`
- **AND** the result is committed to the Record
- **THEN** the reconciler SHALL add the choice's nodeId to the succeeded set
- **AND** SHALL emit an admit candidate for `branches['complex']`
- **AND** SHALL NOT emit an admit candidate for any other branch path
- **AND** SHALL NOT add any branch path to the succeeded set — a branch enters the succeeded set only by committing its own Action

#### Scenario: Downstream of the selected branch waits for the branch itself

- **WHEN** the committed choice result selected `'simple'`
- **AND** a node requires `branches['simple']`
- **AND** the selected branch has no committed result yet
- **THEN** the downstream node SHALL NOT become ready
- **AND** the reconciler SHALL NOT emit an admit candidate for it

#### Scenario: Un-selected branch never executes

- **WHEN** a downstream node requires branch path `branches['simple']`
- **AND** the committed choice result selected `'complex'`
- **THEN** the downstream node SHALL NOT become ready
- **AND** the reconciler SHALL NOT emit an admit candidate for it

#### Scenario: Un-selected branch stays ineligible after the selected branch completes

- **WHEN** the committed choice result selected `'simple'`
- **AND** the selected branch has committed a succeeded result
- **AND** no workspace lock is held
- **THEN** the reconciler SHALL NOT emit an admit candidate for `branches['complex']`
- **AND** every node reachable only from `branches['complex']` SHALL remain ineligible

#### Scenario: Rejected branch does not block the implicit finish

- **WHEN** the committed choice result selected `'simple'`
- **AND** every node NOT reachable only from a rejected branch entry has succeeded
- **THEN** the reconciler SHALL emit a `finish` candidate with the plan's implicit finish outcome
- **AND** the Run SHALL reach its terminal outcome WITHOUT executing the rejected branch

#### Scenario: Convergence node after the branches rejoin is not excluded

- **WHEN** a node is reachable from BOTH the selected and a rejected branch entry
- **THEN** the reconciler SHALL NOT treat it as an excluded branch node
- **AND** it SHALL remain gated by its own `requires` like any other node

#### Scenario: Malformed choice result is not a selection

- **WHEN** the choice's committed result does not name one of the choice's declared outcomes
- **THEN** the reconciler SHALL NOT add the choice's nodeId to the succeeded set
- **AND** SHALL NOT mark any branch ineligible
- **AND** SHALL re-admit the choice's condition evaluator

#### Scenario: Choice selection deterministic on restart

- **WHEN** a Run is restarted after the choice result was committed
- **THEN** the reconciler SHALL read the same committed result
- **AND** SHALL derive the same succeeded set
- **AND** SHALL NOT re-admit the choice evaluator

### Requirement: Reconciler executes fan-out nodes with concurrency cap and budget

The deterministic reconciler SHALL recognize `fan-out` plan nodes, admit the condition evaluator to determine active members, and admit active member nodes subject to a concurrency cap and budget. The concurrency cap limits how many members are admitted per reconcile pass. The budget limits total member admissions across the Run lifetime. Member candidates SHALL pass through the same `selectCompatibleAdmissions` as atomic and bounded-loop candidates, preserving the single-writer-per-workspace lock invariant.

#### Scenario: FanOut condition evaluator admitted first

- **WHEN** a Run with a `fan-out` node whose `requires` are in the succeeded set is reconciled
- **AND** no committed condition result exists
- **THEN** the reconciler SHALL emit exactly one `admit` for the fan-out's condition evaluator
- **AND** member nodes SHALL NOT be admitted until the condition result is committed

#### Scenario: Active members admitted under concurrency cap

- **WHEN** the fan-out's condition result is committed with 5 active members
- **AND** the concurrency cap is 3
- **THEN** the reconciler SHALL admit at most 3 member candidates per reconcile pass
- **AND** the 3 admitted SHALL be the first 3 in stable hierarchical-path order
- **AND** remaining members SHALL be admitted in subsequent passes as slots free up

#### Scenario: Budget exhaustion suppresses remaining members

- **WHEN** the budget is 4 and 4 members have already been admitted
- **AND** a 5th active member is ready
- **THEN** the reconciler SHALL NOT admit the 5th member
- **AND** the Join SHALL treat the 5th member as suppressed (not required-failed)

#### Scenario: FanOut members respect workspace lock

- **WHEN** two fan-out members with `access: 'write'` are ready
- **THEN** the reconciler SHALL admit at most one write-access member per pass
- **AND** the other SHALL be blocked by `selectCompatibleAdmissions`
- **AND** a `workspace-reservation` wait SHALL be emitted for the blocked member

#### Scenario: Suppressed members never admitted

- **WHEN** the condition result lists a member as inactive
- **THEN** the reconciler SHALL NOT emit an admit candidate for that member
- **AND** the Join SHALL ignore the member entirely

### Requirement: Reconciler executes join nodes with required/optional/fail-closed semantics

The deterministic reconciler SHALL recognize `join` plan nodes as barriers over fan-out member outcomes. The Join SHALL proceed (add to succeeded set) when all active required members have succeeded and all active optional members are terminal. The Join SHALL fail closed (emit escalate) when any active required member has a non-succeeded terminal state. The Join SHALL suppress (ignore) optional member failures. An active member — required OR optional — whose Action is admitted, granted, or blocked but not yet committed counts as NON-terminal, so the Join SHALL wait for it rather than proceeding while it is still in flight.

#### Scenario: Join proceeds when all required succeed

- **WHEN** all active required members have committed succeeded results
- **AND** all active optional members are terminal (succeeded or failed)
- **THEN** the reconciler SHALL add the join's nodeId to the succeeded set
- **AND** downstream nodes that require the join SHALL become eligible

#### Scenario: Join fails closed on required member failure

- **WHEN** an active required member has a committed failed result
- **THEN** the reconciler SHALL emit an escalate candidate with the join's `outcomes.failed` code
- **AND** the join's nodeId SHALL NOT be added to the succeeded set
- **AND** downstream nodes SHALL NOT become eligible

#### Scenario: Join suppresses optional member failure

- **WHEN** an active optional member has a committed failed result
- **AND** all active required members have succeeded
- **THEN** the reconciler SHALL ignore the optional member's failure
- **AND** SHALL add the join's nodeId to the succeeded set once all active members are terminal

#### Scenario: Join waits for non-terminal members

- **WHEN** an active required member has an active (non-terminal) action
- **THEN** the reconciler SHALL NOT add the join to the succeeded set
- **AND** SHALL NOT emit an escalate candidate
- **AND** the Run classification SHALL be `running` or `waiting`

#### Scenario: Join waits for an in-flight OPTIONAL member

- **WHEN** all active required members have committed succeeded results
- **AND** an active optional member has an admitted-but-uncommitted action
- **THEN** the reconciler SHALL NOT add the join to the succeeded set
- **AND** SHALL NOT emit an escalate candidate
- **AND** the join SHALL proceed only once that optional member reaches a terminal state

#### Scenario: Join idempotent on restart

- **WHEN** a Run is restarted after some members have committed results
- **THEN** the reconciler SHALL read the same committed results
- **AND** SHALL derive the same Join state
- **AND** SHALL NOT re-admit completed members
- **AND** SHALL NOT re-evaluate already-consumed member results

### Requirement: Lowerer produces choice, fan-out, and join runtime plan nodes

The lowerer SHALL lower Definition v2 `Choice`, `FanOut`, and `Join` root nodes to the corresponding runtime plan node kinds. FanOut members SHALL be lowered as atomic nodes with a `fanOut` tag carrying the parent nodeId and `required` flag. The lowerer SHALL validate that all FanOut members have frozen capability bindings and that the Join references valid member nodeIds.

#### Scenario: Choice lowers with branch mapping

- **WHEN** a Definition v2 root node of kind `Choice` with outcomes `['simple', 'complex']` is lowered
- **THEN** the runtime plan SHALL contain a `choice` node with `outcomes: ['simple', 'complex']`
- **AND** `branches` SHALL map each outcome to the downstream node's hierarchical path

#### Scenario: FanOut lowers with member atomic nodes

- **WHEN** a Definition v2 root node of kind `FanOut` with 3 branches is lowered
- **THEN** the runtime plan SHALL contain one `fan-out` node with 3 members
- **AND** 3 `atomic` nodes with `fanOut: { nodeId, required }` tags
- **AND** each member's `requires` SHALL include the fan-out's nodeId

#### Scenario: Join lowers with required/optional split

- **WHEN** a Definition v2 root node of kind `Join` is lowered
- **THEN** the runtime plan SHALL contain a `join` node
- **AND** `requiredMembers` SHALL list the nodeIds of required fan-out members
- **AND** `optionalMembers` SHALL list the nodeIds of optional fan-out members

#### Scenario: Unsupported node kinds rejected

- **WHEN** a Definition v2 root node of an unrecognized kind is lowered
- **THEN** the lowerer SHALL throw `lowerer_shape_mismatch`

### Requirement: Normalizer maps v1 parallelGroup to v2 FanOut/Join

The normalizer in `definition.ts` SHALL detect v1 stages with `parallelGroup` and produce v2 `FanOut` + member `AtomicStage` nodes + `Join` root nodes. `condition: always` SHALL map to `required: true`; all other conditions SHALL map to `required: false`.

#### Scenario: parallelGroup produces FanOut and Join

- **WHEN** a v1 pipeline with `parallelGroup: experts` on 6 stages is normalized
- **THEN** the v2 definition SHALL contain a `FanOut` root node with 6 members
- **AND** a `Join` root node
- **AND** 6 `AtomicStage` member root nodes
- **AND** the downstream stage's `requires` SHALL reference the Join node

#### Scenario: condition always maps to required

- **WHEN** a v1 stage has `condition: always`
- **THEN** the corresponding v2 FanOut member SHALL have `required: true`

#### Scenario: conditional stage maps to optional

- **WHEN** a v1 stage has `condition: security-relevant`
- **THEN** the corresponding v2 FanOut member SHALL have `required: false`

### Requirement: Projection emits parallel and choice view sections

The projector SHALL emit a `parallel/1` section when the plan contains a fan-out node and a `choice/1` section when the plan contains a choice node. Both sections SHALL derive from the canonical Record and be additive alongside existing sections.

#### Scenario: parallel section shows member frontier

- **WHEN** a Run with a fan-out node is projected
- **THEN** the `ChangeRunView` SHALL contain a `parallel/1` section
- **AND** the section SHALL list each member with status (suppressed/ready/running/succeeded/failed)
- **AND** SHALL show the join state, concurrency cap, budget usage, and key blockers

#### Scenario: choice section shows selected outcome

- **WHEN** a Run with a choice node is projected after the choice result is committed
- **THEN** the `ChangeRunView` SHALL contain a `choice/1` section
- **AND** the section SHALL show the selected outcome and active/inactive branches

### Requirement: Canvas provides parallel authoring with legality feedback

The Canvas SHALL display FanOut, Join, and Choice nodes with their structural details. The Canvas SHALL validate concurrency cap bounds (1–32), budget sufficiency (>= required member count), and Join required/optional assignments. Over-budget or illegal shapes SHALL NOT be marked runnable.

#### Scenario: FanOut panel shows members and limits

- **WHEN** a FanOut node is selected in the Canvas
- **THEN** the panel SHALL show the member list with required badges and conditions
- **AND** SHALL show concurrency cap and budget as configurable scalars

#### Scenario: Over-budget shape rejected

- **WHEN** a FanOut has budget=2 but 3 required members
- **THEN** the Canvas SHALL show a validation error
- **AND** SHALL NOT mark the pipeline as runnable

### Requirement: Recovery at parallel boundaries is deterministic

The same immutable plan + committed Record SHALL always produce the same FanOut active-member set, concurrency-capped admission, and Join barrier state. Completed members SHALL NOT be re-admitted. Committed member results SHALL be consumed exactly once by the Join.

#### Scenario: Crash before FanOut condition commit

- **WHEN** the FanOut condition evaluator is admitted but not completed
- **AND** the Run is restarted
- **THEN** the reconciler SHALL re-admit the condition evaluator (same nodeId, same occurrence)
- **AND** no members SHALL be admitted

#### Scenario: Crash mid-member-execution

- **WHEN** 2 of 5 active members have committed succeeded results
- **AND** 1 member is active (admitted but not completed)
- **AND** the Run is restarted
- **THEN** the reconciler SHALL NOT re-admit the 2 completed members
- **AND** SHALL NOT re-admit the active member (it stays active)
- **AND** SHALL admit remaining members up to the concurrency cap

#### Scenario: Required member failure → Join fail-closed

- **WHEN** a required member commits a failed result
- **THEN** the Join SHALL emit escalate
- **AND** the Run SHALL NOT complete as `completed`

#### Scenario: Optional member failure → Join suppresses

- **WHEN** an optional member commits a failed result
- **AND** all required members have succeeded
- **THEN** the Join SHALL proceed once all active members are terminal
- **AND** the optional failure SHALL be recorded in the parallel section as `failed`
