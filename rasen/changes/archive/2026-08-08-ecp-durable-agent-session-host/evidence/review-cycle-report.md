# Review cycle report: durable agent Session host

## Round identity and disposition

- Round: 1, non-author fixer pass after the independent review and CSO audit.
- Change: `ecp-durable-agent-session-host`.
- Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`.
- Base HEAD: `050fc84332b26a75a07f441efd6b235842f89e1e`.
- Fixer scope: the 20 product, test, design, and parent-planning files listed in
  the scope manifest below. The report itself is evidence-only and excluded
  from that product fingerprint.
- Confirmation: **Round 1 non-author re-review completed — CHANGES_REQUIRED**.
  Open Blocker/Major findings mean this round does not satisfy tasks 9.8 or
  9.9.
- No task checkbox, `.rasen` run state, commit, push, ship, archive, full-root
  test, or full-UI test was performed by the fixer.

## Finding-by-finding fix record

| ID | Canonical severity | Discriminating RED evidence | Fix and regression coverage | Fixer disposition |
| --- | --- | --- | --- | --- |
| V1 | Major | Two distinct simultaneous wakes produced a loser classified as `backend-spawn-failed` and left multiple unfinished requests; concurrent retire/cancel ended durably `idle` after a successful retirement receipt. | Added monotonic lifecycle `revision` CAS independent of process generation, exact expected-revision mutations, terminal-aware bounded retry for tail updates, and regressions for wake contention, retire/cancel, and same-generation stale writers in `contracts.ts`, `registry.ts`, `host.ts`, `host.test.ts`, and `registry.test.ts`. | Fixed locally; awaiting re-review. |
| V2 | Major | A transport whose stdin-acceptance promise rejected was still persisted and returned as a settled sent request. | Added the awaitable `BackendTurnStream.accepted` fence. The host now persists `sent` only after exact transport acceptance; rejection stays pre-acceptance/cancelled rather than ambiguous. Added held/rejected acceptance regressions in `backend.ts`, `claude-backend.ts`, `host.ts`, `claude-backend.test.ts`, and `host.test.ts`. | Fixed locally; awaiting re-review. |
| V3 | Major | Closing an idle resident transport left generation 1 selected; the next wake did not exact-resume and the unsent input became ambiguous. | Added one exact close observer per live transport, idempotent detach/release, idle process-fact clearing, active interruption classification, and exact generation+1 resume coverage in `host.ts` and `host.test.ts`. Updated affected fake transports so their `closed` promises represent actual termination rather than immediate close. | Fixed locally; awaiting re-review. |
| V4 | Major | Startup reconciliation converted a durable `retiring` record to executable `idle`. | Startup now completes `retired` only after exact owner absence/reap; surviving or uncertain ownership preserves terminal intent and rejects mutation. Added crash-after-retiring reconciliation coverage in `host.ts` and `host.test.ts`. | Fixed locally; awaiting re-review. |
| V5 | Major | During backend open, the durable record had no owner nonce; a crash after worker binding but before root-PID publication therefore had no recoverable authority path. | Persisted the nonce-bearing process authority before spawn, then bound the worker token and published the exact root PID. Recovery can validate and reap the nonce-bound worker when root publication was interrupted, but still fails closed on mismatches/absence. Added boundary tests in `host.test.ts`, `ownership.test.ts`, and the ownership/adapter implementation. | Fixed locally; awaiting non-author code and CSO re-review. |
| V6 | Major | With two gated slow transports, serial shutdown began termination for only one before the outer server guard could abandon cleanup. | Hosted transports now drain concurrently under their internal bounded cleanup contract; the shorter 8-second outer Session race was removed. Added a two-transport concurrency regression and retained the socket-close guard in `host.ts`, `server.ts`, and `host.test.ts`. | Fixed locally; awaiting re-review. |
| V7 | Major | Built CLI invocation with a missing prompt file returned generic `session-command-failed`; analogous cwd/backend/timeout input could reach daemon setup. | Prompt/cwd stat, realpath, and read failures now map to one `invalid-input` receipt before daemon contact. Backend and timeout validation also precede daemon contact. Added built CLI cases proving no daemon state for missing prompt/cwd, unsupported backend, and invalid timeout in `session.ts` and `session-host.test.ts`. | Fixed locally; awaiting re-review. |
| V8 | Major | The initialization-delay discriminator emitted `backend-protocol-failed` because diagnostics could not distinguish the single wall-clock timer from init, inactivity, and overall deadlines. | Added independent init, no-output, and overall limits/timers with event-specific reset rules and single cleanup. Regressions discriminate delayed init despite diagnostics, inactivity after init, and overall expiry despite periodic diagnostics in `contracts.ts`, `host.ts`, and `host.test.ts`. | Fixed locally; awaiting re-review. |
| V9 | Minor | With the prior production adapter suppression temporarily restored, a second same-id init did not reach the reducer and the regression failed because no error was thrown. | Production Claude transport now forwards the duplicate init so the neutral reducer rejects it; a production-adapter regression covers the path in `claude-backend.ts` and `claude-backend.test.ts`. | Fixed locally; awaiting re-review. |
| V10 | Minor | Parent context said pruned request IDs were not retained and that the already-recorded apply-stage root suite was still pending. | Corrected the parent planning facts: the fixed monotonic Bloom tombstone safely refuses false positives without false negatives for inserted IDs; the apply-stage root result was 452 files / 6,947 passed + 34 skipped, while a fresh post-review root/UI rerun remains task 9.10. | Documentation corrected; awaiting re-review. |
| V11 | Minor | Independent review found an unrelated machine-data/project-root config-editor hunk in child-1 scope. | Removed only that hunk and its dedicated assertion. The Session CLI follows the daemon API path and has no direct interactive config-editor call chain, so no approved coupling exists. `git diff -- src/commands/config.ts test/commands/config-editor.test.ts` is empty. | Scope drift removed; no separate behavior claimed by this Change. |

## Verification evidence

The final focused command intentionally covered the real Claude wrapper/process
path, Session host/registry/ownership/security, hosted Management API/recovery,
daemon convergence, and built CLI behavior:

```text
pnpm exec vitest run test/core/session-host test/core/management-api/hosted-sessions-api.test.ts test/core/management-api/hosted-session-recovery.test.ts test/core/management-api/server-shutdown.test.ts test/commands/daemon-half-started.test.ts test/commands/daemon-spawn-convergence.test.ts test/cli-e2e/session-host.test.ts --maxWorkers=1 --minWorkers=1
PASS: 14 files, 86/86 tests
```

Additional final gates:

| Gate | Result |
| --- | --- |
| `pnpm run build` | PASS |
| `pnpm run lint` | PASS |
| `pnpm exec tsc --noEmit` | PASS |
| `node bin/rasen.js validate ecp-durable-agent-session-host --strict` | PASS (`valid`) |
| Forbidden-authority scan over host, Session CLI, and hosted Management adapter | PASS; only `Object.assign` matched the broad `sign` substring |
| Test-owned OS temp scan for Session-host test prefixes | PASS; no residue found |
| `git diff --check` before this evidence write | PASS; only cumulative worktree LF/CRLF notices were printed |

The fixer did not run the full root or full UI suites. Those are deliberately
reserved for task 9.10 after the fresh independent review is clean.

## Scope fingerprint

- Product-scope file count: 20.
- Ordered scope-manifest hash: `137d6913eed5eac5a740d9239810ed0fb9a1e939`.
- Product-scope binary diff hash, excluding this report:
  `b9aee13004e745fb84536cd35443988d3f34d756`.
- Cumulative dirty-worktree binary diff hash before this report:
  `eba2af5c7b768b0ab0ef849fd0c79126d16f700c`.

Ordered product-scope manifest:

```text
src/core/session-host/contracts.ts
src/core/session-host/registry.ts
src/core/session-host/backend.ts
src/core/session-host/claude-backend.ts
src/core/session-host/host.ts
src/core/session-host/ownership.ts
src/core/claude/session-state.ts
src/core/management-api/server.ts
src/commands/session.ts
docs/session-host.md
rasen/changes/ecp-durable-agent-session-host/design.md
rasen/changes/ecp-session-execution-and-self-hosting/planning-context.md
test/core/session-host/host.test.ts
test/core/session-host/registry.test.ts
test/core/session-host/ownership.test.ts
test/core/session-host/claude-backend.test.ts
test/core/session-host/security.test.ts
test/core/management-api/hosted-session-recovery.test.ts
test/core/management-api/hosted-sessions-api.test.ts
test/cli-e2e/session-host.test.ts
```

## Remaining review and delivery tail

1. A fresh non-author reviewer must re-review V1-V11 against the scope
   fingerprint and decide tasks 9.8/9.9.
2. Only after that review is clean, task 9.10 must run the current full root and
   full UI suites and record fresh counts.
3. Tasks 10.2-10.6 remain the delivery tail, including review/local ship,
   archive, and remote Linux/macOS evidence. None is claimed here.

## Durable findings for the next reviewer and LEAD

1. Lifecycle admission needs a monotonic record revision distinct from backend
   generation; every terminal/control tail write must use exact lifecycle CAS.
2. `sent` means transport acceptance, not merely send initiation. A durable
   acceptance fence is part of the backend-neutral port contract.
3. Live transport closure is lifecycle input: observe it once, release once,
   persist the exact outcome, and exact-resume only from recoverable idle.
4. Process containment authority must exist durably before spawn; root-PID
   publication may refine authority but cannot create it after the fact.
5. Clean shutdown evidence must cover all hosted trees concurrently, and the
   outer daemon stop contract must not expire before bounded tree cleanup.

**FIXER VERDICT: FIXES_APPLIED - confirmation pending non-author re-review**

## Round 1 independent confirmation

- Reviewer identity: `/root/ecp7_host_verifier_1` (the original independent
  reviewer, preserving the Round 0 review/CSO/verification context).
- Re-review mode: dispatched, report-only, delta inspection plus fresh
  discriminating probes; no product/test/task/run-state edit or delivery action.
- HEAD: `050fc84332b26a75a07f441efd6b235842f89e1e`.
- HEAD tree: `58489c46633a209d2c1761c2a4b684ad8b95cb48`.
- Reviewed Round 1 product-scope binary diff fingerprint:
  `b9aee13004e745fb84536cd35443988d3f34d756` (20-file ordered scope declared
  above; report files excluded).
- Fresh focused result: 14 files, 86/86 tests passed.
- Fresh build, lint, TypeScript no-emit, strict Change validation, and scoped
  `git diff --check` passed. The built missing-prompt CLI probe exited non-zero
  with the required `invalid-input` JSON receipt.

### V1-V11 disposition

| ID | Round 1 independent disposition | Confirmation evidence |
| --- | --- | --- |
| V1 | **OPEN — Major (partially fixed).** Distinct wakes now have one winner and one `session-busy`; cancel/retire no longer overwrites retirement. However, a concurrent shutdown tail does not guard `retiring` and reproducibly persists `idle` plus `retirementReason`, after which retire returns `session-busy`. | Independent probes: `V1_WAKE` = one write / `ok,session-busy`; both cancel/retire invocation orders preserve the winner; `RETIRE_SHUTDOWN_RACE` reopens `retiring -> idle`. Exact gap: `src/core/session-host/host.ts:1123-1134`. |
| V2 | **OPEN — Major.** The production Claude adapter exposes a real acceptance fence, but the backend-neutral port makes `accepted` optional and the host treats omission as acceptance. A conforming adapter without the optional property is durably marked `sent` before any acceptance fact exists. | `src/core/session-host/backend.ts:25-28`; `host.ts:631-635`. Independent `V2_OPTIONAL` probe observed durable `sent` with no `accepted` property. |
| V3 | **OPEN — Minor (original idle-wake failure fixed).** Ordinary idle close now exact-resumes. A close observer that reads the active revision but loses CAS to valid terminal settlement is swallowed; it detaches the transport but leaves the durable PID. | Focused idle-close regression passed. Forced active-settlement/close ordering returned success with settled/idle state but stale `pid:7373`; `host.ts:436-465`. |
| V4 | **RESOLVED.** Startup completes provably owner-free `retiring` records as retired and preserves uncertain retirement intent; restart/wake remain rejected. | Focused retiring-reconciliation regression passed; static terminal guards confirmed. The separate shutdown overwrite is retained under V1. |
| V5 | **OPEN — Major; CSO native HIGH, OWASP A04, confidence 9/10.** Publishing a nonce before spawn closes the old bind-to-root-publication gap, but creates two adjacent gaps: crash before spawn leaves fake durable process authority that cannot be reclaimed, and crash after spawn but before `bindWorker` leaves a real untracked worker. | Exact child-process probe spawned an unbound detached worker; `reapStaleOwner({ownerToken})` returned `live-or-uncertain`, signalled no PID, and the worker remained alive until the verifier explicitly cleaned it. `host.ts:358-379`; `session-state.ts:273-279,673-675`. |
| V6 | **OPEN — Major (partially fixed).** Known live transports drain concurrently and the shorter outer race is gone. Shutdown snapshots only the current transport map, so an execute already blocked in `backend.open()` is missed; shutdown resolves, then the new live transport is published and executes without termination. | Independent `SHUTDOWN_OPEN_RACE` probe: shutdown returned while the record was prepared/starting; after open released the execute succeeded, `terminations:0`, final PID remained live. `host.ts:367-395,1105-1138`. |
| V7 | **RESOLVED.** Prompt/cwd/backend/timeout validation occurs before daemon contact and filesystem errors map to `invalid-input`. | Focused built CLI regression passed; independent missing-prompt command emitted `{"ok":false,"code":"invalid-input",...}`. |
| V8 | **OPEN — Major (partially fixed).** The three event clocks discriminate init/inactivity/overall after acceptance, but no clock covers the awaited acceptance fence. A never-settling `accepted` promise remains `prepared` beyond every configured deadline and is not terminated. | Focused three-clock regression passed. Independent 30 ms overall-limit probe was still unsettled/prepared with zero termination after 100 ms. `host.ts:176-245,631`. |
| V9 | **RESOLVED.** Production duplicate same-id init now reaches the reducer and is rejected. | Focused production-adapter duplicate-init regression passed; `claude-backend.ts:338-349`. |
| V10 | **RESOLVED.** Parent planning facts now describe the Bloom tombstone, prior 452-file / 6,947-pass + 34-skip apply gate, and fresh post-review task 9.10 separately. | `rasen/changes/ecp-session-execution-and-self-hosting/planning-context.md:370-383`. |
| V11 | **RESOLVED.** The unrelated config-editor hunk/assertion is absent. | `git diff -- src/commands/config.ts test/commands/config-editor.test.ts` is empty. |

### Round 1 aggregate

- Blocker: 0
- Major: 5 (V1, V2, V5, V6, V8)
- Minor: 1 (V3)
- Trivial: 0

The V5 CSO finding overlaps the code-review V5 and is counted once. Tasks 9.8
and 9.9 must remain unchecked; task 9.10 also remains pending. Route the five
Major findings and the one Minor finding to the next non-author fixer, preserve
the discriminating probe shapes above as regressions, and request a new
delta-only independent confirmation.

**ROUND 1 REVIEWER VERDICT: CHANGES_REQUIRED — Blocker:0 Major:5 Minor:1 Trivial:0**

## Round 2 fixer pass

- Fixer identity: `/root/ecp7_host_fixer_1` (not the Round 1 reviewer).
- Worktree: `OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle`.
- Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`.
- HEAD: `050fc84332b26a75a07f441efd6b235842f89e1e`.
- HEAD tree: `58489c46633a209d2c1761c2a4b684ad8b95cb48`.
- Mode: RED -> GREEN fixes for only the six Round 1 open findings. No
  task checkbox, run-state, delivery, archive, commit, or push mutation.

