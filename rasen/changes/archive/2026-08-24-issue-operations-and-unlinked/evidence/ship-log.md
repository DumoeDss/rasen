# Ship Log: issue-operations-and-unlinked

**Date:** 2026-08-24T09:44:57.3739446+08:00
**Mode:** local
**Branch:** feat/issue-phase7
**Commit:** 0d31dbfabc6fad5e87fce4d97cc8b188560a3f8c
**Tree:** 25e4a3f984c6f5a4ba812dc45c5683980f0b41c1
**Status:** Committed (delivery deferred to the Phase 7 portfolio level)
**Archive timing:** on-merge
**Archived in ship:** no

## Delivery Resolution

`issue-operations-and-unlinked` is g-002 of the serial `issue-ui-convergence` Phase 7 portfolio.
It shares `feat/issue-phase7` with g-001 and the pending g-003 child, so this ship stage uses
explicit local mode: commit this child only, then defer the non-force push, pull request, and
portfolio delivery gate until every child is complete. This stage created or updated no remote
branch, pull request, archive, retention artifact, deployment, or persistent Store content.

## Pre-Flight Results

- Verification: pass — `verification-report.md` is CLEAN with 32/32 tasks, 13/13 delta
  requirements, 54/54 scenarios, and all four earlier verification findings independently closed.
  `review-report.md` and `review-cycle-report.md` record a clean one-round independent review cycle
  with no open Blocker, Major, Minor, or Trivial finding.
- Tasks: 32/32 complete.
- Scope: 51 files committed, 5,673 insertions and 56 deletions.
- Integrity: `git diff --cached --check` passed after removing three trailing EOF blank lines from
  delta specs; strict UTF-8 validation passed for all 51 staged text files; all 4 staged JSON files
  parsed; no BOM, U+FFFD, or known mojibake marker was found.
- Fences: no `.rasen/` ephemera, parent/sibling change, version file,
  `src/core/pipeline-registry/` file, or persistent `issue-registry` content was staged. The
  persistent Store remained clean at `f295abce308297dd09eb34a81287c614a8c489c5`.

## Test Gate

- Required scope: the fresh Store-wide Change-to-Issue association read and management API path;
  lock-held conditional Execution Plan publication; Session and Store wire mirrors; the complete
  `@atelierai/rasen-ui` package because this child changes API mirrors, routes, controls, locales,
  styles, and both Store-only pages; root/UI production builds; change validation.
- Rationale: the real-Git fixtures exercise active/archive association, incompleteness, read
  freshness/no-write, authenticated HTTP behavior, stale CAS zero-write, partial-create recovery,
  lock release, and two-writer serialization. The package-wide UI suite covers Operations,
  Unlinked Changes, Task Detail, Session controls, old Board compatibility, routing, and locale
  parity. No dependency, migration, version, CI, or frozen pipeline-registry change requires the
  unrelated root full suite; portfolio LEAD/CI owns the eventual rollup gate.
- `pnpm run build` — PASS; TypeScript and the Windows ProcessCapsule release helper built.
- `pnpm --filter @atelierai/rasen-ui test` — PASS, 76 files / 985 tests. Known jsdom navigation and
  `window.scrollTo` diagnostics were non-failing.
- `pnpm --filter @atelierai/rasen-ui build` — PASS, 566 modules transformed.
- `pnpm exec vitest run test/core/management-api/change-issue-links.test.ts` — PASS, 1 file / 7
  tests, run serially; 211.19 seconds.
- `pnpm exec vitest run test/core/store/store-issue-plan-concurrency.test.ts` — PASS, 1 file / 3
  tests, run serially; 34.17 seconds.
- `pnpm exec vitest run test/core/management-api/sessions-api.test.ts` — PASS, 1 file / 22 tests;
  40.99 seconds.
- `pnpm exec vitest run test/core/management-api/store-aggregate-wire-mirror.test.ts` — PASS,
  1 file / 19 tests; 1.27 seconds.
- `node bin/rasen.js validate issue-operations-and-unlinked` — PASS.
- Tested tree: `25e4a3f984c6f5a4ba812dc45c5683980f0b41c1`.

## Commit Scope

- Core/API: `src/core/issue-read/change-links.ts`, the issue-read barrel, flat management
  handler/router/wire files, and Store Issue conditional publication contracts/implementation.
- UI: API client/types, Store Operations and Unlinked Changes pages, link dialog, pure operations
  model, reusable Run controls, routes/navigation, styles, three locales, fixtures, and tests.
- Guards and documentation: real-Git link/API and CAS tests, Session/wire-mirror coverage, Vitest
  slow-test weight, four architecture-index files, and the complete
  `rasen/changes/issue-operations-and-unlinked/` planning/spec/dogfood/verification/review evidence
  available at code-commit time.
- Explicitly excluded: `.rasen/changes/issue-operations-and-unlinked/ephemera/auto-run.json`, all
  other `.rasen/` debris, `rasen/changes/issue-ui-convergence/`,
  `rasen/changes/issue-board-cutover/`, g-001 artifacts, persistent `issue-registry`, version fields,
  and `src/core/pipeline-registry/`.

## Deployment

Status: Deferred to the Phase 7 portfolio-level delivery.

## Archive Timing Note

Timing is `on-merge`. Nothing was archived during this local child ship. Portfolio LEAD owns the
later retention/archive sequence after portfolio delivery facts are final.

## Archive
**Date:** 2026-08-24T10:12:14.155Z
**Ship commit:** 0d31dbfabc6fad5e87fce4d97cc8b188560a3f8c
**Outcome:** archived at E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\.claude\worktrees\issue-layer\rasen\changes\archive\2026-08-24-issue-operations-and-unlinked
**Transaction:** 7c1fa74f-a8c0-4296-a68e-1d23bdf76ee2
