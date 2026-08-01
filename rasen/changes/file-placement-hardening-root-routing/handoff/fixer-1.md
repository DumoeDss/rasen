# Fixer handoff 1

Date: 2026-07-31

Canonical input:
`evidence/review-report.md` — preserved unchanged.
SHA-256 after the fix pass:
`4313AE3B77686320B3F5D15C905805EC1046B29695525641276A5263205014BC`.

## Outcome

All three review findings are resolved.

## Finding 1 — incomplete plans were silent successful previews

Resolution:

- JSON reports now include an additive `blockers` array with typed `phase`,
  `operation`, `path`, optional `code`, and `message` fields.
- Human previews now print a `Planning blockers:` section containing the
  operation, affected path, code, and message.
- Preview-only invocations remain usable: JSON without `--yes` and human
  preview/dry-run report blockers without attempting mutation.
- A non-dry-run `--yes` invocation against an incomplete plan now returns the
  diagnostic `work_migrate_plan_incomplete`, sets a non-zero exit status, and
  never calls `applyWorkMigration`.
- The JSON failure retains the full preview plus blockers and adds the normal
  `status` diagnostic rather than replacing the report with an empty failure
  envelope.

Regression evidence:

- `JSON previews surface typed blockers and --yes fails without applying`
  injects `EACCES`, asserts `readdir`, exact path, code, exit behavior, and
  unchanged source bytes.
- `human --yes prints blocker operation, path, and code then fails closed`
  injects `EPERM`, asserts the human projection, non-zero exit, no apply call,
  and unchanged source bytes.

## Finding 2 — empty JSON apply changed `executed` meaning

Resolution:

- Execution intent is now `!dryRun && yes`, independent of action count.
- A complete empty `--json --yes` plan is passed unchanged to the safe no-op
  apply engine and reports `executed: true`.
- Interactive empty plans retain their presentation-only early return.
- The unregistered/no-home `--json --yes` case also reports
  `executed: true` while preserving the no-mint guarantee.

Regression evidence:

- The second-run idempotence test now asserts both zero candidates and
  `executed: true`.
- The no-home test asserts `executed: true`, unchanged `config.yaml`, and no
  machine project registry creation.

## Finding 3 — exact-plan test bypassed command confirmation

Resolution:

- Added the narrow `WorkMigrateCommandDependencies` runtime seam for the real
  root resolver, planner, apply engine, and confirmation prompt.
- `registerWorkCommand` accepts that optional seam and production continues to
  use the real dependencies by default.
- The new regression constructs a real Commander program, registers the actual
  `work migrate` action, and parses the interactive command in-process.
- Its wrapped real planner captures the plan that is projected as the preview.
  The confirmation callback verifies the preview was printed, then mutates cwd,
  replaces the fingerprinted source, and adds a later candidate. The wrapped
  real apply engine receives the exact same plan reference.
- Apply reports `ESTALE`, preserves the replacement and later candidate, and
  creates nothing under the post-preview cwd.

Regression:

- `the registered command confirms and applies the exact previewed plan after drift`

## Exact verification

- `npx vitest run test/commands/work.test.ts test/core/work-migration.test.ts test/core/management-api/sessions-api.test.ts test/core/management-api/sessions-space.test.ts`
  - PASS: 4 files, 117 tests.
- `npm run build`
  - PASS.
- `npm run lint`
  - PASS.
- `node dist/cli/index.js validate file-placement-hardening-root-routing --type change --strict --json`
  - PASS: 1 item passed, 0 failed, no issues.
- `git diff --check`
  - PASS: no whitespace errors; only expected Windows LF-to-CRLF notices.

The initial parallel build/validate invocation raced while `dist` was being
cleaned. The required gates were rerun serially in the order above and all
passed.

## Scope and preservation

- Production edits for this fix round are limited to
  `src/commands/work.ts`.
- Focused regression edits are limited to `test/commands/work.test.ts`.
- The canonical review report was not edited or softened.
- No archive-owned file, run-state, workflow template, or final documentation
  was changed.
- No commit, push, ship, archive, or run-state mutation was performed.

## Final-tree completion integration correction

The combined final tree exposed one stale root-owned completion expectation
after `work migrate` intentionally gained the paired `--store` and `--project`
selectors.

Correction:

- Added `work migrate` to the sorted selector-bearing lifecycle inventory in
  `test/core/completions/command-registry.test.ts`.
- Added it to the specialized-selector exception for the shared generated
  workflow guidance check. The shared paragraph enumerates general workflow
  follow-up commands; the one-shot migration command retains its direct CLI
  selector/help coverage and remains subject to the paired-selector assertion.
- No production source, archive implementation, archive review report, task,
  or run-state file was changed for this integration correction.

Final integration evidence:

- `pnpm exec vitest run test/core/completions/command-registry.test.ts`
  - PASS: 1 file, 7 tests.
- `pnpm exec vitest run test/commands/work.test.ts test/core/work-migration.test.ts test/core/management-api/sessions-api.test.ts test/core/management-api/sessions-space.test.ts`
  - PASS: 4 files, 117 tests.
- `pnpm lint`
  - PASS.
- `pnpm build`
  - PASS.
- `git diff --check`
  - PASS: no whitespace errors; only expected Windows LF-to-CRLF notices.

No commit, push, ship, archive, or run-state mutation was performed.
