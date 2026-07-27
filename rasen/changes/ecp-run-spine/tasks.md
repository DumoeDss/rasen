## 1. Closed runtime and wire contracts

- [x] 1.1 RED: Add contract tests for `ChangePipelineRuntime.start/resume/complete/inspect/control`, requiring full RunId after start and proving optional Run selection exists only in CLI read-only discovery.
- [x] 1.2 GREEN: Implement closed branded request/error contracts and the public facade export without exporting plan, Record, reducer, store, or filesystem internals.
- [x] 1.3 RED: Add strict `change-run-view/1`, `root-dag/1`, receipt, control, completion, Action, Actor, EvidenceRef, and WorkspaceRevision codec golden/unknown-major/extra-field tests.
- [x] 1.4 GREEN: Implement the closed codecs, including commit-vs-unborn WorkspaceRevision, safe integers/bounds, additive unknown view sections, and typed unknown-major rejection.
- [ ] 1.5 RED: Add root-dag invariant tests for stable arrays, actions plus `waits[]`, terminal mutual exclusion, status priority, workspace scope, Action delivery state, allowed-control derivation, and receipt disposition/action-grant matrix.
- [ ] 1.6 GREEN: Implement invariant validation and exact disposition priority; make `RunActionView` diagnostic only and return executable receipt actions only on a durable grant/first claim or recovery-approved redelivery.
- [ ] 1.7 RED/GREEN: Prove reused start, idempotent completion, stale/conflicting control, waiting, and terminal responses carry `actions: []`; exact resume alone classifies lost delivery.

## 2. Planning-space, Change-instance, and launch identity

- [x] 2.1 RED: Add domain-separated SHA-256 golden vectors for PlanningSpaceId, ChangeInstanceId, WorkspaceInstanceId, RunId, NodeId, InvocationId, AttemptId, EffectId, ActionId, and WaitId.
- [x] 2.2 GREEN: Implement identity allocation from persisted registry-home, versioned physical-identity bytes, Change name/incarnation, committed ordinals, sorted effect descriptors, and exact wait context; exclude clocks, randomness, paths, PIDs, mtimes, Record version, and runOrdinal.
- [ ] 2.3 RED: Add POSIX device/inode/birth and Windows volume/file-index/creation codec tests for aliases, same-volume rename, reuse/conflicting history, missing precision, cross-volume copy, linked worktrees, independent clones with equal projectId, project move, and RASEN_HOME relocation.
- [ ] 2.4 GREEN: Implement fail-closed physical identity codecs and deterministic PlanningSpace/ChangeInstance/WorkspaceInstance derivation; keep projectId lineage/display-only.
- [ ] 2.5 RED: Add immutable association-registry contract tests for first bind, concurrent registered first starts, active/archive/missing aliases, runtime archive migration, manual unprovable move, same-name recreation, and crash-safe revision replay.
- [ ] 2.6 GREEN: Implement the bounded SafeRunPath-protected machine-home association ledger under the stable `(PlanningSpaceId, changeId)` association lease.
- [ ] 2.7 RED: Add launch-intent tests for normalized key-order-independent inputs, exact Pipeline/engine binding within `(PlanningSpaceId, ChangeInstanceId, launchRequestId)`, conflict, cross-scope reuse, and display-only runOrdinal.
- [x] 2.8 GREEN: Implement `RunId = H("run", PlanningSpaceId, ChangeInstanceId, changeId, launchRequestId)` and launch digesting with no global mutable key index.
- [ ] 2.9 RED/GREEN: Cover active-instance lookup, unique historical same-key retry without source, multiple-history `launch_instance_ambiguous`, archived same-name recreation, and old Run inability to target the new directory.

## 3. Frozen executable plan and support analysis

