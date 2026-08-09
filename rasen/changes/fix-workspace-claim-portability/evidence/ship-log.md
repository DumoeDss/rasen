# Ship Log: fix-workspace-claim-portability

**Date:** 2026-08-10T00:53:21+08:00
**Mode:** local
**Branch:** fix/archive-transaction-recovery-follow-up
**Commit:** bf6bdbb77fbe23acdc2f6e8868286c5162bf37c6
**Tree:** f9f35885154618e40c27e948f2d88b0adb15f388
**Status:** Committed (delivery deferred to portfolio level)

## Pre-Flight Results

- Verification: passed — Tier A review cycle CLEAN after 3 rounds, with 0 Blocker, 0 Major, 0 Minor, and 0 Trivial findings open.
- Tasks: 13/14 complete.
- Pending: task 4.3 still requires real Windows and POSIX CI evidence. Local mocked policy coverage and the native Windows focused run do not satisfy or close this task.
- Authorization: the parent portfolio gate is off, so this decomposed child was committed locally with task 4.3 still pending.

## Test Gate

- Required scope: focused atomic workspace recovery tests, repository TypeScript compilation, focused ESLint for the two owned implementation/test files, and strict validation for this child change.
- Rationale: the delivered delta is bounded to atomic workspace carrier recovery and its focused regression file. The checks cover the changed recovery, exact-identity, directory-durability, and platform-policy boundaries without silently escalating to the full repository suite.
- Tests: `pnpm exec vitest run test/core/store/workspace-atomic-write.test.ts` — 1 file passed, 53/53 tests passed, 0 skipped.
- TypeScript: `pnpm exec tsc --noEmit` — passed.
- Lint: `pnpm exec eslint src/core/store/workspace/dependencies.ts test/core/store/workspace-atomic-write.test.ts --max-warnings=0` — passed.
- Validation: `rasen validate fix-workspace-claim-portability --strict --json` — 1/1 change valid, 0 issues.
- Tree: f9f35885154618e40c27e948f2d88b0adb15f388.

## Delivery

- No push, PR, merge, or deployment was performed.
- Delivery is deferred to the portfolio/parent level after all decomposed children complete.
- The child remains active and was not archived.

## Outstanding Evidence

- Task 4.3 remains unchecked until a real Windows CI job and a real POSIX CI job record the exact directory-open/sync behavior and large-identity evidence.
