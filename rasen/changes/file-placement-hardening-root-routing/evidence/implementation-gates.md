# Root-routing implementation gates

Date: 2026-07-31

## Focused behavior

- `npx vitest run test/commands/work.test.ts test/core/work-migration.test.ts test/core/management-api/sessions-api.test.ts test/core/management-api/sessions-space.test.ts`
  - PASS: 4 files, 114 tests.
  - Includes Store planning/member execution routing, main plus linked worktree
    migration, linked-worktree Session precedence, plan-reference identity,
    source-drift rejection, no-mint preview/apply behavior, and compatibility
    output/options.
- `test/core/work-migration.test.ts` ran deterministic explicit
  `PathIdentityFlavor` cases for both `win32` and `posix`.
  - PASS: `win32` case-insensitive scope and Windows separator identity.
  - PASS: `posix` case-sensitive scope and POSIX separator identity.
  - Host for this run: Windows. This is deterministic flavor coverage, not a
    claim that macOS or Linux native runners were exercised.

## Static and artifact gates

- `npm run build`
  - PASS: TypeScript compilation and distribution build.
- `npm run lint`
  - PASS: repository ESLint gate.
- `node dist/cli/index.js work migrate --help`
  - PASS: Commander presentation accepts and renders `--store` and `--project`.
- `node dist/cli/index.js validate file-placement-hardening-root-routing --type change --strict --json`
  - PASS: 1 item passed, 0 failed, no issues.
- `git diff --check`
  - PASS: no whitespace errors; only the repository's expected Windows
    LF-to-CRLF notices were emitted.

## Scope review

The implementation changes are limited to migration root/caller threading,
Sessions terminal-read routing, command selector presentation metadata/locales,
focused tests, and this change's task/evidence/handoff artifacts. No
archive-engine, archive-accounting, workflow-template, final documentation, or
historical archive artifact was changed by this child.

## Closure handoff

The closure child still owns the required real Windows/macOS/Linux CI matrix.
It should reuse the focused command above and must not treat this Windows-host
run with explicit `win32`/`posix` flavors as native macOS/Linux evidence.
