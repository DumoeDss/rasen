## Context

Cherry-pick of `296ecbc` into the rasen fork. This is the batch's highest-risk pick: it restructures the CI job graph and rewrites the shared `runCLI` test helper that every CLI-spawning test depends on. The fork has diverged in three ways that matter here — an extra Nix job + two `required-checks` jobs in `ci.yml`, `XDG_*` isolation already present in `runCLI`, and the telemetry/opener env vars rebranded to `RASEN_*`.

## Goals / Non-Goals

- **Goals:** faithful behavioral parity with upstream flake hardening; PRs run the full cross-platform matrix; `runCLI` never hangs a worker; local Windows flake measurably improves.
- **Non-Goals:** no touch to the Nix job or `flake.nix`; no touch to `src/telemetry`; no change to `vitest.config` (it already reads `VITEST_MAX_WORKERS`).

## Decisions

### Key discovery — `vitest.config` already reads `VITEST_MAX_WORKERS`
The fork's `vitest.config` already has `resolveMaxWorkers()` reading `process.env.VITEST_MAX_WORKERS` and setting `maxWorkers`. So the upstream CI env `VITEST_MAX_WORKERS: ${{ matrix.vitest_workers }}` is already consumed at runtime — no config change needed, and the Windows worker cap is locally reproducible with `VITEST_MAX_WORKERS=2 pnpm test`. This lowers the risk of the ci.yml port: the plumbing exists; C only wires the CI env + matrix legs.

### `test/helpers/run-cli.ts` — manual env merge (the main port)
Upstream replaces the `env: { ...process.env, OPEN_SPEC_INTERACTIVE, ...options.env }` object with `mergeEnv(process.env, { OPENSPEC_TELEMETRY: '0', OPEN_SPEC_INTERACTIVE: '0' }, options.env)`. The fork's `runCLI` env additionally sets `XDG_CONFIG_HOME`/`XDG_DATA_HOME: isolatedConfigHome`. The merged result must be:

```
env: mergeEnv(
  process.env,
  {
    XDG_CONFIG_HOME: isolatedConfigHome,
    XDG_DATA_HOME: isolatedConfigHome,
    RASEN_TELEMETRY: '0',          // upstream OPENSPEC_TELEMETRY -> fork env name
    OPEN_SPEC_INTERACTIVE: '0',
  },
  options.env
),
```

Everything else from the upstream hunk applies as-is: `import { type ChildProcess, spawn }`; `DEFAULT_CLI_TIMEOUT_MS = 30_000`; `activeCliChildren` set; `mergeEnv`, `terminateProcessTree` (Windows `taskkill /pid <pid> /t /f`, else `process.kill(-pid)`), `formatOutputTail`, `terminateActiveCliChildren` exports; `detached: process.platform !== 'win32'`; `activeCliChildren.add(child)` after `unref()`; always-on `setTimeout(..., timeoutMs)` calling `terminateProcessTree`; `clearTimeout` + `activeCliChildren.delete` in the `error`/`close` handlers; and the `if (timedOut) reject(descriptive error)` branch in `close`. The fork's `runCommand` (build helper) is untouched by upstream — leave it.

Rationale for `RASEN_TELEMETRY=0`: `src/telemetry/index.ts` opts out on `RASEN_TELEMETRY === '0'`. Disabling telemetry in spawned CLIs removes the keep-alive-socket exit hang (fork memory "Node fetch hangs CLI exit"), which is exactly what made `cli-e2e` basic time out at 10 s.

### `vitest.setup.ts` — clean
Our teardown is upstream's pre-image verbatim (`setTimeout(process.exit(0), 1000).unref()`), so the hunk (swap import + replace teardown body with `terminateActiveCliChildren()`) applies cleanly.

### `test/helpers/temp-cleanup.ts` — new file, clean add.

