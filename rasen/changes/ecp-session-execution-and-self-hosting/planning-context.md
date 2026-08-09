# Planning Context: ECP-7 Session Execution and Self-hosting

## Original user goal

The user made the delivery order explicit:

- treat Issue, Issue Execution Plan, portfolio runtime, Dispatch, and the
  `auto-decompose` migration as 0.3.0 work;
- finish the complete Change-level ECP in 0.2.0 first;
- start every implementation Slice from the active Direction, use
  `$rasen-auto auto-decompose`, keep all work in the isolated worktree, and
  drive every Slice to real evidence rather than accepting documents, mocks,
  or task checkboxes as completion;
- after ECP-7 and ECP-8 are genuinely complete, transfer the intended 0.2.0
  ECP delta to a clean branch and create one final PR. No child Change gets its
  own push or PR.

The active checkout is
`E:/AI/ChatAI/Agents/VibeCodingProjects/workflow/Reference/OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle`
on `wip/ecp-shared-bounded-loop-lifecycle-resume`. The migrated safety stash
and unrelated retained test-output directories are outside this portfolio's
ownership and must remain untouched.

## Current execution-order decision (2026-08-06)

The user changed the portfolio workflow to an implementation-first batch:
each Change runs `planner -> implementer`, then the LEAD advances to the next
Change without starting that Change's verify or review-cycle stages. Once all
non-deferred Changes in the current implementation wave are frozen, the LEAD
starts the independent verification/review wave and only then permits local
ship/archive. This is an execution-order optimization, not a relaxation of
author separation, open Blocker/Major gates, real-OS evidence, Section 9, or
ECP-8 delivery truth.

The current serial implementation order is Linux provider -> Windows provider.
macOS remains explicitly `decision-deferred` and receives no proposal/apply
work until a future Direction decision. Automatic context compaction alone is
not a handoff trigger; only genuine recall degradation, stated budget, or an
explicit runtime failure may create a handoff.

## Direction authority and projection boundary

- Direction: `rasen/work/issue-centered-automation-platform/executable-composite-pipelines`
- Active Slice: `slices/session-execution-and-self-hosting`
- Target State: `target-state.md`
- Roadmap item: ECP-7 Session Execution and Self-hosting
- Slice authority: `slices/session-execution-and-self-hosting/spec.md`
- Projection constraints: `slices/session-execution-and-self-hosting/plan.md`
- Current Result: `slices/session-execution-and-self-hosting/result.md` (`partial`)
- Design input: `docs/session-execution-layer-design.md`
- Predecessor evidence: ECP-6 `passed`

This portfolio projects only ECP-7. It must not absorb ECP-8 release truth,
version/changelog/package/tag work, legacy-engine retirement, final clean-branch
delivery, or any 0.3.0 Issue/Execution Plan/portfolio/Dispatch capability.
The historical Session design is an implementation input, not authority over
the current frozen Action, canonical Run, and ECP-6 trust contracts.

## Verified ECP-6 facts inherited by this Slice

- Authored Definition v2 is the default for new product paths; v1 is a
  compatibility input. The frozen v1 `auto-decompose` source remains outside
  Change-level ECP migration.
- The reconciler, immutable RuntimePlan/execution profile, canonical Record,
  deterministic projector, BoundedLoop, ReviewCycle, GoalLoop, Choice,
  FanOut/Join, Gate, and Finish are implemented and independently reviewed.
- Canvas authoring and CLI/Management/Operations projection are already
  vertically proven for a loop plus parallel Custom Composite.
- ECP-6 froze a public Ed25519 attestation authority into profile, plan, and
  Action; signed evidence and completion claims are verified before durable
  publication and re-read from a recoverable filesystem EvidenceStore before
  Record mutation.
- ECP-6 ended CLEAN with no open Blocker/Major finding and fresh root/UI gates,
  but its only working trusted completion producer is a test host. The product
  still has no real agent Action executor or production signer custody.

These facts are prerequisites, not areas to redesign. ECP-7 may add the
missing producer/executor and policy surfaces, but it must preserve the single
canonical Run truth and the existing complete-set verification boundary.

## Current code ownership and real gaps

The Project audit found four independently reviewable fault domains:

1. **Session host lifecycle.** `management-api/supervisor.ts` currently starts
   a one-shot `/rasen-auto` or `/rasen-goal` process with ignored stdin. Its
   registry is process-local, has only starting/running/exiting/exited states,
   and cannot wake, reuse, retire, reattach, or recover a worker after daemon
   restart. The HTTP Session API is a long-runner launcher, not an agent Action
   executor. There is no `rasen session exec|list|retire` command or durable
   run-scoped Session registry.