- [x] 3.1 RED: Extend Definition/plan-reader tests for exact envelope/payload digest, closed version, deep immutability, tampering, and stored-plan open without current source.
- [x] 3.2 GREEN: Extract the shared non-barrel plan codec and private opener/lowerer while keeping the public phase-1 payload opaque.
- [x] 3.3 RED: Add RuntimeExecutionProfile/1 fixtures freezing path-independent SourceRevision layer/source/content/semantic identity, exact capability/result/evidence/recovery/Adapter artifact, and every action-shaping effective policy value with provenance.
- [ ] 3.4 GREEN: Implement private launch-time execution sealing and bind plan/profile/source/capability/policy digests into launch and Record; reject unsupported effective values.
- [ ] 3.5 RED: Add drift tests for project/user/package shadowing, same-semantic raw edits, skill/artifact/config changes, removal, and unavailable current state while stored Actions remain byte-stable.
- [ ] 3.6 GREEN: Implement comparison-only DriftObserver and exact artifact resolution; never recompile or substitute current source/profile during resume.
- [ ] 3.7 RED: Add one support-analyzer fixture matrix across start, CLI show, management Pipeline detail, and Canvas for root DAG/Atomic/Gate/Finish/simple bug-fix versus unsupported Composite/Loop/FanOut/Join/other v1/v2.
- [ ] 3.8 GREEN: Implement `availableEngines`/`reconcilerSupport {supported, reason, profileDigest}` once and preserve legacy executionMode/LEGACY_NORMALIZED as separate compatibility information.

## 4. Canonical Record, reducer, waits, and limits

- [x] 4.1 RED: Add closed Record tests for PlanningSpace/ChangeInstance/WorkspaceInstance, frozen digests/revisions, predecessor chain, transitions/actions/effects/waits, counters, and terminal invariants.
- [x] 4.2 GREEN: Implement deeply readonly canonical Record and strict transition/action/wait/terminal/stimulus codecs with no separately writable event/projection truth.
- [x] 4.3 RED: Add reducer tests for RunStarted, ActionAdmitted, result/effect/infrastructure observations, GateAwaiting/Decided, workspace acceptance, suspension/resume/escalate/cancel/finish, and illegal ordering.
- [x] 4.4 GREEN: Implement pure validated reduction returning new values or typed failures with no input mutation or I/O.
- [x] 4.5 RED: Add WaitId tests for two Gates with equal decisionId, repeated occurrence, blocked/infrastructure/uncertain/capability/workspace variants, workspace-reservation stable-sorted multi-intent tuple identity, wrong/closed/stale WaitId, and exact required/forbidden fields.
- [x] 4.6 GREEN: Implement stable contextual WaitId allocation, exact variant codecs, and WaitId-bound resume/decision/workspace controls.
- [x] 4.7 RED/GREEN: Prove every Attempt/Action/Record path obeys sealed maxAttempts, maxActions, revisions, transitions, evidence refs, and execution budgets and commits a bounded terminal/escalated outcome at limit.

## 5. Pure root-DAG reconciliation and settling

- [x] 5.1 RED: Add reconciler determinism tests with shuffled insertion, poisoned clock/random/env/filesystem, repeated replay, and full stable identities/order.
- [x] 5.2 GREEN: Implement pure `reconcile(runtimePlan, record)` from only frozen plan/Record, sorting ready nodes by hierarchical NodeId.
- [x] 5.3 RED: Cover dependencies, AtomicStage, Gate, rejected Gate policy, adaptive simple/complex route, implicit/explicit root Finish, and terminal no-action behavior.
- [x] 5.4 GREEN: Implement only root-DAG semantics and reject ReviewCycle/Composite/BoundedLoop/GoalLoop/FanOut/Join before Run creation.
- [x] 5.5 RED: Add settle tests for two concurrent Gates, Gate plus independent read Action, ready reader+writer, two writers, access-none plus blocked workspace work, external reader/writer reservation races, concurrent completions with a remaining wait, and whole-root terminal rules.
- [x] 5.6 GREEN: Implement branch-local `waits[]` settling and pure stable-NodeId compatible admission selection; persist local-only workspace-reservation waits without blocking access-none progress.
- [x] 5.7 RED/GREEN: Add cycle/progress guards and prove a result plus downstream admissions/waits are committed in one candidate Record.

