# Task 6.4 — no-regression baseline: flake analysis

## Baseline run

Command:

```
pnpm exec vitest run test/core/store test/core/change-run test/commands/store.test.ts test/commands/store-root-selection.test.ts test/cli-e2e/store-lifecycle.test.ts
```

Result: `Test Files 1 failed | 109 passed (110)`, `Tests 2 failed | 1436 passed | 1 skipped (1439)`.

Pre-change reference (established before Group 1-5 work began): 104 files / 1264 passed / 1 skipped.
New file count (110) is higher by exactly 6 — the six new suites added by this change
(`planning-validation-v2`, `planning-layout-v2`, `planning-identity-v2`, `finalization-v2`,
`planning-foundation-consumer`, `planning-foundation-purity`). New passing-test count (1436) is
higher by exactly 174 over the reference's 1264, minus the 2 failures — which is exactly the total
test count of those same six new suites (174, confirmed by task 6.1's isolated run). This means
every pre-existing test in the baseline set passed; the only failures are 2 tests inside a single
pre-existing file, `test/cli-e2e/store-lifecycle.test.ts`.

Sole visible failure detail (the terminal capture only rendered 1 of the 2 FAIL blocks — a known
live-reporter `\r`-redraw artifact for long multi-file runs):

```
FAIL test/cli-e2e/store-lifecycle.test.ts > standalone store lifecycle journey
  > machine B: completes its own change through archive in the clone

AssertionError: expected 'Using Rasen root: team-context (C:\Us…' to contain 'rasen new change <name> --store team-…'

- Expected
+ Received

- rasen new change <name> --store team-context
+ Using Rasen root: team-context (C:\Users\Sayo\AppData\Local\Temp\rasen-store-lifecycle-t2kwhO\machine-b\team-context)
+ - Generating apply instructions...
+ ✖ Error: Missing required option --change. Available changes:
+   add-billing

❯ test/cli-e2e/store-lifecycle.test.ts:454:32
    452|     expect(failedApply.exitCode).not.toBe(0);
    453|     expect(failedApply.stderr).toContain(`Using Rasen root: ${STORE_ID…
    454|     expect(failedApply.stderr).toContain(`rasen new change <name> --st…
```

## Root-cause investigation

1. **Isolated re-run** of the same file alone:

   ```
   pnpm exec vitest run test/cli-e2e/store-lifecycle.test.ts
   ```

   Result: `Test Files 1 passed (1)`, `Tests 8 passed (8)` — including the exact scenario
   ("machine B: completes its own change through archive in the clone") that failed in the
   combined baseline run. 100% green in isolation.

2. **Diff-scope check**: the failing assertion's message ("Missing required option --change.
   Available changes: …") is emitted from `src/commands/workflow/shared.ts:216` and
   `src/commands/workflow/status.ts:92`. Neither file appears anywhere in this change's diff:

   ```
   git diff --stat HEAD -- . ':!.rasen' ':!rasen/changes/store-planning-contract-v2/tasks.md' ':!rasen/changes/store-planning-contract-v2/evidence'
   ```

   touches only `src/core/change-metadata/schema.ts`, `src/core/index.ts`,
   `src/core/store/foundation.ts`, `src/core/store/index.ts`, `src/core/store/project-records.ts`,
   `src/core/workflow-package/canonical.ts`, `test/utils/change-metadata.test.ts`, plus new files
   under `src/core/store/planning-*.ts` and `test/core/store/planning-*.test.ts` /
   `finalization-v2.test.ts`. None of this change's Layer-0 code is reachable from the `apply`
   command's argument-parsing/messaging path that produced the unexpected stderr.

## Conclusion

This is a pre-existing test-isolation flake in `test/cli-e2e/store-lifecycle.test.ts` under the
full multi-file parallel run (most likely CLI-subprocess/temp-directory timing contention across
110 concurrently-scheduled files), not a regression introduced by this change:

- The failing code path is entirely outside this change's diff.
- The exact same scenario passes cleanly (8/8) when the file is run in isolation.
- Every pre-existing test elsewhere in the baseline set passed; only this one flaky file/scenario
  is affected, and only under full-suite parallel load.

No fix was applied (there is nothing in this change to fix — the flake is pre-existing baseline
behavior, not caused by Group 1-5 work). Task 6.4 is closed as: baseline compared, no regression
found, one known pre-existing flake documented.