2. **Frozen Action and trust consumption.** The facade returns full granted
   Actions internally, but the public `pipeline start/resume-run/complete`
   JSON narrows them to `actionId/nodeId/kind`; no product component atomically
   claims and executes the exact committed Action. `TrustedCompletionProducer`
   requires an Ed25519 private `KeyObject`, while production preparation
   persists only public adapter descriptors and otherwise installs the
   package-unavailable public authority. Only test fixtures supply a matching
   private signer. No real Session result becomes a verified completion.
3. **Policy and driver parity.** `sessionReuseAuthored` survives lowering, but
   `handoffTokenLimit=10000` and `reuseRoundLimit=1` remain explicit
   placeholders and nothing enforces reuse/handoff/touch/retire policy.
   Management HTTP deliberately defers executable grants, CLI grants them,
   Canvas/Operations inspect projections, and daemon does not own a trusted
   dispatch loop. There is no one control contract that binds Session state,
   usage/audit, cancel/restart/ack-loss, and driver replacement to the same
   Run/Action.
4. **Self-hosting proof.** No non-ECP product Change has been implemented,
   verified, independently reviewed/fixed, and brought to local
   delivery-ready by this executor. ECP-6's many-process vertical drove the
   CLI correctly but manually supplied trusted test-host completions.

## Decomposition plan and dependency DAG

All children use the decompose-free `small-feature` pipeline and run in the
strict serial order below:

```text
ecp-durable-agent-session-host
  -> ecp-frozen-action-session-executor
    -> ecp-session-policy-and-control-parity
      -> ecp-session-self-hosting-vertical-proof
```

### 1. `ecp-durable-agent-session-host`

Deliver the backend-neutral, recoverable host seam first: bounded stream-json
create/wake, strict single-flight, real cwd binding, cancel/process-tree
cleanup, restart/reattach fallback, durable atomic Session registry, lifecycle
inspection, and deterministic protocol-replay fixtures. Preserve existing
Management Session compatibility while making lifecycle facts available to a
future Action executor. The registry records host lifecycle only and must not
become a second completion or Run state machine.

Primary touch surface: `src/core/management-api/supervisor.ts`,
`session-registry.ts`, `sessions.ts`, `router.ts`, `wire-types.ts`, daemon/server
wiring, agent CLI process transport, a narrow Session CLI surface, filesystem
placement/locking helpers, and their process/protocol tests.

Independent-delivery basis: users gain a durable, controllable real agent
Session host with restart behavior through existing CLI/API infrastructure;
the Change does not need to mutate a canonical Run or hold signing authority.
Its review can focus on process injection, single-flight, persistence,
cleanup, cwd identity, and recovery.

### 2. `ecp-frozen-action-session-executor`

Bind the reviewed Session host to the canonical engine. Atomically consume only
an exact granted agent Action from its frozen RuntimePlan/profile/adapter
authority and current Record version; validate Run/Action/invocation/effect,
workspace instance/revision/access, backend, and delivery state; execute the
structured capability input; collect structured result/events/usage; and
publish a plan-bound signed completion through `HostEvidenceWriter` and the
durable EvidenceStore. Add production trusted-producer credential custody whose
private signing capability is usable only inside the trusted host process and
never crosses project, argv, environment, registry, log, API, or UI boundaries.
Duplicate/stale dispatch, completion ack loss, signer mismatch, wrong cwd, and
worker loss must fail closed or recover exactly once.

Primary touch surface: new Action-executor/producer-provider modules under
`src/core/change-run/internal/`, the granted-Action transport seam in
`src/commands/pipeline.ts` or an equivalent internal driver API,
`trusted-completion-producer.ts`, `trusted-execution-adapters.ts`, runtime
context/RunStore/EvidenceStore integration, and trust/replay/fault-injection
tests.

Independent-delivery basis: after this Change, one real supported backend can
take one frozen Action to a verified canonical Record mutation without a
prompt-owned worker manager. Review can isolate trust-root custody, exact
Action admission, evidence atomicity, replay resistance, and exactly-once
mutation from broader product policy/UI work.

### 3. `ecp-session-policy-and-control-parity`

Make Session execution authoritative and usable across product surfaces.
Define configurable defaults and provenance for authored `sessionReuse`,
handoff token and reuse-round limits, touch/retire behavior, backend capacity,
and compatibility fallback; enforce scope compatibility and auditable
handoff/retire decisions. Wire CLI, Management API, Canvas/Operations, daemon,
and both supported interactive launcher shapes to start/resume/cancel/inspect
the same Run without exposing executable payloads to untrusted browser paths.
Project Session identity, cwd, actor, backend/model, usage/cost, result,
diagnostics, cancel/restart/ack-loss state, and next frontier from canonical
Run plus lifecycle facts. Add run-level audit/reconciliation evidence.

