## MODIFIED Requirements

### Requirement: Exact process-authority provider selection
Rasen SHALL expose a platform-neutral process-authority provider contract and SHALL dispatch preparation or recovery only to the exact registered provider, capability, and protocol identity requested or persisted for that authority. The recursive process-scope capability SHALL enumerate exactly eight semantics as one indivisible versioned contract: forked-descendant non-escape, exact root-exit distinction, exact scope-empty, exact recursive termination, exact recursive abort, bounded control, identity-drift detection, and event-completeness.

Forked-descendant non-escape SHALL mean only that no descendant the workload itself forks can leave the exact authority, including a descendant that calls `setsid` or double-forks to detach. It SHALL NOT be read as a claim that nothing the workload caused still exists: a workload that asks a reachable out-of-scope service to start a process on its behalf produces a process this contract does not govern, and Rasen SHALL NOT treat that as a contract violation. `exact-scope-empty` SHALL continue to mean exactly what the provider measures, that no process remains in the exact authority.

Replacement recovery across controller lifetimes SHALL NOT be advertised by this capability version. A durable authority SHALL NOT be claimed to survive the death of the controller that created it. Publication-before-activation SHALL NOT be advertised as a capability semantic either: the durable publication machinery that gave it a cross-controller recovery purpose is deferred with replacement recovery, while pre-activation workload inertness and exactly-once explicit activation are retained as their own requirements below.

#### Scenario: Exact provider tuple is registered
- **WHEN** a caller requests a provider id, recursive-scope capability id, and protocol version that exactly match one valid registry entry
- **THEN** Rasen dispatches the operation to that entry and preserves the exact tuple in the resulting authority reference

#### Scenario: Duplicate or ambiguous registration
- **WHEN** registry construction receives duplicate provider identities, duplicate exact tuples, or conflicting descriptors for one provider
- **THEN** Rasen rejects the registry before any preparation or recovery operation can run

#### Scenario: Registry provenance is forged
- **WHEN** a coordinator receives a registry subclass, proxy, structural lookalike, or overridden public selector rather than the exact closed registry instance that completed manifest validation
- **THEN** Rasen returns `authority-unavailable` through an internal non-overridable selector and performs zero provider preparation, observation, or control dispatch

#### Scenario: No exact provider is available
- **WHEN** the requested exact provider tuple is absent or its availability probe cannot establish the required authority
- **THEN** Rasen returns `authority-unavailable` without trying a weaker provider, PID tree, process group, or registration-order fallback

#### Scenario: Capability subset would weaken authority
- **WHEN** a provider offers only a subset of the recursive-scope capability or a caller requests a subset that omits one required semantic
- **THEN** Rasen rejects negotiation and does not activate a workload under that capability name

#### Scenario: Provider advertises a retired semantic
- **WHEN** a runtime descriptor or packaged provider manifest enumerates a retired semantic name, an extra semantic, or the retired semantic ordering under the same capability id
- **THEN** registry construction or manifest validation fails closed before any preparation, observation, or control dispatch
- **AND** the stale artifact cannot be accepted as an equivalent of the current capability contract

### Requirement: Bounded prepare, publish, and activate ordering
Rasen SHALL prepare an inert authority, bind the exact reference to a successful durable publication acknowledgment, and activate it exactly once only after publication. Prepare, publication, activation, and prepared abort SHALL each have a bounded outcome, and no failure before activation may silently run workload code.

This ordering is retained coordinator mechanics, not an advertised semantic of the recursive process-scope capability. The durable publication machinery that gave the ordering a cross-controller recovery purpose is deferred to the upgrade path with replacement recovery, and a provider fixture MAY satisfy the publication acknowledgment with the non-durable canonical helper as the conformance requirement provides. Deferring the publish-before-activate semantic SHALL NOT weaken pre-activation inertness or exactly-once activation, which are stated independently below.

#### Scenario: Prepare remains inert
- **WHEN** a provider successfully prepares an authority and returns its opaque reference
- **THEN** the workload has not started and the only permitted next operations are exact publication or abort

