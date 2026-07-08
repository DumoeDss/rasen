## Why

Upstream `296ecbc` (Fix Windows CI flake hardening, #1325) directly targets the EBUSY/timeout flake we hit on this very machine: Windows CLI-spawning tests intermittently hang or fail to clean their temp dirs. The fix has three prongs — (1) a real cross-platform CI test matrix that runs on PRs (not just `push`) with bounded vitest workers per OS, (2) a hardened `runCLI` helper that always applies a timeout, kills the whole process tree (via `taskkill /t /f` on Windows), disables telemetry in spawned CLIs, and reports a useful timeout error, and (3) a retrying temp-dir cleanup helper (`cleanupTempPath`) used across the CLI e2e/command tests. Carrying this pick is the concrete remediation for the "Windows test flakiness" and "Node fetch hangs CLI exit" issues recorded in fork memory.

## What Changes

- **CI matrix (`.github/workflows/ci.yml`).** Delete the Ubuntu-only `test_pr` job; broaden `test_matrix` to also run on `pull_request`/`merge_group`; add a `vitest_workers` value per matrix leg (linux 4, macos 4, windows 2) and export it as `VITEST_MAX_WORKERS` on the test step (the fork's `vitest.config` already reads this env — see design); rename the coverage artifact to `coverage-report-${{ github.event_name }}`; add a lightweight `test_pr_required` gate job named `Test`; repoint `required-checks-pr` from `test_pr` to `test_matrix`.
- **`runCLI` helper (`test/helpers/run-cli.ts`).** Add process-tree termination, an always-on default timeout (30 s), a `mergeEnv` helper (Windows case-insensitive env de-dupe), telemetry disabling in the spawned CLI, `detached` on non-Windows, an active-children registry with `terminateActiveCliChildren()`, and a descriptive timeout error with stdout/stderr tails.
- **Global teardown (`vitest.setup.ts`).** Replace the `setTimeout(process.exit)` hack with `terminateActiveCliChildren()`.
- **New helper (`test/helpers/temp-cleanup.ts`).** `cleanupTempPath()` = `fs.rmSync(..., { recursive, force, maxRetries: 5, retryDelay: 100 })`.
- **Test-file adoption (9 files).** Swap `fs.rmSync(..., { recursive: true, force: true })` for `cleanupTempPath(...)` and add per-journey timeout constants in the CLI e2e and command tests.

## Fork adaptations vs upstream

- **`run-cli.ts` env merge is a manual port.** The fork's `runCLI` already injects `XDG_CONFIG_HOME`/`XDG_DATA_HOME` isolation that upstream lacks. The upstream hunk that rewrites the `env` object must be merged by hand to preserve that isolation, and the upstream `OPENSPEC_TELEMETRY: '0'` must be rebranded to the fork's env name **`RASEN_TELEMETRY: '0'`** (verified: `src/telemetry/index.ts` opts out on `RASEN_TELEMETRY === '0'`).
- **`ci.yml` is a manual port** against the fork's diverged workflow (extra Nix job, two `required-checks` jobs, rasen rename). Applied on top of child B's `version: 9` removal.
- **Two test files conflict on rebranded context lines:** `workset.test.ts` (`RASEN_ENABLE_CLI_AGENT_OPENERS`, not `OPENSPEC_`) and `store-lifecycle.test.ts` (`Using Rasen root` / `rasen new change`). The *changed* lines are brand-neutral; only the surrounding context diverged — resolve by hand.

## Capabilities

### New Capabilities
- `ci-test-harness`: cross-platform CI test matrix on PRs with bounded per-OS vitest workers, and a hardened CLI-spawn test harness (always-timeout, process-tree kill, telemetry-off, retrying temp cleanup).

### Modified Capabilities
<!-- none -->

## Impact

- **Files:** `.github/workflows/ci.yml`, `vitest.setup.ts`, `test/helpers/run-cli.ts`, `test/helpers/temp-cleanup.ts` (new), and 9 test files (`test/cli-e2e/{capstone-journeys,store-lifecycle}.test.ts`, `test/commands/{context,doctor,legacy-groups-removed,store-git,store-remote,store-root-selection,workset}.test.ts`).
- **Serial edges:** depends on child B (shared `ci.yml`); child D (store-fix) depends on this change (shared `store-git.test.ts` / `store-root-selection.test.ts` — D's diffs are cut against the post-`296ecbc` blobs that add the `cleanupTempPath` import).
- **Verification:** `pnpm build`; targeted vitest on the touched test files; then a **full `pnpm test`** run to observe whether the local Windows EBUSY/timeout flake actually improves (record in ship-log as evidence per the batch convention). `vitest.config` already reads `VITEST_MAX_WORKERS`, so a local `VITEST_MAX_WORKERS=2 pnpm test` reproduces the Windows CI worker cap.
- **Constraint:** do not touch the Nix job in `ci.yml`; do not touch `src/telemetry`.
- **Delivery:** local ship (commit only, pathspec-scoped); no push, no tag.

## Simple vs Complex

**Complex** — cross-cutting test-harness change (every CLI-spawning test depends on `runCLI`) plus a hand-ported CI job graph. Adaptive-verify must run the full suite, not just the touched files, and capture the flake-improvement observation.
