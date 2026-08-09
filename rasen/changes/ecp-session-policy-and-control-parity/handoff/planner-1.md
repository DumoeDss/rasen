# Planner handoff - ecp-session-policy-and-control-parity (propose)

For: the implementer and the LEAD. Stage: propose artifacts complete, awaiting implementation dispatch. Warm continuation from the executor propose (same planner; the executor scope-cut deliberately routed this work here).

## Artifacts

- `rasen/changes/ecp-session-policy-and-control-parity/proposal.md`
- `rasen/changes/ecp-session-policy-and-control-parity/design.md`
- `rasen/changes/ecp-session-policy-and-control-parity/specs/session-policy-and-control-parity/spec.md`
- `rasen/changes/ecp-session-policy-and-control-parity/tasks.md`
- `rasen/changes/ecp-session-policy-and-control-parity/.openspec.yaml`

## Task count and structure

`tasks.md` has 7 sections / 28 tasks: 1 Baseline and context (3), 2 Exhaustive cross-driver parity (4), 3 Exhaustive cancel/restart/ack-loss fault matrix (4), 4 Configurable provenance-bearing policy source (3), 5 Face-invariant policy decisions (2), 6 Deterministic guards and mutation receipts (3), 7 Verification and ship (4). No real-OS/real-backend receipt section — those defer to ECP-8 as explicit known gaps (the executor already receipted the representative execution-lost/hosted/cutover receipts); the 0.2.0 gate is exhaustive deterministic fault-injection over the executor's injectable seams plus mutation-proven guards.

## Capability / delta shape

ONE new capability `session-policy-and-control-parity`, `## ADDED Requirements` (7 requirements). ADDED-only — no MODIFIED, no REMOVED, no renamed headings, no renamed scenarios (the implicit-delete traps are not reachable). No existing capability modified: the executor capability (`frozen-action-session-executor`), the durable host capabilities, `ecp-change-run-runtime`, and `runtime-adapter-registry` are consumed as immutable seams.

## What we CONSUME vs BUILD (the boundary)

**Consume (immutable, shipped by the executor — do NOT modify):**
- `dispatchGrantedAction` / `ExecutionDispatchResult` / `HostedBackendSeam` / `InToolBackendSeam` (`src/core/frozen-action-executor/executor.ts:96-177`) — the single contract + the injectable seams.
- The daemon face endpoint `handleFrozenActionDispatch` (`src/core/management-api/frozen-action-executor.ts`) and the 7.1 wiring routing all faces through it.
- `buildExecutionCapabilityMatrix` / `resolveBackendSelection` (`capability-matrix.ts`) — the matrix oracle.
- `reconcileActionOutcome` / `partitionCommittedFrontier` / `isCommittedInvocation` (`action-outcome.ts`) — execution-lost + committed-frontier resume.
- `resolveReusePolicy` / `decideReuse` / `ExecutorPolicyBlock` / `DEFAULT_EXECUTOR_POLICY_BLOCK` (`reuse-policy.ts`) — the policy resolver and the policy-block type.
- The Facade, the EvidenceStore, the durable session-host registry, the frozen crates, the legacy ProcessCapsule.

