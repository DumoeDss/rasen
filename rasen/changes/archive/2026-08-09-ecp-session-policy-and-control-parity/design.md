## Context

This change is the enforcement, completeness, and configuration layer for the session execution and control surface the frozen-action session executor already shipped. The executor (archived 2026-08-09, ship `65092938`; main spec `rasen/specs/frozen-action-session-executor/`) delivered the authoritative spine, and its independent review plus the LEAD close-out handoff explicitly routed three pieces of work here. Verified code anchors in this worktree at HEAD `0d9af974`:

- The single contract every face routes through: `dispatchGrantedAction` (`src/core/frozen-action-executor/executor.ts:126-177`) returns a typed `ExecutionDispatchResult` (`rejected | duplicate | authority-unavailable | executed`). The daemon face endpoint `handleFrozenActionDispatch` (`src/core/management-api/frozen-action-executor.ts:108-211`) constructs the production executor bound to the daemon `SessionHost`, loads the head Record read-only, dispatches, and performs NO Record mutation - completion stays the canonical Facade path. The 7.1 wave wired the CLI, Management API, Canvas, daemon, and launchers onto this one endpoint.
- The capability matrix: `buildExecutionCapabilityMatrix` and `resolveBackendSelection` (`src/core/frozen-action-executor/capability-matrix.ts`) compute the OS x backend matrix and never silently reroute; the executor consumes the matrix via `DispatchGrantedActionOptions.matrix`.
- The execution-lost mechanism and committed-frontier resume: `reconcileActionOutcome` (`src/core/frozen-action-executor/action-outcome.ts:119-185`) composes owning-process liveness with the host turn result at the executor; `partitionCommittedFrontier` (`:208-221`) and `isCommittedInvocation` (`:229-234`) partition and guard the committed frontier. The executor's review confirmed these invariants.
- The injectable backend seams: `HostedBackendSeam` and `InToolBackendSeam` (`executor.ts:50-71`) let a deterministic replay/fault-injection backend drive the same path the real session host does - the substrate for the fault matrix this change builds.
- The reuse policy resolver: `resolveReusePolicy` (`src/core/frozen-action-executor/reuse-policy.ts:112-162`) and `decideReuse` (`:233-274`). The resolver accepts an optional `ExecutorPolicyBlock` (`:57-62`) but defaults to `DEFAULT_EXECUTOR_POLICY_BLOCK` (`:64-69`) and always stamps the numeric limits `default` provenance, because - in the module's own documented words at `:50-56` - "there is no authoring surface for the numeric limits yet, so a recorded placeholder is never enforced as authored." That documented gap is exactly the configuration surface this change owns.
- The representative parity gate the 7.1 wave shipped: `production-executor.test.ts` proves two faces resolve to the same Run/Action through the contract. This change extends that representative gate to exhaustive coverage.

The durable session host (`rasen/specs/durable-agent-session-host/`, `session-supervision/`, `daemon-residency/`; `src/core/session-host/host.ts` with `closeDurableProcess` and its two release paths) and the canonical Run Facade (`src/core/change-run/facade.ts`) are consumed as immutable. Locked decisions 11 (execution-lost and committed-frontier resume), 12 (threat model; no signing/key-custody; fail-closed typed uncertainty and actor separation preserved), and 13 (best-effort backend roster) govern.

## Goals / Non-Goals

**Goals:**

- Exhaustive cross-driver same-Run parity: every driver face x every operation (start, resume, cancel, inspect, audit) routes through the shared contract to the same canonical Run/Action, matrix-driven, with a drift-prevention gate and the audit operation on the parity surface.
- The exhaustive cancel/restart/ack-loss fault matrix: every named failure mode recovers exactly-once, fail-closed, continuing only the uncommitted frontier, with deterministic fault-injection evidence.
- A configurable, provenance-bearing, face-invariant reuse/handoff/touch/retire policy source that closes the executor's "no authoring surface for the numeric limits yet" gap.
- Real-OS/real-backend receipts that are environment-gated are explicit ECP-8 known gaps; deterministic fault-injection plus mutation-proven guards are the 0.2.0 correctness gate.

**Non-Goals:**