### Finding disposition and regression evidence

| ID | Severity | RED discriminator | Round 2 fix | Local disposition |
| --- | --- | --- | --- | --- |
| V1 | Major | With retirement and shutdown termination tails ordered so shutdown completed first, the durable state became `idle` instead of preserving `retiring`. | Shutdown and termination tails now treat both `retiring` and `retired` as monotonic terminal intent and refuse an `idle` overwrite. The exact two-terminator regression is `keeps retirement intent monotonic when the shutdown terminator finishes first`. | Fixed locally; fresh non-author confirmation pending. |
| V2 | Major | A backend omitting `accepted` could complete successfully and persist `sent`/settled state without any acceptance fact. | `BackendTurnStream.accepted` is mandatory in the backend-neutral contract and is runtime-validated before the host may persist `sent`. Missing or rejected acceptance is typed `backend-protocol-failed` and remains pre-acceptance. All in-scope fake adapters now expose the fence. | Fixed locally; fresh non-author confirmation pending. |
| V3 | Minor | A close observer that lost lifecycle CAS to a valid settlement detached the transport but left stale durable `pid: 7373`. | The observer retries exact lifecycle CAS while generation, owner, and root still match; it clears the exact process fact while preserving settled `idle` and terminal intent. Regression: `clears exact process facts when a close observer loses CAS to valid settlement`. | Fixed locally; fresh non-author confirmation pending. |
| V5 | Major / CSO HIGH | A dead pre-spawn nonce claim returned `live-or-uncertain`; separately, failing admission after a real child spawn still launched the real backend marker process. | Production launch now spawns an inert, trusted Node supervisor first. The host synchronously commits that exact supervisor root under its nonce before sending a private activation byte; only then may the backend process spawn as its descendant. Closing the gate before commit cannot launch the backend. Claims created through this supervised handshake carry an explicit `admission: supervised` marker, so an exact no-worker pre-spawn claim is safely reclaimable; legacy claims remain fail-closed. Regressions prove both dead-claim reclaim and that failed admission never activates the real backend. | Fixed locally; fresh non-author code and CSO confirmation pending. |
| V6 | Major | Shutdown returned while an execute was held in `backend.open()`; releasing the open later published a live transport, executed input, and recorded zero termination. | In-flight opens are registered before the first await with an abort signal. Shutdown closes admission, aborts opens, drains known transports concurrently, and awaits all opening paths. A transport returned after draining begins is terminated before publish or input. Regression: `closes admission and drains an execute held inside backend open before shutdown returns`. | Fixed locally; fresh non-author confirmation pending. |
| V8 | Major | A never-settling acceptance fence remained `prepared` beyond a 30 ms overall limit with zero termination. | Mandatory acceptance is raced against the original overall turn deadline. Expiry produces typed `backend-timeout`, cancels the request, and terminates once; the independent event-phase clocks retain their documented semantics after acceptance. Regression: `bounds the mandatory acceptance fence with the overall turn deadline`. | Fixed locally; fresh non-author confirmation pending. |

