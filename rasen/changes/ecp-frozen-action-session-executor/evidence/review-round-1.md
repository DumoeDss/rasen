# Independent review round 1 - frozen-action session executor

Change: `ecp-frozen-action-session-executor`
Reviewer role: FRESH NON-AUTHOR (reviewed closure + host immediately prior; zero
involvement in this executor's authoring/implementation).
Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`, HEAD `56b18dcc` at review.
Host: Windows (shared worktree). 2026-08-08.

Every verdict below was re-derived on this tree by reading the module + seams and
re-running the guards/mutations; none is trusted from a receipt. The two
LEAD-named highest-value mutations were re-run by the reviewer (byte-exact
backup/restore via `cp`, never `git checkout --`).

## Overall verdict

**CLEAN.** 0 Blocker, 0 Major, 1 Minor (informational, non-blocking). The core
module is a coherent, tested, PURELY-ADDITIVE shippable unit. No review defect
blocks it. The 7 deferred tasks (7.1 wiring, 7.3, 10.1/10.2/10.4 real receipts,
5.4, 8.1) are honestly-recorded owned follow-ups, not defects.

**7.1 ruling: SHIP THE CORE; 7.1 is a separable wiring wave (option b), mandatory
before ECP-8's unified PR.** Reasoning in the dedicated section below.

## Item 1 - execution-lost wiring (the crux) - CONFIRMED

`reconcileActionOutcome` (`action-outcome.ts:119-185`) composes the owning-process
liveness signal with the host turn result AT THE EXECUTOR. The orchestrator
`dispatchGrantedAction` calls it at `executor.ts:174` immediately after the backend
seam returns - not in the host or a provider. Re-derived invariants, each holding
in code:

1. **Death -> execution-lost, regardless of turn.** hosted + `!daemonAlive` ->
   execution-lost/daemon-death (`:128-134`); in-tool + `!launcherAlive` ->
   execution-lost/launcher-disappearance (`:135-141`). Checked FIRST, before any
   turn inspection. CONFIRMED.
2. **Hosted lost-generation -> execution-lost** even with the daemon alive:
   `turn.ambiguous && turn.requestUnfinished && backend === 'hosted'` ->
   execution-lost (`:170-176`). An in-tool ambiguous+unfinished turn with the
   launcher alive falls through to generic `uncertain` (correct - in-tool lifetime
   = launcher lifetime). CONFIRMED.
3. **Settled turn -> succeeded/failed, NEVER execution-lost.** `turn.ok` ->
   workload status (`:155-162`), checked before the lost-generation branch.
   CONFIRMED.
4. **Non-death host failure -> generic uncertain, NEVER execution-lost** (`:179-
   184`). CONFIRMED.

Resume is from the committed frontier only: `partitionCommittedFrontier`
(`:208-221`) is a pure partition over recorded `committed` flags;
`isCommittedInvocation` (`:229-234`) guards resend. No reattach, no identity
revalidation (decision 11). CONFIRMED.

The host outcome vocabulary is unchanged: the change is purely additive
(`git diff --name-only dc3d84ad^..HEAD -- src/ test/` returns only
`frozen-action-executor/` files; zero edits under `src/core/session-host/`). So the
executor reads the host's existing `turn-outcome-unknown`/`interrupted` facts and
composes liveness at its own seam - exactly design D4 / Disagreements item 5.

Empirical: `action-outcome.test.ts` (12) + `executor.test.ts` (7) green at HEAD,
including the two execution-lost dispatch tests and the "settled turn is NOT
execution-lost" discrimination guard.

## Item 2 - never-silently-reroute (mutation 3.3) - CONFIRMED, 4 RED re-run

The matrix is COMPUTED over {linux,darwin,win32} x {in-tool,hosted-best-effort}
by `buildExecutionCapabilityMatrix` (`capability-matrix.ts:223-267`); each cell
joins a frozen declaration with a typed availability verdict. `resolveBackendSelection`
(`:346-405`) has NO code path that selects `in-tool` in response to hosted
unavailability: a hosted request the platform cannot serve returns typed
`authority-unavailable` (`:362-369`); the seam-missing case in the orchestrator
also returns authority-unavailable (`executor.ts:154-167`); and "no backend
requested or defaulted" refuses to invent one (`:398-404`).

**Mutation re-run (reviewer):** the hosted-unavailable branch was mutated to
return a selected `in-tool` backend (the literal silent reroute). RED = 4:
`capability-matrix.test.ts` (3 never-reroute cases) + `executor.test.ts > hosted
unavailable returns authority-unavailable and drives NO in-tool backend`.
Byte-exact restore (`222ca19b...` before and after; `git status` clean).
CONFIRMED discriminating, matches receipt 2.

## Item 3 - transactional completion (mutation 5.3) - CONFIRMED, 2 RED re-run

Three composable parts, all verified in `transactional-completion.ts`:
complete-set verify-before-publish (`publishCompletionTransactionally:154-173`
calls `verifyCompleteEvidenceSet` BEFORE the first store write); Facade re-read/
re-verify (`rereadVerifyCompletion:184-207` delegates to the existing
`verifyAttestedCompletion`, reading bytes through `evidenceStore.read`); and the
Record mutation is atomic under the RunStore head+1 commit (existing Facade
machinery, unedited - the executor composes it). The `crashAfter` fault-injection
seam (`:163-168`) simulates a mid-publish crash.

**Mutation re-run (reviewer):** `storeHoldsCompleteSet` mutated to return `true`
unconditionally. RED = 2: `transactional-completion.test.ts > a mid-publish crash
leaves a partial set the completeness check rejects` and `> a half-set accepted as
complete fails the guard (discrimination)`. Byte-exact restore (`f6e27394...`
before and after; clean). CONFIRMED discriminating, matches receipt 4.

**No signing/key-custody (decision 12):** a source scan of the module
(`grep -rniE "sign|private.?key|key.?custody|hmac|rsa|ecdsa|ed25519|crypto.sign"`)
returns only comment prose ("signal"/"design"); no signing primitive, private key,
or producer credential is minted, held, or accepted. The spec's completion
requirement states this explicitly (`spec.md:107,128-131`).

Note (consistent with the implementer's stop-on-drift log): atomicity for the
complete action comes from the RunStore head+1 commit + the Facade re-read, NOT
from `expectedRecordVersion` on the complete request (only `ChangeRunControlRequest`
carries that field). This matches design D5; no defect.

## Item 4 - Frozen-Action consumption + authority - CONFIRMED

`validateGrantedAction` (`authority.ts:135-246`) validates, in order: Run/Change
identity (`run-mismatch`), Record version CAS (`record_version_conflict`), Action
admitted in the Record (`not-currently-executable`), identity binding
(`receipt_conflict` via `sameActionIdentity`), authority binding (`receipt_conflict`
via `sameAuthority` - capability/profile/evidence/policy/workspace/effects),
workspace revision (`workspace-scope-mismatch`), duplicate dispatch (settled/
in-flight), and currently-executable (deliveryState === 'granted'). Every illegal
case fails closed with a typed outcome and performs no backend work. Authority is
read ONLY from the granted ActionView + the committed Record; the function
signature accepts neither chat, the live Definition, nor caller self-report.
CONFIRMED. (`authority.test.ts` 9/9; receipt 1 mutation re-confirmed by the
implementer, discrimination class independently visible in the
`sameAuthority`/`sameActionIdentity` branches.)

## Item 5 - reuse policy - CONFIRMED

`resolveReusePolicy` (`reuse-policy.ts:112-162`) resolves the authored
`sessionReuseAuthored` scope at `authored` provenance when present, else the
two-value `reuse` at `default` provenance; numeric limits always resolve from the
policy block at `default` provenance (a recorded placeholder is never enforced as
authored). `decideReuse` (`:233-274`) retires on `never`, on cross-authority
(different invocation/role/workspace/backend), and on over-round-limit; produces
an auditable handoff on over-handoff-limit; otherwise permits. No path silently
reuses across an authority boundary or past a limit. CONFIRMED. (`reuse-policy.test.ts`
11/11; receipts 6 + 7 cover the provenance and cross-authority guards.)

## Item 6 - scope boundary - CONFIRMED

- **No exhaustive cancel/restart/ack-loss matrix.** The module ships the
  execution-lost MECHANISM + committed-frontier resume + the representative
  receipts its tasks name; the exhaustive fault-injection matrix for acceptance 4
  is explicitly owned by the downstream `ecp-session-policy-and-control-parity`
  (implementer handoff "Seam and downstream ownership"; tasks.md section 7/10
  scope it). CONFIRMED.
- **No self-hosting toy-Change design.** `SELF_HOSTING_PROOF_SEAM` is a frozen
  const in `executor.ts:185-189` marking the operator-owned
  `ecp-session-self-hosting-vertical-proof` child as the driver; this change does
  not select or design the toy Change and does not pre-empt open decision 2.
  CONFIRMED.

## THE 7.1 RULING (prominent)

**Ruling: (b) - ship the core as a coherent shippable unit; 7.1 (production
driver-face wiring) is a separable integration wave, mandatory before ECP-8's
unified PR but NOT a gate on shipping the core module now. The LEAD should
dispatch the 7.1 wiring wave NEXT.**

Reasoning:

1. **Purely additive - shipping the core cannot regress any driver face.**
   Verified: `git diff --name-only dc3d84ad^..HEAD -- src/ test/` returns ONLY
   files under `src/core/frozen-action-executor/` and `test/core/frozen-action-
   executor/` (8 source files, 1814 insertions; 7 test files). Zero existing
   source edited - the CLI, Management API, Canvas, daemon, and host continue to
   work exactly as before. The executor is dormant-but-correct until wired.
2. **The architectural deliverable is done and proven.** The single
   projector/control contract (`dispatchGrantedAction` -> typed
   `ExecutionDispatchResult`), the computed capability matrix, the authority
   validation, the execution-lost reconciliation, the transactional completion,
   and the reuse policy are all delivered and tested (65 guards; 8 mutation
   receipts, including both LEAD-named targets re-confirmed RED by this review).
   The driver-face parity test (`executor.test.ts`) proves two faces consuming the
   contract resolve to the same Run/Action.
3. **7.1 is mechanical routing, separable by kind.** It routes each existing
   face's Run-driving entry to call `dispatchGrantedAction` with the face's
   backend selection. The implementer deliberately deferred it to avoid a
   half-integrated production change with regression surface in a shared worktree
   - sound engineering judgment. The contract is frozen and ready to consume.
4. **Acceptance 6's full receipt leg is gated independently of 7.1.** The
   real-run receipts (10.1/10.2) need Claude/Codex credentials + the wiring; the
   WSL Linux receipt (10.4) needs the external ext4 tree. So even if 7.1 landed
   in this wave, acceptance 6 could not be fully receipted this wave. The receipt
   deferral is orthogonal to the wiring decision.
5. **Local ship != user ship.** This is a local ship into the ECP-7 branch. The
   unified 0.2.0 PR is ECP-8. The executor being unwired at local-ship does not
   reach users; the wiring wave lands before ECP-8.

Honesty guard (the condition that makes (b) safe): the change must NOT claim
acceptance 6 or the driver-face requirement is operationally met. The spec's
"real receipts" requirement (`spec.md:190-213`) already frames real-receipt
acceptance as forward, and the implementer handoff records 7.1/10.x/5.4/8.1 as
deferred owned follow-ups. The spec's driver-face requirement (`spec.md:157-174`)
describes the target behavior correctly; its operational truth arrives with the
7.1 wiring. No false claim ships as long as archive waits for the wiring (which it
must - see item 8).

Practical note for the LEAD: the change is NOT archive-ready today. The archive
dry-run's sole top-level blocker is "7 task(s) are incomplete" (7.1, 7.3, 10.1,
10.2, 10.4, 5.4, 8.1) - expected, not a spec defect. So "ship the core" means the
core lands and the change stays open for the wiring + receipt waves; the LEAD's
next dispatch is the 7.1 wiring wave (which also unblocks 10.1/10.2).

## Item 8 - spec delta + projection - CLEAN (ADDED-only)

The delta is `## ADDED Requirements` for one new capability
(`frozen-action-session-executor`); 10 requirement headings, no MODIFIED, no
REMOVED, no RENAMED. No scenario rename, no heading rename (implicit delete is
not reachable). `rasen validate --strict` passes.

`rasen archive ecp-frozen-action-session-executor --dry-run --json` (non-
destructive; "Preview all planned archive actions without executing"):
`specSyncPlan` = `[{capability: "frozen-action-session-executor", status:
"create"}]` with spec-sync `blockers: []`. So the spec projection is
structurally clean. The dry-run's only non-empty top-level blocker is the
task-completeness gate ("7 task(s) are incomplete") - that is the expected
follow-up gate, not a projection defect.

## Item 9 - general pass - CLEAN

- `node bin/rasen.js validate ecp-frozen-action-session-executor --strict`:
  passed (exit 0).
- `npx tsc --noEmit`: 0 errors. `npx eslint` over the new module + tests: clean.
- Whitespace: `git diff --check dc3d84ad^..HEAD` clean; no trailing whitespace,
  no CRLF in the change directory or the new source/test bytes.
- Guard suite: 65/65 across 7 files (capability-matrix 15, action-outcome 12,
  authority 9, reuse-policy 11, transactional-completion 7, executor 7,
  attribution 4).
- No signing material (decision 12) - see item 3.
- No additional severity-worthy defect found.

## Findings

- **Blocker:** none.
- **Major:** none.
- **Minor (informational, non-blocking):** in `reconcileActionOutcome`
  (`action-outcome.ts:170-176`), the hosted lost-generation case records
  `source: 'daemon-death'` even when the daemon process may still be alive (the
  generation is lost, not necessarily the daemon). The outcome KIND
  (`execution-lost`) and the message ("lost generation... no longer controllable")
  are correct; only the audit `source` label is slightly imprecise relative to
  its own docstring ("the death that mints execution-lost"). A future docs/label
  pass could add a `lost-generation` source value; it does not affect correctness,
  typing, or authority retention, and the 12 action-outcome tests pass as written.

## Ship-readiness

The core module is shippable as-is (CLEAN, purely additive, contract delivered and
proven). 7.1 is a mandatory separable wiring wave before ECP-8, not a gate on the
core. The LEAD should: (1) ship the core, (2) dispatch the 7.1 production
driver-face wiring wave next, (3) collect the gated real receipts (10.1/10.2/10.4)
once credentials + wiring + the WSL tree are in place. No code change was made by
this review; only this evidence file was added.