- Redesigning the executor's contract, matrix, execution-lost mechanism, committed-frontier partition, transactional-completion path, or reuse resolver. They are consumed unmodified.
- The self-hosting toy-Change proof (acceptance 7) - operator-owned `ecp-session-self-hosting-vertical-proof`; the executor's `SELF_HOSTING_PROOF_SEAM` (`executor.ts:185-189`) is left.
- Producer signing, private-key custody, `producerIsolation`, byte-reproducibility-as-provenance, or TOCTOU hardening (decision 12). Cross-child worker reuse (`worker-reuse-config`, `worker-reuse-orchestration`).
- Modifying the executor capability spec, the durable host capabilities, the Facade, the EvidenceStore, the frozen authority crates, the legacy ProcessCapsule, or the durable session-host registry record shape.
- ECP-8 release engineering: the single clean-branch PR, remote CI, version/changelog/tag, and the actual real-OS/real-backend receipt collection.

## Decisions

### D1: Consume, do not redesign; this change is the enforcement/completeness/config layer

The executor's spine is frozen and reviewed-clean. This change feeds it an authoritative, configured policy block and proves its invariants exhaustively; it does not alter `dispatchGrantedAction`, the matrix, `reconcileActionOutcome`, the committed-frontier partition, or `resolveReusePolicy`'s signature. Alternative considered: folding the fault matrix and parity harness back into the executor was rejected - the executor shipped a coherent purely-additive core precisely by excluding this surface, and re-opening it would re-create the integration-regression risk the 7.1 ruling avoided.

### D2: Parity enforcement is an exhaustive faces-x-operations harness with a drift-prevention gate

The harness enumerates the Cartesian product of driver faces (interactive launcher, bare CLI, Management API, Canvas, Operations/audit, daemon) and operations (start, resume, cancel, inspect, audit) and asserts each cell routes through the shared `dispatchGrantedAction` contract to the same canonical RunId/ActionId and honours the matrix's typed availability verdict. The audit operation is added to the parity surface (the executor's representative gate covered start/dispatch on two faces). A drift-prevention gate asserts no face maintains a second Run, Session, or completion truth - a face that projects a Run/Action identity or completion state not backed by the canonical Record fails closed. The headless-driver-independent-of-launcher property is asserted per face on platforms where the hosted backend is available. The harness consumes the shipped contract and daemon endpoint; it does not duplicate them. Alternative considered: a documentation support matrix was rejected (acceptance 6 forbids prose as the "when capability allows" oracle).

### D3: The fault matrix is an enumerated failure-mode x recovery-invariant table over the injectable seams

The matrix is a fixed enumeration of the seven named failure modes (cancel-before-start, cancel-in-flight, host/daemon restart, worker process loss, completion ack loss, duplicate completion, stale control) crossed with the recovery invariants each must satisfy: recovery continues only the uncommitted frontier; already-committed invocations and effects are not re-executed; unprovable state is typed-waited or escalated (fail-closed); and (hosted) daemon death and (in-tool) launcher disappearance compose into typed `execution-lost` via the executor's existing `reconcileActionOutcome`. Each cell is exercised by a deterministic fault-injection backend at the `HostedBackendSeam`/`InToolBackendSeam` seam - the same path the real session host drives - so the matrix is a correctness gate that does not depend on credentials or a real host. The executor's representative execution-lost receipts are the substrate; this change adds the full enumeration with exactly-once/fail-closed evidence and a mutation receipt per invariant.

### D4: Policy authoritativeness = a configuration source supplying the policy block with provenance

The executor's resolver already accepts an `ExecutorPolicyBlock` parameter and already defines the `authored | definition | default` provenance vocabulary; it simply has no source that produces non-`default` values. This change adds that source: an operator/author configuration key (resolved through the existing configuration chain - project, then store, then global, then the shipped `DEFAULT_EXECUTOR_POLICY_BLOCK` default) that supplies `handoffTokenLimit`, `reuseRoundLimit`, and the touch/retire cadence, each stamped with its provenance. A configured value carries `authored` (operator/author set it) or `definition` (derived from the node's nature) provenance; an unset value still carries `default`. The resolver's signature is unchanged - it receives an authoritative block instead of the frozen default. This closes the documented "no authoring surface for the numeric limits yet" gap without modifying the executor's requirement (which already anticipated non-`default` provenance).

