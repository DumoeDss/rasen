Scope legend: `[WSL-EXTERNAL]` marks real-Linux evidence that MUST run in an external run tree on ext4 with its own isolated node_modules - never the repo checkout (vitest here can wipe dist/, and Windows-installed node_modules fail under WSL). `[THIS-HOST]` marks real-Windows evidence taken on this machine. Every guard added by this change needs a demonstrated failing counterpart (mutation receipt); an unmutated green guard is not acceptance evidence in this repo.

## 1. Baseline and context

- [ ] 1.1 Record the implementation-start HEAD and verbatim copies of BOTH byte-pin lists (`linux-process-authority-boundary-guards.test.ts` LEGACY_PROCESS_CAPSULE_INPUTS, seven files; `windows-process-authority-package-ci.test.ts` LEGACY_PROCESS_CAPSULE_INPUTS, five files) in `evidence/implementation-baseline.md`, with each pinned file's digest computed from the COMMIT (`git show HEAD:<file>` piped to sha256) - never from the shared dirty worktree.
- [ ] 1.2 Re-verify the seam facts design.md rests on with file:line anchors against the current tree: the three `createHostedProcessScope()` construction sites (router.ts:639, host.ts:306, claude-backend.ts:423), the single selection point in `hosted-process-scope.ts`, the declaration persistence and activation gate in host.ts, BOTH `closeDurableProcess` release paths (observation and receipt), and the three prepared-abort gates. Report any drift to the LEAD before writing code.
- [ ] 1.3 Confirm and record that `host.ts`, `claude-backend.ts`, `router.ts`, and the session-host registry record shape need no edits for this change (the machinery is tier-agnostic on declaration presence). If any edit turns out to be required, stop and flag it to the LEAD before making it.

## 2. POSIX generalisation

- [ ] 2.1 Move the darwin best-effort implementation to `src/core/session-host/process-capsule/posix-best-effort-scope.ts` with platform-neutral export names (`createPosixBestEffortProcessScope`, `POSIX_BEST_EFFORT_DECLARATION`) and platform-neutral error strings; behaviour byte-for-byte equivalent (same protocol, same bounds, same receipt shapes). Delete `darwin-best-effort-scope.ts`; no compatibility shim.
- [ ] 2.2 Keep the declaration constant frozen with `exactCancel: false` and `scopeEmptyProof: false` as literal `false`, and the POSIX semantics list unchanged; no code path can widen either flag.
- [ ] 2.3 Update the module's importers: `hosted-process-scope.ts` plus the three darwin test files. Repoint the two source-scan guards (no `closed`/`scope-empty`/proven-emptiness emission; no reattach/revalidation) at `posix-best-effort-scope.ts` so they keep reading the real implementation, not a shim.
- [ ] 2.4 Enable the cutover in `hosted-process-scope.ts`: `darwin` and `linux` select the POSIX best-effort scope; `win32` selects the win32 best-effort scope (Section 3); every other platform keeps the legacy path unchanged. Preserve the options pass-through so existing test seams (`platform`, `resolve`, `spawn`, ...) keep working.
- [ ] 2.5 Update the platform-selection guard suite: linux now yields the POSIX declaration pre-start, win32 yields the win32 declaration pre-start, darwin is unchanged, and the exact-tier sentinel assertion moves to a non-cutover platform (e.g. `freebsd`).

## 3. win32 honest re-declaration

- [ ] 3.1 Implement `src/core/session-host/process-capsule/win32-best-effort-scope.ts` as a thin scope delegating `prepare/activate/inspect/terminate` to an unmodified `createNativeProcessScope()`, passing `NativeProcessScopeOptions` through, holding a per-ref state map for scopes it prepared (daemon-lifetime posture), and attaching `WIN32_BEST_EFFORT_DECLARATION` to every prepared scope before activation.
- [ ] 3.2 Translate protocol outcomes per design D3: acknowledged `SCOPE_EMPTY` on terminate/abort becomes a `declared-unproven` receipt (outcome `cancelled`, `forced: true`, `groupObservedEmpty: true` as Job-accounting diagnostic); natural close without a cancel in flight becomes a `declared-unproven` terminal (outcome `completed`); the live scope's `closed` promise resolves the honest terminal, never `ScopeEmptyReceipt`, at the hosted seam.
- [ ] 3.3 Map transport/controller loss, protocol violations, and control timeouts to `uncertain` with the typed failure - authority retained. A `declared-unproven` terminal is mintable ONLY from an actual capsule protocol outcome; no error path constructs one.
- [ ] 3.4 Translate foreign/stale refs per design D4: delegate to the one-shot probe; `live` stays controllable; `foreign`/`uncertain` pass through; probe `closed` becomes a `declared-unproven` observation/receipt with a diagnostic naming the one-shot observation, so stale-record reconciliation releases honestly instead of wedging.
- [ ] 3.5 Add `WIN32_BEST_EFFORT_SCOPE_SEMANTICS` to `process-scope.ts` (own-job-object, job-kill-cancel, kill-on-job-close-teardown, exact-root-exit, bounded-controls, honest-unproven-terminal) and widen `BestEffortScopeDeclaration.semantics` additively. Do not touch `BEST_EFFORT_SCOPE_SEMANTICS` members, `RECURSIVE_PROCESS_SCOPE_SEMANTICS`, or any persisted record key.
- [ ] 3.6 Verify pre-start visibility end-to-end on the existing plumbing: the win32 declaration lands in the hosted-session record at prepare time (`tier`/`exactCancel`/`scopeEmptyProof`), activation fails typed when it cannot be recorded, and the API projection shows it before start - all without editing host/registry/router code (task 1.3 gate).