### Round 2 verification evidence

The post-build focused command covered the modified neutral host, production
Claude wrapper and real process tree, legacy runner compatibility, ownership,
security, hosted Management API/recovery, daemon convergence/shutdown, and the
built Session CLI:

```text
pnpm exec vitest run test/core/session-host test/core/agent-cli-process.test.ts test/core/claude/runner.test.ts test/core/management-api/hosted-sessions-api.test.ts test/core/management-api/hosted-session-recovery.test.ts test/core/management-api/server-shutdown.test.ts test/commands/daemon-half-started.test.ts test/commands/daemon-spawn-convergence.test.ts test/cli-e2e/session-host.test.ts --maxWorkers=1 --minWorkers=1
PASS: 16 files, 118/118 tests
```

| Gate | Result |
| --- | --- |
| `pnpm run build` | PASS |
| Focused post-build Vitest command above | PASS (16 files, 118/118 tests) |
| `pnpm run lint` | PASS |
| `pnpm exec tsc --noEmit` | PASS |
| `node bin/rasen.js validate ecp-durable-agent-session-host --strict` | PASS (`valid`) |
| `git diff --check` before this evidence write | PASS; only cumulative worktree LF/CRLF notices were emitted |

The interrupted pre-build test process produced no recoverable final result and
is deliberately not counted. The fixer did not run the full root or full UI
suites; task 9.10 remains reserved until a fresh independent review is clean.

