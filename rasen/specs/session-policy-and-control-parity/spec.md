# session-policy-and-control-parity Specification

## Purpose
Guarantee that every driver face — the interactive launcher, the CLI, the Management API, Canvas, Operations/audit, and the daemon — addresses the same canonical Run through the one shared frozen-Action dispatch contract, so no face can maintain a second Run or Session truth or project a Run/Action/completion fact the canonical Record does not back. It owns the exhaustive cancel/restart/ack-loss fault matrix (every failure mode recovers only the uncommitted frontier with no re-send, no re-execution, and fail-closed on unprovable state, composing typed `execution-lost`), and it makes session reuse/handoff/touch/retire policy authoritative and face-invariant: one configured, provenance-stamped policy block resolved once governs every face, and no configured limit can disable the cross-authority or past-limit safety decisions.
## Requirements
### Requirement: Every driver face routes every operation to the same Run through the shared contract

The Claude/Codex interactive launcher, the bare CLI, the Management API, Canvas, the Operations/audit plane, and the daemon SHALL each route start, resume, cancel, inspect, and audit operations for a canonical Run through the shared projector and control contract the frozen-action session executor exposes, so that every face resolves to the same canonical RunId and ActionId. "When capability allows" SHALL be decided solely by the queryable capability matrix the executor computes: a face SHALL NOT assert availability the matrix does not report, and a driver x backend x platform combination that is not available SHALL return a typed unavailable reason rather than proceeding. No face SHALL maintain a second Run, Session, or completion truth.

#### Scenario: Each face addresses the same Run for each operation
- **WHEN** a Run is started from one driver face and start, resume, cancel, inspect, and audit are later issued from a different face
- **THEN** every operation from every face resolves to the same canonical RunId and ActionId through the shared contract
- **AND** no face creates or reads a duplicate Run, Session, or completion truth

#### Scenario: Availability is matrix-driven on every face
- **WHEN** a face decides whether an operation is allowed for a driver, backend, and platform
- **THEN** it honours the capability matrix's typed availability verdict
- **AND** an unavailable combination returns a typed unavailable reason on every face

#### Scenario: The headless driver is independent of the interactive launcher on every face
- **WHEN** a Run is driven through the daemon face on a platform where the hosted backend is available
- **THEN** the Run does not require the interactive launcher to remain alive
- **AND** launcher exit does not end the Run

### Requirement: A parity drift-prevention gate refuses a divergent Run/Session truth

A parity gate SHALL assert that every driver face's projected Run/Action identity and completion state is backed by the canonical Run Record. A face that projects a Run, Action, Session, or completion fact not present in the canonical Record SHALL fail closed with a typed drift outcome and SHALL NOT silently regress to a divergent truth.

#### Scenario: A divergent projection fails closed
- **WHEN** a driver face projects a Run/Action identity or completion state the canonical Record does not back
- **THEN** the parity gate returns a typed drift outcome
- **AND** no divergent Run, Session, or completion truth is treated as authoritative

#### Scenario: A mutation that introduces divergence is caught
- **WHEN** a mutation causes a face to maintain a second Run or Session truth
- **THEN** the parity gate fails
- **AND** a matching mutation receipt shows the gate red against the divergence

### Requirement: Recovery from every cancel, restart, and ack-loss failure mode continues only the uncommitted frontier

The executor's recovery SHALL be proven under an exhaustive fault matrix covering the seven named failure modes: cancel-before-start, cancel-in-flight, host/daemon restart, worker process loss, completion ack loss, duplicate completion, and stale control (host/daemon restart exercised for both the host process and the daemon process). For every entry in the matrix, recovery SHALL continue only the uncommitted frontier: already-committed invocations and effects SHALL NOT be re-executed, an input whose commitment state is unknown SHALL NOT be resent, and any state that cannot be proven SHALL be typed-waited or escalated rather than silently completed or silently dropped. Daemon death on the hosted backend and launcher disappearance on the in-tool backend SHALL compose into the executor's typed `execution-lost` outcome and resume from the committed frontier with no reattach and no identity revalidation.

**Locked decision 11 scope.** Scope lifetime equals daemon lifetime; resume is from the committed frontier only. **Locked decision 13 scope.** Windows proves zero-orphan daemon-death teardown via the cutover's Job `KILL_ON_JOB_CLOSE` chain; on linux and macOS the orphan risk is a declared known limitation and the matrix entry proves `execution-lost` typing plus uncommitted-frontier integrity.

#### Scenario: Cancel-before-start and cancel-in-flight recover exactly once
- **WHEN** a cancel is injected before a turn starts or while it is in flight
- **THEN** recovery does not re-execute any committed invocation or effect
- **AND** the uncommitted frontier is the only thing re-driven

#### Scenario: Host/daemon restart and worker process loss resume from the committed frontier
- **WHEN** the host process restarts, the daemon restarts, or the worker process is lost during an in-flight Action
- **THEN** the in-flight Action is typed `execution-lost` where the owning process died and the Run resumes from the committed frontier
- **AND** no reattach or identity revalidation occurs and no committed work is re-executed

