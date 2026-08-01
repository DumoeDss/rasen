# Implementer handoff

## Edits

- `src/core/ephemera-cleaner.ts`
  - Added canonical auto/portfolio validation, bounded goal-round validation, explicit version guards, recursive symlink-safe source detection, typed blockers, deterministic fingerprints, and guarded non-recursive unlink.
- `src/core/work-migration.ts`
  - Added immutable ordered plan/apply models, typed blockers/outcomes, scoped ownership filtering, dependency-injected filesystem operations, exclusive file publication with EXDEV-only fallback, exclusive directory publication with created-path tracking, verification, and source-last removal.
  - Retained `runWorkMigration` as the existing CLI report compatibility projection.
- Focused tests cover schemas, byte preservation, source signals, inspection failures, cleaner drift, immutable actions, scoped globals, archived-state disposal, no-clobber races, fallback/failure paths, partial destinations, and win32/posix semantics.
- `test/core/archive-ephemera.test.ts` fixtures now use schema-valid run-state.
- `tasks.md`: 28/29 complete. Task 7.2 remains unchecked because macOS/Linux CI execution is unavailable from this Windows-only local worktree.

## Verification

- `pnpm exec vitest run test/core/ephemera-cleaner.test.ts test/core/work-migration.test.ts`
  - PASS: 2 files, 74 tests.
- `pnpm exec vitest run test/core/archive-ephemera.test.ts test/core/archive-accounting.test.ts test/commands/work.test.ts`
  - PASS: 3 files, 20 tests.
- `pnpm lint`
  - PASS.
- `pnpm build`
  - PASS.
- `pnpm test`
  - NOT A PASS: no Vitest summary after about 430 seconds; exited nonzero, matching the review's pre-existing full-suite hang. No matching worktree Node/pnpm process or `test-pipeline-command-tmp/` remained after termination.
- `node dist/cli/index.js validate file-placement-hardening-migration-safety --json`
  - PASS: 1 change valid, 0 issues.
- `git diff --check`
  - PASS; only repository line-ending warnings.

## Open risks / blocked items

- Task 7.2 requires the focused suites on Windows, macOS, and Linux CI. Only Windows local execution is verified; defer the CI matrix gate to portfolio delivery/closure.
- The repository-wide full suite still hangs independently of the focused changes and must not be represented as passing.

## Durable cross-child findings

- `src/commands/work.ts` interactive mode still obtains preview and apply through two compatibility calls. The root-routing/closure owner should carry one `WorkMigrationPlan` from confirmation into `applyWorkMigration` so the CLI uses the exact displayed action object, while threading explicit planning/execution roots.
- Archive entry points should surface cleaner `sourceSignals`, `blockers`, `complete`, and expanded preserved-path reporting. They must never call `applyEphemeraDeletion` for an aborted/incomplete plan.
- Archive tests and generated fixtures must use schema-valid known state; malformed known state is intentionally preserved and reported.
- Directory partial-path lists contain only paths created by the current action; a concurrently created colliding child is deliberately excluded.