### Round 2 scope fingerprint

- Scope file count: 15 (report excluded).
- Ordered manifest SHA-256:
  `f106ada5e804f1e099d15af12ff5c0242892536b150260a417ac52a62261ad70`.
- Exact delta-state SHA-256:
  `1c24cfcdb1d2b6e5506b72df7a878f1101abf12c991961cb1e6f6bbaa8cc9527`.
  This hashes, in manifest order, each path plus its HEAD Git blob ID (or
  `ABSENT`) and current Git blob ID.
- Current scoped-content SHA-256:
  `2aee77b564a317d973ccafed060f0681c3b67bdb0713b6bc293ad4d070e8b23f`.

Ordered Round 2 scope manifest:

```text
src/core/agent-cli-process.ts
src/core/claude/session-state.ts
src/core/session-host/backend.ts
src/core/session-host/claude-backend.ts
src/core/session-host/host.ts
src/core/session-host/ownership.ts
docs/session-host.md
rasen/changes/ecp-durable-agent-session-host/design.md
test/core/agent-cli-process.test.ts
test/core/session-host/host.test.ts
test/core/session-host/ownership.test.ts
test/core/session-host/claude-backend.test.ts
test/core/session-host/security.test.ts
test/core/management-api/hosted-session-recovery.test.ts
test/core/management-api/hosted-sessions-api.test.ts
```

### Durable Round 2 findings

1. A process claim is only safely reclaimable before worker publication when
   the launch protocol itself proves that no backend can start before the
   exact claimed root is committed. The explicit supervised-admission marker
   keeps this proof separate from legacy fail-closed claims.
2. Shutdown must close and drain both published transports and pre-publication
   opens. Registering an open before its first await is the relevant linearized
   admission boundary.
3. Transport acceptance belongs under the overall turn deadline even when
   initialization and inactivity clocks start later.
4. Close reconciliation must clean exact process facts without regressing a
   simultaneously settled or terminal lifecycle state.

Tasks 9.8, 9.9, and 9.10 remain unchecked. A new non-author reviewer must
inspect this exact Round 2 delta, rerun discriminators, and perform a fresh CSO
decision for V5 before the review tail may advance.

**ROUND 2 FIXER VERDICT: SIX FINDINGS FIXED LOCALLY — CONFIRMATION PENDING FRESH NON-AUTHOR REVIEW/CSO**

## Round 2 independent confirmation

- Reviewer: `/root/ecp7_host_verifier_1` (same independent reviewer as Round 1,
  not the Round 2 fixer).
- Mode: dispatched, report-only, exact delta inspection plus fresh focused
  gates and bounded built-product probes. No product/test/task/run-state,
  commit, archive, or delivery mutation.
- HEAD: `050fc84332b26a75a07f441efd6b235842f89e1e`.
- HEAD tree: `58489c46633a209d2c1761c2a4b684ad8b95cb48`.
- Exact reviewed delta-state SHA-256:
  `1c24cfcdb1d2b6e5506b72df7a878f1101abf12c991961cb1e6f6bbaa8cc9527`.

### Fresh gate evidence

| Gate | Result |
| --- | --- |
| `pnpm run build` | PASS |
| Round 2 exact focused Vitest command | PASS (16 files, 118/118 tests) |
| `pnpm run lint` | PASS |
| `pnpm exec tsc --noEmit` | PASS |
| `node bin/rasen.js validate ecp-durable-agent-session-host --strict` | PASS (`valid`) |

