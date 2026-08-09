# pipelines-ui Specification Delta

## MODIFIED Requirements

### Requirement: Canvas holds one complete versioned Definition draft

Canvas SHALL load and save one complete version-discriminated Pipeline Definition draft. Every fresh assemble flow and not-found empty-draft recovery SHALL start from the canonical blank Definition v2 envelope. Canvas SHALL preserve authored v1 editing and duplication as compatibility behavior and SHALL represent v2 directly; Canvas MUST NOT maintain a second executable graph, flatten v2 into the v1 stage model, or serialize a normalized v1 definition as authored v2. Saving, detailing, duplicating, exporting, importing, and reloading a v2 draft SHALL preserve all unedited semantic fields and exact capability revisions through the canonical server writer.

#### Scenario: Fresh Canvas draft is v2

- **WHEN** a user starts assembling a new pipeline or chooses empty-draft recovery for an absent name
- **THEN** Canvas creates the version 2 blank envelope with the requested stable name and source identity
- **AND** it does not create hidden v1 stages or a parallel v1 draft

#### Scenario: v2 fields survive an unrelated edit

- **WHEN** a user edits one exposed property of a v2 draft that contains declaration, execution, lifecycle, parallel, graph, or extension fields the current control does not change
- **THEN** save preserves every unedited v2 field verbatim alongside the intentional edit
- **AND** the server returns the semantic projection expected from that edit rather than from a reconstructed UI model

#### Scenario: No-op v2 round trip preserves digests

- **WHEN** a valid v2 definition is loaded into Canvas, saved without a semantic edit, reloaded from detail, exported, and imported under the same trusted capability catalog
- **THEN** its source, capability, and plan digests remain equal
- **AND** its authored version remains 2

#### Scenario: All supported authored contracts reload

- **WHEN** a user authors definition and declaration contracts plus AtomicStage, CompositeRef, BoundedLoop, Choice, FanOut/Join, Gate, and Finish nodes through Canvas and saves successfully
- **THEN** detail reload returns the same stable identities, typed fields, connections, execution declarations, limits, exits, lifecycle policy, capability revisions, and terminal mappings
- **AND** Canvas renders those returned values as editable authored source

#### Scenario: v2 duplicate is a user-source fork

- **WHEN** a user duplicates a native v2 built-in or user definition under a new valid name
- **THEN** the duplicate receives stable user-definition and source identities for the new name while preserving its typed contracts and graph meaning
- **AND** it does not retain package provenance as the source of the editable copy

#### Scenario: v1 draft remains editable and duplicable

- **WHEN** a user opens or duplicates an existing editable authored v1 Pipeline
- **THEN** the existing stage editing, save, and duplicate contracts remain available
- **AND** opening, editing, saving, or duplicating the draft does not rewrite it to version 2

#### Scenario: Blank factory mirror cannot drift

- **WHEN** the browser blank-draft factory is compared with the core public blank-v2 fixture for the same name
- **THEN** both produce the same version, identities, typed contract fields, declarations, and empty root graph

### Requirement: Canvas edits the enabled v2 root vocabulary

Canvas SHALL render, create, connect, select, edit, rename, and delete the supported v2 root vocabulary: `AtomicStage`, `CompositeRef`, `BoundedLoop`, `Choice`, `FanOut`, `Join`, `Gate`, and `Finish`. It SHALL expose the complete typed authored fields required by each kind, retain stable node and connection identities, and keep structured references coherent when an identity changes. The server's shared preparation remains authoritative for graph, port, capability, lifecycle, and lowering legality; Canvas SHALL present its diagnostics rather than infer a second executable profile.

#### Scenario: AtomicStage authors capability and execution meaning

- **WHEN** a user adds an AtomicStage from an enabled catalog capability
- **THEN** the node carries that exact capability revision and a complete version 1 execution declaration with explicit role and workspace access
- **AND** the user can edit applicable verification, runtime, model, effort, sandbox, session-reuse, lead-review, and handoff fields without authoring a second Gate field

#### Scenario: CompositeRef Choice and Finish are fully editable

- **WHEN** a user adds a CompositeRef, Choice, or Finish
- **THEN** the user can select the referenced declaration, author unique Choice outcomes, select compatible typed connections, and author the terminal Finish outcome
- **AND** each value remains attached to the same stable node after save and reload

#### Scenario: Gate is the sole authored gate authority

