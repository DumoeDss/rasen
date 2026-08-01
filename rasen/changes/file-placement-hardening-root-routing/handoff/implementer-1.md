# Implementer handoff 1

## Outcome

All 20 tasks in `file-placement-hardening-root-routing` are implemented and
locally verified.

Migration now receives one explicit frozen `WorkMigrationRootContext` carrying
planning, changes, execution, legacy-home-owner, and path-identity facts.
Root-capable callers no longer derive execution or Store ownership downstream.
The legacy string-argument API remains as a narrow in-repo adapter with the
existing plan/report aliases and `runWorkMigration` failure vocabulary.

`rasen work migrate` now:

- accepts the shared `--store` and `--project` selectors;
- freezes Store planning separately from the invocation checkout/worktree;
- plans exactly once in dry-run, JSON, and interactive modes;
- applies the exact plan object that produced the preview;
- never mints identity or replans after a no-home preview; and
- preserves the existing human/JSON compatibility surface.

Sessions now keep planning-space filtering and the planning `changeDir`, but
terminal reads require a usable frozen project execution. Ephemera and
read-only legacy-home lookup use only `record.execution.root`. Missing,
planning-only, removed, or stale execution returns `{ "kind": "absent" }`;
unexpected inspection failures degrade to the existing per-entry error shape.

## Files owned by this implementation

- `src/core/work-migration.ts`
- `src/commands/work.ts`
- `src/core/management-api/sessions.ts`
- `src/core/completions/command-registry.ts`
- `src/locales/en.json`
- `src/locales/ja.json`
- `src/locales/zh-cn.json`
- `test/core/work-migration.test.ts`
- `test/commands/work.test.ts`
- `test/core/management-api/sessions-api.test.ts`
- `test/core/management-api/sessions-space.test.ts`
- this change's `tasks.md`, `evidence/implementation-gates.md`, and handoff

The completion registry and locale edits are the required presentation
companions for the two new command options; without them the CLI's Commander
structure preflight correctly rejects the command.

## Verification

- Focused suites: PASS, 4 files / 114 tests.
- Build: PASS.
- Lint: PASS.
- Strict change validation: PASS, 1/1.
- Diff check: PASS.
- Explicit `win32` and `posix` identity cases: PASS on the current Windows
  host.

Exact commands and results are recorded in
`evidence/implementation-gates.md`.

## Important preservation notes

- The migration-safety plan/apply engine was not replaced. Scope-before-probe,
  complete-plan blockers, destructive source fingerprints, no-clobber
  publication, bounded cross-device fallback, and fail-closed errors remain
  covered by the 63-test core suite.
- No archive engine/accounting, workflow templates, final documentation, or
  archived historical artifacts were edited by this child.
- The shared worktree also contains sibling changes. Use the file list above
  when reviewing or staging this child.
- No commit, push, ship, archive, or run-state mutation was performed.
- Closure must still run the real Windows/macOS/Linux matrix; this handoff makes
  no native macOS/Linux claim.