The focused command was:

```text
pnpm exec vitest run test/core/session-host test/core/agent-cli-process.test.ts test/core/claude/runner.test.ts test/core/management-api/hosted-sessions-api.test.ts test/core/management-api/hosted-session-recovery.test.ts test/core/management-api/server-shutdown.test.ts test/commands/daemon-half-started.test.ts test/commands/daemon-spawn-convergence.test.ts test/cli-e2e/session-host.test.ts --maxWorkers=1 --minWorkers=1
```

### V1/V2/V3/V5/V6/V8 disposition

| ID | Round 2 independent disposition | Evidence |
| --- | --- | --- |
| V1 | **RESOLVED.** | Adverse shutdown/retirement tail ordering stayed `retiring` and finished `retired`; no terminal-intent overwrite. |
| V2 | **RESOLVED.** | A stream omitting `accepted` returned `backend-protocol-failed`, stayed pre-acceptance/cancelled, and terminated once. |
| V3 | **RESOLVED.** | Forced close-observer CAS loss preserved settled/idle state and cleared the exact PID. |
| V5 | **OPEN - Major; CSO HIGH, confidence 9/10.** The supervised activation handshake closes the original pre-spawn/pre-bind gaps, and no prompt/secret/activation injection was found. However, stale exact tokens have no OS process-start identity, so a reused matching PID is signalled. On the real Windows host, killing an admitted supervisor whose backend launched a detached grandchild left that descendant alive before and after `killProcessTree(supervisorPid)`. | Safe-spy PID-reuse probe: `result=live-or-uncertain`, `signalled=[current unrelated PID]`; legacy no-worker stayed fail-closed and supervised no-worker was reaped without signal. Real process probe: root/backend false, detached grandchild true before and after cleanup; verifier then killed the exact grandchild PID and removed the temp root. `session-state.ts:114-122,661-699`; `agent-cli-process.ts:140-229`. |
| V6 | **OPEN - Major.** In-flight opens are now awaited, but a late transport whose termination returns `closed:false` or throws is discarded anyway; the exact claim and registry authority are released while the process remains live. | Both independent variants returned `session-busy`, made one termination attempt, released once, left the injected process alive, and exposed no retained PID/process authority. `host.ts:420-480`. |
| V8 | **RESOLVED.** | A never-resolving fence returned `backend-timeout`, failed pre-acceptance, and terminated once. Resolving it later left state and termination count unchanged. The separately bounded event-phase timers remain consistent with the authored independent-clock design. |

### Round 2 aggregate

- Blocker: 0
- Major: 2 (V5, V6)
- Minor: 0
- Trivial: 0

V5 and V6 overlap the two fresh CSO containment findings and are counted once
in this aggregate. Tasks 9.8 and 9.9 remain unchecked; task 9.10 remains
pending. Route only V5 and V6 to a fresh non-author fixer, add the exact reused-
PID, detached-descendant, and unobserved-late-close regressions, and request a
new delta-only independent review plus CSO confirmation.

**ROUND 2 REVIEWER VERDICT: CHANGES_REQUIRED - Blocker:0 Major:2 Minor:0 Trivial:0**

## Round 3 fixer pass

- Fixer identity: `/root/ecp7_host_fixer_2` (not the Round 2 reviewer).
- Worktree: `OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle`.
- Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`.
- HEAD: `050fc84332b26a75a07f441efd6b235842f89e1e`.
- HEAD tree: `58489c46633a209d2c1761c2a4b684ad8b95cb48`.
- Mode: RED -> GREEN fixes for Round 2 V5 and V6 only. No task checkbox,
  run-state, `.rasen/**/ephemera`, commit, push, ship, archive, child-2,
  full-root-suite, or full-UI-suite mutation.

### Preserved RED evidence

Before product implementation, the new V5/V6 discriminators were run with:

```text
pnpm exec vitest run test/core/session-host/ownership.test.ts test/core/session-host/host.test.ts test/core/session-host/claude-backend.test.ts --maxWorkers=1 --minWorkers=1
RED: 3 files, 55 tests; 48 passed, 7 failed
```

The seven failures were two real detached-descendant/process-tree failures,
two exact-process-instance/PID-reuse ownership failures, and three late-open
`closed:false`/throw/retry authority failures. Those failures demonstrate that
the pre-fix product did not already satisfy V5/V6.

### V5 disposition: exact process identity and containment

| Boundary | Round 3 fix and evidence | Local disposition |
| --- | --- | --- |
| Bridge and worker authority | Claim token v3 binds the bridge PID to `bridgeProcessInstanceId`; worker token v2 binds `rootPid` to `processInstanceId`. The durable registry requires the instance ID whenever a root PID is present. Legacy token versions remain fail-closed. | Fixed locally; fresh non-author confirmation pending. |
| OS identity | Windows captures `Win32_Process.CreationDate.Ticks` through CIM; Linux captures `/proc/<pid>/stat` start ticks plus boot ID; the remaining POSIX path hashes `ps -o lstart=`. An injected `ProcessInstanceProbe` and platform seam makes `same`, `different`, `absent`, and `uncertain` deterministic in tests. | Fixed locally; remote OS matrix remains ECP-8 scope. |
| PID reuse | Every live signal path first inspects the exact worker instance. `different` reclaims stale authority without signalling the unrelated reused PID; `uncertain` remains fail-closed. The reuse regression runs injected `win32` and `linux` branches and asserts zero signals. | Fixed locally; fresh CSO confirmation pending. |
| Windows detached descendants | Production Windows launch creates a Job Object controller before activation, enables `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, assigns the admitted supervisor, waits for readiness, and only then activates the backend. A real Windows test kills only the supervisor and observes the detached/unref descendant die. | Fixed locally; fresh CSO confirmation pending. |
| POSIX descendants | POSIX retains process-group containment and exact process-instance checks. Deterministic injected POSIX identity/reuse coverage ran on this Windows host; actual Linux/macOS CI is still ECP-8 delivery evidence. | Fixed locally within child scope. |