#### Scenario: Exact publication enables activation
- **WHEN** the trusted host durably publishes the exact prepared reference and supplies the matching publication acknowledgment
- **THEN** Rasen enters `published-inert` and exposes one activation capability for that same reference

#### Scenario: Durable publication callback does not settle
- **WHEN** the trusted durable publisher exceeds the common publish deadline or loses control
- **THEN** Rasen returns typed retained `timeout` or `control-loss` for phase `publish`, aborts its operation signal, preserves the exact reference, and does not activate workload code

#### Scenario: Runtime bridge fails before activation
- **WHEN** the compatibility adapter cannot acquire and validate its runtime bridge while authority is `published-inert`
- **THEN** it performs one bounded published abort before workload activation and releases only from an authentic exact-empty receipt

#### Scenario: Activate before publication
- **WHEN** a caller or mutation attempts to activate a prepared authority before the matching publication acknowledgment
- **THEN** Rasen rejects activation, the workload remains inert, and the authority remains available for bounded abort or reconciliation

#### Scenario: Publication identity does not match preparation
- **WHEN** the publication acknowledgment names a different reference digest, version, or preparation operation
- **THEN** Rasen consumes the publication capability, returns retained `control-loss` for phase `publish`, forbids another publisher invocation, and permits only bounded abort or exact-reference reconciliation

#### Scenario: Duplicate activation or late publication
- **WHEN** a caller repeats activation, publishes after abort, or supplies a second publication acknowledgment after a state transition
- **THEN** Rasen settles exactly once, does not start a second workload, and returns a typed ordering conflict without changing the recorded state

### Requirement: Exact lifecycle observations remain distinct
Rasen SHALL keep `prepared-inert`, `published-inert`, `live`, `root-exited`, and `exact-scope-empty` as distinct lifecycle facts. Only `exact-scope-empty` SHALL authorize release of durable process authority; `root-exited`, provider loss, or a closed transport MUST NOT authorize release.

Recovery of an authority by a replacement controller after its creating controller has died is deferred to the upgrade path and is not part of this capability version. Its implementation and evidence are retained in version control rather than deleted, but Rasen SHALL NOT advertise, require, or accept a receipt that claims a replacement controller resumed live authority over an already-published scope. The generation ledger, collision rules, and capacity rules SHALL continue to apply to locally prepared authorities.

#### Scenario: Backend root exits while authority remains live
- **WHEN** the backend root exits while any descendant or provider authority may still exist
- **THEN** Rasen reports `root-exited` with the backend status, retains the exact reference, and continues to permit only exact inspect or termination reconciliation

#### Scenario: Exact natural scope empty
- **WHEN** the selected provider positively proves that no process remains in the exact recursive authority
- **THEN** Rasen emits one `exact-scope-empty` receipt and permits the host to release the corresponding durable authority

#### Scenario: Provider reference is reused
- **WHEN** a provider returns an active or retired provider-reference generation that the coordinator has already observed
- **THEN** Rasen rejects the new preparation before publication or activation, preserves the earlier lifecycle truth, and never replays its exact-empty receipt for the new attempt

#### Scenario: Reference tombstone retention is exhausted
- **WHEN** the fixed reference-lifecycle ledger cannot retain another non-reusable generation
- **THEN** Rasen atomically reserves capacity before preparation, refuses overflow before provider dispatch, and releases a preparation reservation only when failure, timeout, or collision minted no reference

#### Scenario: Inspect preserves an inert phase
- **WHEN** exact inspection of an authority prepared by the current controller reports `prepared-inert` or `published-inert`
- **THEN** Rasen preserves that exact state and reference for bounded termination or reconciliation without translating it to live, closed, or control loss

#### Scenario: Root-exit status is incomplete
- **WHEN** any observation or control result reports `root-exited` without exact `code` and `signal` fields or with both values null
- **THEN** Rasen rejects the provider value as retained control loss and does not synthesize missing status

#### Scenario: Authority becomes unavailable after publication
- **WHEN** inspect, terminate, or abort cannot open the exact provider authority after its reference was durably published
- **THEN** Rasen returns `authority-unavailable` with the same reference and does not report exact-scope-empty

