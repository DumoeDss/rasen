# Ship log — ecp-session-policy-and-control-parity

- **Date:** 2026-08-09
- **Mode:** local (commit only; delivery deferred to portfolio level — a separate PR session reconciles + PRs the whole branch to dev/0.2.0)
- **Branch:** `wip/ecp-shared-bounded-loop-lifecycle-resume`
- **Commit:** `b798fe2a` (implementation; propose `53f4559f`)
- **Status:** Committed (delivery deferred to portfolio level per ECP-7 local-delivery policy)

## Scope shipped

Cross-driver same-Run parity and control parity for the session executor: an exhaustive data-driven parity harness over {launcher, CLI, Management API, Canvas, Operations/audit, daemon} × {start, resume, cancel, inspect, audit} (each cell through the shared `dispatchGrantedAction` contract to the same Run/Action, matrix-driven) plus a DRIFT-PREVENTION GATE (a face projecting a Run/Action/completion fact not backed by the canonical Record fails closed); the 7-mode fault-injection matrix (cancel-before-start, cancel-in-flight, host/daemon restart, worker-process-loss, completion-ack-loss, duplicate-completion, stale-control) exercised at the SHIPPED HostedBackendSeam/InToolBackendSeam (production path, not a parallel fixture); a configurable provenance-bearing policy source (project>store>global>DEFAULT, authored/default provenance) supplying the executor's `ExecutorPolicyBlock` without disabling safety (cross-authority/past-limit reuse stays limit-independent); and face-invariant policy decisions (one resolution point ⇒ all faces see the same policy).

## Pre-flight

- Independent review round-1 = CLEAN (`d7d45697`; 0 Blocker/Major/Minor). Load-bearing fault-matrix-at-shipped-seam CONFIRMED: the reviewer re-ran mutation M6c (shipped `reconcileActionOutcome` daemon-death label) → RED exactly on the daemon-restart source-label assertion, byte-exact restored. Drift-gate M3 and face-invariance M7 both RED+GREEN. Policy-config 4.3 safety rejection confirmed (maximally-permissive valid config still retires cross-authority — limit-independent). 3 flagged items ruled sound/acceptable.
- Additivity verified: executor module + native untouched (empty numstat); config files purely additive.
- `rasen validate --strict` GREEN; tsc 0; eslint clean; whitespace clean; archive dry-run blockers [] (archive-ready).
- Regression: policy-parity 53/53; executor 89 unchanged; targeted regression 135 passed/0 failed.

## Tasks

All ticked (23 leaf tasks across 7 sections; the "28" in some docs was a section-sum miscount — no impact). No deferred tasks — real-OS/real-backend receipts and acceptance 7 (self-hosting toy-Change proof) are operator/ECP-8 owned and out of this change's scope.

## Delivery

Local (commit only). A separate session (see `rasen/handoff/pr-to-020-conflict-handoff.md`) reconciles the branch with dev/0.2.0 and opens the PR.