Primary touch surface: pipeline Definition/profile/config resolution and
provenance, Action policy fields, profile editor/config API, Session executor
policy, run-control/router/daemon commands, Management wire types/projectors,
Operations and Canvas UI, locales/docs, and cross-plane/fault-matrix tests.

Independent-delivery basis: it consumes the already reviewed executor and
turns it into a public, program-enforced product contract. Its review focuses
on policy-source truth, capability/fallback honesty, cancel/recovery semantics,
and same-Run projection rather than cryptographic primitive correctness.

### 4. `ecp-session-self-hosting-vertical-proof`

Use the frozen contracts from the first three children to run a bounded,
non-ECP toy Change that modifies real product code and has deterministic tests.
ECP must drive it from start through implement, verify, independent review,
finding repair/re-review when needed, and local delivery-ready. Exercise driver
replacement or host restart and at least the required cancel/ack-loss/process
faults without repeating committed work. Preserve a complete RunId/ActionId/
Session/workspace revision/result/evidence/gate/review graph; fix any defects
the real run reveals and finish with independent CLEAN security/review evidence
and fresh root/UI/static gates. After review-clean, run this child's local ship
and create its commit; do not push or open a PR.

Primary touch surface: a deliberately small real product delta selected in the
child proposal, bounded real-backend harness/protocol replay, vertical tests,
evidence and documentation. Product fixes discovered by dogfood may touch the
preceding seams, which is why this child is last and never parallel.

Independent-delivery basis: this is the acceptance consumer, not another
contract-design Change. It proves the assembled product and produces the
delivery-ready evidence ECP-8 will audit.

## Decomposition self-audit

- **Coherence:** every child has one user-observable result and one dominant
  fault domain: process lifecycle, trusted Action execution, public
  policy/control, then acceptance dogfood. The first trust boundary suggested
  by the Direction Plan was split once because process persistence and private
  signing/Record mutation require different security reviews; no smaller split
  leaves a useful product result.
- **Independence:** each child is reviewable and locally deliverable on the
  cumulative tree, but none is safe to run concurrently. Later children
  explicitly consume predecessor contracts.
- **DAG correctness:** the graph is a single acyclic chain. A dependent cannot
  begin until its prerequisite is implemented and independently review-clean.
- **Parallel audit:** verdict `safe-serial`, with no parallel cohort. The
  children overlap supervisor/registry, Action/profile authority,
  run-control/daemon, wire/projector/UI, shared process fixtures, TEMP/TMP,
  ports, backend credentials, and final dogfood resources. There is no positive
  file, contract, or resource-independence proof.
- **Dogfood:** the last child must be driven by the product executor built by
  the preceding children and must change real non-ECP product code. A helper
  that directly calls `TrustedCompletionProducer`, a mock-only backend, a docs
  edit, or a test-only fake cannot satisfy it.
- **Scope audit:** ECP-8 release work and every 0.3.0 Issue/Execution Plan/
  portfolio/Dispatch/`auto-decompose` migration item are explicitly excluded.

## Security and truth boundaries for every child

- The canonical Run Record is the sole mutable execution truth. Session
  registry, transcripts, audit rows, UI state, and launcher state are
  projections or host lifecycle facts only.
- Execution authority comes from the exact committed, frozen Action and its
  immutable plan/profile/adapter authority, never from the current Definition,
  chat history, request body, browser, or worker self-report.
- Private signing capability stays in the trusted host boundary and must never
  appear in argv, environment, project/worktree, Action/View/Record,
  Session registry, logs, API/Canvas payloads, or committed artifacts.
- Actor separation and workspace access are program-enforced. A producer cannot
  award its own independent-review verdict or bypass the existing complete-set
  evidence verification path.
- Restart, cancel, ambiguity, missing signer/backend, stale Record, and lost
  acknowledgement fail closed with typed unfinished state. No recovery path
  may redispatch an already committed invocation/effect.

## Child and portfolio delivery lifecycle

Every child runs its own decompose-free `small-feature` pipeline to a reachable
terminal state:

1. `propose -> apply -> verify -> review-loop` reaches independent
   review-clean with no open Blocker/Major finding;
2. `ship` executes in `local` mode and creates that child's local commit only;
   it must be recorded `done`, with no push and no per-child PR;
3. after local ship, normally dispatch `rasen-archive-change` for that child;
   `archive.timing=on-merge` does not add a PR-merge gate when the ship log is
   `Mode: local`. Record `archive: done` only from real archive evidence,
   including an evidence-backed already-archived no-op. `archive: skipped` is
   permitted only when the ship evidence explicitly says `Archived in ship`.
   Never defer a child archive to ECP-8, leave it `pending`, or use the
   parent-only `delegated` status for a child stage.

