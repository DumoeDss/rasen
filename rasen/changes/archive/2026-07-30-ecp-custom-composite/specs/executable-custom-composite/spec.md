## ADDED Requirements

### Requirement: CompositeRef inlined into runtime plan

The lowerer SHALL inline a root-level `CompositeRef` node's declaration body into the runtime plan as atomic nodes with hierarchical paths. Each body AtomicStage SHALL become a runtime plan atomic node whose hierarchical path encodes both the CompositeRef and the body stage identity. The inlined nodes SHALL use the same admission, workspace, gate, and finish-guard machinery as root-level AtomicStage nodes — no privileged runtime path.

#### Scenario: Simple composite inlined and executed

- **WHEN** a v2 definition has a root-level CompositeRef referencing a declaration with two AtomicStage body nodes (stage-a → stage-b)
- **AND** the Run is started
- **THEN** the reconciler SHALL admit stage-a first (its dependency is the CompositeRef's root-level requires)
- **AND** after stage-a succeeds, the reconciler SHALL admit stage-b
- **AND** after stage-b succeeds, the CompositeRef's root-level dependents SHALL become eligible

#### Scenario: Composite body stage with gate

- **WHEN** a composite body AtomicStage has a gate policy
- **THEN** the inlined runtime plan node SHALL carry the gate
- **AND** the reconciler SHALL emit `await-gate` before admitting the stage
- **AND** a gate decision SHALL unblock the stage exactly as a root-level gated stage

#### Scenario: CompositeRef with multiple root-level dependents

- **WHEN** a CompositeRef has two downstream root-level AtomicStage nodes
- **AND** the composite body completes successfully
- **THEN** both downstream nodes SHALL become eligible for admission in the same reconcile pass

### Requirement: BoundedLoop with composite body kind

The runtime plan SHALL support a `composite` body kind alongside the existing `review-cycle` body kind for `BoundedLoop` nodes. A `BoundedLoop` whose declaration body is not ReviewCycle-shaped (lacks the 4 `reviewCyclePhase`-tagged AtomicStages) SHALL be lowered as a composite body. The reconciler SHALL execute the composite body by admitting body stages in topological order each iteration and mapping the body's declared outcomes to the loop's continue/exit decisions.

#### Scenario: Composite-body loop iterates until exit outcome

- **WHEN** a BoundedLoop with a composite body (2 AtomicStages + Finish outcome 'done') has `maxIterations: 3` and exit `{ done: { action: 'exit', outcome: 'success' } }`
- **AND** iteration 1 completes with the Finish producing outcome 'done'
- **THEN** the loop SHALL exit with outcome 'success'
- **AND** the loop's nodeId SHALL be added to the succeeded set

#### Scenario: Composite-body loop reaches maxIterations without exit

- **WHEN** a BoundedLoop with a composite body has `maxIterations: 2`
- **AND** both iterations complete without producing an exit outcome
- **THEN** the reconciler SHALL emit an escalate candidate with the loop's exhausted outcome

#### Scenario: Composite-body loop stage waiting

- **WHEN** the current iteration's next body stage has an active (admitted but not completed) action
- **THEN** the reconciler SHALL NOT emit a new admit candidate for that stage
- **AND** the Run classification SHALL be running or waiting

### Requirement: Canvas creates and references a Custom Composite declaration

The Canvas SHALL allow the user to create a new `CompositeDeclaration` with a unique id, provenance `custom`, declared inputs, artifacts, outcomes, and a body graph. The user SHALL be able to reference the declaration from the root graph via a `CompositeRef` node or embed it in a `BoundedLoop`. The Canvas SHALL validate that the declaration id is unique within the definition.

#### Scenario: User creates a custom composite and references it

- **WHEN** the user creates a declaration `my-composite` with outcomes `['done']` and a body of two AtomicStage nodes
- **AND** adds a CompositeRef node to the root graph referencing `my-composite`
- **AND** saves the definition
- **THEN** the prepared definition SHALL be valid
- **AND** the declaration SHALL appear in `definition.declarations` with `provenance: 'custom'`

#### Scenario: Duplicate declaration id rejected

- **WHEN** the user creates a declaration with an id that already exists in the definition
- **THEN** the Canvas SHALL reject the creation with a duplicate-id diagnostic
- **AND** the definition SHALL not be saved

### Requirement: Canvas folds and expands a CompositeRef

The Canvas SHALL render a `CompositeRef` node with a fold/expand toggle. When folded, the node displays the declaration name, outcome ports, and a composite badge. When expanded, the body stages are shown inline as a read-only sub-graph within the composite's visual bounding box. The fold state is a display preference and SHALL NOT alter the underlying definition.

#### Scenario: Folded CompositeRef shows summary

- **WHEN** a CompositeRef node is folded
- **THEN** the Canvas SHALL display the declaration name and outcome ports
- **AND** SHALL NOT display the individual body stages

#### Scenario: Expanded CompositeRef shows body stages

- **WHEN** a CompositeRef node is expanded
- **THEN** the Canvas SHALL display the body AtomicStage nodes within the composite's bounding box
- **AND** the body stages SHALL be visually nested under the composite

### Requirement: Canvas edits composite declaration scalar fields

The Canvas SHALL allow the user to edit a custom declaration's inputs (add/remove/rename port name and type), artifacts (add/remove/rename), and outcomes (add/remove/rename). Changes to the declaration contract SHALL trigger server-side validation that checks port mappings between the declaration and its body graph connections.

#### Scenario: User adds an input port to a custom declaration

- **WHEN** the user adds an input port `review-target` of type `string` to a custom declaration
- **AND** saves the definition
- **THEN** the prepared definition SHALL include the new port in the declaration's inputs
- **AND** the semantic digest SHALL reflect the change

#### Scenario: User removes an outcome that is referenced by an exit mapping

- **WHEN** the user removes outcome `done` from a declaration that is referenced by a BoundedLoop exit
- **THEN** the Canvas SHALL show a validation error indicating the outcome is referenced
- **AND** the server-side `MISSING_EXIT` or `PORT_MISMATCH` diagnostic SHALL fire on prepare

### Requirement: Canvas edits composite body stages

The Canvas SHALL allow the user to add, remove, and edit AtomicStage nodes within a custom declaration's body graph. The body palette SHALL be constrained to `AtomicStage` only — `CompositeRef`, `BoundedLoop`, `Choice`, `FanOut`, and `Join` SHALL NOT be available in the body palette. Body connections SHALL be validated against the same DAG-cycle rules as root connections.

#### Scenario: User adds an AtomicStage to a custom declaration body

- **WHEN** the user adds an AtomicStage with capability `skill:rasen-apply` to a declaration body
- **AND** connects it to an existing body stage
- **AND** saves
- **THEN** the prepared definition SHALL include the new stage in the declaration's body graph

#### Scenario: Body connection creating a cycle is rejected

- **WHEN** the user draws a connection in the declaration body that would create a cycle
- **THEN** the Canvas SHALL reject the connection
- **AND** the server-side `GRAPH_CYCLE` diagnostic SHALL confirm the rejection on prepare

### Requirement: Canvas deletes a CompositeRef or declaration

The Canvas SHALL allow the user to delete a `CompositeRef` node from the root graph. When a declaration is no longer referenced by any root node, the user MAY delete the declaration. The Canvas SHALL NOT allow deleting a declaration that is still referenced by a root-level `CompositeRef` or `BoundedLoop`.

#### Scenario: Deleting an unreferenced declaration

- **WHEN** the user deletes a declaration that has no root-level references
- **THEN** the declaration SHALL be removed from the definition
- **AND** the definition SHALL remain valid

#### Scenario: Deleting a referenced declaration is blocked

- **WHEN** the user attempts to delete a declaration that is referenced by a CompositeRef
- **THEN** the Canvas SHALL block the deletion with a reference error

### Requirement: Static validation rejects invalid custom-authored shapes

The Definition v2 prepare pipeline SHALL reject custom-authored definitions that contain recursion, nested loops, general graph cycles, missing loop exits, unreachable exits, illegal port mappings, capability mismatches, and impossible budgets. These validators SHALL fire identically whether the definition was authored in the Canvas or constructed programmatically.

#### Scenario: Recursive CompositeRef rejected

- **WHEN** a declaration A references declaration B, and declaration B references declaration A
- **THEN** prepare SHALL fail with a `COMPOSITE_RECURSION` diagnostic
- **AND** the definition SHALL not produce a plan

#### Scenario: Nested BoundedLoop in composite body rejected

- **WHEN** a BoundedLoop's body declaration transitively contains another BoundedLoop
- **THEN** prepare SHALL fail with a `NESTED_LOOP` diagnostic

#### Scenario: Missing exit for reachable body outcome rejected

- **WHEN** a BoundedLoop's body can produce outcome `partial` but the loop's exits do not map `partial`
- **THEN** prepare SHALL fail with a `MISSING_EXIT` diagnostic

#### Scenario: Port type mismatch in declaration body rejected

- **WHEN** a body connection produces type `ecp/control` but the consumer port expects `string`
- **THEN** prepare SHALL fail with a `PORT_MISMATCH` diagnostic

#### Scenario: Capability not in catalog rejected

- **WHEN** a body AtomicStage references a capability id that is not in the frozen catalog
- **THEN** prepare SHALL fail with a `CAPABILITY_MISSING` diagnostic

### Requirement: Built-in and custom isomorphic plans

A custom CompositeRef whose body is isomorphic to a set of root-level AtomicStages (same stages, same dependency graph, same capabilities) SHALL produce a runtime plan with the same structure: same node count, same topological order, same dependency relationships, and same reconcile() output for the same Record state. There SHALL be no privileged built-in path.

#### Scenario: Custom composite and equivalent root-level plan produce equivalent reconcile output

- **WHEN** a custom CompositeRef wrapping stages A → B → C is lowered
- **AND** an equivalent root-level plan with AtomicStage A → B → C is lowered
- **THEN** both runtime plans SHALL have the same number of atomic nodes
- **AND** both SHALL produce the same admit candidates for the same Record state
- **AND** both SHALL produce the same finish outcome

### Requirement: Export/import round-trip preserves semantic digest

A custom composite definition that undergoes Canvas save → detail → export → re-import SHALL produce an unchanged semantic digest. The `semanticCanonicalizeDefinition` function SHALL strip `provenance`, `canvas`, `position`, and `sourcePath` keys so that display-only metadata does not affect the digest.

#### Scenario: Round-trip with canvas metadata

- **WHEN** a custom composite definition with `canvas` position metadata is saved
- **AND** the saved definition is re-imported
- **THEN** the semantic digest of the re-imported definition SHALL equal the original
- **AND** the `canvas` and `position` keys SHALL NOT appear in the canonical form

### Requirement: Composite drill-down projection

The projector SHALL emit a `composite/1` view section when the runtime plan contains an inlined composite (from CompositeRef or composite-body BoundedLoop). The section SHALL list each body stage's hierarchical path, status, capability, and actor, and the composite's current outcome. CLI, Management API, and Operations SHALL consume this section from the same `ChangeRunView`.

#### Scenario: Composite section shows body stage states

- **WHEN** a Run with an inlined composite has body stage A succeeded and body stage B active
- **THEN** the `composite/1` section SHALL list stage A with status `succeeded` and stage B with status `active`
- **AND** the section SHALL include the declaration id and composite path

#### Scenario: Composite section reflects loop iteration

- **WHEN** a composite-body BoundedLoop is in iteration 2 of 3
- **THEN** the `composite/1` section SHALL include `round: 2` and `maxIterations: 3`

### Requirement: Recovery at composite body stage boundaries

Recovery at quiescent boundaries between inlined composite body stages SHALL be deterministic. The same frozen plan and committed Record SHALL always produce the same next action, regardless of crash point. Completed body stages SHALL NOT be re-admitted; uncommitted completions SHALL NOT advance the state.

#### Scenario: Crash after body stage commit

- **WHEN** body stage A's completion is committed but the Run crashes before stage B is admitted
- **AND** the Run is resumed
- **THEN** the reconciler SHALL admit stage B (A is in the succeeded set)
- **AND** stage A SHALL NOT be re-admitted

#### Scenario: Crash before body stage commit

- **WHEN** body stage A is admitted but the Run crashes before A's completion is committed
- **AND** the Run is resumed
- **THEN** stage A SHALL remain active (its action is still in-flight)
- **AND** the reconciler SHALL NOT admit stage B

### Requirement: Real dogfood of a Canvas-authored Custom Composite

A non-built-in Custom Composite authored through the Canvas SHALL complete real success, failure, and recovery paths via the reconciler. Evidence SHALL include the revision, RunId, ActionId, actor, and evidence refs for each path.

#### Scenario: Dogfood success path

- **WHEN** a Canvas-authored custom composite is run against a real Change
- **AND** all body stages complete successfully
- **THEN** the Run SHALL reach a completed terminal
- **AND** the projection SHALL show the composite outcome

#### Scenario: Dogfood recovery path

- **WHEN** a Canvas-authored custom composite Run is interrupted mid-body-stage
- **AND** resumed
- **THEN** the Run SHALL continue from the correct body stage
- **AND** no committed work SHALL be lost or duplicated