## 6. Closed Actions, Actors, completion, and external effects

- [x] 6.1 RED: Add closed Agent Action tests for role/model/effort/runtime/sandbox/input/session policy bounds and cross-variant/unknown/extra rejection.
- [x] 6.2 RED: Add closed Command Action tests for exact Adapter/executable artifacts, argv/env allowlist, WorkspaceInstance/workdir, timeout, `shell:false`, injection strings, ambient env/PATH drift, and bounds.
- [x] 6.3 RED: Add closed Host Action tests for supported operation/effects/input and Definition inability to inject executable code, argv, Adapter paths, or validators.
- [x] 6.4 GREEN: Implement exact versioned Agent/Command/Host constructors/codecs from trusted frozen capability bindings only.
- [x] 6.5 RED: Add ActorRef tests for agent role/provider/runtime/principal/session/Adapter, command Adapter/executable, host Adapter/principal, canonical identity digest, privacy, attestation, spoof, and unknown-major rejection.
- [x] 6.6 GREEN: Implement trusted Adapter-attested ActorRef validation; forbid raw principal/token/path/env data and retain principal-vs-session semantics.
- [x] 6.7 RED: Add completion discriminated-union matrix tests for domain result, required per-effect observation, infrastructure failure, required/forbidden fields, bounded contract-owned JSON, actor/evidence/action binding, and canonical receipt bytes.
- [x] 6.8 GREEN: Implement exact completion decoding and validation before mutation; never treat caller-supplied digest, actor, result, observation, or evidence as trusted.
- [x] 6.9 RED: Add completion-slot idempotency tests for `(ActionId, kind, EffectId-or-domain)`: same canonical bytes idempotent, same slot conflict, different EffectIds mixed-order independent, and domain closure after all required effects.
- [x] 6.10 GREEN: Implement per-slot receipt idempotency independent of Record version and transport-only uploads.
- [x] 6.11 RED: Add external-operation ownership tests for commit/ref/trailer, push lease, PR head/marker, archive manifest/receipt, two Runs on one resource, response loss, preexisting identical output, and marker tamper.
- [x] 6.12 GREEN: Freeze operation key/ownership-marker strategy per effect; credit only exact EffectId ownership, return typed conflict, and keep unprovable provider state uncertain.

## 7. Evidence ingestion, verification, and retention

- [x] 7.1 RED: Add EvidenceRef/envelope golden tests binding PlanningSpace/ChangeInstance/project/Run/Action/Effect/tree/schema/producer/observation plus content and attestation digests.
- [x] 7.2 GREEN: Implement private local-substitutable EvidenceStore/EvidenceVerifier and closed path-free refs with no Record write capability.
- [x] 7.3 RED: Add verification tests for missing/tampered/relabelled/cross-binding/oversized/sparse/link/reparse/traversal/TOCTOU evidence and strong `effect-not-executed` attestation/query.
- [x] 7.4 GREEN: Implement bounded no-follow physical reads, stable identity/containment rechecks, digest/contract/producer attestation validation, and fail-closed errors.
- [x] 7.5 RED: Add HostEvidenceWriter staging tests for bytes/local source, request/Run file-byte budgets, capacity reservation, claimed-digest conflict, and named before/after-publish crashes.
- [x] 7.6 GREEN: Implement private atomic content-addressed staging and idempotent refs; expose no writable evidence path or RunStore.
- [x] 7.7 RED: Add orphan-retention tests for explicit-only invocation, 256-entry cursor page, 24-hour minimum, full bounded Record reference recheck, race retention, and no status/inspect/list cleanup.
- [x] 7.8 GREEN: Implement bounded conservative retention and `input_too_large`/`evidence_budget_exceeded`/stored-corruption distinctions.
- [ ] 7.9 RED/GREEN: Add CLI transport-upload tests proving uploads stage before facade, only refs enter receipt bytes, and orphaned uploads cannot advance.

## 8. Workspace observation and cross-Run admission

