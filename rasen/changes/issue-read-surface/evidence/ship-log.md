# Ship Log: issue-read-surface

**Date:** 2026-08-24T05:41:52.9644388+08:00
**Mode:** local
**Branch:** feat/issue-phase7
**Commit:** 9b7130de7d58e66bd1a8ff8e0c6e0d20181fd10f
**Tree:** d53eebc4f4997c30977d6346d3e49687f9fa15e3
**Status:** Committed (delivery deferred to the Phase 7 portfolio level)
**Archive timing:** on-merge
**Archived in ship:** no

## Delivery Resolution

`issue-read-surface` is g-001 of the `issue-ui-convergence` Phase 7 portfolio. It shares the
`feat/issue-phase7` worktree with the remaining serial children, so this child uses the same
local-delivery convention as the preceding Issue-layer portfolios: commit the child once and
defer the non-force push and pull request to the portfolio-level rollup. No remote branch was
created or updated and no pull request was opened by this ship stage.

## Pre-Flight Results

- Verification: pass — `verification-report.md` is CLEAN with 8/8 requirements and 27/27
  scenarios mapped; `review-report.md` and `review-cycle-report.md` record a clean two-round
  independent review cycle with no open finding.
- Tasks: 22/22 complete.
- Scope: 46 files committed, 7,732 insertions and 351 deletions.
- Integrity: `git diff --cached --check` passed; strict UTF-8 validation passed for all 46
  staged text files; all 6 staged JSON files parsed; no BOM or U+FFFD was found.
- Fences: no `src/core/pipeline-registry/` file, version field, persistent Store content,
  `.rasen/` ephemera, or sibling change was staged.

## Test Gate

- Required scope: shared Issue read composition and its real management API/CLI parity path;
  the full `@atelierai/rasen-ui` package because the delivery changes its client, wire mirror,
  routes, locales, components, and styles; build and change validation.
- Rationale: the delivered behavior is bounded to the new Issue read composition, three
  additive Store projection endpoints, and the read-only Issue Board/Detail UI. The fresh
  API suite exercises the real CLI subprocesses and Git fixtures, including byte parity,
  freshness, no-write, refusal, incompleteness, and visibility behavior. The package-wide UI
  suite covers every UI consumer and locale. No dependency, migration, CI, security-boundary,
  pipeline-registry, or version change requires the root repository suite; the root full suite
  remains the portfolio CI/LEAD gate recorded in the handoff.
- `pnpm run build` — PASS.
- `pnpm exec vitest run test/core/management-api/issue-projection.test.ts --reporter=verbose`
  — PASS, 1 file / 14 tests, run serially (322.76 seconds).
- `pnpm --filter @atelierai/rasen-ui test` — PASS, 71 files / 959 tests.
- `pnpm exec vitest run test/core/management-api/store-aggregate-wire-mirror.test.ts --reporter=dot`
  — PASS, 1 file / 18 tests.
- `node bin/rasen.js validate issue-read-surface` — PASS.
- Tested tree: `d53eebc4f4997c30977d6346d3e49687f9fa15e3`.

## Commit Scope

- Core/CLI/API: `src/core/issue-read/`, `src/commands/store-issue.ts`,
  `src/commands/store.ts`, and the three management API files.
- UI: API client/types, Board/Detail components and vocabulary, routes/navigation, styles,
  three locales, component/app fixtures and tests.
- Guards and documentation: projection and wire-mirror tests, Vitest slow-test weight, four
  architecture-index files, and the complete `rasen/changes/issue-read-surface/` planning,
  handoff, spec, dogfood, verification, and review evidence available at code-commit time.
- Explicitly excluded: `.rasen/changes/issue-read-surface/ephemera/auto-run.json`, all other
  `.rasen/` debris, `rasen/changes/issue-ui-convergence/`, every sibling change, Canvas
  baseline files, the persistent `issue-registry` Store, `src/core/pipeline-registry/`, and
  version fields.

## Deployment

Status: Deferred to the Phase 7 portfolio-level delivery.

## Archive

Timing is `on-merge`. Nothing was archived during ship. Retention runs before the later
archive action; for local delivery there is no child PR merge to poll, so the archive stage
may proceed after retention under the portfolio's lifecycle policy.