The Job controller receives only constant source and numeric process facts via a
UTF-16LE encoded PowerShell command; prompt/user data remains on stdin and is
never interpolated into the containment command.

### V6 disposition: retained authority for unobserved close

| Failure mode | Round 3 behavior | Local disposition |
| --- | --- | --- |
| Late-open `terminate()` returns `closed:false` | Exact root/instance/owner facts are durably published before close. The live transport, claim, and registry authority remain retained; shutdown rejects rather than resolving cleanly. | Fixed locally; fresh non-author confirmation pending. |
| Late-open `terminate()` throws | The same authority is retained and the failure remains retryable. Server stop resets its stop promise; daemon shutdown does not remove daemon state or exit cleanly while authority remains. | Fixed locally; fresh non-author confirmation pending. |
| Late close | The close observer clears only matching generation/root/instance authority and releases once. | Fixed locally; fresh non-author confirmation pending. |
| Explicit retry/reconcile | A later shutdown retry single-flights termination and completes after exact close. Startup reconciliation retains fail-closed uncertainty and only reaps a provably stale exact instance. | Fixed locally; fresh non-author confirmation pending. |
| Cancel/execute/shutdown concurrency | Live termination has one shared promise. Concurrent control paths do not double-signal, double-release, or double-settle; ambiguous sent work remains `turn-outcome-unknown`. | Fixed locally; fresh non-author confirmation pending. |

### Final focused verification

```text
pnpm exec vitest run test/core/session-host test/core/agent-cli-process.test.ts test/core/claude/runner.test.ts test/core/management-api/hosted-sessions-api.test.ts test/core/management-api/hosted-session-recovery.test.ts test/core/management-api/server-shutdown.test.ts test/commands/daemon-half-started.test.ts test/commands/daemon-spawn-convergence.test.ts test/cli-e2e/session-host.test.ts --maxWorkers=1 --minWorkers=1
PASS: 16 files, 125/125 tests (228.55s)
```

This exact command includes the Round 2 16-file matrix plus seven new V5/V6
regressions. It covers the production Windows process path, injected POSIX
branches, registry/ownership, host lifecycle, Management API/server shutdown,
daemon convergence, and built CLI journeys.

| Gate | Result |
| --- | --- |
| `pnpm run build` | PASS |
| Focused Vitest command above | PASS (16 files, 125/125 tests) |
| `pnpm run lint` | PASS |
| `pnpm exec tsc --noEmit` | PASS |
| `node bin/rasen.js validate ecp-durable-agent-session-host --strict` | PASS (`valid`) |
| `git diff --check` before this evidence write | PASS; cumulative shared-worktree LF/CRLF notices only |
| Test-owned process/temp audit | PASS; no matching temp directory, replay/session-host Node process, or debug admission marker remained |

The first static-gate attempt incorrectly ran build and strict validation in
parallel, so validation momentarily read a rebuilding `dist` and failed with a
missing module. Build and validation were then rerun in dependency order and
both passed; the transient orchestration race is not counted as a product gate.

Three earlier full focused runs each ended 124/125 because old test-only timing
margins were below observed busy-Windows costs: a 150 ms outer acceptance
watchdog, a 2 s CIM claim-publication poll, and a default 30 s CLI test timeout.
The product acceptance deadline, runner timeout behavior, CLI call timeouts,
and all semantic assertions remain unchanged. Only test harness margins were
widened; targeted reruns passed before the final single-run 125/125 result.

The fixer did not run the full root or full UI suites. Tasks 9.8, 9.9, and 9.10
remain unchecked and reserved for the fresh independent review and subsequent
parent lifecycle decision.

### Round 3 scope fingerprint

Because the ECP worktree is cumulative and uncommitted and no Round 3 baseline
blob snapshot existed, the delta-state fingerprint below is explicitly the
HEAD-to-current state for the ordered Round 3 scope. It is not represented as a
Round-3-only binary diff.

- Scope file count: 20 (this report and `handoff/fixer-2.md` excluded).
- Ordered manifest SHA-256:
  `df1d7bf6ac444a334969dac7e68c4e4ab3df0f8bf448fb00a4801512164ceaca`.
- HEAD-to-current scoped delta-state SHA-256:
  `8742602b1918e17c73d49ccf74833a14901bce5c08ad5dc218498fca9e498202`.
- Current scoped-content SHA-256:
  `335cc0b265014bd96ce6efc6e3d0c558aabc418b5a4bfa77b2dc27842a55fe89`.

Ordered Round 3 scope manifest:

```text
src/core/agent-cli-process.ts
src/core/claude/session-state.ts
src/core/session-host/backend.ts
src/core/session-host/contracts.ts
src/core/session-host/host.ts
src/core/session-host/ownership.ts
src/core/session-host/registry.ts
src/core/management-api/server.ts
src/commands/daemon.ts
docs/session-host.md
rasen/changes/ecp-durable-agent-session-host/design.md
rasen/changes/ecp-durable-agent-session-host/evidence/security-boundary.md
rasen/changes/ecp-durable-agent-session-host/evidence/scenario-test-map.md
test/fixtures/session-host/replay-claude.mjs
test/core/session-host/ownership.test.ts
test/core/session-host/claude-backend.test.ts
test/core/session-host/host.test.ts
test/core/management-api/server-shutdown.test.ts
test/core/claude/runner.test.ts
test/cli-e2e/session-host.test.ts
```

### Durable Round 3 findings

1. A PID is never sufficient process authority. Bridge and worker claims need
   an OS process-start identity, and every later signal must re-inspect it.
2. Windows descendant containment needs a kernel Job Object established before
   backend activation; post-hoc PID-tree enumeration cannot cover detached
   descendants or PID reuse safely.
3. A failed or unobserved termination is retained authority, not cleanup.
   Registry facts, writer claim, and in-memory transport must survive until
   exact close, safe retry, or fail-closed reconciliation.
