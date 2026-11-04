# ECP durable Session host Round 3 fixer handoff

This handoff was written after the fixer session was compacted/interrupted. It
records the recovered state for the next non-author reviewer; it is not a clean
review verdict.

## Identity and scope

- Fixer: `/root/ecp7_host_fixer_2`.
- Worktree: `OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle`.
- Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`.
- HEAD: `050fc84332b26a75a07f441efd6b235842f89e1e`.
- HEAD tree: `58489c46633a209d2c1761c2a4b684ad8b95cb48`.
- Change: `ecp-durable-agent-session-host`.
- Authorized findings: Round 2 V5 and V6 only.
- No task checkbox, run-state, `.rasen/**/ephemera`, commit, push, ship,
  archive, child-2, full-root-suite, or full-UI-suite mutation was performed.

## What changed

V5 now binds every bridge and worker claim to an OS process-start identity in
addition to its PID. Claim token v3 carries the bridge instance identity and
worker token v2 carries the worker instance identity. Windows uses CIM process
creation ticks, Linux uses `/proc/<pid>/stat` start ticks plus boot ID, and the
remaining POSIX fallback hashes `ps -o lstart=`. All live signalling rechecks
the exact instance; a reused PID is never signalled. Injectable probe/platform
seams cover deterministic Windows and POSIX branches.

Windows production launch now creates a Job Object controller before backend
activation, sets `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, assigns the admitted
supervisor to that job, and only then opens the activation gate. Detached
descendants remain in the job and die when the supervisor/controller lifecycle
ends. POSIX retains process-group containment. The real Windows regression
kills only the admitted supervisor and observes the detached descendant die.

V6 now durably publishes exact process authority before attempting to close a
transport returned after shutdown admission closed. If `terminate()` returns
`closed:false` or throws, the host retains the live transport, ownership claim,
and registry process facts, marks shutdown uncertain, and rejects shutdown
instead of reporting a clean stop. A later transport close or explicit shutdown
retry reconciles and releases exact authority once. Termination is
single-flight, so cancel/execute/shutdown races do not double-signal or double-
settle. Management server stop is retryable; daemon shutdown does not erase its
state or exit cleanly while authority is retained.

## RED and GREEN evidence

The pre-fix RED command covered ownership, host, and the production Claude
backend. It ran 55 tests: 48 passed and 7 failed. The failures were the two
detached-descendant/process-tree cases, two exact-process/PID-reuse ownership
cases, and three late-open `closed:false`/throw/retry authority cases. This is
the preserved mutation discriminator for V5/V6.

Final focused command:

```text
pnpm exec vitest run test/core/session-host test/core/agent-cli-process.test.ts test/core/claude/runner.test.ts test/core/management-api/hosted-sessions-api.test.ts test/core/management-api/hosted-session-recovery.test.ts test/core/management-api/server-shutdown.test.ts test/commands/daemon-half-started.test.ts test/commands/daemon-spawn-convergence.test.ts test/cli-e2e/session-host.test.ts --maxWorkers=1 --minWorkers=1
PASS: 16 files, 125/125 tests (228.55s)
```

Static gates all pass: `pnpm run build`, `pnpm run lint`,
`pnpm exec tsc --noEmit`, strict Change validation, and `git diff --check`.
The diff check emitted only the cumulative shared-worktree LF/CRLF notices.
No test-owned matching temp directory, replay/session-host Node process, or
debug admission marker remained after the final run.

Three pre-final full-matrix runs each exposed a different Windows load margin,
not a V5/V6 product failure: the acceptance test's outer test watchdog, the
runner's CIM claim-publication poll, and the CLI test's Vitest default timeout.
Only test-side margins were widened; product deadlines and semantic assertions
were unchanged. Each discriminator passed in isolation before the final
125/125 run.

## Scope fingerprint

The implementation/test/doc scope contains 20 files. Since this is a cumulative
uncommitted ECP worktree and no Round 3 baseline blob snapshot existed, the
delta-state hash below is explicitly HEAD-to-current for this scoped manifest,
not a claimed Round-3-only diff.

- Ordered manifest SHA-256:
  `df1d7bf6ac444a334969dac7e68c4e4ab3df0f8bf448fb00a4801512164ceaca`.
- HEAD-to-current scoped delta-state SHA-256:
  `8742602b1918e17c73d49ccf74833a14901bce5c08ad5dc218498fca9e498202`.
- Current scoped-content SHA-256:
  `335cc0b265014bd96ce6efc6e3d0c558aabc418b5a4bfa77b2dc27842a55fe89`.

The ordered manifest is recorded in the Round 3 fixer section of
`evidence/review-cycle-report.md`.

## Next action

Dispatch a fresh non-author code/spec review and CSO confirmation over exactly
V5/V6 and the scoped manifest. Tasks 9.8, 9.9, and 9.10 remain unchecked. Do
not mark this Change clean, ship, archive, or begin the next child until that
review has independently resolved both findings and the parent authorizes the
next lifecycle step.

**HANDOFF STATUS: FIXES_APPLIED - PENDING NON-AUTHOR RE-REVIEW/CSO**