- [x] 8.1 RED: Add WorkspaceObserver golden manifests for commit/unborn/detached HEAD, HEAD tree, index stages/modes/blob IDs, tracked bytes/modes/deletions, untracked nonignored files, symlink target, clean submodule gitlink/commit, NFC/case collisions, and Windows paths.
- [x] 8.2 GREEN: Implement bounded Git-plumbing plus physical reads, two identical passes/retry-once, and `workspace_observation_raced`/unsupported typed failures without `git diff` or mtimes.
- [x] 8.2a RED/GREEN: Prove unchanged submodule HEAD with inner staged/unstaged/untracked/mode/symlink dirtiness fails `workspace_submodule_dirty`, while nested/uninitialized/unreadable/racing/over-budget submodules fail unsupported; implement bounded per-submodule proof and no recursive dirty interpretation.
- [x] 8.3 RED: Add writer completion tests for exact before/after/delta, false/stale/external edits, not_executed no-delta proof, stale reader, and active-writer change becoming uncertain-effect rather than generic drift.
- [x] 8.4 GREEN: Implement WorkspaceRevision verification/update, typed workspace-drift, and WaitId-bound evidence-backed accept-revision with no ordinary resume.
- [ ] 8.5 RED: Add cross-Run admission tests: same WorkspaceInstance readers coexist; writer conflicts with all reads/writes across Changes/Runs; stable reader/writer/two-writer subset; access-none bypasses; durable local-only workspace-reservation wait at version zero; still-busy no-churn; release via facade or version+WaitId defer control; different linked worktrees do not block.
- [ ] 8.6 GREEN: Implement bounded immutable WorkspaceInstance reservation registry under the global workspace lease with exact Run/Action/Attempt/effect/Record cross-validation.
- [ ] 8.7 RED: Fault every reservation-delta boundary for new admission and completion-settle self-handoff: retain old finals, one/many new pending readers/writer/none, one Record closing old+admitting new, partial new finalize, partial old delete, concurrent waiters, exact predecessor, divergent digest/version, advanced head, and corrupt ledger.
- [ ] 8.8 GREEN: Implement token-grouped asymmetric recovery: at exact unchanged predecessor clear all new pendings/keep old finals; at exact admitted Record finalize every new reservation before deleting any old; otherwise remain busy/corrupt and return no new Action grant.
- [ ] 8.9 RED/GREEN: Prove selected-root workspace/Change-instance mismatch blocks resume/complete/control/host mutation with zero writes while exact cross-worktree inspect is read-only `scope: other`.

## 9. Immutable RunStore, Safe paths, locks, and aggregate bounds