4. Shutdown cleanliness composes upward: the Session host, Management server,
   and daemon must all refuse a clean stop while live authority is retained.
5. Termination must be single-flight across execute/cancel/shutdown so one
   process identity receives at most one concurrent signal and one settlement.

Tasks 9.8, 9.9, and 9.10 remain unchecked. A fresh non-author reviewer and CSO
must inspect this exact scope, rerun the V5/V6 discriminators, and append an
independent disposition. This fixer does not claim CLEAN.

**ROUND 3 FIXER VERDICT: FIXES_APPLIED - PENDING NON-AUTHOR RE-REVIEW/CSO**

## Round 3 independent confirmation

### Review identity and immutable scope

- Reviewer: fresh non-author reviewer + CSO, report-only.
- Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`.
- HEAD: `050fc84332b26a75a07f441efd6b235842f89e1e`.
- HEAD tree: `58489c46633a209d2c1761c2a4b684ad8b95cb48`.
- Exact 20-file manifest SHA-256:
  `df1d7bf6ac444a334969dac7e68c4e4ab3df0f8bf448fb00a4801512164ceaca`.
- Fixer-recorded HEAD-to-current delta-state SHA-256:
  `8742602b1918e17c73d49ccf74833a14901bce5c08ad5dc218498fca9e498202`.
- Fixer-recorded scoped content SHA-256:
  `335cc0b265014bd96ce6efc6e3d0c558aabc418b5a4bfa77b2dc27842a55fe89`.
- No product, test, task, or run-state file changed during this review.

The exact manifest remains:

```text
src/core/agent-cli-process.ts
src/core/claude/session-state.ts
src/core/session-host/backend.ts
src/core/session-host/contracts.ts
src/core/session-host/host.ts
src/core/session-host/ownership.ts
src/core/session-host/registry.ts
src/core/management-api/server.ts
src/commands/daemon.ts
docs/session-host.md
rasen/changes/ecp-durable-agent-session-host/design.md
rasen/changes/ecp-durable-agent-session-host/evidence/security-boundary.md
rasen/changes/ecp-durable-agent-session-host/evidence/scenario-test-map.md
test/fixtures/session-host/replay-claude.mjs
test/core/session-host/ownership.test.ts
test/core/session-host/claude-backend.test.ts
test/core/session-host/host.test.ts
test/core/management-api/server-shutdown.test.ts
test/core/claude/runner.test.ts
test/cli-e2e/session-host.test.ts
```

### Independent gates

| Gate | Result |
|---|---|
| `pnpm run build` | PASS (22.3 s) |
| Exact focused 16-file Vitest suite | PASS, 16 files, 125/125 (204.83 s) |
| `pnpm run lint` | PASS |
| `pnpm exec tsc --noEmit` | PASS |
| `node bin/rasen.js validate ecp-durable-agent-session-host --strict` | PASS |
| `git diff --check` | PASS; cumulative line-ending notices only |
| Authority/injection negative scan | PASS |
| Post-probe process/temp audit | PASS; no reviewer residue |

### Delta review and timeout discipline

The reviewer inspected every scoped source/test/document file, the previous
round histories, all handoffs, the spec/design/tasks, and the authored
scenario map. The implementation adds exact bridge/worker tokens, admission
before activation, Windows Job containment, retained authority for unobserved
close, retryable server/daemon stop, and targeted regressions. No product
deadline or acceptance/event timeout was relaxed. Larger values are confined
to outer test timeout or bounded test polling.

The controller is a constant encoded PowerShell program. Its numeric root PID
is passed through a private overwritten environment variable, backend spawn is
`shell:false`, and no prompt/secret interpolation or mutable trusted-state,
completion, signing, EvidenceStore, Run/Action, or Record authority was found.

### Independent V5 discriminator: still open

Two real Windows probes used the built production adapter and
`descendant-process-survival` fixture. The stronger run identified root PID
12028, its direct production PowerShell controller PID 24972, and detached
descendant PID 23232 through CIM. After killing the exact controller, the
controller was confirmed dead while root and descendant were both alive at
0 ms, 250 ms, 1 s, 3 s, and 6 s. A separate run reproduced the result with
root 45120, controller 15476, and descendant 12376. Exact cleanup then killed
only those probe PIDs and removed only their temporary roots; a final audit
found no residue.

This is a **Major** containment escape at
`src/core/agent-cli-process.ts:223-310`. Killing the supervisor is covered by
the new suite; killing the controller itself is not. The required invariant is
that controller death cannot release a live admitted tree. Add that exact
real-process regression and repair the Job handle lifetime before re-review.

The remaining-POSIX identity at
`src/core/claude/session-state.ts:751-783` is also **Major**: it hashes only
second-resolution `ps -o lstart=` text, so distinct same-second processes can
share an identity and a reused PID can be misclassified as `same`. The new
reuse regression at `test/core/session-host/ownership.test.ts:102-157` covers
only Windows and Linux. Use a truly exact OS process-birth identity or fail
closed, then exercise the real remaining-POSIX branch.

### Independent V6 discriminator: resolved

Static inspection plus the focused regressions confirm that late-open
`closed:false` and throw retain the transport, writer claim, registry PID, and
exact process instance. Shutdown fails safely, a later retry is single-flight,
and positive close releases once. Management-server stop resets its promise on
failure, and the daemon does not delete its state or exit until stop succeeds.

### Round 3 disposition

- V5-A controller-death containment: **OPEN - Major**.
- V5-B remaining-POSIX exact identity: **OPEN - Major**.
- V6 retained authority and retryable shutdown: **RESOLVED**.
- New Blocker/Minor/Trivial findings: none.
- Aggregate: Blocker 0, Major 2, Minor 0, Trivial 0.

Tasks 9.8 and 9.9 remain unchecked. Task 9.10 remains pending. Do not run the
full root/UI post-review gate, ship, archive, or advance child2 until a fresh
fixer resolves both V5 findings and another non-author review is CLEAN.

**ROUND 3 INDEPENDENT VERDICT: CHANGES_REQUIRED - Blocker:0 Major:2 Minor:0 Trivial:0**

## Strategy attempt 1 design decision

This entry records a design-only response to the two open Round 3 Major
findings. It does not replace the independent verdict above, claim either
finding is fixed, or advance implementation, task, run-state, delivery, or
archive status. The complete decision record is
[`strategy-attempt-1.md`](strategy-attempt-1.md).

Three designs were compared before selecting the implementation direction:

- **A — external seam:** expose only an opaque `ProcessScope`/`ProcessRef`
  capability to `SessionHost`; PID, process-group, Job, and native-handle
  signaling stay below the seam.
- **B — internal adapter:** add a versioned, hashed, capability-probed native
  `ProcessCapsule` helper behind deterministic platform adapters; runtime
  download and semantic fallback are forbidden.
- **C — topology:** make a daemon-owned, per-generation native controller the
  unique containment owner outside the contained tree, with an inert
  supervisor inside it and publish-before-activate admission.

The selected hybrid uses A as the durable domain boundary, B as the trusted
platform mechanism, and C as the lifecycle topology. On Windows, the native
controller uniquely owns a non-inheritable Job handle, creates the root
suspended, assigns it before activation, and relies on
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` for controller-death cleanup. On Linux,
identity uses pidfd plus boot/start ticks and containment uses a process group.
On macOS, identity uses a native process unique identifier when available, or
microsecond process birth data; unsupported or ambiguous capability fails
closed. `ps -o lstart` is deleted as authority.

