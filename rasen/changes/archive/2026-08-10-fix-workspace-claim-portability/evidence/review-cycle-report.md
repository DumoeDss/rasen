# Review Cycle Report: fix-workspace-claim-portability

- Pipeline: `small-feature`
- Tier: **A — Codex-native role-isolated workers**
- Branch: `fix/archive-transaction-recovery-follow-up`
- Pre-child / current PR head: `27b2d4c2fb6828fa9849b85cbfb458a47f2a0fac`
- Review rounds completed: **3**
- Current cycle verdict: **CLEAN — 0 Blocker, 0 Major, 0 Minor, 0 Trivial open**
- Delivery disposition: **review-clean; task 4.3 still awaits native Windows/POSIX CI evidence**

## Role separation and provenance

| Stage / round | Role | Native task | Mutation authority | Outcome |
|---|---|---|---|---|
| Initial implementation | Author / implementer | `/root/implement_workspace_claim` | Scoped source, test, and child artifacts | Produced the initial child delta and focused evidence. |
| Review Round 1 | Independent reviewer | `/root/review_workspace_claim` | Report-only | Found F1–F4: 2 Blocker and 2 Minor. Wrote only `evidence/review-report.md`. |
| Fix Round 1 | Non-reviewer fixer | `/root/fix_workspace_review_findings` | Scoped source and focused test | Implemented the F1–F4 remediation delta and supplied recorded gates. |
| Review Round 2 | Same independent reviewer, still non-author/non-fixer | `/root/review_workspace_claim` | Report-only | Confirmed F1, F2, F4, and original F3 resolved; found one deterministic POSIX test-gate Blocker while re-reviewing F3. |
| Fix Round 2 | Non-reviewer fixer | `/root/fix_workspace_review_findings` | Focused test only | Bound the Windows success case to `win32`, added Linux/Darwin writer-level denial cases, and restored local spies in `finally`. |
| Review Round 3 | Same independent reviewer, still non-author/non-fixer | `/root/review_workspace_claim` | Report-only | Confirmed R2-F3b resolved; targeted 3/3 and atomic 53/53 passed with no open finding. |

The Tier A separation is intact: the initial author, remediation fixer, and reviewer are three distinct native task identities. The reviewer made no source/test/task/run-state edits in any round and did not commit, push, or dispatch another reviewer.

## Round history

### Round 1 — 2026-08-09

Verdict: **FAIL — 2 Blocker, 0 Major, 2 Minor, 0 Trivial.**

| Finding | Severity | Round 1 disposition |
|---|---:|---|
| F1 journal-bound missing-authority fallback | Blocker | Open — a retained claim could resume self-contained before journal authority was recorded. |
| F2 backup final unlink omitted digest proof | Blocker | Open — equal-size in-place backup changes could be deleted. |
| F3 tolerated directory-sync branch lacked deterministic writer coverage | Minor | Open — sync allowlist and ancestry-revalidation branches were not executed. |
| F4 atomic path identity lacked real alias regression | Minor | Open — local `test/AGENTS.md` requirement was incomplete. |

Reviewer evidence: atomic writer **41/41** and Git-verb/Windows-path/identity **41/41** passed; TypeScript, focused ESLint, strict validation, and diff check passed. A broader 10-file run exceeded 240 seconds and was recorded as inconclusive.

### Round 2 — 2026-08-10

Verdict: **FAIL — 1 Blocker, 0 Major, 0 Minor, 0 Trivial open.**

| Finding | Round 2 disposition | Independent evidence |
|---|---|---|
| F1 | **RESOLVED** | `journalBound` includes `onPrepared`; intact before-state/no-backup reconstruction revalidates all carriers and awaits the callback before link/unlink. Focused reconstruction and carrier-free refusal tests pass. |
| F2 | **RESOLVED** | Digest-checking `requireBackup()` is the final awaited proof before unlink; equal-size same-inode mutation is retained with conflict. |
| F3 original coverage gap | **RESOLVED** | Writer-level Windows/Linux/Darwin sync tuples and tolerated-sync ancestry replacement are exercised. Genuine I/O, file-sync, and close failures remain visible. |
| F4 | **RESOLVED** | Real Windows junction/POSIX symlink coverage canonicalizes both ends, preserves exact target authority, and retains bytes on alias-spelling refusal. Windows rerun had zero skips. |
| R2-F3b | **OPEN Blocker** | The unconditional Windows `open/EISDIR` success test will run under POSIX, where the exact policy correctly returns `EISDIR`; the required POSIX focused job therefore fails. |

