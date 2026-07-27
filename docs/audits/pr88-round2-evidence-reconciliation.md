# PR #88 Round-2 Evidence Reconciliation

Shared evidence artifact for the `pr88-af-*` round-2 fix children. Each child appends its findings.

---

## M6 — Test Stability Investigation (pr88-af-ci-required-gate)

**Scope:** partial investigation of the root test suite instability reported in the PR #88 acceptance review (M6). The review named three symptoms: CLI subprocess non-exit, Windows EPERM teardown cascade, and 10s test timeouts, observed at scale (4-worker ~95 failures).

### What was fixed (determinable, locally verifiable)

Three known-flaky CLI-spawning test files used bare `fs.rm(dir, { recursive: true, force: true })` in their `afterEach`/`afterAll` teardown — no EPERM retry. On Windows, a just-exited CLI subprocess can leave file handles locked for a few hundred milliseconds; the bare `fs.rm` hits EPERM immediately and fails, causing the teardown to error out. In a multi-worker vitest run this cascades: the failed teardown leaves temp directories that interfere with subsequent test isolation.

**Fix:** switched all three files to the existing `cleanupTempPathAsync` helper (`test/helpers/temp-cleanup.ts`), which retries on EPERM/EBUSY/ENOTEMPTY with `maxRetries: 15, retryDelay: 200ms` (bounded — a genuinely stuck handle surfaces as a thrown error, not an infinite hang).

| File | Changed site | Was | Now |
|---|---|---|---|
| `test/cli-e2e/basic.test.ts` | `afterAll` (temp dir cleanup) | `fs.rm(dir, { recursive: true, force: true })` | `cleanupTempPathAsync(dir)` |
| `test/commands/validate.test.ts` | `afterEach` ×2 + inline `finally` | `fs.rm(testDir/isoRoot, { recursive: true, force: true })` | `cleanupTempPathAsync(testDir/isoRoot)` |
| `test/commands/validate.enriched-output.test.ts` | `afterEach` | `fs.rm(testDir, { recursive: true, force: true })` | `cleanupTempPathAsync(testDir)` |

**No subprocess leak was found.** The shared CLI helper (`test/helpers/run-cli.ts`) already has robust child tracking (`activeCliChildren` set), `terminateProcessTree()` with platform-specific kill (`taskkill /t /f` on Windows), `child.unref()`, stream destruction on both `close` and `error`, and a timeout-kill fallback. All direct-spawn test files (`daemon-lifecycle.test.ts`, `ui-launch-stale-replace.test.ts`, `kill-tree.test.ts`, `threshold-schemes-api.test.ts`, `file-state.test.ts`) already have proper `afterEach` child cleanup and use `cleanupTempPathAsync` for temp dirs.

### What remains known-open

1. **Suite-wide stability at 4-worker scale** — the three file-level fixes address the most common EPERM teardown cascade sites, but the full suite has ~48 files using `fs.rmSync` in teardown. 34 of those already use the `cleanupTempPath`/`cleanupTempPathAsync` helper. The remaining bare-`fs.rmSync` sites are in non-CLI-spawning tests (lower EPERM risk) and were not changed to keep the diff minimal and focused on the known-flaky pattern.

2. **CLI subprocess non-exit (native fetch keep-alive)** — this root cause was already identified and fixed in a prior change (`node-fetch-hangs-cli-exit`): the telemetry fire-and-forget path was changed from native `fetch` (undici keep-alive socket) to `node:https` with `agent: false` + guard timer. The fix is in the codebase. No further action on this front.

3. **`daemon-lifecycle.test.ts` local `runCli` has no timeout** — the file's local `runCli()` helper (not the shared `runCLI`) spawns a CLI child and waits for `close` without a timeout or kill fallback. If a daemon command hangs, the test hangs. This is a narrow integration-test concern (the commands it invokes — `daemon start/stop/status` — are designed to exit quickly) and was not changed to avoid altering test semantics. Flagged for future hardening.

### Per-file duration guidance

Known-slow tests that consistently approach or exceed the default 10s vitest timeout:

| File | Test | Timeout | Guidance |
|---|---|---|---|
| `test/cli-e2e/basic.test.ts` | "shows Simplified Chinese pipeline help..." | 20s (explicit) | Spawns 12+ CLI subprocesses sequentially for per-subcommand help. Keep the explicit `20_000` override. |
| `test/cli-e2e/basic.test.ts` | "initializes with --tools all option" | 25s (explicit) | Runs `rasen init --tools all` which writes many skill files. Keep the explicit `25_000` override. |
| `test/cli-e2e/basic.test.ts` | "uses the language persisted..." | default 10s | Runs 5 CLI invocations sequentially. Approaches but does not consistently exceed 10s. Monitor. |
| `test/commands/daemon-lifecycle.test.ts` | all tests | default 10s | Spawns real daemon + HTTP probe loops. Could approach 10s on slow CI. Consider explicit timeout if flaky. |

### Frontier — NOT claimed by this change

- **"3 consecutive green on real Windows CI"** — this sign-off requires actual GitHub Actions CI runs on `windows-latest`, which this session cannot perform. The trigger fix (M7) and the EPERM-retry fixes (M6) are necessary conditions, but proving the suite is stable at scale requires CI evidence. Flagged as frontier for the maintainer to verify after merging.