## 4. Deterministic guards and mutation receipts (any OS; non-acceptance)

- [ ] 4.1 win32 never-clean guard: with an injected/deterministic capsule seam, no wrapper code path yields `closed`, `'scope-empty'`, or any proven-emptiness claim at the hosted seam - including the Job-observed-empty case; add a source-scan guard on `win32-best-effort-scope.ts` mirroring the POSIX one.
- [ ] 4.2 Transport-loss guard (SEC-001 shape): inject controller close before `SCOPE_EMPTY` and a control timeout; the wrapper returns `uncertain`, `receiptAuthorizesRelease` refuses it, and `closeDurableProcess` retains the session on BOTH paths (observation and receipt).
- [ ] 4.3 Declaration-gated release guards for linux and win32 declared scopes, exercising BOTH `closeDurableProcess` paths: the observation path (inspect returns the declared-unproven observation) and the receipt path (terminate returns the receipt) each release a declared scope and each refuse an undeclared scope. A guard that only exercises one path is not done.
- [ ] 4.4 Regression: the existing deterministic-scope suite, the darwin behavioural suites (now exercising the POSIX module), and the pinned capsule test files (`process-capsule-package.test.ts`, `process-capsule-posix-replacement.test.ts`) pass unchanged.
- [ ] 4.5 Mutation receipts in `evidence/mutation-receipts.md`, each showing its guard RED against the defect it names: (a) wrapper forges a clean-cancel (`closed`) receipt; (b) wrapper promotes transport loss to a declared-unproven terminal; (c) selection regression routing linux back to the legacy capsule; (d) release granted without the pre-start declaration on one path while the other stays green (proves per-path discrimination); (e) POSIX module emits a proven-emptiness claim.

## 5. Legacy freeze integrity

- [ ] 5.1 After all code changes are committed: recompute every digest in BOTH pin lists from the COMMIT (`git show <commit>:<file>` piped to sha256) and record an integrity receipt in `evidence/legacy-freeze-integrity.md` showing each pinned file byte-identical to the baseline (old hash = new hash, per file). Expected outcome: no rebaseline anywhere.
- [ ] 5.2 Contingency (expected unused): if any pinned file must change, STOP before editing it and escalate to the LEAD as an explicit rebaseline decision; a rebaseline, if granted, is its own ticked task with old hash, new hash, and reason - never a silent side effect. Do not touch `native/linux-process-authority/**` or `native/windows-process-authority/**` under any outcome.

## 6. Real Linux receipts [WSL-EXTERNAL]

- [ ] 6.1 Prepare the external run tree: fresh clone/export of the branch on ext4 inside WSL with its own `npm install` (never the repo checkout, never Windows-installed node_modules); record tree path, distro, kernel, and Node version in the evidence.
- [ ] 6.2 Production-path cancel receipt: start a real hosted session on Linux through the production entry path (`createSessionHost` via the management router - not a fixture, not a `...ForTesting` twin), cancel it, and capture the Record showing the pre-start POSIX declaration and the `cancelled / emptiness-unproven` terminal.
- [ ] 6.3 Escape-honesty receipt on a real Linux kernel: a descendant leaves the group via `setsid()` and survives a completed cancel while the group observes empty; the Record shows `cancelled / emptiness-unproven` and never claimed proven-empty - the declared limitation, not a defect.
- [ ] 6.4 Natural-completion receipt: exact root exit code and, separately, exact terminating signal captured; the completion terminal carries the same unproven-emptiness honesty. Label every Section 6 evidence file with its provenance and run-tree isolation statement.

## 7. Real Windows receipts [THIS-HOST]

- [ ] 7.1 Production-path cancel receipt: start a real hosted session on this Windows host through the production entry path, cancel it, and capture the Record showing the pre-start win32 declaration and the `cancelled / emptiness-unproven` terminal, with the capsule's Job kill mechanics actually exercised (controller spawned, TERMINATE acknowledged).
- [ ] 7.2 KILL_ON_JOB_CLOSE daemon-death teardown receipt: start a hosted workload that spawns a descendant, kill the daemon process without cancelling, and verify the whole workload Job dies via the handle-close chain; then restart and confirm the stale record is reported honestly (foreign/uncertain or declared-unproven per D4) with no reattach. If any link of the claimed chain fails, record the finding instead of widening the declaration.
- [ ] 7.3 Transport-loss receipt: kill the capsule controller process (not the workload) mid-session and capture the `uncertain` outcome with the session retained - the SEC-001 shape on a real host.
- [ ] 7.4 Label every Section 7 evidence file with host, OS build, and Node version provenance.

## 8. Verification and ship

- [ ] 8.1 `rasen validate --strict` green for this change; whitespace gate verified on bytes (LF-only, no trailing whitespace, no trailing blank line at EOF) for every file this change adds or edits.
- [ ] 8.2 Confirm the DAG: `ecp-native-process-capsule-closure` depends on this change alone; no edge from `ecp-macos-process-authority-provider` into closure was added; the two parked provider changes and their frozen crates are untouched by this change's diff.
- [ ] 8.3 Record the SEC-001 structural-closure evidence pointer for the closure re-grade wave (the D3 invariant, the 4.2 guard, and the 7.3 receipt), phrased as "structure shipped, closure verdict owed to the closure re-grade" - do not mark the finding closed.
- [ ] 8.4 Cross-platform neutrality: typecheck/lint/root suites green on this host; all new paths built with `node:path`; darwin routing still selects the same protocol (now under the POSIX module name) so macOS behaviour is unchanged pending its own ECP-8 receipts.