### D5: Face-invariance follows from one resolution point consuming one configured block

A reuse/handoff/touch/retire decision is the same regardless of which face asks because the policy is resolved at one point - the executor consuming one configured `ExecutorPolicyBlock` - and every face reaches the executor through the same `dispatchGrantedAction` contract. Face-invariance is therefore not a new mechanism but a property the configuration surface makes non-trivial and a face-invariance harness proves: the same granted Action dispatched from each face yields the same resolved policy and the same reuse/handoff/retire decision. A face that bypassed the shared resolution point would diverge and the parity drift-gate (D2) would catch it.

### D6: Real receipts defer to ECP-8; deterministic fault-injection is the 0.2.0 gate

Fault-injection over the injectable seams, the cross-face parity harness, the face-invariance harness, and mutation-proven guards are the 0.2.0 acceptance gate - they do not require credentials, network, or a particular OS. The real-OS/real-backend receipts that prove the same properties on a real agent backend and on each actual OS are environment-gated and defer to ECP-8 as explicit known gaps (mirroring the executor's 8.1/10.1/10.2/10.4 dispositions). No environment-gated receipt is defaulted to pass.

### D7: No second truth; the registry stays a lifecycle reader

The parity harness and the fault matrix both assert the durable session-host registry holds host lifecycle facts only and that completion truth lives solely in the canonical Record through the Facade - composing with the executor's existing registry-is-not-completion-truth requirement. No face, no fault path, and no policy decision writes a second Run, Session, or completion truth.

## Risks / Trade-offs

- **[The parity harness could pass while a face silently forks its own projection]** -> the drift-prevention gate asserts each face's projected Run/Action/completion is backed by the canonical Record, and a mutation receipt proves a divergent projection fails closed.
- **[A fault-matrix cell could be exercised against a fixture that does not match the real seam]** -> every fault is injected at the shipped `HostedBackendSeam`/`InToolBackendSeam` interface (the same interface the real session host satisfies), so the exercised path is the production path; a guard asserts the injection point is the shipped seam.
- **[The configuration surface could let an operator set a limit that silently disables a safety property]** -> configured limits are validated (positive integers, bounded), provenance is always traceable, and the over-limit/never/cross-authority decisions in `decideReuse` are unchanged; a mutation receipt proves a misconfigured limit cannot permit a cross-authority or past-limit silent reuse.
- **[Face-invariance could be assumed rather than proven once the config surface exists]** -> the face-invariance harness dispatches the same granted Action from each face and asserts identical resolved policy and decision; a mutation receipt proves a face-specific policy source fails the harness.
- **[Adding the audit operation could widen the projector contract the executor froze]** -> audit is an additive read-only operation over the existing projector; it does not alter `dispatchGrantedAction` or any control mutation, and a guard asserts it performs no Record mutation.
- **[Exhaustive enumeration could rot if a new face or failure mode appears]** -> the harness/matrix are data-driven enumerations, not scattered individual tests, so adding a face or mode is one table row plus its guard; a guard asserts every enumerated face/operation/mode is covered.

## Migration Plan

Additive. The parity harness, fault matrix, audit operation, and policy-configuration source are new; they consume the executor's shipped contract, seams, matrix, partition, and resolver unmodified. Records and configured policy created before this change keep working: an unset policy configuration resolves to the shipped `DEFAULT_EXECUTOR_POLICY_BLOCK` at `default` provenance (exactly today's behaviour), and the resolver treats pre-slice placeholder limits as `default` exactly as before. The executor module's public surface is unchanged. Rollback removes this change's harness/matrix/config-source; the executor continues to operate at its shipped default policy and representative parity gate.

## Open Questions

- None blocking proposal. The exact default values for the policy configuration (when unset) remain the shipped `DEFAULT_EXECUTOR_POLICY_BLOCK` values; if the LEAD wants different configured defaults at apply time they derive from the same resolution chain as `worker-reuse-config`. The set of operations on the parity surface is fixed at {start, resume, cancel, inspect, audit}; a future operations plane expansion would add a row, not redesign the harness.