- **WHEN** a user adds a Gate for an AtomicStage and authors its decisions
- **THEN** the Gate targets exactly that AtomicStage and every unique decision maps to exactly one `proceed`, `fail`, or `escalate` disposition
- **AND** save/reload preserves the Gate identity, target, decisions, and dispositions without adding `AtomicStage.execution.gate`

#### Scenario: FanOut and Join are authored as one parallel contract

- **WHEN** a user creates a parallel frontier from eligible root members
- **THEN** Canvas creates a FanOut and paired Join with the same ordered membership, explicit member paths, required/optional partition, conditions, positive concurrency cap and budget, stable Join reference, and distinct proceed/failed outcomes
- **AND** both nodes remain selectable and editable on the graph

#### Scenario: Parallel membership edit updates both halves

- **WHEN** a user adds, removes, renames, or changes required status for a FanOut member
- **THEN** FanOut branches/member metadata and Join inputs/required/optional membership update as one authored operation
- **AND** Canvas refuses an edit that would leave an empty or structurally split parallel contract

#### Scenario: Identity edit preserves structured references

- **WHEN** a user renames a root AtomicStage used by typed connections, a Gate, or a FanOut/Join contract, or renames a declaration used by CompositeRef or BoundedLoop
- **THEN** Canvas rewrites every owned connection endpoint and structured reference to the new stable identity
- **AND** no stale hidden reference remains in the submitted draft

#### Scenario: Illegal typed graph remains fail closed

- **WHEN** a draft contains an incompatible typed port, a non-Atomic Gate target, duplicate decisions, inconsistent parallel partitions, an invalid cap or budget, an ordinary graph cycle, or an unsupported node shape
- **THEN** server preparation returns path-addressed errors and Canvas blocks save
- **AND** no Run or executable-profile claim is created from the invalid draft

### Requirement: Canvas and server diagnostics have locator parity

Canvas SHALL consume the server's shared diagnostic severity, code, message, related locations, and JSON Pointer path and map valid paths to the corresponding definition control, root node or connection, declaration, declaration body node or connection, and closest nested property control. Client-side connection and identity checks MAY provide immediate feedback, but server preparation remains authoritative. Every diagnostic SHALL remain visible with its complete path even when the current client cannot map it.

#### Scenario: Root graph issue is marked in both planes

- **WHEN** a v2 graph has an invalid typed connection or nested root-node field and is checked locally and by draft validation
- **THEN** Canvas and server identify the same connection or consuming node and closest property path
- **AND** the server diagnostic remains visible in the issue list and on the mapped graph element or control

#### Scenario: Declaration issue selects its editor

- **WHEN** a diagnostic points to a declaration contract, declaration body AtomicStage execution field, or body connection
- **THEN** selecting the issue opens that declaration and identifies the affected contract field, body node, or body connection
- **AND** the full `/declarations/<index>/...` path remains visible

#### Scenario: Definition limit issue selects the definition contract

- **WHEN** validation returns an issue at `/limits/budget` or another top-level typed contract field
- **THEN** selecting the issue focuses the definition-contract editor and marks the budget or corresponding field
- **AND** the issue is not classified as declaration- or root-unmapped

#### Scenario: Nested loop and parallel issue selects the exact section

- **WHEN** validation reports a BoundedLoop lifecycle/limit/exit path, a FanOut member condition/cap/budget path, a Join partition/outcome path, or a Gate disposition path
- **THEN** Canvas selects the owning root node and marks the closest nested structured control
- **AND** editing any other field clears the prior result so a stale marker is not presented as current

#### Scenario: Unknown locator is never dropped or misdirected

- **WHEN** a diagnostic path is malformed, out of range, or belongs to a newer field the client cannot yet represent
- **THEN** Canvas lists its severity, code, message, and full path as unmapped
- **AND** it does not select a different element or hide the diagnostic

## ADDED Requirements

### Requirement: Canvas authors v2 definition and Composite declaration contracts

Canvas SHALL provide structured editing for definition inputs, artifact outputs, named outcomes, and optional global action/budget limits, and for custom Composite declaration identity, typed inputs, artifacts, named outcomes, and body graph. A declaration body SHALL support AtomicStage creation, edit, connection, rename, and removal with exact capability and complete execution declarations. Optional ReviewCycle/GoalLoop phase metadata SHALL remain typed and shall be validated with its role, workspace access, and capability contract. Built-in declaration provenance SHALL remain visible and protected, while custom declarations SHALL retain the existing referenced-delete guard.