**Build (this change):**
- The exhaustive cross-face parity harness (faces x operations, table-driven) + the audit operation + the drift-prevention gate.
- The exhaustive fault-injection matrix (the 7 slice-named failure modes x recovery invariants) over the injectable seams.
- The policy-configuration source supplying `ExecutorPolicyBlock` with `authored`/`definition` provenance (closes the executor's documented "no authoring surface for the numeric limits yet" gap at `reuse-policy.ts:50-56`).
- The face-invariance harness.

## Design decisions (the three the LEAD asked for)

- **Parity-enforcement shape.** A data-driven harness over the Cartesian product {interactive launcher, bare CLI, Management API, Canvas, Operations/audit, daemon} x {start, resume, cancel, inspect, audit}, asserting each cell routes through the shared `dispatchGrantedAction` contract to the same Run/Action and honours the matrix verdict. Adds the AUDIT operation (the executor's representative gate covered start/dispatch on two faces) and a DRIFT-PREVENTION GATE: a face projecting a Run/Action/completion fact not backed by the canonical Record fails closed. Table-driven so a new face/op is one row. The headless-driver-independent-of-launcher property is asserted per face. (D2)
- **Fault-matrix representation.** A fixed enumeration of the seven named failure modes the slice acceptance 4 enumerates (cancel-before-start, cancel-in-flight, host/daemon restart exercised for both the host process and the daemon process, worker process loss, completion ack loss, duplicate completion, stale control) crossed with the recovery invariants (committed-frontier-only, no-resend, no-re-execute, fail-closed-on-unprovable, execution-lost composition). Each cell is exercised at the SHIPPED `HostedBackendSeam`/`InToolBackendSeam` (the same interface the real session host satisfies), so the exercised path is the production path. The executor's representative execution-lost receipts are the substrate; this adds the full enumeration + a mutation receipt per invariant. (D3)
- **Policy-authoritativeness mechanism.** The executor's resolver already accepts an `ExecutorPolicyBlock` and already defines the `authored|definition|default` provenance vocabulary; it just has no source producing non-`default` values (limits always resolve `default`). This change adds that source: an operator/author config key resolved through the existing chain (project, store, global, then the shipped default) supplying the policy block, each value provenance-stamped. The resolver's signature and safety decisions are unchanged — it receives an authoritative block instead of the frozen default. Face-invariance follows for free: policy is resolved at one point consuming one configured block, and every face reaches the executor through the same contract; a face-specific source is caught by the drift gate. (D4/D5)

## Code anchors (re-verified at HEAD 0d9af974)

`dispatchGrantedAction` `executor.ts:126-177`; `ExecutionDispatchResult` `executor.ts:96-107`; `HostedBackendSeam`/`InToolBackendSeam` `executor.ts:50-71`; daemon endpoint `handleFrozenActionDispatch` `src/core/management-api/frozen-action-executor.ts:108-211` (no Record mutation — loads head Record read-only via `loadHeadRecord`); matrix `capability-matrix.ts`; `reconcileActionOutcome` `action-outcome.ts:119-185`, `partitionCommittedFrontier` `:208-221`, `isCommittedInvocation` `:229-234`; `resolveReusePolicy` `reuse-policy.ts:112-162`, `decideReuse` `:233-274`, `ExecutorPolicyBlock` `:57-62`, `DEFAULT_EXECUTOR_POLICY_BLOCK` `:64-69`, documented "no authoring surface" gap at `:50-56`; `SELF_HOSTING_PROOF_SEAM` `executor.ts:185-189` (operator-owned, untouched). These anchors come from the shipped executor (verified by me and by the executor's independent review round-1); re-verify at apply start per task 1.1.

## Validate output

`node dist/cli/index.js validate ecp-session-policy-and-control-parity --strict` -> `Change 'ecp-session-policy-and-control-parity' is valid`, exit 0. (Not vitest; does not touch dist/.) Whitespace gate on the four files: LF-only (0 CR bytes), 0 trailing-whitespace lines, 0 trailing blank lines at EOF.

## Risks flagged for reviewer attention

- The fault matrix MUST be exercised at the SHIPPED seam, not a parallel fixture (task 3.1 guard) — a fixture that doesn't match the real seam is the classic verification-theater failure mode in this repo.
- The drift-prevention gate (2.3) and the face-invariance harness (5.1) are the two highest-value mutation targets; both must have RED counterparts.
- The policy config surface MUST NOT let a configured limit disable a safety property (cross-authority/past-limit silent reuse) — task 4.3 rejects that; the resolver's `decideReuse` safety decisions are unchanged.

## Deferred to ECP-8 / operator (explicit, not defaulted to pass)

- Real-OS and real-agent-backend receipts proving the parity, fault-matrix, and face-invariance properties on an actual OS/backend — environment-gated, ECP-8 known gaps; deterministic counterparts (Section 6) are the 0.2.0 gate.
- Acceptance 7 (self-hosting toy-Change proof) — operator-owned `ecp-session-self-hosting-vertical-proof`; the executor's `SELF_HOSTING_PROOF_SEAM` is left untouched.

## Open decisions not settled here

- The exact default policy values when unset remain the shipped `DEFAULT_EXECUTOR_POLICY_BLOCK` (handoffTokenLimit 4, reuseRoundLimit 8, touchMaxIdleMs 5m); if the LEAD wants different configured defaults at apply time they derive from the same resolution chain as `worker-reuse-config`. Non-blocking.
- The operations set on the parity surface is fixed at {start, resume, cancel, inspect, audit}; a future Operations-plane expansion adds a row, not a redesign.

## Commit

Committed with narrow pathspec `git commit -F <msg> -- rasen/changes/ecp-session-policy-and-control-parity`, message `docs(ecp7): propose ecp-session-policy-and-control-parity` (+ body + the required Co-Authored-By trailer). The sha is the resulting propose commit on `wip/ecp-shared-bounded-loop-lifecycle-resume`.