### `.github/workflows/ci.yml` — manual port (applied after child B)
On the post-B fork ci.yml, make these edits and no others:
1. **Delete** the `test_pr` job (fork L43-80).
2. `test_matrix` `if:` → `github.event_name == 'pull_request' || github.event_name == 'merge_group' || github.event_name == 'push' || github.event_name == 'workflow_dispatch'`.
3. Add `vitest_workers:` to each matrix leg: ubuntu 4, macos 4, windows 2.
4. In the `Run tests` step add `env:\n  VITEST_MAX_WORKERS: ${{ matrix.vitest_workers }}`.
5. Coverage artifact name `coverage-report-main` → `coverage-report-${{ github.event_name }}`.
6. **Add** the `test_pr_required` job (name `Test`, `needs: [test_matrix]`, `if: always() && (pull_request || merge_group)`, verifies `needs.test_matrix.result == 'success'`). This preserves a required status check literally named `Test` after `test_pr` is removed.
7. `required-checks-pr`: `needs` `test_pr` → `test_matrix`; in its verify step, `needs.test_pr.result` → `needs.test_matrix.result` (message "Matrix test job failed").
8. Leave `required-checks-main` as-is (already `needs: [test_matrix]`), and leave the Nix job byte-identical.

### Test-file adoption — mostly mechanical, two manual resolves
Seven files (`capstone-journeys`, `context`, `doctor`, `legacy-groups-removed`, `store-git`, `store-remote`, `store-root-selection`) get: add `import { cleanupTempPath } from '.../temp-cleanup.js'`, swap `fs.rmSync(x, { recursive: true, force: true })` → `cleanupTempPath(x)`, add per-journey timeout constants (`JOURNEY_TIMEOUT_MS` etc.) and pass them as the 2nd arg to the relevant `it(...)`. Changed lines are brand-neutral → apply cleanly on 3-way.

**Manual resolve #1 — `test/commands/workset.test.ts`:** the first `afterEach` hunk's context line is `delete process.env.OPENSPEC_ENABLE_CLI_AGENT_OPENERS;` upstream but `RASEN_ENABLE_CLI_AGENT_OPENERS` on the fork (L58). Apply the `fs.rmSync(tempDir,...)` → `cleanupTempPath(tempDir)` swap keeping our `RASEN_` line. The other workset swaps (memberA/B/C L472/497/511, L874) are brand-neutral.

**Manual resolve #2 — `test/cli-e2e/store-lifecycle.test.ts`:** the final-test timeout hunk's context includes `Using Rasen root: ${STORE_ID}` and `rasen new change <name> --store` (L451-452, rebranded). Apply the `});` → `}, JOURNEY_TIMEOUT_MS);` change keeping our rebranded assertions. The import add, `JOURNEY_TIMEOUT_MS` const, and `fs.rm(base,...)` → `cleanupTempPath(base)` (L192) are clean.

## Risks / Trade-offs

- **Harness blast radius:** `runCLI` is imported by every CLI e2e/command test; a botched env merge silently breaks config isolation (skill-generation tests would regress). Mitigation: verify the exact merged env block above and run the full suite.
- **CI graph:** a mis-ported `needs`/`if` leaves a required check unsatisfiable. Mitigation: the change is local-only this batch (no push); the workflow is exercised only after the portfolio push, but the job-graph edits are small and enumerated.
- **`detached` on POSIX** enables `process.kill(-pid)` group kill; harmless on this Windows dev machine (the `win32` branch uses `taskkill`).

## Simple vs Complex (for adaptive-verify)

**Complex.** Cross-cutting harness + CI-graph change. Evidence required: `pnpm build`; targeted vitest on all touched test files; **full `pnpm test`** with a note on whether the Windows EBUSY/timeout flake improved (batch convention); optionally `VITEST_MAX_WORKERS=2 pnpm test` to mirror the Windows worker cap.

## Migration / Rollout

Local ship only. CI behavior changes take effect after the portfolio push.

## Open Questions
<!-- none -->
