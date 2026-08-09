# Implementer handoff - ecp-frozen-action-session-executor

For: the LEAD and the next implementer/reviewer. Stage: deterministic core +
guards + mutation receipts + one real receipt delivered; production driver-face
wiring and gated real-backend/WSL receipts are the named follow-ups.

## What was built

A new `src/core/frozen-action-executor/` module — the authoritative layer
between the canonical Run Facade and the session host — plus its deterministic
guard suite under `test/core/frozen-action-executor/`. The executor consumes
granted frozen Actions, validates authority against the committed Record,
selects a backend through a computed OS x backend capability matrix (never
silently rerouting), reconciles host outcomes into a typed `execution-lost`
Action outcome on daemon/launcher death, resumes only from the committed
frontier, enforces authoritative per-invocation session reuse policy with
`authored | definition | default` provenance, and guards transactional
completion integrity and registry-holds-lifecycle-only attribution.

Module files (all under `src/core/frozen-action-executor/`):

- `capability-matrix.ts` — the computed `ExecutionCapabilityMatrix` over
  {linux,darwin,win32} x {in-tool,hosted-best-effort}; the sole "when capability
  allows" oracle; `resolveBackendSelection` enforces never-silently-reroute.
- `action-outcome.ts` — `reconcileActionOutcome` maps host `turn-outcome-unknown`
  / `interrupted` + daemon/launcher liveness into the typed `execution-lost`
  Action outcome (distinct from generic uncertainty and workload failure);
  `partitionCommittedFrontier` / `isCommittedInvocation` enforce resume from the
  committed frontier.
- `authority.ts` — `validateGrantedAction` validates Run/Action/invocation/
  workspace/profile/adapter/Record-version against the granted ActionView and
  the committed Record; the four illegal-dispatch cases fail closed; authority is
  rebuilt from no non-granted source (the signature accepts neither chat, the
  Definition, nor caller self-report).
- `reuse-policy.ts` — `resolveReusePolicy` + `decideReuse`; retires the
  `ecp-change-run-runtime` placeholder clause; `never`/`same-invocation` +
  provenance + auditable handoff/retire on over-limit/cross-authority.
- `transactional-completion.ts` — `verifyCompleteEvidenceSet` (complete-set
  verify-before-publish), `publishCompletionTransactionally` (with a `crashAfter`
  fault-injection seam), `storeHoldsCompleteSet` (half-set guard),
  `rereadVerifyCompletion` (delegates to the Facade's existing
  `verifyAttestedCompletion` re-read). No signing material (decision 12).
- `executor.ts` — `dispatchGrantedAction` orchestrator composing the above around
  injectable `HostedBackendSeam` / `InToolBackendSeam`; the single typed result
  every driver face consumes; `SELF_HOSTING_PROOF_SEAM` left for the
  operator-owned child.
- `attribution.ts` — `assertRegistryHoldsLifecycleOnly` (registry holds lifecycle
  facts only, no completion truth) + `projectRegistryLifecycleFacts`.
- `index.ts` — barrel.

## Commits (this wave, on wip/ecp-shared-bounded-loop-lifecycle-resume)

- `dc3d84ad` feat(ecp7): frozen-action session executor core (matrix,
  execution-lost, authority, transactional completion, reuse, attribution)
- `cddb3cae` docs(ecp7): executor implementation baseline + mutation receipts
- `91be2cce` docs(ecp7): executor real receipts (win32 zero-orphan re-proof +
  gated-receipt status)

