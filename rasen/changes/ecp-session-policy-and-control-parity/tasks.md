Scope legend: this change is the enforcement/completeness/config layer over the SHIPPED frozen-action session executor (`src/core/frozen-action-executor/`, archived change ship `65092938`). It consumes the executor's `dispatchGrantedAction` contract, capability matrix, `reconcileActionOutcome`/committed-frontier partition, and `resolveReusePolicy`/`decideReuse` resolver as IMMUTABLE seams - do not modify the executor module's public contract. The 0.2.0 correctness gate is exhaustive deterministic fault-injection over the executor's injectable `HostedBackendSeam`/`InToolBackendSeam` plus mutation-proven guards; real-OS/real-backend receipts are environment-gated and defer to ECP-8 as explicit known gaps (never defaulted to pass). Every guard added by this change needs a demonstrated failing counterpart (mutation receipt); an unmutated green guard is not acceptance evidence in this repo.

## 1. Baseline and context

- [x] 1.1 Record the implementation-start HEAD in `evidence/implementation-baseline.md` and re-verify the shipped executor seams design.md rests on, with file:line anchors against the current tree: `dispatchGrantedAction`/`ExecutionDispatchResult`/`HostedBackendSeam`/`InToolBackendSeam` (`src/core/frozen-action-executor/executor.ts`); the daemon face endpoint `handleFrozenActionDispatch` and its no-Record-mutation path (`src/core/management-api/frozen-action-executor.ts`); `buildExecutionCapabilityMatrix`/`resolveBackendSelection` (`capability-matrix.ts`); `reconcileActionOutcome`/`partitionCommittedFrontier`/`isCommittedInvocation` (`action-outcome.ts`); `resolveReusePolicy`/`decideReuse`/`ExecutorPolicyBlock`/`DEFAULT_EXECUTOR_POLICY_BLOCK` and the documented "no authoring surface for the numeric limits yet" gap (`reuse-policy.ts`); the 7.1 parity gate (`production-executor.test.ts`). Report any drift to the LEAD before writing code.
  - Receipt: `evidence/implementation-baseline.md`. Anchor table with HEAD sha and the verified line for each seam. No design-affecting drift, or drift reported before code.
- [x] 1.2 Confirm and record that this change does not modify the executor module's public contract (`dispatchGrantedAction` signature, `ExecutionDispatchResult`, the seam interfaces), the Facade, the EvidenceStore, the durable session-host registry record shape, the frozen authority crates, or the legacy ProcessCapsule. If any edit to those turns out to be required, stop and flag it to the LEAD before making it.
  - Receipt: `evidence/implementation-baseline.md` "Task 1.2" table. `git diff --stat` for this change touches none of them.
- [x] 1.3 Record the three-piece scope (exhaustive parity, exhaustive fault matrix, configurable face-invariant policy) and its governing decisions (11/12/13) plus the executor's explicit deferral (review item 6; LEAD close-out handoff) in `evidence/implementation-baseline.md`.
  - Receipt: `evidence/implementation-baseline.md` "Scope and governing decisions" section.

## 2. Exhaustive cross-driver parity (acceptance 6)

- [x] 2.1 Build the data-driven cross-face parity harness enumerating {interactive launcher, bare CLI, Management API, Canvas, Operations/audit, daemon} x {start, resume, cancel, inspect, audit}, asserting each cell routes through the shared `dispatchGrantedAction` contract to the same canonical RunId/ActionId and honours the capability matrix's typed availability verdict. The enumeration is table-driven so adding a face or operation is one row.
  - Receipt: parity harness green over the full faces-x-operations table; a coverage guard flags any uncovered face or operation.
- [x] 2.2 Add the audit operation to the Operations/projector surface as an additive read-only operation (no Record mutation) and include it in the parity harness.
  - Receipt: audit operation wired; guard asserting it performs no Record mutation and resolves to the same Run/Action.
- [x] 2.3 Install the parity drift-prevention gate: every face's projected Run/Action identity and completion state must be backed by the canonical Record; a divergent projection fails closed with a typed drift outcome.
  - Receipt: drift gate green for backed projections; mutation receipt proving a divergent projection fails closed.
- [x] 2.4 Assert the headless-driver-independent-of-launcher property per face on a platform where the hosted backend is available: launcher exit does not end the Run.
  - Receipt: guard asserting a hosted Run survives launcher exit when driven through the daemon face.

## 3. Exhaustive cancel/restart/ack-loss fault matrix (acceptance 4)

- [x] 3.1 Build the data-driven fault-injection matrix over the executor's injectable `HostedBackendSeam`/`InToolBackendSeam` covering the seven named failure modes the slice acceptance 4 enumerates: cancel-before-start, cancel-in-flight, host/daemon restart (exercised for both the host process and the daemon process), worker process loss, completion ack loss, duplicate completion, and stale control. Each entry injects its fault at the shipped seam.
  - Receipt: matrix harness green over all eight modes; a coverage guard flags any uncovered mode; guard asserting the injection point is the shipped seam (not a parallel fixture).
- [x] 3.2 For each matrix entry, assert the recovery invariants: recovery continues only the uncommitted frontier; already-committed invocations/effects are not re-executed; an input whose commitment is unknown is not resent; unprovable state is typed-waited or escalated (fail-closed).
  - Receipt: per-mode invariant guards (committed-frontier-only via `partitionCommittedFrontier`/`isCommittedInvocation`; no-resend; fail-closed-on-unprovable); mutation receipt per invariant.