#### Scenario: Completion ack loss, duplicate completion, and stale control fail closed
- **WHEN** a completion acknowledgement is lost, a second completion arrives, or a stale control reaches a settled or restarted generation
- **THEN** the executor does not double-settle, does not advance from an unprovable state, and returns a typed outcome
- **AND** no duplicate execution or silent completion occurs

#### Scenario: Unprovable state is typed-waited or escalated
- **WHEN** a recovery point cannot be proven committed or uncommitted
- **THEN** the executor reports a typed wait or escalation
- **AND** it does not silently complete or silently drop the work

#### Scenario: The matrix is exercised at the shipped backend seam
- **WHEN** a matrix entry runs
- **THEN** the fault is injected at the executor's injectable backend seam that the real session host also satisfies
- **AND** the exercised path is the production execution path, not a parallel fixture

### Requirement: Reuse, handoff, touch, and retire policy is resolved from a configurable provenance-bearing source

The numeric reuse limits - `handoffTokenLimit`, `reuseRoundLimit`, and the touch/retire cadence - SHALL be resolvable from an operator/author configuration source through the existing configuration chain, so a configured value carries `authored` or `definition` provenance and only an unset value carries `default` provenance. The configured source SHALL supply the executor policy block the frozen-action session executor's resolver consumes; the resolver's behaviour and the over-limit, never, and cross-authority decisions SHALL be unchanged. A configured limit SHALL be validated, and a configuration that would disable a safety property SHALL be rejected.

#### Scenario: A configured limit carries authored provenance
- **WHEN** an operator or author configures a `handoffTokenLimit`, `reuseRoundLimit`, or touch/retire cadence value
- **THEN** the resolved value carries `authored` or `definition` provenance and the configured value
- **AND** the value is traceable end-to-end to its configured source

#### Scenario: An unset limit keeps default provenance
- **WHEN** no configuration supplies a limit value
- **THEN** the resolved value carries `default` provenance and equals the shipped default
- **AND** pre-slice placeholder limits are still treated as `default`, never enforced as authored

#### Scenario: A safety-disabling configuration is rejected
- **WHEN** a configured limit is not a positive bounded integer or would permit a silent cross-authority or past-limit reuse
- **THEN** the configuration is rejected with an actionable error
- **AND** the resolver's safety decisions are unchanged

### Requirement: A reuse, handoff, touch, or retire decision is face-invariant

The resolved reuse policy and the resulting reuse, handoff, touch, or retire decision SHALL be identical regardless of which driver face initiates the dispatch, because policy is resolved at one point consuming one configured policy block and every face reaches the executor through the shared contract. A face-specific policy source or bypass SHALL fail the parity drift-prevention gate.

#### Scenario: The same Action from different faces yields the same decision
- **WHEN** the same granted Action is dispatched from each driver face in turn
- **THEN** the resolved policy and the reuse/handoff/touch/retire decision are identical across faces
- **AND** no face yields a different decision for the same authority and limits

#### Scenario: A face-specific policy source is rejected
- **WHEN** a mutation introduces a policy source specific to one face
- **THEN** the face-invariance harness fails
- **AND** a matching mutation receipt shows the harness red against the per-face source

### Requirement: Acceptance uses exhaustive deterministic fault-injection and mutation-proven guards; real receipts defer to ECP-8

Acceptance for this capability SHALL be carried by the exhaustive cross-face parity harness, the exhaustive fault-injection matrix over the executor's injectable backend seams, the face-invariance harness, and a demonstrated failing counterpart (mutation receipt) for every guard this capability adds. Real-OS and real-agent-backend receipts that prove the same properties on an actual operating system or backend are environment-gated and SHALL be recorded as explicit ECP-8 known gaps; no environment-gated receipt SHALL be defaulted to pass. The durable session-host registry SHALL continue to hold host lifecycle facts only and SHALL NOT become a second completion truth.

#### Scenario: The parity harness covers every face and operation
- **WHEN** the cross-face parity harness runs
- **THEN** it exercises every driver face against every operation and asserts same-Run resolution and matrix-driven availability
- **AND** every uncovered face or operation is flagged

#### Scenario: The fault matrix covers every named failure mode
- **WHEN** the fault-injection matrix runs
- **THEN** it exercises every named failure mode and asserts exactly-once, fail-closed, committed-frontier-only recovery
- **AND** every uncovered failure mode is flagged

#### Scenario: Guard discrimination is proven by mutation
- **WHEN** a guard for this capability is presented as green
- **THEN** a matching mutation receipt shows the guard failing against the defect it names

#### Scenario: Environment-gated real receipts are explicit ECP-8 gaps
- **WHEN** a real-OS or real-backend receipt for a property in this capability is not available
- **THEN** it is recorded as an explicit ECP-8 known gap with the deterministic counterpart that is the 0.2.0 gate
- **AND** it is not defaulted to pass
