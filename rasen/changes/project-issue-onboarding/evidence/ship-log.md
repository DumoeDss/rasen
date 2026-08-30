# Ship Log: project-issue-onboarding

**Date:** 2026-08-31T05:13:57+08:00
**Mode:** pr
**Branch:** feat/project-issue-onboarding
**Pre-delivery commit:** db05f9df04584c7550ebe9074101b7e4463c877c
**Pre-delivery tree:** 02030a12b4c761b42b6f75904861772bdc833b46
**Base:** dev/0.2.0
**PR:** https://github.com/DumoeDss/rasen/pull/183
**Status:** PR Created

## Pre-Flight Results

- Verification: PASS — parent verifier reported CLEAN with 0 Blocker, 0 Major, 0 Minor, and 0 Trivial findings.
- Tasks: PASS — 32/32 complete across the API and UI child changes; the parent is intentionally a taskless portfolio shell.
- Requirements: PASS — 10/10 delta requirements and 40/40 scenarios mapped to implementation and evidence.
- Base synchronization: PASS — `origin/dev/0.2.0` is an ancestor of the delivery commit; 0 behind and 8 ahead before delivery.
- Verification freshness: PASS — `46edbf77934e20fe6b360c0aa91047ca08914cfc..db05f9df04584c7550ebe9074101b7e4463c877c` contains only this parent verification report and portfolio delivery state. The report's tested tree exactly matches `46edbf77934e20fe6b360c0aa91047ca08914cfc^{tree}`.
- Diff hygiene: PASS — `git diff --check origin/dev/0.2.0...HEAD`, sensitive filename scanning, and added-line secret/debug/TODO scanning found no issues before delivery.

## Test Gate

- Required scope: focused Store/Management regression and integration tests; complete UI package tests; root and UI production builds; strict validation of both child changes and the two amended canonical specs; diff, strict UTF-8/no-BOM, JSON, and locale-parity checks; final browser QA.
- Rationale: the branch changes the Store membership CLI/Management bridge and the Project onboarding UI. The five focused backend/Store test files cover the bounded API, real CLI integration, and both post-QA fixes; the complete UI suite covers routes, components, shared catalog behavior, localization, and regressions. No product code changed after the recorded green evidence.
- `pnpm run build` — PASS, exit 0; TypeScript compiled and ProcessCapsule `win32-x64` built.
- `pnpm exec vitest run test/commands/store-add-project.test.ts test/core/store/membership-operations.test.ts test/commands/store-membership-cli.test.ts test/core/management-api/create-space.test.ts test/core/management-api/create-space.integration.test.ts` — PASS, 5/5 files and 102/102 tests.
- `pnpm --dir packages/ui run test` — PASS, 75/75 files and 1,027/1,027 tests.
- `pnpm --dir packages/ui run build` — PASS, exit 0; 567 modules transformed and production assets emitted.
- `node bin/rasen.js validate "project-store-membership-api" --type change --strict --json` — PASS, 1/1 item, 0 failed, 0 issues.
- `node bin/rasen.js validate "project-issue-onboarding-ui" --type change --strict --json` — PASS, 1/1 item, 0 failed, 0 issues.
- `node bin/rasen.js validate "store-add-project" --type spec --strict --json` — PASS, 1/1 item, 0 failed; informational long-text suggestions only.
- `node bin/rasen.js validate "space-creation" --type spec --strict --json` — PASS, 1/1 item, 0 failed; informational long-text suggestions only.
- Browser QA — PASS, 99/100 on release-shaped fingerprint `f32fdb5d8970991837f425f94b5d2827164acf9eed3098ff3f941f75425fbfbe`: Store creation HTTP 201, membership HTTP 200, exact `/s/qa-issue-onboarding-v2-20260831/issues` navigation, all three Store aggregate endpoints HTTP 200, and zero application console errors or exceptions in the clean final-navigation window.
- Tests: skipped at ship time — scoped green evidence in `verification-report.md` covers the delivered product tree; the only subsequent commit before delivery added that report and portfolio run-state metadata.
- Evidence tree: `2b8550ca6e949a829bfc866f823da3f199e0459f`
- Pre-delivery tree: `02030a12b4c761b42b6f75904861772bdc833b46`

## CI Fix Follow-Up

- Recorded: 2026-08-31T06:07:26+08:00
- Fix commit: `cad3f469dd74910dd1e0d6d9a0f2cfff339415e9` (`test: make store setup fixture hermetic`)
- Fix tree: `08201ef65a5e6ebcbb9bbce23b3b609d1872bf6e`
- Failed run superseded: `https://github.com/DumoeDss/rasen/actions/runs/33335930067` — the Linux Node 20, Linux Node 24, and Windows shard 1 jobs each failed only `test/core/management-api/create-space.integration.test.ts` because its real Store setup relied on ambient Git author/committer identity that GitHub-hosted runners did not provide. The aggregate `Test` and `All checks passed` gates consequently failed. This run is permanently ineligible as green delivery evidence.
- Remediation: the integration fixture now supplies disposable `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, and `GIT_COMMITTER_EMAIL` values inside the existing per-test environment snapshot/restoration boundary. Product behavior is unchanged.
- Independent review: PASS — `CI-GIT-IDENTITY: RESOLVED`; Blocker:0 Major:0 Minor:0 Trivial:0.
- `pnpm exec vitest run test/core/management-api/create-space.integration.test.ts` — PASS, 1/1 file and 3/3 tests in the normal environment.
- The same full-file command with system/global Git configuration disabled and all four ambient identity variables absent — PASS, 1/1 file and 3/3 tests.
- Environment restoration probe, strict UTF-8/no-BOM scan, and `git diff --check` — PASS.
- Base synchronization: PASS — refreshed `origin/dev/0.2.0` remained an ancestor of the pre-fix HEAD, 0 behind; no base merge was required.
- Replacement CI: Pending — only a workflow/check suite for the new pushed PR head may authorize merge.

## Deployment

Status: Pending (run `rasen-ship --deploy` to continue)
