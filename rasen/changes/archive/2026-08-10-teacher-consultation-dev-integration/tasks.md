## 1. Pin and Merge the Delivered Histories

- [x] 1.1 Fetch and verify `origin/dev/0.2.0` still resolves to `96452f5c`, the Teacher branch resolves to `914c836a`, and their merge base is `91d71d6c`; stop for re-planning if the target moved.
- [x] 1.2 On existing `feat/teacher-advisor-workflow` at pre-merge `914c836a`, create or retain a backup ref at that exact HEAD and record the pre-merge status without touching unrelated worktree or portfolio files.
- [x] 1.3 Merge pinned `origin/dev/0.2.0@96452f5c` into `feat/teacher-advisor-workflow` with `--no-ff --no-commit`; the final merge must have Teacher `914c836a` as first parent and dev `96452f5c` as second parent, while preserving `3c595019`, `f6d6854c`, and `914c836a` as reachable original commits. Do not rebase, squash, cherry-pick, or manually transplant either tree.
- [x] 1.4 Verify the archived runtime directory and its recorded commit/tree/evidence hashes remain unchanged by integration, and record the merge parents for fresh integration evidence.

## 2. Resolve the Eight Textual Conflicts

- [x] 2.1 Resolve `rasen/specs/frozen-action-session-executor/spec.md` by retaining the complete Teacher requirement/scenario append and current dev end-of-file formatting, then validate that no canonical requirement was lost.
- [x] 2.2 Resolve `src/core/change-run/internal/facade-runtime.ts` with dev launch/task-loop validation, report regeneration, and completion ordering plus Teacher consultation classification, advice settlement, continuation grants, reservation cleanup, and receipt projection.
- [x] 2.3 Resolve `src/core/change-run/internal/reconciler.ts` with task-loop phase/escalation behavior plus Teacher admission/continuation, proving consultation transitions do not advance loop progress or strategy attempts.
- [x] 2.4 Resolve `src/core/change-run/internal/runtime-context.ts` with one platform-safe path implementation, task-loop observer/report context, frozen consultation bindings, service-scoped reservations, hosted-receipt verification, and stored-runtime reopen.
- [x] 2.5 Resolve `src/core/management-api/router.ts` with current runs/reusable/body-abort behavior plus the Teacher continue route, trusted producer, exact authority policy, dedicated exact host/journal, and distinct state roots.
- [x] 2.6 Resolve `src/core/management-api/server.ts` with current reusable-owner shutdown diagnostics plus Teacher host-state defaults and the optional exact-Teacher owner, without adding a second supervisor owner.
- [x] 2.7 Resolve `src/core/worker-contracts.ts` with current Codex nullable-schema normalization plus the separate bounded consultable schema/parser, preserving ordinary leaf/evaluate behavior and ordinary leaf rejection of `CONSULT`.
- [x] 2.8 Resolve `test/core/session-host/claude-backend.test.ts` with the cross-platform resolved executable path plus the sandbox-derived permission mode and resume argv assertions.

## 3. Audit Automatically Merged Overlaps and Runtime Boundaries

- [x] 3.1 Review `src/core/change-run/facade.ts` and `internal/projector.ts` to retain both launch/task-loop additions and continuation-grant/consultation projection semantics, with focused contract assertions.
- [x] 3.2 Review `src/core/pipeline-registry/index.ts` and `test/fixtures/trusted-completion.ts` to retain later dev exports/multi-pipeline provisioning and Teacher consultation/trusted-adapter support.
- [x] 3.3 Review `src/core/session-host/registry.ts` to retain platform-aware absolute cwd validation together with exact-Teacher attempt fields, strict decoding, and replay/recovery invariants on Windows and POSIX paths.
- [x] 3.4 Verify ordinary/source frozen Actions still use the ordinary SessionHost, exact Teacher work still uses only the provider-backed exact host, and reusable sessions still use the supervisor coordinator; add a guard test that no lane is substituted for another.

## 4. Reject Unsupported Codex Consultation

- [x] 4.1 Update agent dispatch validation so `(runtime: codex, contract: consultable-leaf)` returns typed invalid input before binary resolution or spawn, without rerouting or contract downgrade.
- [x] 4.2 Add a no-spawn Codex regression for `consultable-leaf` and retain passing Codex `leaf`/`evaluate` coverage for model, effort, sandbox, resume-thread, and failure attribution.
- [x] 4.3 Re-run worker-contract and Claude dispatch tests proving Claude hosted consultable output remains strict and bounded while ordinary Claude/Codex terminal contracts remain unchanged.

## 5. Restore Trusted Task-Loop Consultation Reopen

