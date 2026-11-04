# Implementation baseline - ecp-session-policy-and-control-parity

Recorded at implementation start by the implementer. All anchors re-verified in
this worktree on 2026-08-09.

## HEAD and propose anchor

- Implementation-start HEAD: `53f4559f9233bbb3f834c9f3d7fb3c89b973acec`
  (`docs(ecp7): propose ecp-session-policy-and-control-parity`). This IS this
  change's propose commit; the design.md / planner-1.md were authored against
  the immediately-prior HEAD `0d9af974` (`docs(specs): replace archived Purpose
  placeholder in frozen-action-session-executor`). The only commit between the
  two is this change's own propose docs; the consumed seams are byte-identical.
- Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume` (SHARED worktree).
- The shipped executor change is archived at
  `rasen/changes/archive/2026-08-09-ecp-frozen-action-session-executor/`
  (ship `65092938`); its code in `src/core/frozen-action-executor/` is the
  immutable seam this change consumes.

## Task 1.1 - Seam anchors re-verified at HEAD 53f4559f

Every anchor the design.md rests on was re-read against the current tree. No
design-affecting drift.

| Seam | File:line (HEAD 53f4559f) | Verified |
| --- | --- | --- |
| `dispatchGrantedAction` (the single contract) | `src/core/frozen-action-executor/executor.ts:126-177` | yes |
| `ExecutionDispatchResult` (typed result) | `src/core/frozen-action-executor/executor.ts:96-107` | yes |
| `HostedBackendSeam` (injectable hosted seam) | `src/core/frozen-action-executor/executor.ts:50-56` | yes |
| `InToolBackendSeam` (injectable in-tool seam) | `src/core/frozen-action-executor/executor.ts:63-69` | yes |
| `ExecutorBackendSeam` / `ExecutorBackends` | `src/core/frozen-action-executor/executor.ts:71-76` | yes |
| `DispatchGrantedActionOptions` (incl. `matrix`, `backends`, `turnInput`) | `src/core/frozen-action-executor/executor.ts:78-94` | yes |
| daemon face `handleFrozenActionDispatch` (no Record mutation) | `src/core/management-api/frozen-action-executor.ts:108-211` | yes |
| daemon endpoint loads head Record read-only (`loadHeadRecord`) | `src/core/management-api/frozen-action-executor.ts:181` | yes |
| daemon endpoint returns result, no mutation | `src/core/management-api/frozen-action-executor.ts:210` | yes |
| `buildExecutionCapabilityMatrix` | `src/core/frozen-action-executor/capability-matrix.ts:223-267` | yes |
| `resolveBackendSelection` (never-silently-reroute) | `src/core/frozen-action-executor/capability-matrix.ts:346-405` | yes |
| `reconcileActionOutcome` (execution-lost composition) | `src/core/frozen-action-executor/action-outcome.ts:121-187` | yes |
| `partitionCommittedFrontier` | `src/core/frozen-action-executor/action-outcome.ts:210-223` | yes |
| `isCommittedInvocation` | `src/core/frozen-action-executor/action-outcome.ts:231-236` | yes |
| `resolveReusePolicy` (accepts `policyBlock?`, stamps limits `default`) | `src/core/frozen-action-executor/reuse-policy.ts:112-162` | yes |
| `decideReuse` (never / cross-authority / over-limit safety decisions) | `src/core/frozen-action-executor/reuse-policy.ts:233-274` | yes |
| `ExecutorPolicyBlock` | `src/core/frozen-action-executor/reuse-policy.ts:57-62` | yes |
| `DEFAULT_EXECUTOR_POLICY_BLOCK` (4 / 8 / 5m) | `src/core/frozen-action-executor/reuse-policy.ts:64-69` | yes |
| documented "no authoring surface for the numeric limits yet" gap | `src/core/frozen-action-executor/reuse-policy.ts:50-56` | yes |
| `SELF_HOSTING_PROOF_SEAM` (operator-owned, untouched) | `src/core/frozen-action-executor/executor.ts:185-189` | yes |
| production seam factory `createProductionExecutor` | `src/core/frozen-action-executor/production-executor.ts:193-223` | yes |
| 7.1 representative parity gate (the gate this change extends) | `test/core/frozen-action-executor/production-executor.test.ts:174-219` | yes |
| config-chain precedent `resolveHandoffThresholdLayers` (project>store>global>default) | `src/core/effective-config.ts:588-623` | yes |
| config-chain precedent `resolveModelConfigLayers` | `src/core/effective-config.ts:712-728` | yes |
| `GlobalConfig` additive optional blocks (`handoff`/`models`/`runs`) | `src/core/global-config.ts:79-218` | yes |
| `ProjectConfigSchema` (zod object, strip-by-default; `handoff` block) | `src/core/project-config.ts:49`, `:195` | yes |

The two highest-value mutation targets named by the planner (the drift-
prevention gate 2.3 and the face-invariance harness 5.1) are NEW code this
change adds; both will have demonstrated RED counterparts (task 6.2).

### Note on the resolver's hardcoded `default` provenance

`resolveReusePolicy` stamps the numeric limits `provenance: 'default'`
unconditionally (`reuse-policy.ts:142-153`) — that is the documented gap
(`:50-56`). This change does NOT modify `reuse-policy.ts` (executor module,
consumed unmodified). Instead the NEW policy-config source module (Section 4)
is the authoritative provenance bearer: it resolves the configured layers
(project > store > global > default), stamps the true per-field provenance
(`authored` for a configured project/store/global value, `definition` for a
node-nature-derived value, `default` for unset), validates, and produces BOTH
the `ExecutorPolicyBlock` that feeds the executor's resolver (so the
configured VALUE reaches the resolver unchanged) AND a `ResolvedReusePolicy`
carrying the correct provenance that the face-invariance harness and `decideReuse`
consume. The executor resolver's conservative `default` stamp and its
`decideReuse` safety decisions (never / cross-authority / over-limit) stay
byte-identical — task 4.1 proves the configured value reaches the resolver and
the safety decisions are unchanged; task 4.2 proves the source's provenance is
correct (a placeholder is never stamped `authored`).

## Task 1.2 - No-touch surfaces

This change does not modify:

- `src/core/frozen-action-executor/**` (the shipped executor module — consumed
  unmodified: `dispatchGrantedAction`, `ExecutionDispatchResult`, the seam
  interfaces, `reconcileActionOutcome`, the committed-frontier partition,
  `resolveReusePolicy`, `decideReuse`, the production seam factory).
- `native/**` (frozen authority crates — parked to the upgrade path, decision 13).
- `.rasen/**`, archived changes, other workstream files.
- The Facade, the EvidenceStore, the transactional-completion path
  (`transactional-completion.ts`), the attribution/registry guards
  (`attribution.ts`).
- The durable session-host registry record shape; the legacy ProcessCapsule.
- The change-run projector (`src/core/change-run/internal/projector.ts`) — the
  audit operation (2.2) is a NEW additive read-only operation in a new module;
  it does not widen the frozen projector contract.

The two config files this change DOES edit are additive-only and in-scope per
design D4 ("an operator/author configuration key resolved through the existing
configuration chain"): an optional `sessionPolicy` block on `GlobalConfig`
(`src/core/global-config.ts`) and on `ProjectConfigSchema`
(`src/core/project-config.ts`), mirroring the existing `runs`/`handoff`/`models`
precedent exactly. `git diff --stat` for this change will show only those two
additive config fields plus new files (the policy source, the parity gate, the
audit operation, and their tests); it touches none of the no-touch surfaces.

## Scope and governing decisions

### The three-piece scope (this change owns, the executor excluded them)

1. **Exhaustive cross-driver same-Run parity** (slice acceptance 6). The
   executor wired every face through one contract and shipped a representative
   two-face parity gate (`production-executor.test.ts:174-219`); this change
   extends that to the exhaustive faces-x-operations harness, adds the audit
   operation to the parity surface, and installs a drift-prevention gate so a
   face projecting a Run/Action/completion fact not backed by the canonical
   Record fails closed.
2. **Exhaustive cancel/restart/ack-loss fault matrix** (slice acceptance 4).
   The executor shipped the `execution-lost` mechanism plus committed-frontier
   resume and representative receipts; this change builds the full
   fault-injection matrix over the seven named failure modes at the SHIPPED
   `HostedBackendSeam`/`InToolBackendSeam` (the production path, not a parallel
   fixture).
3. **Configurable provenance-bearing face-invariant policy source** (slice
   acceptance 5). The executor's resolver stamps numeric limits `default`
   because "there is no authoring surface for the numeric limits yet"; this
   change adds that surface through the existing config chain.

### Governing decisions (consumed, not re-derived)

- **Locked decision 11**: scope lifetime equals daemon lifetime; resume is from
  the committed frontier only. Daemon death (hosted) / launcher disappearance
  (in-tool) types the in-flight Action `execution-lost`.
- **Locked decision 12**: threat model is our own mistakes; no signing /
  key-custody / byte-repro-as-provenance / TOCTOU hardening; fail-closed typed
  uncertainty and actor separation preserved. The policy config source MUST NOT
  let a configured limit disable a safety property (cross-authority / past-limit
  silent reuse) — task 4.3 rejects it.
- **Locked decision 13**: best-effort backend roster on all three OSes
  (`exactCancel: false`, `scopeEmptyProof: false`); consumed via the matrix.

### Deferred (explicit, not defaulted to pass)

- Real-OS / real-agent-backend receipts proving the parity, fault-matrix, and
  face-invariance properties on an actual OS/backend are environment-gated
  ECP-8 known gaps; deterministic fault-injection + mutation-proven guards
  (Section 6) are the 0.2.0 correctness gate.
- Acceptance 7 (self-hosting toy-Change proof) is operator-owned
  `ecp-session-self-hosting-vertical-proof`; the executor's
  `SELF_HOSTING_PROOF_SEAM` (`executor.ts:185-189`) is left untouched.
