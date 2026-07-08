## 1. New + clean-apply helpers

- [x] 1.1 Add `test/helpers/temp-cleanup.ts` — `cleanupTempPath(target)` doing `fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })` with an undefined-guard. New file, clean add.
- [x] 1.2 `vitest.setup.ts` — swap import to `{ ensureCliBuilt, terminateActiveCliChildren }` and replace the `setTimeout(process.exit(0))` teardown body with `terminateActiveCliChildren();`. Pre-image matches verbatim; clean.

## 2. Port test/helpers/run-cli.ts (manual env merge)

- [x] 2.1 Change the import to `import { type ChildProcess, spawn } from 'child_process';`.
- [x] 2.2 Add `DEFAULT_CLI_TIMEOUT_MS = 30_000`, `const activeCliChildren = new Set<ChildProcess>()`, and the helpers `mergeEnv`, `terminateProcessTree` (win32 → `taskkill /pid <pid> /t /f`, else `process.kill(-pid, 'SIGKILL')`), `formatOutputTail`, and exported `terminateActiveCliChildren` — copied from upstream.
- [x] 2.3 In `runCLI`, replace the `env: { ... }` object with `mergeEnv(process.env, { XDG_CONFIG_HOME: isolatedConfigHome, XDG_DATA_HOME: isolatedConfigHome, RASEN_TELEMETRY: '0', OPEN_SPEC_INTERACTIVE: '0' }, options.env)`. **Preserve the fork's XDG isolation; rebrand upstream `OPENSPEC_TELEMETRY` → `RASEN_TELEMETRY`.**
- [x] 2.4 Add `detached: process.platform !== 'win32'` to the spawn options; after `child.unref()` add `activeCliChildren.add(child)`.
- [x] 2.5 Replace the conditional `options.timeoutMs ? setTimeout(...)` with the always-on `const timeout = setTimeout(() => { timedOut = true; terminateProcessTree(child); }, timeoutMs)` using `const timeoutMs = options.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS`.
- [x] 2.6 In the `error` and `close` handlers, change `if (timeout) clearTimeout(timeout)` → `clearTimeout(timeout)` and add `activeCliChildren.delete(child)`. In `close`, add the `if (timedOut) { reject(new Error([...invocation, stderr tail, stdout tail].filter(Boolean).join('\n\n'))); return; }` branch before `resolve(...)`.
- [x] 2.7 Leave `runCommand` (the build helper) untouched.

## 3. Port .github/workflows/ci.yml (manual, applied AFTER child B)

- [x] 3.1 Delete the `test_pr` job.
- [x] 3.2 Broaden `test_matrix` `if:` to include `pull_request || merge_group || push || workflow_dispatch`.
- [x] 3.3 Add `vitest_workers:` per matrix leg — ubuntu 4, macos 4, windows 2.
- [x] 3.4 Add `env:\n  VITEST_MAX_WORKERS: ${{ matrix.vitest_workers }}` to the `Run tests` step.
- [x] 3.5 Rename the coverage artifact `coverage-report-main` → `coverage-report-${{ github.event_name }}`.
- [x] 3.6 Add the `test_pr_required` job (name `Test`, `needs: [test_matrix]`, PR/merge_group gate verifying `needs.test_matrix.result == 'success'`).
- [x] 3.7 `required-checks-pr`: `needs` `test_pr` → `test_matrix`, and its verify step `needs.test_pr.result` → `needs.test_matrix.result`. Leave `required-checks-main` and the Nix job untouched.

## 4. Adopt cleanupTempPath in the 9 test files

- [x] 4.1 Clean-apply (brand-neutral swaps + timeout consts): `test/cli-e2e/capstone-journeys.test.ts`, `test/commands/context.test.ts`, `test/commands/doctor.test.ts`, `test/commands/legacy-groups-removed.test.ts`, `test/commands/store-git.test.ts`, `test/commands/store-remote.test.ts`, `test/commands/store-root-selection.test.ts`. Add the `cleanupTempPath` import, swap `fs.rmSync(x, { recursive: true, force: true })` → `cleanupTempPath(x)`, add the per-file timeout constant and pass it as the 2nd `it(...)` arg where upstream does.
- [x] 4.2 **Manual resolve** `test/commands/workset.test.ts`: apply all `fs.rmSync → cleanupTempPath` swaps (afterEach L59, memberA/B/C L472/497/511, L874) + import, keeping the fork's `RASEN_ENABLE_CLI_AGENT_OPENERS` context line.
- [x] 4.3 **Manual resolve** `test/cli-e2e/store-lifecycle.test.ts`: apply import, `JOURNEY_TIMEOUT_MS`/`GIT_JOURNEY_TIMEOUT_MS` consts, `fs.rm(base) → cleanupTempPath(base)`, and the `it(...)` timeout args, keeping the fork's `Using Rasen root` / `rasen new change` assertions.

## 5. Verify (complex — full suite + flake observation)

- [x] 5.1 `pnpm build`.
- [x] 5.2 Targeted: `pnpm vitest run test/cli-e2e/capstone-journeys.test.ts test/cli-e2e/store-lifecycle.test.ts test/commands/context.test.ts test/commands/doctor.test.ts test/commands/legacy-groups-removed.test.ts test/commands/store-git.test.ts test/commands/store-remote.test.ts test/commands/store-root-selection.test.ts test/commands/workset.test.ts` — all green.
- [x] 5.3 Full `pnpm test`; record in ship-log whether the Windows EBUSY/timeout flake improved (batch convention). Optionally `VITEST_MAX_WORKERS=2 pnpm test` to mirror the Windows CI worker cap.
- [x] 5.4 `node bin/rasen.js validate upstream-cherrypick-batch1-win-flake` — change delta valid.
- [x] 5.5 Confirm the touch-set is exactly the listed files; the Nix job in `ci.yml` and `src/telemetry` are untouched; `vitest.config` was not modified.