- [ ] 9.1 RED: Add reusable in-memory/filesystem RunStore contracts for create/load/commit/list, immutable plan/launch/full Records, no-gap full-chain validation, exact temp namespace, and no earlier-revision fallback.
- [ ] 9.2 GREEN: Implement private in-memory and filesystem stores in registered machine-home with `{ensure:true}` only for validated new Run and `{ensure:false}` for exact existing Run operations.
- [ ] 9.3 RED: Add SafeRunPath tests at every directory/file component for symlink/junction/reparse/nonregular/hardlink/containment/parent replacement/no-follow identity and outside sentinels.
- [ ] 9.4 GREEN: Implement bounded SafeRunPath checks, same-parent exclusive create/publish, and the documented pure-Node same-user race boundary.
- [ ] 9.5 RED: Add immutable launch/commit fault tests before/after stage/fsync/publish/return, concurrent same/different keys, CAS conflicts, abnormal/overwidth/variant entries, plan mismatch, and Windows rename behavior.
- [ ] 9.6 GREEN: Implement staging-directory launch and `wx` immutable Record publication with named fault injector, fsync/close, predecessor/digest validation, and one successful publish.
- [ ] 9.7 RED: Add aggregate-budget tests for large/sparse/many Records/evidence, cumulative ledger limit, healthy plus malicious Runs, 100-summary/512-candidate/256-MiB list page, stable opaque cursor, and ordering.
- [ ] 9.8 GREEN: Enforce per-file/structure/count/cumulative budgets before parse/canonicalize and bounded isolated `run_store_too_large` list summaries.
- [ ] 9.9 RED: Add SafeCoordinationPath tests for benign global-data aliases, nested symlink/junction/reparse/non-dir/parent swap, cross-device hardlink, and physical anchor convergence.
- [ ] 9.10 GREEN: Implement physically anchored coordination paths with pre/post parent/file identity checks and no replacement-capable fallback.
- [ ] 9.11 RED: Add IPC lease tests on Linux/macOS Unix sockets and Windows named pipes for nonce/token response, timeout/permission unknown, paused loop, stable refusal twice, listener loss, stale socket, PID reuse, live-owner metadata corruption/unprovable companion remaining unknown-busy, and ABA release.
- [ ] 9.12 GREEN: Implement token-bound `net` challenge ownership, quarantine only for complete-metadata stable-refusal proven death, pre-publish lease revalidation, compare-token release, no automatic corrupt-lock steal, and no mtime/PID/process-table truth.
- [ ] 9.13 RED: Fault staging/fsync/link/link-before-unlink/post-return and test nlink=1, valid nlink=2 strict same-inode/token companion, crash residual, >2/unknown companion, extra hardlink, old-token cleanup, and unsupported Windows hardlink.
- [ ] 9.14 GREEN: Implement atomic same-volume hard-link-to-absent claim, strict companion validation/cleanup, `lock_unavailable` fallback behavior, and fixed bootstrap->association->engine->workspace->create->commit ordering.
- [ ] 9.15 RED/GREEN: Prove concurrent first bind, registered-no-association legacy resume versus canonical start, aliases, separate worktrees, archive-vs-recreate, and multi-process crash retries derive the same instance/engine lease and avoid lost association/Record revisions or nested facade locks.

## 10. Runtime facade, engine ownership, and recovery

- [ ] 10.1 RED: Add facade start tests for exact instance lookup, prepare/seal once, launch lookup before current source, unsupported support no artifacts, and same-key reuse returning current view plus `actions: []`.
- [ ] 10.2 GREEN: Implement `ChangePipelineRuntime` factory/facade wiring codecs, association, plan seal/open, observer, reducer/settler, reservations, store, projector, and one canonical commit path.
- [ ] 10.3 RED: Add resume/complete/control/inspect tests for exact RunId, trusted grant/defer context, admitted_undelivered -> first grant, double claim, committed view/action version equality, disposition matrix, read-only inspect, safe redelivery serialization, ambiguous suspension, and typed errors.
- [ ] 10.4 GREEN: Complete facade methods without exposing internal plan/Record/store/path; enforce source/workspace instance scope and durable delivery-state transition before any executable return.
- [ ] 10.5 RED: Add bilateral engine-guard cases for legacy-only, canonical-only, both, late legacy file, terminal history, corrupt/unreadable either side, exact/unknown legacy ChangeInstance binding after recreation, archive source absence, multiple canonical candidates, and discovery-to-lock race.
- [ ] 10.6 GREEN: Implement EngineOwnershipGuard under stable PlanningSpace/ChangeInstance lease; every registered mutation rechecks both stores exactly once and invalid state is never absence.
- [ ] 10.7 RED/GREEN: Extract legacy resume behind one authoritative lease, retain byte-shape/workdir-first behavior, prohibit nested lock-taking facade calls, and prove read-only candidate discovery creates nothing.

## 11. Projector and simple bug-fix dogfood

- [ ] 11.1 RED: Add projector goldens for full Change identity, workspace identity/scope, status/sourceState/drift, frontier/invocations/actions/effects, stable waits/WaitIds, terminal, diagnostics, and controls.
- [ ] 11.2 GREEN: Implement one read-only ChangeRunProjector reused by receipts, CLI, management, and UI; isolate invalid Runs without fallback.
- [ ] 11.3 RED: Add complete v1 decoder compatibility tests: unknown additive section tolerated/preserved, unknown top major rejected, exact root-dag closure and stable ordering.
- [ ] 11.4 GREEN: Implement shared wire decode/project helpers with no plane-local state derivation.
- [ ] 11.5 RED: Add in-memory simple bug-fix fixture through Gate, implement/verify simple, independently reconciled ship/archive effects, and finish, interrupted at every quiescent point.
- [ ] 11.6 GREEN: Add only the exact trusted bug-fix capability/action/profile table and v1 lowering needed by the fixture.
- [ ] 11.7 RED/GREEN: Prove complex route suspends `review_cycle_capability_unavailable` before ship and later-child semantics reject before launch.

