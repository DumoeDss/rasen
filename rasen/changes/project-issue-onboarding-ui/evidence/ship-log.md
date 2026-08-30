# Ship Log: project-issue-onboarding-ui

**Date:** 2026-08-30T21:44:06.5383747+08:00
**Mode:** local
**Branch:** feat/project-issue-onboarding
**Commit:** 96ecbbc805df61dcaf6389b82bfac3bbe33606b9
**Tree:** a34c401331f5207b46f31d14b0bb81574902fa90 (verified product tree before this evidence-only log)
**Status:** Committed (delivery deferred to portfolio/parent level)
**Archived in ship:** no

## Portfolio Commits

- `8f6266525b3b32940780a94f0f3565aaeeaf06d1` — `feat(management-api): add project to store membership bridge`
- `35a63cd6a6cc41ec3eb9a1f98ee4bf8998ddc0b5` — `test(management-api): close membership bridge review gaps`
- `96ecbbc805df61dcaf6389b82bfac3bbe33606b9` — `feat(ui): add project issue onboarding`

## Pre-Flight Results

- Verification: pass — API review clean and UI review-cycle round 3 clean, with no open Blocker, Major, Minor, or Trivial finding.
- Tasks: 32/32 complete (API 11/11; UI 21/21).
- Delivery mode: local only; no push, PR creation/update, merge, archive, deployment, or worktree cleanup occurred.

## Test Gate

- Required scope: focused Management API mutation/route/wire/client tests; full UI suite; UI production build; root TypeScript check; both strict Change validations; locale and repository hygiene checks.
- Rationale: the delivered diff crosses the authenticated space-mutation bridge, its UI wire mirror, Project/Store routing, shared catalog publication, Store creation dialog, localization, and onboarding UI behavior.
- PASS — `pnpm exec vitest run test/core/management-api/create-space.test.ts test/core/management-api/create-space.integration.test.ts test/core/management-api/router.test.ts test/core/management-api/workflow-whitelist.test.ts test/core/management-api/space-creation-wire-mirror.test.ts`: 5 files, 99/99 tests. The suite's root global setup also completed the production root build successfully.
- PASS — from `packages/ui`, `pnpm exec vitest run test/api/client.test.ts test/api/fixtures.test.ts`: 2 files, 46/46 tests.
- PASS — from `packages/ui`, `pnpm exec vitest run --testTimeout=15000`: full suite, 75 files, 1027/1027 tests. The initial default-timeout run completed 1026 tests but its source-key catalog scan took 5.049 seconds and exceeded the 5-second per-test limit; the same full scope passed with a 15-second per-test limit, and the catalog file also passed 12/12 in focused evidence.
- PASS — from `packages/ui`, `pnpm run build`: Vite production build, 567 modules transformed.
- PASS — root `pnpm exec tsc --noEmit`.
- PASS — strict validation for `project-store-membership-api` and `project-issue-onboarding-ui`: 1/1 valid each, 0 issues.
- PASS — `git diff --check origin/dev/0.2.0`.
- PASS — 52 changed/untracked files scanned as strict UTF-8: no BOM, U+FFFD, common mojibake, trailing whitespace, or zero-byte file.
- PASS — English, Japanese, and Simplified-Chinese locale JSON parsed with 801 keys and exact key parity.
- Tree: `a34c401331f5207b46f31d14b0bb81574902fa90`.

## Known Baseline

`pnpm run typecheck` in `packages/ui` remains non-green with 13 pre-existing diagnostics in unchanged Canvas/consultation files: `src/canvas/ConsultationBindingEditor.tsx`, `src/canvas/IssuesDrawer.tsx`, `test/canvas/pipeline-canvas-page.test.tsx`, and `test/canvas/v2-node-panel-consultation.test.tsx`. No diagnostic names an onboarding, space-dialog, local-path-picker, locale, routing, or API file changed by this portfolio. This baseline is recorded as a failure, not a passing gate.

## Deployment

Status: Not requested; local child delivery is deferred to the portfolio/parent ship stage.