The parent `auto-run.json` stages remain `delegated` because the parent is a
planning container; that parent-only ownership transfer does not change the
child lifecycle above. Once all four children are `done | skipped`, parent
portfolio delivery transitions `pending -> in_progress -> done` with
`mode: local`. This terminal local outcome means the cumulative ECP-7
worktree/commits are locally delivery-ready and keeps `pipeline resume` live;
it does not mean the ECP-7 parent is released, pushed, remotely validated,
merged, or finally archived. Each child has already completed its own local
ship-and-archive lifecycle with evidence.

The only PR and remote CI remain ECP-8 responsibilities: ECP-8 transfers the
intended 0.2.0 ECP delta onto a clean branch, revalidates it, creates one PR,
waits for remote CI, and then performs the final ECP-7-parent/ECP-8 remote
merge-and-archive bookkeeping. ECP-7 may be marked passed from local
functional, dogfood, child-archive, and independent review evidence, but never
reported as remotely released.

## Durable findings from child 1 proposal (2026-08-04)

`ecp-durable-agent-session-host` completed proposal/design/spec/tasks and
strict validation without starting implementation. Its code audit established
these durable facts for apply and later children:

- The existing Management supervisor is a one-shot `claude -p` launcher with
  ignored stdin, bounded tails/watchdogs/tree-kill, and an in-memory registry.
  Existing `POST/GET/DELETE /api/v1/sessions` behavior must remain compatible;
  it is not itself the reusable Action Session host.
- The existing `agent dispatch --runtime claude` path already owns valuable
  cross-process primitives: canonical-cwd binding, exact-session writer
  claims, worker-process-tree tokens, serialized stale-owner recovery, bounded
  result parsing, and fail-closed cwd/ownership ambiguity. Child 1 should
  generalize/reuse those primitives rather than create a weaker parallel lock.
- The selected deep module has one command-shaped SessionHost interface for
  execute/cancel/restart/retire plus inspect/list/reconcile/shutdown. Backend
  protocol details live behind an internal adapter seam; the production Claude
  stream-json adapter and deterministic replay adapter exercise the same host
  interface.
- Rasen Session identity is stable and distinct from backend Session identity
  and OS process generation. Every replacement process increments a generation;
  PID alone is never durable ownership proof. The original canonical cwd is
  immutable across wake/restart/recovery, including Windows alias handling.
- The durable registry is machine-local `rasen-session-host-registry/1`, not a
  Run directory or second completion ledger. It stores only host lifecycle,
  generation, ownership, bounded request-state digests/references, and recovery
  diagnostics. It must never persist prompt/result bodies, Action payloads,
  canonical Run/Record state, evidence claims, credentials, or signing keys.
- Normal create/wake uses one resident bidirectional stream-json process.
  Recovery opens the exact backend Session id in the same cwd and returns to a
  resident transport. A driver replacement talking to the same daemon reuses
  the stable Rasen Session without process replacement.
- Recovery deliberately prevents duplicate dispatch rather than claiming
  Action exactly-once semantics: if a daemon/process dies with a prepared or
  sent turn but no durable terminal result, the turn becomes
  `turn-outcome-unknown`/ambiguous and is never automatically replayed. Child 2
  must add frozen-Action admission, authoritative evidence reconciliation, and
  exactly-once canonical mutation above this honest host result.
- Cancel/restart/retire are generation-fenced, intent-before-signal operations.
  They reuse graceful-then-forced tree termination, release capacity/claims
  only after observed close, reject restart while an exact owner is live, and
  make retire terminal. Touch, final-handoff, reuse limits, and backend capacity
  remain policy-child work.
- The proposed narrow CLI is `rasen session exec|list|inspect|cancel|restart|retire`.
  Short-lived commands route through the identified resident daemon; prompt
  content travels over authenticated local input and backend stdin, never
  backend argv. Existing one-shot `agent dispatch` remains compatible.
- The implementation plan is explicitly RED -> GREEN and includes deterministic
  protocol replay, atomic-publication and multi-process fault injection,
  current-host real process/path gates plus injected Windows/POSIX branches,
  sensitive-data/security checks, full root/UI static gates, independent
  security/code review, local ship, and immediate evidence-backed child archive.
  It creates no child PR; ECP-8 keeps the unique remote PR and actual
  Windows/Linux/macOS CI responsibility.

The child artifacts are at
`rasen/changes/ecp-durable-agent-session-host/{proposal.md,design.md,specs/,tasks.md}`.
They were the strict-valid apply baseline for the implementation recorded below.

## Durable findings from child 1 implementation (2026-08-04)

`ecp-durable-agent-session-host` is now implemented in the shared isolated
ECP worktree. Verification/review/ship/archive remain separate stages; these
facts describe the current implementation and are safe premises for later
ECP-7 children:

