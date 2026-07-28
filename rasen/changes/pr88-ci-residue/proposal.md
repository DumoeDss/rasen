## Why

PR #88's acceptance review (condition #6: "3 consecutive green CI") is blocked by 6 residual test failures across the linux-bash and UI Package Build CI jobs. The failures were invisible before child #8 (M7) wired CI to run on `dev/0.1.5`; they are pre-existing M6 debt (timing, fixture, and contract gaps), not round-2 regressions (verified: 536/0 integration locally, each child review-clean). This change makes CI green by fixing each failure at the correct layer — three are code bugs, three are test/fixture bugs — without reverting any round-2 work or setting `RASEN_AGENT_RUNTIME` globally.

## What Changes

- **Code (3 fixes):**
  - `src/core/management-api/router.ts` — `rejectImport` now sends a graceful FIN (`req.socket.end()`) after the error response flushes, with a 100ms `destroy()` fallback. The old `setTimeout(req.destroy, 10ms)` held the socket for ~3s per incomplete upload (RST raced the client's read); under CI load two sequential `incompleteUpload` calls exceeded the 30s test timeout.
  - `src/core/token-audit/management.ts` — `AuditReportRepository.read()` now wraps ALL thrown errors as `AuditServiceError`. Previously, `readDirectReport`'s `O_NOFOLLOW` open of a symlink threw a raw ELOOP (not `AuditServiceError`) on Linux, and the catch only re-wrapped `AuditServiceError` instances; the test's `expect(...).toThrow(AuditServiceError)` failed on CI (Linux) but was skipped locally on Windows (no Developer Mode → no symlink → assertion guarded by `symlinkCreated`).
  - `src/core/store/bootstrap.ts` — `obtainAbsentStore` now snapshots whether the supplied target existed at the start of the call. When `selectBootstrapLocation` refuses on `existing-checkout` but the target was ABSENT at the snapshot, the loser reports `obtain-failed` (lost a concurrent publish race) instead of `not-acted`. Pre-existing user content (target existed at the snapshot) keeps the `not-acted` contract — the two existing "pre-existing precious content" tests still pass.

- **Test (3 fixes):**
  - `test/commands/pipeline-store-root-selection.test.ts` — the "agents writes a runtime config instance" test now sets `RASEN_AGENT_RUNTIME: 'claude'` in its per-test `env`. The `dispatchMode: 'exec-bridge'` assertion is only correct under a Claude host; on CI (no `CLAUDECODE`/`RASEN_AGENT_RUNTIME` in the env) the host resolves to `unknown` → `legacy-fallback`. The test passed locally only because `runCLI` merges `process.env` (including the developer's `CLAUDECODE`) with the test's `env`.
  - `test/core/store/bootstrap-obtain.test.ts` — the "registers the Store checkout during apply" test now removes the store's registry entry via `updateStoreRegistryState` instead of a line-level regex on the YAML. The regex `.*${store.root}.*` matched only the `local_path:` line on Linux (forward slashes), leaving a malformed entry (no `local_path`) that fails the Zod schema → `readRegistryEntries` returns `failure` → `buildStoreFirstReport` returns a `blocked` report with no `store` field → `report.store?.registered` is `undefined`. On Windows the regex never matched (backslashes), so the entry stayed and the test trivially passed.
  - `packages/ui/test/components/board-page.test.tsx` — the two "New change submission" tests now poll for the post-submit UI state via a `waitFor` helper instead of relying on a fixed `flushMicrotasks(6)`. Under jsdom + CI load, the Preact re-render chain after `handleChangeCreated → setRefreshNonce → useEffect → listChanges → setChanges` needs more than 6 microtask ticks; the component is correct, the test's wait is insufficient.

## Capabilities

### New Capabilities
<!-- None — these are bug/test fixes; no new capability is introduced. -->

### Modified Capabilities
- `store-bootstrap`: the "clone target is chosen by stated priority and never overwrites anything" requirement gains a clause distinguishing a concurrent race loss (target was absent at call start, another process published first) from a refusal to clobber pre-existing user content. The audits-api socket teardown and AuditReportRepository error-wrapping changes are NOT spec'd here — they tighten existing runtime contracts that the failing tests already encode (the tests are the source of truth for those contracts).

## Impact

- Affected code: `src/core/management-api/router.ts` (import rejection teardown), `src/core/token-audit/management.ts` (`AuditReportRepository.read` error normalization), `src/core/store/bootstrap.ts` (`obtainAbsentStore` race-loser action).
- Affected tests: `test/commands/pipeline-store-root-selection.test.ts` (env pinning), `test/core/store/bootstrap-obtain.test.ts` (registry mutation approach), `packages/ui/test/components/board-page.test.tsx` (async wait helper).
- No spec deltas: each behavior change is a tightening that the failing test already encodes (the tests are the source of truth for the contract). No new or modified capabilities.
- Cross-platform: all paths use `path.join()`/`path.resolve()`; no hardcoded slashes; Windows CI (`windows-pwsh`) stays green. The `req.socket.end()` fix is platform-neutral (Node TCP). The `O_NOFOLLOW` + error-wrap fix closes the Linux symlink gap while preserving the Windows `lstat` fallback already in `readDirectReport`. The race-loser snapshot uses `fs.existsSync` (cross-platform).
- Constraints honored: no global `RASEN_AGENT_RUNTIME`; no round-2 revert; the audits-api test already encodes the early-rejection contract (no spec change needed).

## Cross-platform stabilization follow-up

After PR #88 became Linux-green and was merged into `dev/0.1.5`, the same full
suite exposed a second residue class on macOS and Windows:

- canonical paths for existing directories use macOS `/private/var` and Windows
  long-name spellings, while future descendants and several test fixtures kept
  the lexical `/var` or 8.3 short-name spelling;
- three ownership-race tests attempted to unlink and recreate a pathname while
  the original file descriptor remained open, an operation Windows can reject
  with `EPERM` even though the production guard is working as intended.

This follow-up makes future descendants inherit the canonical spelling of their
deepest existing ancestor, canonicalizes path-identity fixtures before deriving
expectations, and expresses ownership mismatch tests through portable seams.
It does not strip platform prefixes or special-case a runner username: the same
identity rule applies to symlinks, junctions, macOS temporary-directory aliases,
and Windows short/long paths.

The Windows run also proved that the 15-minute job ceiling is below the suite's
normal wall time: a local full run took 17 minutes 48 seconds, with time spread
across real CLI subprocess, Git, filesystem, and process-tree integration
tests. The follow-up isolates ambient `CODEX_THREAD_ID`, replaces fixed session
sleeps with bounded event polling, and splits Windows Vitest execution into
three deterministic CI file partitions. This shortens wall time without
weakening coverage; the higher 20-minute partition timeout is only a safety
margin.
