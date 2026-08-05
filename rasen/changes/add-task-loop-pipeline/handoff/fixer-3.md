# FIXER round 1 handoff (relay 3)

## Why this handoff exists

The FIXER context compacted while the deterministic full-suite matrix was still in progress. Per the review-cycle handoff rule, the remaining shards and final evidence must continue in a fresh FIXER context. This relay did not self-review or certify the change.

## Scope and constraints

- Change: `add-task-loop-pipeline`
- Review findings in scope: F1-F9 from `evidence/review-report.md`
- Do not self-review/certify, commit, ship, or archive.
- Do not edit `.rasen/.../auto-run.json` or `evidence/review-report.md`.
- Preserve unrelated user work, especially `rasen/config.yaml`, `.rasen/`, `rasen/changes/add-thing/`, `rasen/changes/ecp-v2-default-authoring-and-builtins/`, and `rasen/specs/billing/`.
- Use `apply_patch` for edits.

## Repairs made in this relay

### Internal Task Loop leaked into profile selection

The new `task-loop` dependency-only built-in was present in profile checkbox choices, current built-in baselines, and named-profile normalization. This caused 17 failures in `test/commands/profile.test.ts` because the internal workflow has no selectable display metadata.

An initial generic `definition.kind !== 'internal'` approach was rejected because `goal-plan`, `goal-iterate`, and `goal-report` are intentionally profile-selectable despite their internal kind. The final repair adds and exports `isInternalBuiltInWorkflowId()` and filters only the explicit dependency-only IDs (`retain-command` and `task-loop`).

Files changed:

- `src/core/workflow-registry/builtins.ts`
- `src/core/workflow-registry/index.ts`
- `src/commands/profile-editor.ts`
- `src/core/profiles.ts`
- `src/core/named-profiles.ts`

Verification:

- `pnpm exec vitest run test/commands/profile.test.ts test/core/profiles.test.ts --maxWorkers=1 --minWorkers=1 --no-file-parallelism --maxConcurrency=1 --reporter=dot --silent=passed-only --hideSkippedTests`
- Result: 2 files passed, 88 tests passed.
- Formal shard `3/32` then passed: 14 files, 358 passed, 7 skipped.

### Task Loop legacy-engine refusal happened after launch-input reading

Formal shard `7/32` exposed that a Task Loop invocation explicitly selecting the legacy engine tried to resolve/read its hidden input file before issuing the required `task_loop_reconciler_required` refusal. This violated the reconciler-only, refuse-before-work requirement and made the policy test fail with a safe-path diagnostic instead.

`src/commands/pipeline.ts` now resolves the engine policy and refuses legacy execution after validating that the hidden input option is Task-Loop-only, but before resolving state-file locations or reading/decoding the launch input. Generic non-Task-Loop input rejection remains first.

Verification:

- `pnpm run build`: passed after this repair (24.4s).
- `pnpm exec vitest run test/core/change-run/engine-selection-policy.test.ts -t "refuses task-loop legacy execution" --maxWorkers=1 --minWorkers=1 --no-file-parallelism --maxConcurrency=1 --reporter=dot --silent=passed-only --hideSkippedTests`: 1 passed, 9 skipped.
- Formal shard `7/32` rerun passed: 14 files, 151 tests passed (53.03s).

## Other verification completed in this relay

- `pnpm run build`: passed before matrix work (35.1s) and again after the final pipeline ordering repair (24.4s).
- `pnpm run lint`: passed after the final repair (41.5s), with only the pre-existing unused eslint-disable warning at `test/core/change-run/facade-settle-completeness.test.ts:139`.
- Focused Task Loop/runtime suite:
  - `pnpm exec vitest run test/core/change-run/task-loop.test.ts test/core/change-run/facade-runtime.test.ts test/core/change-run/goal-cycle.test.ts test/commands/pipeline-start-input.test.ts --reporter=dot --maxWorkers=1 --minWorkers=1 --no-file-parallelism`
  - 4 files passed, 69 tests passed (20.89s).
- Windows CLI E2E:
  - `pnpm exec vitest run test/commands/pipeline-bugfix-e2e.test.ts -t "drives a spec-free Task Loop" --reporter=dot --maxWorkers=1 --minWorkers=1 --no-file-parallelism`
  - 1 selected test passed, 2 skipped (95.15s).
- Same-name built-in shadowing:
  - `pnpm exec vitest run test/commands/pipeline.test.ts -t "refuses a same-name" --reporter=dot --maxWorkers=1 --minWorkers=1 --no-file-parallelism`
  - 2 selected tests passed, 100 skipped (18.19s).
- `git diff --check`: exit 0; only repository line-ending warnings were printed.
- No root-level `test-*` or `*-tmp` directories were found after the runs.

## Deterministic full-suite matrix

Vitest reports 423 test files. The formal matrix is 32 sequential hash shards with one worker and no file parallelism:

```text
pnpm exec vitest run --shard=N/32 --maxWorkers=1 --minWorkers=1 --no-file-parallelism --maxConcurrency=1 --reporter=dot --silent=passed-only --hideSkippedTests
```

On this Windows machine, set `$env:TEMP="$env:SystemRoot\Temp"; $env:TMP="$env:SystemRoot\Temp"` before each remaining shard. The user's `C:\Users\Sayo\AppData\Local\rasen` otherwise makes tests creating temp projects below the default Local temp directory discover an unrelated ancestor Rasen root.

Completed coverage (formal shards 1-7):

| Shard | Files | Passed | Skipped | Disposition |
|---|---:|---:|---:|---|
| 1/32 | 14 | 224 | 3 | Passed |
| 2/32 | 14 | 253 | 0 | Passed |
| 3/32 | 14 | 358 | 7 | Failed initially on profile leakage; repaired and passed |
| 4/32 | 14 | 259 | 0 | Additive timeout as one invocation; all exact members passed in deterministic splits |
| 5/32 | 14 | 160 | 1 | Passed |
| 6/32 | 14 | 170 | 1 | Two failures isolated and classified; equivalent final coverage passed |
| 7/32 | 14 | 151 | 0 | Failed initially on refusal ordering; repaired and passed |

Formal coverage so far: 98 files, 1,575 passing tests, 12 skipped tests, with every observed failure either repaired or conclusively isolated/classified.

Shard 4 split evidence:

- First seven exact member files: 7 files, 60 passed (29.01s).
- `test/commands/artifact-workflow.test.ts`: 89 passed (188.41s).
- `workflow-enablement`, `run-store-fs`, `execution-plan`, `view`, and `record`: 5 files, 35 passed (49.89s).
- `test/core/update.test.ts`: 75 passed (100.18s).
- The combined shard exceeded the command time budget because of additive duration; no member failed.

Shard 6 classifications:

- `test/commands/config-editor.test.ts`: four failures were caused by the default Windows temp path living below the user's real `C:\Users\Sayo\AppData\Local\rasen`. With TEMP/TMP set to `C:\Windows\Temp`, the file passed 19/19. This test/source has no branch diff.
- `test/core/management-api/supervisor-injection.test.ts`: one fixed-800ms exit-state assertion failed once; its isolated rerun passed 11 tests with 1 skipped (10.92s). Classified as a timing transient.

Earlier exploratory evidence, not part of the formal matrix:

- `1/16`: 27 files passed, 436 passed, 3 skipped (265.81s).
- `2/16`: timed out twice without a summary, motivating the 32-shard matrix.

## Remaining required work

1. Continue formal shards `8/32` through `31/32`, sequentially, with system TEMP/TMP and the exact low-concurrency flags above.
2. The Vitest BaseSequencer uses `ceil(423/32) = 14` files per shard, so shard 31 contains the final 3 files and shard 32 is expected to be empty. Run `32/32` with `--passWithNoTests` (or otherwise record the zero-file membership) so the matrix boundary is explicit.
3. For any failed/timed shard, compute its exact SHA-1-sorted membership, split only that membership, isolate every failing file, and fix real branch regressions or record concrete environmental/pre-existing evidence. Do not treat a timeout as a pass.
4. After any additional repair, rerun build, lint, the focused 69-test suite, Windows E2E, and shadowing checks in proportion to affected paths.
5. Write `rasen/changes/add-task-loop-pipeline/evidence/review-fix-round-1.md` with the F1-F9 disposition table, exact commands/final counts, residual limitations, and a final diff-tree fingerprint.
6. Return `DONE` to the LEAD only after the entire matrix and evidence file are complete. Otherwise write the next handoff and return `HANDOFF`.

## Exact shard-membership method for a timed shard

Vitest 3.2.6 hashes each normalized spec path (a leading `/` and forward slashes) with SHA-1, sorts by that hash, and slices by `ceil(fileCount/shardCount)`. `vitest list --shard` does not itself filter the listing in this version, so use the following PowerShell logic and choose the requested `$index`:

```powershell
$files = @(& pnpm exec vitest list --filesOnly) | Where-Object { $_ -match '^test/.+\.test\.ts$' }
$items = foreach ($file in $files) {
  $specPath = '/' + ($file -replace '\\', '/')
  $sha = [System.Security.Cryptography.SHA1]::Create()
  try {
    $hash = ([System.BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($specPath)))).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
  [pscustomobject]@{ File = $file; Hash = $hash }
}
$sorted = @($items | Sort-Object Hash)
$size = [Math]::Ceiling($sorted.Count / 32)
$start = $size * ($index - 1)
$end = [Math]::Min($size * $index, $sorted.Count)
$sorted[$start..($end - 1)]
```

## Dirty-worktree reminder

The workspace remains intentionally dirty with implementation changes and unrelated user work. Do not clean/reset it. `rasen/config.yaml` was observed but not edited by this relay. No commit, ship, archive, LEAD state update, or review-report edit was performed.