- `src/core/session-host/` now owns the backend-neutral command/outcome/view
  contract, strict validation, bounded per-turn NDJSON protocol, backend and
  transport seams, Claude resident adapter, atomic registry, ownership adapter,
  and lifecycle orchestration. The host imports no canonical Run/trust modules.
- A single daemon-owned host and registry are constructed by the Management
  server. Authenticated `/api/v1/hosted-sessions` routes and
  `rasen session exec|list|inspect|cancel|restart|retire` share that resident
  owner; legacy one-shot Session launch semantics remain intact and receive
  only additive hosted projection fields.
- The durable process fact is exact authority, not PID inference: it pairs the
  existing Claude session-state writer nonce with worker token/root PID.
  Reconciliation may reap only an exact stale owner. Live or mismatched
  ownership stays interrupted/fail-closed and is never signalled by PID alone.
- The registry uses owner-aware O_EXCL mutation leases, immutable stale-lease
  tombstones, same-directory candidate publication, whole-document integrity,
  canonical cwd identity, copy-on-read, and bounded Windows replacement retry.
  In-memory state is published only after lease release, which removed an
  observed cancel/retire `registry-busy` race.
- Stream decoding and raw byte limits reset per turn on the resident process.
  Any event after a terminal result poisons the transport so a duplicate result
  cannot leak into the following wake. Prompt text is structured stdin only;
  binary, argv, cwd, protocol limits, and backend selection stay server-owned.
- Active cancel/retire and late backend completion are generation-fenced.
  Prepared/sent uncertainty is preserved as interrupted/ambiguous without
  automatic resend. Idempotency is exact while request history is retained;
  terminal ids pruned from detail enter a fixed-size monotonic Bloom tombstone,
  whose possible false positives fail closed as outcome-unknown and whose
  inserted ids cannot permit a second stdin write. This host refusal still
  must not be promoted to Action exactly-once semantics.
- Fresh gates on the Windows host passed: product build and lint; 14 focused
  files with 105/105 host, registry, ownership, protocol, backend, Management,
  daemon, CLI, and tree-kill tests; ten consecutive 11-test host race runs;
  UI typecheck, 59 files with 651/651 tests, and UI production build; strict
  Change validation. The actual CLI E2E used two short-lived drivers against
  one daemon-owned no-network `.cmd` resident and proved stable Session,
  backend, and PID facts.
- The apply-stage isolated full root passed 452 files with 6,947 tests passing
  and 34 skipped. A fresh post-review full-root rerun, clean non-author
  re-review/security disposition, local ship/archive, and actual Linux/macOS
  remote evidence remain pending in their assigned later gates; the earlier
  full-root result does not substitute for those obligations.
- Child 2 may consume the stable host receipt and durable request lifecycle,
  but must independently add frozen-Action admission, authoritative evidence
  reconciliation, trusted completion, and exactly-once canonical mutation.
  The host result alone is never a trusted completion or Run mutation claim.

## Durable portfolio replan: native ProcessCapsule closure prerequisite (2026-08-04)

### Why the original DAG cannot simply resume

After the implementation facts above were recorded, child 1 completed three
bounded independent review/fix rounds and one allowed material strategy
attempt. The strategy replaced PID/PowerShell authority with opaque
`ProcessScope`, the source-built native ProcessCapsule helper, Windows
suspended Job-at-create with a unique controller handle, Linux pidfd plus
boot/start/group identity, macOS native birth identity, registry v2, and
prepare -> durable CAS -> activate. Author gates and a fresh non-author gate
set passed; the real Windows controller-death escape was independently closed.

The fresh strategy reviewer nevertheless returned `CHANGES_REQUIRED` with
Blocker 0, Major 4, Minor 1, Trivial 0. The child review-loop therefore
exhausted its strategy budget and was correctly escalated; the parent has no
original runnable child. Resetting that child to pending or erasing its
counters would falsify history and violate the bounded-loop contract.

The user approved an explicit Direction/portfolio replan: add a new independent
Change named `ecp-native-process-capsule-closure`, close the remaining native
fault domain there, then reopen child 1 for a fresh post-remediation review
without losing its prior escalation history. ECP-8 release truth and every
0.3.0 Issue/Execution Plan/Dispatch/`auto-decompose` product capability remain
excluded.

### Replanned dependency graph

```text
ecp-native-process-capsule-closure              dependsOn: []
  -> ecp-durable-agent-session-host             escalated until explicit replan

ecp-native-process-capsule-closure ─┐
                                    ├─> ecp-frozen-action-session-executor
ecp-durable-agent-session-host ─────┘
  -> ecp-session-policy-and-control-parity
    -> ecp-session-self-hosting-vertical-proof
```