- [x] 3.3 For daemon restart (hosted) and launcher disappearance (in-tool), assert composition into typed `execution-lost` via `reconcileActionOutcome` and resume from the committed frontier with no reattach and no identity revalidation.
  - Receipt: execution-lost composition guards for both backends; mutation receipt proving a normally-completed Action is not execution-lost.
- [x] 3.4 For completion ack loss, duplicate completion, and stale control, assert no double-settle, no advance from an unprovable state, and a typed outcome.
  - Receipt: three guards; mutation receipts.

## 4. Configurable provenance-bearing policy source (acceptance 5)

- [x] 4.1 Add the operator/author configuration source for the reuse policy block (`handoffTokenLimit`, `reuseRoundLimit`, touch/retire cadence) resolved through the existing configuration chain (project, store, global, then the shipped `DEFAULT_EXECUTOR_POLICY_BLOCK` default). A configured value supplies the `ExecutorPolicyBlock` the resolver consumes; the resolver's signature and safety decisions are unchanged.
  - Receipt: config source green; guard proving a configured value reaches `resolveReusePolicy` as the policy block and the resolver's over-limit/never/cross-authority decisions are unchanged.
- [x] 4.2 Stamp provenance: a configured limit carries `authored` (operator/author set it) or `definition` (derived from node nature) provenance; an unset value carries `default`. Every resolved value traces end-to-end to a configured source and provenance.
  - Receipt: provenance guard over configured/unset/derived values; mutation receipt proving a placeholder is never stamped `authored`.
- [x] 4.3 Validate configured limits (positive bounded integers) and reject a configuration that would disable a safety property (e.g. a limit permitting a silent cross-authority or past-limit reuse).
  - Receipt: validation guards; mutation receipt proving a safety-disabling configuration is rejected.

## 5. Face-invariant policy decisions (acceptance 5)

- [ ] 5.1 Build the face-invariance harness: dispatch the same granted Action from each driver face in turn and assert the resolved policy and the reuse/handoff/touch/retire decision are identical across faces.
  - Receipt: face-invariance harness green across all faces; mutation receipt proving a face-specific policy source fails the harness (and the parity drift gate).
- [ ] 5.2 Assert policy is resolved at one point consuming one configured block (no face carries its own policy source). The drift-prevention gate (2.3) catches a bypass.
  - Receipt: guard proving a single resolution point; cross-reference to the 2.3 drift gate.

## 6. Deterministic guards and mutation receipts

- [ ] 6.1 Deterministic counterparts for every parity, fault-matrix, and policy path, driven through the shipped `dispatchGrantedAction` contract and injectable seams (no network, no credentials, no specific OS).
  - Receipt: deterministic guard suite green; each guard named with the property it proves.
- [ ] 6.2 Mutation receipts in `evidence/mutation-receipts.md`, each showing its guard RED against the defect it names, reverted byte-exactly. At minimum: a divergent face projection; a face asserting availability the matrix does not report; a matrix entry exercised against a parallel fixture; a committed invocation re-executed; an unknown-commitment input resent; an unprovable state silently completed; a duplicate/double-settle; a safety-disabling config accepted; a placeholder stamped authored; a per-face policy source.
  - Receipt: `evidence/mutation-receipts.md` with RED counts and byte-exact reverts (`git diff --numstat` empty).
- [ ] 6.3 Regression: the shipped executor guard suite (65 guards), the 7.1 production-executor parity suite, the session-host suites, and the configuration/runtime-adapter suites pass unchanged.
  - Receipt: regression suite counts before/after, 0 new failures.

## 7. Verification and ship

- [ ] 7.1 `rasen validate --strict ecp-session-policy-and-control-parity` green; whitespace gate verified on committed bytes (LF-only, no trailing whitespace, no trailing blank line at EOF) for every file this change adds or edits.
  - Receipt: validate output and the whitespace-gate result on `git show HEAD:<file>` bytes (committed, not working-tree, because `core.autocrlf=true` rewrites the working tree).
- [ ] 7.2 Confirm the DAG: this change depends on `ecp-frozen-action-session-executor` (archived); it blocks `ecp-session-self-hosting-vertical-proof` (operator-owned); no edge to/from the parked provider changes or archived changes; the executor module's public contract and the frozen crates are untouched by this change's diff.
  - Receipt: portfolio DAG read from `.rasen/.../portfolio-run.json`; `git diff --stat -- native/` and over `src/core/frozen-action-executor/executor.ts` empty.
- [ ] 7.3 typecheck (`tsc --noEmit`), lint (`eslint` over changed paths), and root suites green on this host; all new paths built with `node:path`.
  - Receipt: command exit codes and suite counts.
- [ ] 7.4 Record the ECP-8-deferred environment-gated receipts (real-OS/real-backend proofs of the parity, fault-matrix, and face-invariance properties) as explicit known gaps with their deterministic counterparts named; do not default them to pass. Record that acceptance 7 (self-hosting toy-Change proof) stays operator-owned and this change leaves the executor's `SELF_HOSTING_PROOF_SEAM` untouched.
  - Receipt: `evidence/ecp8-deferred-receipts.md` + handoff `planner-1.md` "Deferred to ECP-8 / operator" section.
