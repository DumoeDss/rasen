# Ship Log: add-local-version-test-harness

**Date:** 2026-08-01T15:19:10+08:00
**Mode:** pr
**Branch:** feat/local-version-test-harness-0.1.6
**Commit:** 4fd1dcabd493c89e527e2483335803c69784e0ba
**Tree:** aee99540f5cf02b060133ecfc1c62d6256e7e4ab
**Base:** dev/0.1.6
**PR:** https://github.com/DumoeDss/rasen/pull/125
**Status:** PR Created

## Pre-Flight Results

- Verification: pass — `verification-report.md`, `VERIFY VERDICT: CLEAN`
- Tasks: 16/16 complete

## Test Gate

- Required scope: focused local-version runtime/PowerShell suite; harness static checks; strict change validation; real 0.1.6 CLI/UI cold and warm preparation
- Rationale: the delivered diff is isolated developer tooling, but it crosses package/build, cache/concurrency, Windows PowerShell, and paired CLI/UI resolution boundaries. The focused suite plus a real source-package E2E covers those risks without requiring the unrelated full repository suite locally; the repository CI matrix runs on the PR.
- Tests: `pnpm exec vitest run test/scripts/local-version-runtime.test.ts` — 6/6 passed; `pnpm exec eslint scripts/local-version/local-runtime.mjs test/scripts/local-version-runtime.test.ts` — passed; `node --check scripts/local-version/local-runtime.mjs` — passed; `git diff --check origin/dev/0.1.6...HEAD` — passed; `node bin/rasen.js validate add-local-version-test-harness --type change --strict --json --no-interactive` — passed; real 0.1.6 prepare — cold `built`, warm `hit`, CLI `0.1.6`, UI assets present
- Tree: aee99540f5cf02b060133ecfc1c62d6256e7e4ab

## Deployment

Status: Pending (PR CI is running; merge/deploy was not requested)

## CI Follow-up

- Failed run: `30689519823` (`macOS` and `Windows tests (shard 3/3)`)
- Root causes: the ESM entrypoint compared non-canonical path spellings on macOS; Windows preferred Node's bundled Corepack over the pnpm installed on `PATH`; launcher assertions compared Windows path spellings instead of filesystem identity.
- Fix: canonicalize the runtime entrypoint, resolve the active pnpm from package metadata/user-agent/`PATH`, and canonicalize existing paths in launcher assertions.
- Regression: added a directory-alias entrypoint case reproducing the macOS silent exit.
- Local verification: focused CI cases 3/3 passed; full local-version suite 7/7 passed; ESLint, TypeScript, Node syntax, and `git diff --check` passed.
- Status: Fix ready for PR CI re-run.

## Archive
**Date:** 2026-08-01T08:01:38.317Z
**Ship commit:** 4fd1dcabd493c89e527e2483335803c69784e0ba
**Outcome:** archived at E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-local-version-harness-016\rasen\changes\archive\2026-08-01-add-local-version-test-harness
**Transaction:** 16924581-d169-4b65-8b91-fe9ab5606da6