#### Scenario: Authority truth is uncertain
- **WHEN** the provider cannot prove a more specific live, empty, drift, gap, timeout, or loss outcome
- **THEN** Rasen returns `authority-uncertain` with the same reference and permits no optimistic release or restart

#### Scenario: Identity drift forbids control
- **WHEN** an operation finds that native identity no longer exactly matches the persisted provider reference
- **THEN** Rasen returns `identity-drift`, performs no signal or destructive control, retains the reference, and never translates the observation to closed

#### Scenario: Event completeness has a gap
- **WHEN** an event-backed provider detects a missing, reordered, or otherwise incomplete observation interval
- **THEN** Rasen returns `event-gap`, retains the reference, and does not claim exact empty or successful recursive termination

#### Scenario: Controller death does not leave resumable authority
- **WHEN** the controller that created a live authority dies
- **THEN** Rasen SHALL NOT report that the authority is reattachable, resumable, or recoverable by a later controller
- **AND** any later controller that encounters the persisted reference SHALL fail closed rather than open native control over it

## ADDED Requirements

### Requirement: Per-operation authority revalidation is retained independently of replacement recovery

Reopen-and-revalidate is a destructive-target-safety mechanism, not replacement-recovery machinery, and SHALL be retained in full while replacement recovery is deferred. Every control verb SHALL reopen the exact authority from its opaque reference and revalidate the complete native identity tuple before it signals, terminates, aborts, or otherwise acts destructively, even when the control verb runs in a process that did not perform preparation but shares the controller's lifetime.

Deferring replacement recovery SHALL NOT be treated as authorization to remove the versioned opaque reference envelope, the reopen-and-revalidate ordering, or the refusal to act on drifted or ambiguous identity. A change that removes any of those SHALL be rejected as a loss of destructive-target safety regardless of how it is scoped.

#### Scenario: Control verb runs in a fresh process within the controller lifetime
- **WHEN** a control verb executes in a helper process that consumes the opaque reference rather than in the process that prepared the authority
- **THEN** it verifies the envelope, opens the native authority handle, rereads and compares the complete identity tuple, and only then dispatches control

#### Scenario: Revalidation finds a different native identity
- **WHEN** per-operation revalidation finds a boot id, start time, identifier, or namespace that does not exactly match the persisted reference
- **THEN** Rasen performs no signal or destructive control on that target and returns the retained drift outcome

#### Scenario: Scope reduction attempts to remove the revalidation path
- **WHEN** a change removes the opaque reference envelope, the reopen-and-revalidate ordering, or the drift refusal on the grounds that replacement recovery is deferred
- **THEN** the contract is violated because those mechanisms serve per-operation destructive-target safety within one controller lifetime

### Requirement: Exactly-once explicit activation is retained independently of publication semantics

Exactly-once explicit activation and pre-activation workload inertness are activation discipline, not publication machinery, and SHALL be retained in full while the publish-before-activate semantic is deferred. A prepared authority SHALL run no workload code until one explicit activation step, and activation SHALL settle exactly once: the compatibility adapter SHALL refuse a repeated activation before it invokes any publication or provider operation, and the coordinator SHALL never start a second workload for one authority regardless of how activation is retried.

Deferring the publish-before-activate semantic SHALL NOT be treated as authorization to remove the explicit activation step, the exactly-once settlement, or workload inertness before activation. A change that removes any of those SHALL be rejected as a loss of activation discipline regardless of how it is scoped.

#### Scenario: Adapter refuses repeated activation before any provider call
- **WHEN** a caller invokes activation on a provider-backed process scope whose activation has already been invoked
- **THEN** the adapter fails with a typed activation error before any publication or provider operation is dispatched
- **AND** no second workload starts

#### Scenario: Prepared authority stays inert without activation
- **WHEN** an authority has been prepared but no explicit activation step has run
- **THEN** no workload code has executed and only bounded abort or reconciliation may follow

#### Scenario: Scope reduction attempts to remove activation discipline
- **WHEN** a change removes the explicit activation step, the exactly-once settlement, or pre-activation inertness on the grounds that the publish-before-activate semantic is deferred
- **THEN** the contract is violated because activation discipline is enforced independently of publication and does not leave with it