## 12. Engine-aware Pipeline CLI

- [ ] 12.1 RED: Extend Pipeline command/help/localization tests for start/status/resume/complete/control/cancel, stable launch key, exact Run, WaitId, store/project/planning-space root, duplicate-projectId ambiguity, error codes, and bounded file/stdin input.
- [ ] 12.2 GREEN: Register handlers/options and route only through public runtime/host evidence seams; keep cancel typed control sugar.
- [ ] 12.3 RED: Add versioned JSON/human goldens for view/receipt/actions/disposition/full IDs/native diagnostics, reused start empty grants, deferred ActionView, trusted resume first claim, and status zero writes.
- [ ] 12.4 GREEN: Implement start/status output with no plan/Record serialization and no executable inference from ActionView.
- [ ] 12.5 RED: Add completion/control tests for exact discriminated variants, ActorRef/EvidenceRef, transport uploads, expected version+WaitId, conflict current view, symlink/nonfile/oversized/malformed bodies, and unknown fields.
- [ ] 12.6 GREEN: Implement bounded no-follow input reader, trusted upload staging, exact codecs, and stable non-zero typed errors.
- [ ] 12.7 RED/GREEN: Preserve legacy resume snapshots/locales including LEGACY_NORMALIZED wording; verify canonical ambiguity/integrity/dual-owner blocks fallback and unique canonical dispatch goes through exact facade resume.
- [ ] 12.8 RED/GREEN: Add `pipeline show` parity tests and implementation for availableEngines/reconcilerSupport from the shared analyzer.

## 13. Management API and bounded Operations discovery

- [ ] 13.1 RED: Extend runs wire/API tests for versioned summaries, PlanningSpace/Change/Workspace identity, exact planning/opaque selectors, duplicate-projectId clone ambiguity, current-workspace default filter, sourceState, waits, terminal, errors, and additive legacy fields.
- [ ] 13.2 GREEN: Implement read-only union discovery of active Changes plus registered machine-home Runs, filtered by selected WorkspaceInstanceId, with no writable index or identity mint.
- [ ] 13.3 RED: Add stable cursor pagination tests for many Runs, read/work budgets, invalid/large plus healthy entries, archived/missing exact Run, and two linked worktrees.
- [ ] 13.4 GREEN: Implement bounded paged list and isolated invalid summaries without unbounded full-chain work.
- [ ] 13.5 RED: Add exact GET detail router/auth/method/path tests, CLI equality, archived/missing state, other-worktree read-only scope, unknown major, and zero writes.
- [ ] 13.6 GREEN: Implement exact encoded detail route through the shared projector.
- [ ] 13.7 RED: Add POST tests for closed control+version+WaitId, sealed defer mode, Gate-to-undelivered Action, browser response loss/retry, no executable payload, later CLI first claim/double claim, wrong/stale wait, workspace mismatch, engine conflict, safe argv, output validation, timeout/exit, and no in-process file write.
- [ ] 13.8 GREEN: Implement CLI-backed POST bridge with exact identifiers/space, pre-spawn admission, non-overridable defer context, and view-only/empty-grant response.
- [ ] 13.9 RED/GREEN: Add Pipeline-detail availableEngines/reconcilerSupport parity with CLI start/show and Canvas while keeping legacy capability fields additive.

## 14. Task-detail Operations and Canvas