#### Scenario: User authors the top-level typed contract

- **WHEN** a user adds or edits definition input ports, artifact outputs, named terminal outcomes, max actions, or budget
- **THEN** Canvas submits those typed fields in the same v2 definition envelope used by root graph editing
- **AND** duplicate names, invalid types, invalid outcomes, or non-positive limits are reported at the corresponding controls before save succeeds

#### Scenario: User authors a complete custom declaration

- **WHEN** a user creates a custom Composite declaration, edits its inputs/artifacts/outcomes, adds execution-complete body AtomicStages, and connects compatible body ports
- **THEN** the declaration remains one body graph in the complete draft and can be selected by CompositeRef or BoundedLoop
- **AND** save/reload preserves its contract, body stage identities, capabilities, execution/phase metadata, and connections

#### Scenario: Body stage keeps phase safety visible

- **WHEN** a body AtomicStage is assigned a ReviewCycle or GoalLoop phase
- **THEN** Canvas exposes its exact capability revision, execution role, and workspace access together
- **AND** an incompatible review fixer, re-reviewer, goal worker, or goal judge binding is rejected by shared preparation at the phase field

#### Scenario: Body graph cycle is refused and diagnosed

- **WHEN** a user connects a declaration body stage to one of its direct or transitive prerequisites
- **THEN** Canvas refuses the connection immediately without mutating the body graph
- **AND** the server remains able to report `GRAPH_CYCLE` for any cyclic authored source received through another route

#### Scenario: Referenced declaration cannot be removed

- **WHEN** a custom declaration is referenced by a root CompositeRef or BoundedLoop
- **THEN** Canvas refuses deletion and names the referencing root node or nodes
- **AND** no dangling declaration id is submitted

#### Scenario: Unexposed declaration fields remain lossless

- **WHEN** a declaration or body node contains a valid extension or policy field not exposed by the edited control
- **THEN** the unrelated edit, save, and reload retain that field unchanged

### Requirement: Canvas authors the complete shared BoundedLoop contract

Canvas SHALL allow a user to create and edit a BoundedLoop that names one eligible declaration body, declares positive loop-local iteration/action/budget limits, maps every reachable body outcome to `continue` or `exit` with a typed output, and carries one complete `lifecycle.version: 1` policy. The lifecycle editor SHALL expose stall and repeated-blocker thresholds, bounded strategy attempts, material-change requirement, an exact optional strategy capability revision, and dispositions for iteration limit, action limit, budget limit, stall, blocked, and strategy exhaustion. Lifecycle mechanical exits SHALL remain distinct from domain body exits and from domain success.

#### Scenario: User authors a complete bounded loop

- **WHEN** a user chooses a non-empty Composite body and completes its limits, body-outcome mappings, lifecycle thresholds, strategy, and six mechanical trigger dispositions
- **THEN** Canvas validates and saves one authored BoundedLoop using the shared lifecycle contract
- **AND** reload presents the same body, limits, mappings, capability pin, and dispositions

#### Scenario: Domain continuation and terminal exit stay distinct

- **WHEN** one reachable body outcome is mapped to continue and another to exit with a typed output
- **THEN** Canvas preserves those domain mappings separately from lifecycle iteration/action/budget/stall/blocked/strategy-exhausted dispositions
- **AND** an exit used for a report tail is not labeled as domain satisfaction merely because it leaves the loop

#### Scenario: Strategy capability is explicit and bounded

- **WHEN** a lifecycle strategy permits one or more attempts
- **THEN** the user selects an exact enabled strategy capability revision and the authored policy keeps `requireMaterialChange: true`
- **AND** zero strategy attempts omit the capability rather than retaining an unreachable binding

#### Scenario: Incomplete lifecycle is repairable at its field

- **WHEN** the policy omits a threshold or mechanical exit, uses an illegal disposition, declares a strategy without a capability, or maps a body outcome that is not reachable
- **THEN** shared preparation returns every independent error at its lifecycle or domain-exit path
- **AND** Canvas selects and marks the corresponding loop control and blocks save

#### Scenario: Nested and recursive loops remain outside the authoring set

- **WHEN** a selected declaration transitively contains another BoundedLoop or recursively references itself
- **THEN** shared preparation rejects the unsupported shape with a path-addressed diagnostic
- **AND** Canvas does not offer an alternate runtime or hidden flattening to bypass the refusal