The closure child is the only safe pending/runnable frontier. The original
host child keeps its `escalated` status and old stage evidence until closure is
terminal and the LEAD performs the explicit run-state replan described below.
Child 2 must depend on both closure and the original host so neither native
closure nor host delivery can be accidentally omitted. Children 3 and 4 keep
their original serial dependencies. There is no cycle: the closure Change
uses code already present in the shared cumulative tree and treats child 1's
artifacts/evidence as historical input; it does not depend on child 1 reaching
a terminal run-state.

### New child scope and historical attribution

`ecp-native-process-capsule-closure` owns only the residual native
ProcessCapsule/ProcessScope remediation and the smallest host integration
needed to prove it. Its proposal/design/spec/tasks must say that the initial
opaque/native implementation was authored during the escalated child 1
strategy attempt. The new Change owns the repairs and new evidence, not a
rewritten claim that it originated all existing code.

Expected primary touch surface:

- `native/process-capsule/src/main.rs` and the pinned Rust/package build inputs;
- `src/core/session-host/process-capsule/native-process-scope.ts` and the narrow
  ProcessScope/native-adapter boundary;
- only the necessary `src/core/session-host/host.ts`, registry/migration and
  daemon/shutdown integration needed to retain authority correctly;
- native/package/migration/fault-oracle tests and the closure Change's own
  artifacts/evidence/docs.

It must not implement frozen Action consumption, signer custody, canonical Run
mutation, reuse/handoff policy, public control/UI parity, self-hosting, release
version/changelog/tag work, legacy-engine retirement, Issue/Dispatch, or
portfolio runtime product capability. It must not delete or absorb child 1's
review/security/strategy reports, retained temp outputs, safety stash, or
unrelated cumulative ECP changes.

### Required S1–S5 acceptance

1. **S1 / Major — macOS native ABI and exact identity.** Replace the 40-byte
   declaration with the complete 56-byte `proc_uniqidentifierinfo` contract,
   preferably through generated/system bindings; add compile-time/explicit
   size assertions and real macOS collision, foreign-identity zero-signal, and
   unavailable-source fail-closed oracles. A cross-target compile is not real
   macOS evidence.
2. **S2 / Major — backend exit is not scope close.** Separate backend-root
   `EXIT` from whole-scope empty/controller-terminal closure. A root that exits
   after creating a detached descendant must leave the opaque ref live and
   durable authority retained until exact scope-empty or successful terminate;
   host observation must not clear it early.
3. **S3 / Major — exact POSIX replacement cleanup.** Validate controller and
   supervisor native birth identities and close the exact reserved process
   group (or an equivalent kernel-enforced containment) after daemon/controller
   loss. Real Linux and macOS tests must cover resistant descendants,
   controller/daemon death, replacement cleanup, and same-PID/different-birth
   zero-signal behavior. Controller-only or PID-only signalling is forbidden.
4. **S4 / Major — bounded PREPARED control.** Apply a bounded control deadline
   to ACTIVATE and prepared abort/termination. Hung-controller/pipe mutations
   must produce one typed timeout/uncertainty outcome and retain any authority
   whose close was not observed.
5. **S5 / Minor — truthful reproducibility/provenance.** Two source-identical
   clean helper builds must either produce identical bytes/digests or the
   claimed reproducibility/provenance contract must be explicitly narrowed in
   all authoritative artifacts and tested. Per-build manifest/hash agreement
   remains necessary but does not alone close this finding.

The child must preserve the already successful opaque seam, Windows
Job-at-create/last-handle guarantee, early-activation mutation discriminator,
registry v2 fail-closed migration, adjacent helper integrity checks, and no
runtime compile/download/PATH/PowerShell/`ps lstart` fallback.

### Verification and delivery boundary

Before review-clean, the closure child must run the native/package/migration
subset, complete focused host/Management/daemon/CLI suite, ProcessScope and
real-process fault oracles, Rust fmt/clippy and target checks, TypeScript
build/lint/typecheck, strict Change validation, and package audit. It must add
fresh independent security plus code/spec review over S1–S5. Actual OS claims
require actual OS execution; unavailable local platforms are reported as
explicit evidence obligations, not simulated success. Whether the child can
locally close without the full remote OS matrix must be decided honestly in
its proposal against the Slice contract; ECP-8 still owns the final release CI
matrix and cannot absorb an open ECP-7 Major.

After review-clean it follows the same portfolio lifecycle as every other
child: local ship commit only, no push/PR, then evidence-backed archive. It may
not alter final release/version/tag truth or create a separate PR.

### LEAD-only run-state mutation contract

The Direction/planner worker does not write `.rasen/**`. The LEAD is the sole
run-state writer and must perform these mutations in order:

1. Add `ecp-native-process-capsule-closure` to the parent portfolio as
   `status: pending`, `pipeline: small-feature`, `dependsOn: []`; leave original
   child 1 `escalated` and make closure the only runnable frontier.