The design also fixes the ownership/death contract: daemon, controller, and
supervisor deaths each have an explicit outcome; only the external controller
owns the containment handle; process identity and containment handles cannot
be reconstructed from serialized PID metadata; and the registry publishes an
opaque scope only after admission succeeds and before activation.

Pending work is deliberately unchanged. R3-V5-A (Windows controller-death
containment) and R3-V5-B (remaining-POSIX exact identity) remain **OPEN —
Major**; V6 remains resolved. Implementation must add the proposed RED tests,
native helper/adapters, fail-closed migration, and real-OS death/identity
oracles described in the strategy artifact, followed by a fresh independent
review. The security-boundary and scenario-test map continue to describe the
currently implemented and reviewed state and are not rewritten to imply that
this unimplemented design has landed.

## Strategy attempt 1 implementation handback

The author implementation described by `strategy-attempt-1.md` landed in the
isolated worktree on 2026-08-04. This entry does not amend the historical Round
3 independent verdict and does not mark R3-V5-A or R3-V5-B resolved. It hands a
materially changed implementation back to fresh non-author reviewers.

The previous PowerShell controller/PID admission path has been replaced by an
opaque `ProcessScope` and a versioned, source-built native `ProcessCapsule`.
Windows now assigns the suspended inner supervisor to an unnamed
kill-on-close Job at process creation while the external controller uniquely
owns the non-inherited Job handle. Linux uses pidfd plus boot/start identity;
macOS uses native kernel birth identity and has no durable-host `ps lstart`
fallback. Registry v2 persists only an opaque runtime ref and fails closed for
live/uncertain v1 PID facts.

Author discriminators are green:

- the real Windows native test kills only the controller and observes both
  backend root and detached descendant gone;
- deliberately duplicating the Job handle makes the controller-death oracle
  fail, while the production build passes;
- deliberately activating before publication makes the inertness oracle fail,
  while the production build remains inert;
- exact ProcessScope/package/migration/native tests pass 17/17;
- the complete focused host/Management/daemon/CLI set passes 136/136;
- TypeScript, root ESLint, strict Change validation, build, and npm pack
  dry-run pass.

Windows is the only runtime platform observed by this author. Linux and macOS
target compilation passed, but actual runtime matrix evidence remains ECP-8.
Tasks 9.8, 9.9, and 9.10 remain unchecked. A fresh reviewer must independently
inspect the native handle/identity logic, rerun the relevant discriminators,
and issue the next verdict before any ship/archive action.

**STRATEGY IMPLEMENTATION HANDOFF: READY FOR FRESH REVIEW; HISTORICAL ROUND 3 MAJORS NOT AUTHOR-CLOSED**

## Strategy attempt 1 — independent cycle result (2026-08-04)

Attempt 1 partially succeeded: it materially closes historical R3-V5-A on the
actual Windows host and removes the Linux `ps lstart` identity source. It does
not close historical R3-V5-B because the macOS native identity ABI is wrong,
and it leaves three additional Major lifecycle gaps: backend-root exit is
conflated with whole-scope close, POSIX replacement termination cannot reap the
surviving exact group after controller loss, and post-PREPARED activate/abort
waits are unbounded. Repeated helper builds are also not byte reproducible
(Minor).

The next bounded attempt must preserve the successful opaque ProcessScope /
Windows Job-at-create work while adding all of the following discriminators
before implementation claims closure:

1. backend root exits after creating a detached descendant; the scope remains
   live and durable authority is retained until scope-empty or exact terminate;
2. actual Linux and macOS daemon/controller death followed by replacement
   cleanup of a resistant descendant group, with same-PID/different-birth zero-
   signal mutations;
3. macOS `proc_uniqidentifierinfo` ABI-size and real unique-birth capability
   tests using the full 56-byte system declaration;
4. hung-controller mutations for PREPARED -> ACTIVATE and prepared abort,
   proving bounded typed uncertainty without authority release;
5. two source-identical clean helper builds with either equal bytes or an
   explicitly narrowed, truthful provenance contract.

After the fixes, rerun the 17-test native/package subset, the 140-test focused
suite, static/Rust/strict-validation/package gates, and a fresh non-author
security + code/spec re-review. Full root/UI remains the final task 9.10 gate.

**STRATEGY ATTEMPT 1: EXHAUSTED (PARTIAL) — CHANGES_REQUIRED; Blocker:0 Major:4 Minor:1 Trivial:0**