- [ ] 14.1 RED: Extend UI API types/client tests for versioned view/sections, waits/WaitIds, delivery grants versus ActionView, workspace scope, paged list cursor, exact PlanningSpace/opaque selected-space token on every route, duplicate-projectId ambiguity, exact detail/control, typed errors, and legacy compatibility.
- [ ] 14.2 GREEN: Update the shared client/types to consume server truth without deriving frontier/status/waits/terminal/drift/support.
- [ ] 14.3 RED: Add Task-detail tests for child grouping, selected-workspace isolation, archived/missing Runs, detail selection, concurrent actions+waits, full IDs, source/drift/diagnostics, terminal, loading/errors, and legacy sessions.
- [ ] 14.4 GREEN: Implement Operations UI while preserving session launch/tail/kill and legacy Run displays.
- [ ] 14.5 RED: Add control tests for exact per-wait affordances, version+WaitId submit, workspace-other hidden controls, cancel confirmation, duplicate suppression, conflict refetch, unauthorized handling, and no arbitrary completion/optimistic patch.
- [ ] 14.6 GREEN: Implement controls strictly from projected allowedControls and refetch committed truth.
- [ ] 14.7 RED: Add Canvas tests for availableEngines/reconcilerSupport/profileDigest/reason, LEGACY_NORMALIZED separation, unsupported disabled start, and CLI/management parity.
- [ ] 14.8 GREEN: Render shared support analysis in Canvas without Pipeline-name guessing.
- [ ] 14.9 RED/GREEN: Assert Run terminal state never mutates Board/Issue lifecycle; retain that mapping for 0.2.0.

## 15. Cross-plane parity and failure journeys

- [ ] 15.1 RED: Create one canonical fixture matrix across projector, CLI status, management detail, and Task-detail for all closed core/root-dag fields including actions+waits, workspace scope, and allowed controls.
- [ ] 15.2 GREEN: Remove plane-local derivations until only documented transport wrappers differ.
- [ ] 15.3 RED/GREEN: Add fresh-process simple bug-fix E2E from launch through Gate, typed Action/Actor completions, evidence, workspace reservations, simple verify, independently owned ship/archive effects, and terminal inspect.
- [ ] 15.4 RED/GREEN: Add complex-result E2E proving durable unsupported ReviewCycle wait, no ship, no human uncertain resume, and safe escalate/cancel.
- [ ] 15.5 RED/GREEN: Add launch/completion/downstream-admission ACK-loss journeys for deferred-undelivered, granted-executed, and granted-never-executed safe/non-idempotent Actions; verify browser replay grants empty, trusted first claim is atomic, and only post-grant loss invokes recovery.
- [ ] 15.6 RED/GREEN: Add every store/evidence/lock/reservation fault journey and prove no duplicate external effect, earlier-Record fallback, lost reservation, dual engine progression, or unsafe path escape.
- [ ] 15.7 RED/GREEN: Add archive -> same-name recreate -> old Run exact inspect/new Run start/old mutation failure; two archived generations with same key ambiguity; manual move missing; linked-worktree list/control isolation.

## 16. Verification and scope gates

- [ ] 16.1 Run focused change-run, Definition, Pipeline command, management, UI, and support-analyzer suites; resolve failures without weakening closed contracts.
- [ ] 16.2 Run legacy Pipeline resume/JSON/locales, portfolio/goal reading, management/session/Task-detail/Board regressions and prove additive behavior.
- [ ] 16.3 Run typecheck, lint, unit/integration/CLI E2E, UI typecheck/tests/build, and required POSIX/Windows lock/path/durability jobs.
- [ ] 16.4 Audit one canonical Record owner, complete executable freeze, PlanningSpace/Change/Workspace scoping, exact Actor/effect evidence, bilateral engine guard, zero read-side writes, bounded pagination, and no direct API/UI mutation.
- [ ] 16.5 Audit scope exclusions: no ReviewCycle body, Composite/Loop/Goal/FanOut/Join execution, Issue scheduling, or Board lifecycle mapping.
- [ ] 16.6 Perform real dogfood and named crash exercises, capture commands/results in Change work evidence, and map every scenario in all six delta specs to automated or explicit verification.