2. Add closure as a dependency of `ecp-durable-agent-session-host` for the
   recovered plan representation, and add both closure and host as explicit
   dependencies of `ecp-frozen-action-session-executor`; keep children 3–4
   serial. Preserve the original DAG/replan audit rather than overwriting it.
3. After closure review-clean/local ship/archive, preserve child 1's three
   rounds, strategy attempt, S1–S5 findings and `strategy-exhausted` under an
   immutable `priorEscalation`/replan history field supported by the actual
   run-state contract. Then grant a new explicit bounded post-remediation
   review-loop budget; do not silently reset counters without the history.
4. Re-run child 1 verification and independent security/code/spec review on
   the cumulative tree. Only a fresh 0-Blocker/0-Major result and completed
   final gates permit child 1 local ship/archive and make child 2 runnable.

If the current run-state schema cannot encode the dependency/replan history
without loss, the LEAD must persist an append-only replan evidence record and
make the smallest schema-valid state transition; it must not invent fields
that the reconciler ignores or delete the old auto-run/portfolio record.

### Durable findings for future planning

- A strategy attempt can fix the originally targeted exploit and still expose
  a deeper independent fault domain; budget exhaustion is a legitimate signal
  to replan ownership, not permission to waive findings.
- ProcessCapsule correctness spans native ABI, process-scope lifecycle,
  controller replacement, bounded controls, package provenance, and real-OS
  evidence. Treating it as a narrow PID utility would recreate the escaped
  authority boundary.
- Closure evidence and original host delivery are separate gates. Later Action
  execution must depend on both so a clean native helper cannot be mistaken for
  a complete durable Session host.

## Process authority architecture replan (2026-08-04)

### New evidence and superseded premise

`ecp-native-process-capsule-closure` reached 56/63 before independent review. Review round 1 and
CSO review left `RC-001..005` and `SEC-001..003`; fixer round 1 deliberately made no product edits.
The decisive Blocker is architectural: a workload can call `setsid()`/`setpgid()` and leave the
reserved POSIX process group. Controller/supervisor birth validation and PGID signalling therefore
cannot establish recursive containment, exact empty, or exact kill. Preserve all prior reports,
counters and checked tasks as provenance, but do not count them as the replacement authority.

The primary-source architecture record is
`rasen/changes/ecp-native-process-capsule-closure/evidence/architecture-replan.md`. It compares:

- selected contingent native authorities: Windows Job; Linux user+PID namespace guardian with an
  authenticated installed broker/non-migratable cgroup-v2 fallback; macOS 27 signed/entitled dual
  descendants Endpoint Security clients with bounded no-gap stop/sync termination; and
- a macOS VM boundary with native Windows/Linux, rejected for the current horizon because it adds a
  guest image/runtime, workspace/credential transport and a separate distribution program.

### Human decision boundary

No implementation frontier is currently safe. The product owner must explicitly authorize macOS 27
minimum support, Beta descendants/sync Endpoint Security APIs, Apple entitlement, Developer ID
signing/notarization and a real macOS 27 acceptance runner; otherwise the owner must choose the VM
program or alter the macOS support promise. The current unsigned adjacent npm helper cannot satisfy
either choice. Do not silently label the platform unsupported and do not substitute cross-target or
injected evidence for actual-OS acceptance.

### Required next DAG and single-writer action

After the decision, the LEAD (and only the LEAD) creates and projects a new Change inside the same
ECP-7 Slice:

```text
ecp-platform-process-authority-foundation
  -> ecp-native-process-capsule-closure
       -> ecp-durable-agent-session-host
            -> ecp-frozen-action-session-executor
                 -> ecp-session-policy-and-control-parity
                      -> ecp-session-self-hosting-vertical-proof
```

The executor continues to depend explicitly on closure and host. The foundation owns the public
authority-provider seam, Linux namespace/broker/cgroup, macOS ES/signing/install, Windows adapter,
protocol revision and real escape/death/recovery/empty/kill/unavailable oracles. Closure owns later
ProcessScope/host integration, PGID deletion, `SEC-001..003`, `RC-002..005`, final independent review
and local ship/archive. ECP-8 retains the actual Win/Linux/macOS clean-branch acceptance matrix.

Closure tasks are now 58/94: 10.3–10.4 are the decision/projection gate, 11.1–11.17 are the explicit
foundation RED→GREEN projection, and 12.1–12.10 are closure resume work. Do not mutate run-state or
create the new Change before the product decision is recorded.

## Durable replan: macOS decision deferred without blocking common/Linux/Windows (2026-08-04)

### Exact user decision

The product owner has now made one narrower decision: record the macOS authority issue, defer the
macOS solution until a later decision, and continue the work that does not depend on that choice.
This is **not** authorization for Endpoint Security, a VM, an unsupported-platform policy, a minimum
macOS version, entitlement/signing/notarization work, or any macOS support/release claim. The two
macOS designs in `evidence/architecture-replan.md` remain research candidates only.

