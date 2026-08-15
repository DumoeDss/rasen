# Task 6.4 — no-regression baseline: two unexplained failures

> The filename is retained so the reference from `evidence/review-report.md` keeps resolving. The
> classification it implies is **retracted**: the two failures recorded below were originally called
> a "pre-existing test-isolation flake", and that conclusion is not supported by the evidence in
> hand. See "What is established" and "What is still open".

## Runs

| # | Who / when | Command | Result |
| --- | --- | --- | --- |
| 1 | LEAD, PRE-change baseline for this worktree | the task 6.4 command below | 104 files / **1264 passed / 0 failed** / 1 skipped |
| 2 | Implementer, post-change (commit `eaefc01b`) | the same command | 110 files / 1436 passed / **2 failed** / 1 skipped |
| 3 | Reviewer, independent re-run on the **same commit** `eaefc01b` | the same command | 110 files / **1438 passed / 0 failed** / 1 skipped |

```
pnpm exec vitest run test/core/store test/core/change-run test/commands/store.test.ts test/commands/store-root-selection.test.ts test/cli-e2e/store-lifecycle.test.ts
```

Run 2 and run 3 executed the same test set: 1436 passed + 2 failed = 1438 = run 3's passed count, with
the same single skip in both.

The file count rose from 104 to 110 by exactly the six suites this change adds
(`planning-validation-v2`, `planning-layout-v2`, `planning-identity-v2`, `finalization-v2`,
`planning-foundation-consumer`, `planning-foundation-purity`), and the non-skipped test count rose by
exactly their 174 tests (1264 + 174 = 1438), confirmed against task 6.1's isolated run. So the two
failures in run 2 were **pre-existing tests**, not new ones — every other pre-existing test in the
run passed.

## The one failure that was read

Run 2's terminal capture rendered only 1 of the 2 FAIL blocks (a live-reporter `\r`-redraw artifact
on long multi-file runs). **The second FAIL block was never read.**

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

## Observations that do not settle it

1. **Isolated re-run** of `test/cli-e2e/store-lifecycle.test.ts` alone: `Test Files 1 passed (1)`,
   `Tests 8 passed (8)` — including the exact scenario that failed. This shows the failure is not
   deterministic in isolation. It does not identify a cause.

2. **Diff-scope check.** The stderr line that failed the assertion is emitted from
   `src/commands/workflow/shared.ts:216` and `src/commands/workflow/status.ts:92`, neither of which
   is in this change's diff:

   ```
   git diff --stat HEAD -- . ':!.rasen' ':!rasen/changes/store-planning-contract-v2/tasks.md' ':!rasen/changes/store-planning-contract-v2/evidence'
   ```

   touches only `src/core/change-metadata/schema.ts`, `src/core/index.ts`,
   `src/core/store/foundation.ts`, `src/core/store/index.ts`, `src/core/store/project-records.ts`,
   `src/core/workflow-package/canonical.ts`, `test/utils/change-metadata.test.ts`, plus the new files
   under `src/core/store/planning-*.ts` and the new suites. This addresses the **print site** of the
   symptom, not the causal chain that produced the wrong state — and the diff does touch
   `src/core/index.ts`, a barrel on the package's public surface.

## The causal lead, recorded so it is not lost

The reviewer read the failing path and found the assertion's own scenario does not match its stderr.
The failing assertion is at `store-lifecycle.test.ts:454`, inside the machine-B scenario, whose own
change is `add-invoicing` — but the observed stderr lists **`add-billing`** as an available change.
`add-billing` is *machine A's* change, archived at `store-lifecycle.test.ts:325-331`, and machine B
clones the store only afterwards at `:349-353`. The observed state is therefore what you would see if
machine A's archive step had failed first and cascaded — i.e. if the unread second failure were the
causal one, and the read failure merely its downstream symptom.

This is a lead, not a finding. It has not been reproduced or confirmed.

## What is established

- Run 1 (PRE-change, same file set) had **zero** failures, so "pre-existing" is contradicted by the
  baseline this task was measured against.
- Run 3 re-ran the same command on the same commit and had **zero** failures.
- The failure is therefore **transient and did not reproduce**.
- The 2 failures were in pre-existing tests inside one pre-existing file
  (`test/cli-e2e/store-lifecycle.test.ts`); no new suite failed.

## What is still open

- **The cause is not established.** "Pre-existing", "test-isolation", and "parallel-load contention"
  were asserted, not shown; none of them is supported by the three runs above.
- **One of the two failures was never read.** Every causal statement made from run 2 rests on the
  other one, and the lead above points at the unread failure as the more likely origin.
- Closing this properly needs a reproduction with `--reporter=verbose --no-color` redirected to a
  file, so BOTH failures are enumerated before anything is classified.

Task 6.4's own deliverable — run the baseline set, compare against the pre-change reference, report
the counts — is complete: no reproducible regression was found across two independent full runs of
the same command on the same commit. The unexplained transient above is carried as an open item, not
closed as a flake.