All commits are narrow-pathspec (`src/core/frozen-action-executor`,
`test/core/frozen-action-executor`, the change's `evidence/` dir). `native/`,
the host change dir (mid-archive), other workstream files, and the shared
working tree's parallel archive work are untouched.

## Receipts index

- `evidence/implementation-baseline.md` — HEAD 4a167bfa, re-verified seam anchors
  (no drift), no-touch surfaces, obligations + decision 12/13 scope. (1.1, 1.2, 1.3)
- `evidence/mutation-receipts.md` — 8 guards mutated, 15 RED, byte-exact reverts
  (`git diff --numstat` empty vs dc3d84ad), 65 GREEN restored. (9.2)
- `evidence/win32-daemon-death-receipt.md` — real [THIS-HOST] re-proof of the
  KILL_ON_JOB_CLOSE zero-orphan chain (driver re-run unchanged). (10.3)
- `evidence/real-receipts-status.md` — deterministic counterparts (the
  correctness gate) for 10.1/10.2/10.4 + honest gating status + provenance. (10.5)
- Deterministic guard suite: 65 tests across 7 files (capability-matrix,
  action-outcome, authority, reuse-policy, transactional-completion, executor,
  attribution). (9.1, 9.3)

## The two key mutation receipts (RED + GREEN), both LEAD-named highest-value targets

1. **Transactional half-set guard (task 5.3).** Mutation:
   `storeHoldsCompleteSet` returns `true` unconditionally. RED (2):
   `transactional-completion.test.ts > a mid-publish crash leaves a partial set
   the completeness check rejects` and `> a half-set accepted as complete fails
   the guard (discrimination)`. Revert byte-exact; GREEN restored. The
   `crashAfter` fault-injection seam proves a mid-publish crash leaves a half-set
   the completeness guard rejects, so a later completion re-read is never fooled
   into treating it as complete.

2. **Never-reroute guard (task 3.3).** Mutation: the hosted-unavailable branch
   returns a selected `in-tool` backend instead of `authority-unavailable` (the
   literal silent reroute). RED (4): three `capability-matrix.test.ts`
   never-reroute cases + `executor.test.ts > hosted unavailable returns
   authority-unavailable and drives NO in-tool backend`. Revert byte-exact;
   GREEN restored.

## execution-lost wiring verified at the reconciliation point

`reconcileActionOutcome` (action-outcome.ts) composes the owning-process liveness
signal with the host turn result AT THE EXECUTOR (not in the host or a provider):
hosted daemon death OR a hosted lost-generation (`turn-outcome-unknown` with an
unfinished request) mints `execution-lost`; in-tool launcher disappearance mints
`execution-lost`; a settled turn mints `succeeded`/`failed`; a non-death host
failure mints generic `uncertain`. The orchestrator (`dispatchGrantedAction`)
calls this after the backend seam returns, so the wiring is at the
Action-outcome reconciliation, exactly where design D4 / Disagreements item 5
place it. Proven by `action-outcome.test.ts` (12 tests) and `executor.test.ts`
(the two execution-lost dispatch tests). The host's outcome vocabulary
(`session-host/contracts.ts:5-23`) is unchanged (task 4.3: `git diff --stat` on
`src/core/session-host/` is empty for this change).

## Validate result

`node dist/cli/index.js validate ecp-frozen-action-session-executor --strict` ->
`Change 'ecp-frozen-action-session-executor' is valid`, exit 0.

Whitespace gate: `git diff --check dc3d84ad^..HEAD` clean (exit 0, empty). All
committed source/test bytes are LF (`tr -cd '\r' | wc -c` = 0 on `git cat-file
blob`), no trailing whitespace, no trailing blank line at EOF.

Typecheck: `npx tsc --noEmit` -> 0 errors. Lint: `npx eslint` over the new
module + tests -> clean.

Regression: the closest neighbor suites pass unchanged (94 tests:
facade-runtime, evidence, completion, attestation, contracts, session-host host,
process-scope-contract, cutover-declaration-gated-release). The change is purely
additive (no existing source edited), so the wider suite is structurally
unaffected.

## Stop-on-drift / dead ends

- **One design wording imprecision, not a seam drift (recorded, not blocking).**
  design.md says "`complete`/`control` request carries `expectedRecordVersion`
  (`contracts.ts:436`, `:792`)". Only `ChangeRunControlRequest` carries it
  (`:436`); `CompleteRunAction` does not, and its atomicity comes from the
  RunStore head+1 commit plus the re-read/re-verify in `verifyCompletionAuthority`
  (facade-runtime.ts:119-133) — which is exactly the transactional mechanism D5
  describes. The transactional-integrity work composes that existing re-read; it
  does not need to add `expectedRecordVersion` to the complete request. No
  stop-on-drift raised because the substance holds.
- **Host archive in parallel (expected).** The host change
  `ecp-durable-agent-session-host` is being archived in the shared working tree
  (dir deleted, specs synced). Consumed host code/contract as stable per the
  brief; did not wait on the archive. No contradiction between host's actual code
  and the contract the tasks assume.
- No byte-pinned file (LEGACY_PROCESS_CAPSULE_INPUTS / FROZEN_COMMON_INPUTS)
  needed editing; none touched.

## Exact state of every task (39 total in tasks.md)

(The planner handoff's "47 tasks" was a section-sum miscount — tasks.md actually
has 39: 3+3+4+3+5+4+3+2+3+5+4. This wave ticks 32 and leaves 7 partial/gated.)

Completed with a real receipt (32): 1.1, 1.2, 1.3 (baseline); 2.1, 2.2, 2.3
(authority + source-scan, mutation receipt 1); 3.1, 3.2, 3.3, 3.4 (matrix +
never-reroute, mutation receipt 2); 4.1, 4.2, 4.3 (execution-lost + resume +
no host-vocabulary edit); 5.1, 5.3, 5.5 (complete-set verify, half-set crash
guard with fault injection, no-signing source-scan; mutation receipts 4 + 5);
5.2 (Facade re-read/re-verify — the existing `verifyCompletionAuthority` path,
covered by the regression suite; `rereadVerifyCompletion` delegates to it); 6.1,
6.2, 6.3, 6.4 (reuse policy + placeholder + no edit to worker-reuse specs;
mutation receipts 6 + 7); 7.2 (matrix oracle for availability, proven); 8.2 (registry guard;
mutation receipt 8); 9.1 (deterministic counterparts via injectable seams),
9.2 (mutation receipts), 9.3 (regression-neighbor suites pass); 10.3 (real
[THIS-HOST] win32 zero-orphan re-proof), 10.5 (provenance tables); 11.1 (validate
--strict + whitespace gate on committed bytes), 11.2 (DAG + `native/` untouched),
11.3 (typecheck + lint + node:path), 11.4 (this seam-and-downstream-ownership
section).

Partially complete / follow-up (7):

- **7.1 (unify all driver faces on one projector/control contract).** The shared
  contract — `dispatchGrantedAction` returning the single typed
  `ExecutionDispatchResult` every face consumes, consulting the same matrix — is
  delivered and proven (`executor.test.ts > driver-face parity`). The PRODUCTION
  call-site wiring in each face (CLI, Management API, Canvas, daemon) is the
  integration follow-up: it routes each face's existing Run-driving entry to call
  `dispatchGrantedAction` with the face's backend selection. Not wired this wave
  to avoid a half-integrated production change with regression surface in a
  shared worktree; the contract is ready to consume.
- **7.3 (headless driver independent of the interactive launcher).** Delivered as
  a matrix + orchestrator property (the daemon-driven hosted backend does not
  reference the launcher; `dispatchGrantedAction` with `requestedBackend:
  'hosted'` works with no in-tool seam wired). A full real-host receipt awaits
  the production wiring + credentials (10.2).
- **10.1 [REAL-BACKEND] production-path receipt.** Gated by Claude/Codex
  credentials + the 7.1 production wiring. Deterministic counterpart delivered
  (executor.test.ts) is the correctness gate. See `real-receipts-status.md`.
- **10.2 [REAL-BACKEND] execution-lost + resume receipt.** Gated by credentials
  + production wiring. Deterministic counterpart delivered (action-outcome.test.ts
  + executor.test.ts); the Windows substrate fact is receipted (10.3). See
  `real-receipts-status.md`.
- **10.4 [WSL-EXTERNAL] hosted best-effort on real Linux.** Gated by the external
  ext4 WSL tree (recipe: `ecp-linux-process-authority-provider/handoff/lead-2.md`).
  Deterministic counterpart delivered (capability-matrix.test.ts). See
  `real-receipts-status.md`.
- **5.4 (completion-binding mismatch fails closed `receipt_conflict`).** The
  binding check is enforced by the existing `verifyCompletion` (called by
  `rereadVerifyCompletion`) and by `validateGrantedAction`'s `receipt_conflict`
  path (mutation receipt 1 proves the authority-binding branch discriminates).
  A dedicated per-field (Action/invocation/workspace-revision/ActorRef) mutation
  receipt set for the Facade path is a follow-up; the guards exist and
  discriminate.
- **8.1 real-backend attribution RUN.** The attribution fact-set SHAPE is fixed
  and its lifecycle-only registry projection is guarded; the actual real-backend
  run that populates it end-to-end is the 10.1 follow-up.

## Seam and downstream ownership (task 11.4)

- This change owns slice acceptance 1, 2, 3, 5, 6 and the execution-lost /
  committed-frontier HALF of acceptance 4.
- `ecp-session-policy-and-control-parity` (downstream) owns acceptance 4's full
  cancel/restart/ack-loss fault matrix and deeper control-plane parity. This
  change built the execution-lost MECHANISM + frontier-resume rule + the
  representative receipts its tasks name; it did NOT build the exhaustive
  fault-injection matrix.
- `ecp-session-self-hosting-vertical-proof` (downstream, operator-owned) owns
  acceptance 7. This change left the seam (`SELF_HOSTING_PROOF_SEAM` in
  executor.ts; the executor is what that proof drives) and did NOT select or
  design the toy Change or pre-empt open decision 2 (which backend/platform the
  proof uses).

## Next-action priority for the next wave

1. Production driver-face wiring (7.1): route the CLI / Management API / Canvas /
   daemon Run-driving entries to call `dispatchGrantedAction` with the face's
   backend selection + the shared matrix. This unblocks the real-backend
   receipts (10.1, 10.2).
2. Collect the [REAL-BACKEND] attribution + execution-lost receipts once
   credentials + the wiring are in place.
3. Collect the [WSL-EXTERNAL] Linux hosted-best-effort receipt via the lead-2.md
   recipe.
4. (Reviewer-facing) the design.md wording imprecision about `expectedRecordVersion`
   on the complete request (noted above) can be corrected in a docs pass; it does
   not affect the implementation.