R2-F3b is a new test-portability finding discovered inside the F3 re-review. It does not reopen the product tuple allowlist: the implementation correctly refuses Linux/Darwin `open/EISDIR`. The test must explicitly mock Windows or honestly skip outside Windows.

### Round 3 — 2026-08-10

Verdict: **CLEAN — 0 Blocker, 0 Major, 0 Minor, 0 Trivial open.**

| Finding | Round 3 disposition | Independent evidence |
|---|---|---|
| R2-F3b | **RESOLVED** | Windows success explicitly mocks `process.platform = win32`; Linux and Darwin denial cases call the real writer with their named platform, propagate `EISDIR`, retain the claim, and leave the target absent. Local `finally` plus suite `afterEach` restore spies. |

The remediation executes all three policy expectations on every host and does not weaken `UNSUPPORTED_DIRECTORY_DURABILITY` or use a platform skip. Reviewer reruns passed the exact three cases and the complete 53-case atomic file. Task 4.3 remains a separate native Windows/POSIX CI requirement and is still unchecked.

## Evidence accounting

### Fixer-recorded evidence

The following was supplied by `/root/fix_workspace_review_findings` and is recorded, not attributed to the reviewer:

| Check | Recorded result | Cycle treatment |
|---|---:|---|
| Atomic workspace writer | 51/51 passed | Corroborated by Round 2 reviewer rerun. |
| Git-verb guard + Windows paths + identity | 41/41 passed | Recorded green. |
| Workspace plan | 22/22 passed | Recorded green. |
| Binding + apply | 28/28 passed | Recorded green. |
| Locks | 11/11 passed | Recorded green. |
| Representative cleanup case | 1/1 passed | Recorded green. |
| TypeScript / focused ESLint / strict change validation | Green | TypeScript, ESLint, and strict validation corroborated by reviewer. |
| Full cleanup file | ~296 seconds; runner exit 1; no failing test-case output | **Inconclusive.** Neither pass nor failing-case evidence. |

### Reviewer-rerun evidence

| Round | Check | Result |
|---|---|---|
| 1 | Atomic writer | 41/41 passed. |
| 1 | Git-verb guard + Windows paths + identity | 41/41 passed. |
| 1 | TypeScript, focused ESLint, strict validation, diff check | Passed. |
| 2 | `pnpm exec vitest run test/core/store/workspace-atomic-write.test.ts` | **51/51 passed, 0 skipped** on Windows. |
| 2 | TypeScript, focused ESLint, strict validation, tracked diff check | Passed. |
| 2 | Simulated Linux directory-open `EISDIR` against current matching build | `RESULT_CODE=EISDIR`, proving R2-F3b's unconditional success expectation is invalid on POSIX. |
| 2 | Greptile eligibility | 0 line-level and 0 top-level comments; PR head remains pre-child. |
| 3 | Selected Windows/Linux/Darwin writer-level `open/EISDIR` cases | **3/3 passed** on native Windows; 50 unrelated cases skipped by the name filter. |
| 3 | `pnpm exec vitest run test/core/store/workspace-atomic-write.test.ts` | **53/53 passed, 0 skipped** on native Windows. |

The review cycle does not count the inconclusive cleanup runner exit as a failure or a pass. The R2-F3b test-portability blocker is closed, but task 4.3 remains an external Windows/POSIX CI hold; mocked policy cases and the local Windows run do not claim native POSIX filesystem evidence.

## Current gate and next review

Canonical open count: **0 Blocker, 0 Major, 0 Minor, 0 Trivial.**

The review loop is **CLEAN**. No further code or test fix is required by this review.

Remaining verification outside this review loop:

1. Run the focused matrix on native POSIX CI as required by task 4.3, alongside the recorded/native Windows result.
2. Record exact directory-open/sync outcomes and large-identity evidence, then check task 4.3 only when that evidence exists.

This report records review evidence only and does not update task or run-state. Delivery readiness remains subject to the outstanding task 4.3 gate even though the review finding count is clean.

## Durable findings

1. F1/F2 authority and destructive-cleanup boundaries remain independently closed by code plus regression evidence.
2. F3/F4 and R2-F3b are closed: explicit platform spies exercise Windows tolerance and POSIX denial through the writer without skip-based masking.
3. Deterministic mocked policy coverage and native filesystem verification serve different purposes; task 4.3 remains open until a real POSIX job is recorded.