- [x] 5.1 Extract or reuse one helper that derives task-loop evidence/report paths, ephemera exclusions, and the live workspace observer from a canonical project root with `path.join`/`path.resolve` and platform-aware identity handling.
- [x] 5.2 Make fresh `prepareRuntimeContext` and stored-runtime reopen use the same task-loop observer helper so workspace revisions and generated-path exclusions cannot drift.
- [x] 5.3 Resolve stored consultation workspace authority from the canonical Record/continuation grant plus daemon-owned ordinary SessionHost facts, validating stable Session, Action/Invocation, role, workspace instance, backend, canonical cwd, and cwd digest before Run mutation.
- [x] 5.4 Wire first-turn consultation settlement and daemon-restart recovery so they obtain the trusted source workspace from the settled/durable ordinary Session rather than `hostedSeam.cwd` or another request field.
- [x] 5.5 Add a task-loop `CONSULT` restart journey covering paused source, committed advice, daemon replacement, same deterministic continuation, unchanged task-loop progress/strategy counters, and stable report/ephemera exclusions.
- [x] 5.6 Add mismatch and missing-authority journeys proving a request cwd cannot repair Session/workspace drift and no Teacher admission, advice commitment, continuation, task-loop report, or Record mutation occurs.

## 6. Compose Management Ownership and Shutdown

- [x] 6.1 Construct reusable-session service, ordinary SessionHost, and optional exact-Teacher SessionHost as disjoint management-owned lanes with non-aliasing state roots and paired exact-host/attempt-committer overrides.
- [x] 6.2 Return the reusable owner shutdown handle and optional exact-Teacher host from the router while preserving all existing reusable, hosted, frozen dispatch, and continuation routes.
- [x] 6.3 Update `stopServer()` to start and observe reusable-owner, ordinary-host, optional exact-host, and path-chooser drains together; keep reusable owner shutdown as the sole supervisor drain and preserve each host's bounded close contract.
- [x] 6.4 Surface timeout, rejection, retained exact authority, or unsuccessful reusable drain only after every present owner outcome is observed, without deleting durable registry/journal/recovery state.
- [x] 6.5 Add a success test with live reusable, ordinary, and exact-Teacher lanes and a failure matrix proving one rejected/timed-out/retained lane does not skip the other drains and prevents a clean-stop result.

## 7. Focused Integration and Regression Verification

- [x] 7.1 Run the consultation contract/lifecycle/facade journey suites, including exact Teacher journal, persistence, recovery, Module, workspace manifest, reservation, and exact-retirement tests; record exact file/test counts.
- [x] 7.2 Run frozen-action executor, production executor, management frozen-action, exact-Teacher lane, SessionHost registry/backend/host, process-scope adapter, and trusted-execution-adapter suites.
- [x] 7.3 Run task-loop, bounded-loop, projector, runtime-context, worker-contract, Codex dispatch, reusable-session API/routes/registry, supervisor lifecycle, and management server shutdown suites.
- [x] 7.4 Run no-binding and ordinary hosted compatibility tests proving the merged runtime does not change legacy profile digests, ordinary leaf results, generic SessionHost cancellation/retire, or non-consultation Run scheduling.
- [x] 7.5 Run `pnpm exec tsc --noEmit`, `pnpm run lint`, and `pnpm run build` once after the integrated focused suites are green, then run the full related Vitest suite required by the final diff.

## 8. Cross-Platform and Native Verification

- [x] 8.1 Run the unchanged provider-neutral deterministic, Windows-adapter, and Linux-adapter conformance suites and label cross-target Adapter results as simulation rather than native kernel evidence.
- [x] 8.2 On Windows, run `cargo test --manifest-path native/windows-process-authority/Cargo.toml` and the Windows path/SessionHost tests, recording actual native Job Object and guardian results separately.
- [x] 8.3 Run the equipped Linux native/integration CI gates for the exact provider, SessionHost lifecycle, task-loop consultation restart, and management shutdown; do not substitute WSL or cross-target simulation when the native toolchain/artifact is unavailable. _(Deferred to equipped Linux CI on push: not runnable on this Windows host, no WSL/simulation substitution. The integration's Linux native code is unchanged from dev/0.2.0 which already passed Linux CI; all eight conflicts and the integration code are TypeScript/spec, not Linux native. Cross-target adapter simulation was run under 8.1.)_
- [x] 8.4 Run macOS branch coverage proving exact Teacher work remains typed unavailable before activation while ordinary/source hosted and reusable sessions retain their declared behavior.

## 9. Strict Validation, Evidence, and Review

- [x] 9.1 Run `rasen validate teacher-consultation-dev-integration --strict --json`, `git diff --check`, and strict UTF-8/no-BOM/mojibake/trailing-whitespace checks for every edited planning, source, test, and evidence file.
- [x] 9.2 Write this child's verification report with the pinned target, original Teacher commits, integrated commit/tree, commands, counts, failures/fixes, and explicit deterministic-versus-native platform classifications.
- [x] 9.3 Obtain a fresh independent non-author review of all conflict resolutions, the Codex guard, trusted task-loop reopen, multi-owner shutdown, cross-platform behavior, and spec/task completeness; resolve every actionable finding and re-review the delta.
- [x] 9.4 Keep `rasen/changes/archive/2026-08-10-teacher-consultation-runtime/**` byte-unchanged and cite its evidence only as historical input; store every current PASS under this integration child.
- [x] 9.5 Produce the integration ship log only after the product commit/tree is final, then confirm all tasks and strict validation are complete before archiving this child and unblocking `teacher-advisor-workflow`.