The unresolved macOS decision still blocks the macOS provider, final ProcessCapsule integration
closure, and ECP-8's mandatory actual three-OS release matrix. It does not block the common provider
contract or the Linux and Windows authorities.

### Split Change ownership

The prior single `ecp-platform-process-authority-foundation` ownership is superseded by four
independently reviewable Changes in the same ECP-7 Slice:

1. `ecp-platform-process-authority-foundation` owns only the platform-neutral
   `ProcessAuthorityProvider`, versioned opaque-reference envelope, provider dispatch/registry,
   bounded lifecycle and typed availability/uncertainty, closed capability negotiation, and
   deterministic contract mutations. It owns no OS adapter, broker, installer, entitlement, or
   support claim.
2. `ecp-linux-process-authority-provider` owns the user+PID namespace guardian, full availability
   probe, authenticated installed broker/non-migratable cgroup-v2 fallback, replacement recovery,
   and actual Linux escape/death/empty/kill/unavailable oracles. PGID/PID-tree fallback is forbidden.
3. `ecp-windows-process-authority-provider` owns the Job Object adapter behind the common seam and
   the suspended assignment, breakaway-disabled, unique-last-handle and unrelated-process oracles.
4. `ecp-macos-process-authority-provider` owns only the future macOS authority decision and its
   eventual implementation fault domain. Before a new explicit Direction decision it has no
   selected architecture, no implementation acceptance, and no permission to propose/apply.

The existing `ecp-native-process-capsule-closure` resumes only after all three platform providers
are terminal. It owns ProcessScope/host integration, atomic protocol/manifest integration, deletion
or hard-disablement of PGID authority, `SEC-001..003`, `RC-002..005`, and fresh independent
review/local lifecycle. Existing apply/verify/review/fixer evidence remains historical input.

### Required DAG and portfolio status projection

```text
ecp-platform-process-authority-foundation       [pending; dependsOn: []]
  ├─> ecp-linux-process-authority-provider      [pending; dependsOn: foundation]
  ├─> ecp-windows-process-authority-provider    [pending; dependsOn: foundation]
  └─> ecp-macos-process-authority-provider      [escalated; decision-deferred]

linux + windows + macos providers
  -> ecp-native-process-capsule-closure         [escalated; prior review retained]
       -> ecp-durable-agent-session-host        [escalated; prior escalation retained]

closure + host
  -> ecp-frozen-action-session-executor
       -> ecp-session-policy-and-control-parity
            -> ecp-session-self-hosting-vertical-proof
```

The portfolio parser accepts only `pending | in_progress | done | skipped | escalated | unknown`.
The LEAD MUST therefore project the deferred macOS child as schema-valid `escalated` with an exact
`decision-deferred` note and append-only replan evidence. It MUST NOT invent a raw `decision-gated`
status (which normalizes to `unknown`) or leave the node `pending` (which can become runnable).

The common foundation is the sole initial runnable child. Linux and Windows are `pending`, depend
on the foundation, and may enter one parallel cohort only after the common contract is terminal.
macOS remains escalated regardless of the foundation result. Closure depends explicitly on all
three provider ids and remains escalated until a later explicit replan; this avoids `in_progress`
being surfaced as an interrupted runnable child while its new prerequisites are unsatisfied.
`ecp-frozen-action-session-executor` continues to depend explicitly on both closure and host.

When projecting this DAG, the LEAD must preserve the original host's three review rounds, strategy
attempt and `strategy-exhausted`, plus the closure's completed apply/verify, review round 1, fixer
no-op, eight findings and counters. No auto-run record is reset. After a future macOS decision, only
the macOS child is explicitly moved to `pending` and proposed against that approved architecture.
After all three provider children are `done | skipped`, the LEAD grants closure a fresh bounded
integration/re-review budget while retaining its prior escalation, then resumes the original host
under its separately preserved post-remediation review budget.

### Revised task and release truth

The closure ledger is now 59/96. Task 10.3 records this explicit defer and is not a macOS design
approval. Tasks 10.4–10.6 project the four prerequisite Changes, enforce the non-runnable macOS/
closure states, and define the future decision re-entry. Tasks 11.1–11.17 are partitioned by common,
Linux, macOS and Windows owner; macOS tasks remain dormant until approval. Tasks 12.1–12.10 remain
the closure integration/resume work.

Provider and closure evidence does not replace ECP-8. ECP-8 still runs the first clean-branch actual
Windows/Linux/macOS matrix; an undecided macOS architecture, non-terminal provider, missing receipt,
or failed receipt blocks release and all corresponding support claims. This planning worker does
not create the Changes or mutate `.rasen/**`; the LEAD is the sole writer for that projection.
