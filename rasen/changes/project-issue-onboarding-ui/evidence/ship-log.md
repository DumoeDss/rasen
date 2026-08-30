# Ship Log: project-issue-onboarding-ui

**Date:** 2026-08-30T21:44:06.5383747+08:00
**Updated:** 2026-08-31T02:51:56.8164299+08:00
**Mode:** local
**Branch:** feat/project-issue-onboarding
**Commit:** 2a912fbc98b239734f0cbde1c984a0291b6bc622
**Tree:** 58559c25ffb0359dee3fa0805646a8bd0204aab3 (post-QA-fix product tree before this evidence-only update)
**Status:** Committed (delivery deferred to portfolio/parent level)
**Archived in ship:** no

## Portfolio Commits

- `8f6266525b3b32940780a94f0f3565aaeeaf06d1` — `feat(management-api): add project to store membership bridge`
- `35a63cd6a6cc41ec3eb9a1f98ee4bf8998ddc0b5` — `test(management-api): close membership bridge review gaps`
- `96ecbbc805df61dcaf6389b82bfac3bbe33606b9` — `feat(ui): add project issue onboarding`
- `738050cafd39db7c103ea067cb13fa06ce7d1f46` — `chore(rasen): record onboarding portfolio delivery state`
- `2a912fbc98b239734f0cbde1c984a0291b6bc622` — `fix(store): complete project issue onboarding QA`

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

## Post-Local-Delivery QA Closure

- Final browser QA: **99/100**, with 0 open Critical, High, Medium, or Low findings.
- ISSUE-001 resolved: membership reuses the canonical registered Project identity when the checkout basename is not a valid Store id.
- ISSUE-002 resolved: Management API Store creation requests layout v2, and a fresh Store serves an empty canonical Issue Board through all three aggregate endpoints with HTTP 200 and a clean final console window.
- Independent re-review: **REVIEW-CLEAN**, with 0 open Blocker, Major, Minor, or Trivial findings after specification and newline-hygiene closure.
- Delivery remains local and deferred to the portfolio/parent stage; no push, PR, merge, archive, deployment, or worktree cleanup occurred here.

## Deployment

Status: Not requested; local child delivery is deferred to the portfolio/parent ship stage.
