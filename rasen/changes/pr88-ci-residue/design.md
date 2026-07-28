## Context

PR #88's acceptance review set condition #6 ("3 consecutive green CI"). Child #8 (M7) wired CI to run on `dev/0.1.5` for the first time, exposing 6 pre-existing failures across the linux-bash job (4 test files, 5 tests) and the UI Package Build job (1 file, 2 tests). Round-2 fixes are verified correct (536/0 integration, each child review-clean) — none of these 6 is a round-2 regression.

The failures are heterogeneous: each has its own root cause and the fix lives at a different layer. The core planning question — "fix the TEST or fix the CODE?" — was answered per failure by reading the source, reproducing locally where possible, and reasoning statically where CI-only parallel-load reproduction was impractical. This document records the verdict and the exact fix approach for each, so the implementer can move quickly and the reviewer can verify the diagnosis without re-deriving it.

Local reproduction notes (carried into tasks):
- Failures 1 (codex dispatchMode), 2 (audits-api socket), and 5 (AuditServiceError) reproduce in isolated single-file runs on the right platform. #1 and #5 PASS locally on Windows because the dev shell sets `CLAUDECODE=1` (host=claude → exec-bridge) and Windows can't create file symlinks without Developer Mode (symlink assertion skipped). Both FAIL on Linux CI.
- Failure 2 reproduces locally on Windows: the test takes ~6s (3s per `incompleteUpload`) and times out at 30s on CI. The fix was verified locally (test dropped to ~130ms, 3 stable runs).
- Failures 3 (bootstrap registration) and 4 (B3 race loser) pass locally even under `--pool=forks --poolOptions.forks.maxForks=4`. They fail only under CI's specific scheduling. #3 was diagnosed statically (registry YAML corruption from a regex that matches on Linux but not Windows). #4 was diagnosed statically (race window where the loser's `selectBootstrapLocation` sees the winner's published checkout).
- Failure 6 (UI post-submit) is in `packages/ui` which has no `node_modules` in this worktree (not installed). The component was read statically; the fix is a test-only async-wait improvement.

## Goals / Non-Goals

**Goals:**
- Make all 6 CI failures pass reliably on linux-bash, windows-pwsh, and the UI Package Build jobs.
- Fix each failure at the correct layer (test vs. code) with the smallest change that preserves the intended contract.
- Preserve round-2 work verbatim (no reverts).
- Honor cross-platform constraints (`path.join()`/`path.resolve()` only; no global `RASEN_AGENT_RUNTIME`).

**Non-Goals:**
- Refactoring the audits-api teardown beyond the `rejectImport` path — the normal request helper is fine.
- Changing the bootstrap race-resolution mechanism (staging dirs + atomic rename). Only the loser's REPORTED ACTION changes when its `selectBootstrapLocation` loses the race; the publish path is untouched.
- Adding new spec requirements. The failing tests ARE the contract; this change makes the code and tests agree, not adds new behavior.
- Addressing the 4 pre-existing Purpose placeholders or other M6 items outside the 6 CI failures.

## Decisions

### Per-failure verdicts (test vs. code) and exact fix

**1. `test/commands/pipeline-store-root-selection.test.ts:296` — TEST fix.**
Verdict: the assertion `dispatchMode: 'exec-bridge'` is only correct when the host runtime is Claude. On CI (`RASEN_AGENT_RUNTIME` unset, no `CLAUDECODE`), `detectHostRuntime` returns `unknown` → `resolveDispatchRoute('unknown', 'codex')` returns `legacy-fallback`. The test passed locally because `runCLI` merges `process.env` (which includes the developer's `CLAUDECODE`) with the test's `env` (see `test/helpers/run-cli.ts:165` `mergeEnv(process.env, {...isolation}, options.env)`). The leak is the test's implicit dependence on the ambient `CLAUDECODE` var.
Fix: add `RASEN_AGENT_RUNTIME: 'claude'` to the `env` object inside this single `it` block (per-test, NOT global). This pins the host runtime the assertion already assumes. Do NOT add it to the suite-level `beforeEach` `env` — the other tests in this file have runtime-independent assertions and a global override would mask future regressions of the same kind.
Considered alternative: change the assertion to `dispatchMode: 'legacy-fallback'` (accept the unknown-host reality). Rejected — the test's intent is to verify the codex exec-bridge route under a Claude host, which is the production configuration; weakening the assertion would hide real regressions.

**2. `test/core/management-api/audits-api.test.ts:230` — CODE fix (router teardown).**
Verdict: real bug in `rejectImport`. The teardown `res.once('finish', () => setTimeout(() => req.destroy(), 10))` is both slow (6s/test locally) and unreliable under CI load (>30s timeout). Verified locally: replacing with `res.once('finish', () => req.socket.end())` + a 100ms `req.socket.destroy()` fallback drops the test to ~130ms with 3/3 stable passes. The root cause: `req.destroy()` sends RST which races the client's read of the response body (the test's `incompleteUpload` client got `status: 0` because the RST arrived before the JSON). `req.socket.end()` sends a graceful FIN — the client reads the buffered response bytes before the EOF.
Fix: in `src/core/management-api/router.ts` `rejectImport`, call `req.socket?.end()` on `res.finish`, then schedule a 100ms `req.socket?.destroy()` fallback (unref'd). The 100ms covers any socket that doesn't close cleanly on FIN alone (e.g., a peer that ignores half-close).
Considered alternative: increase the original 10ms to 100ms. Rejected — `req.destroy()` (RST) still truncates the response for slow clients; `socket.end()` (FIN) is the correct TCP primitive for "response fully sent, now close gracefully".

**3. `test/core/store/bootstrap-obtain.test.ts:551` — TEST fix.**
Verdict: the test corrupts the registry YAML on Linux. The line `reg.replace(new RegExp(\`.*${store.root}.*\\\\n?\`, 'g'), '')` matches ONLY the `local_path:` line (the line containing the path) on Linux where `/` is the separator. The result is a store entry with `backend.type: git` but no `local_path`, which fails `GitBackendConfigSchema`'s `local_path: z.string().min(1)` → `parseStoreRegistryState` throws → `readRegistryEntries` returns `{entries: [], failure}` → `buildStoreFirstReport` returns a `blocked` report (no `store` field) → `report.store?.registered` is `undefined`. On Windows the regex never matches (`\\` in the path is not escaped in the regex), so the entry stays intact and the test passes for the wrong reason (store was never actually unregistered).
Fix: replace the regex text manipulation with a proper registry mutation via `updateStoreRegistryState((state) => { const next = { ...state, stores: { ...state.stores } }; delete next.stores[store.id]; return next; }, { globalDataDir })`. This deletes the entire entry cleanly.
Considered alternative: use the higher-level `unregisterStore` API. Rejected — it's in `src/core/store/operations.ts` and pulls in more machinery; `updateStoreRegistryState` from `foundation.ts` is already the test's import scope and is the single explicit-mutation seam.

**4. `test/core/store/bootstrap-obtain.test.ts:1227` — CODE fix (race-loser action).**
Verdict: when two `buildBootstrapReport` calls race on the same target via `Promise.all`, the loser that reaches `selectBootstrapLocation` AFTER the winner's `publishStagedCheckout` completes finds `target` occupied and `holdsCheckout(target)` true → `location.kind === 'refused'` because `existing-checkout` → `entry.action = 'not-acted'`. The test expects `obtain-failed` (lost the race). Locally, both racers reach `selectBootstrapLocation` before either publishes, so both proceed to clone + publish, and the loser drops out at `publishStagedCheckout` (EEXIST) with the correct `obtain-failed` action. Under CI scheduling, one racer is delayed past the other's publish and takes the `refused` branch.
Fix: in `obtainAbsentStore` (`src/core/store/bootstrap.ts`), snapshot `const targetExistedAtStart = inputs.suppliedPath !== undefined && fs.existsSync(inputs.suppliedPath)` immediately before `selectBootstrapLocation(inputs)`. In the `location.kind === 'refused'` branch, set `entry.action = targetExistedAtStart ? 'not-acted' : 'obtain-failed'`. This distinguishes "user pointed at a path that already had content" (not-acted, pre-existing) from "the path was absent when we started but another process published while we were preparing" (obtain-failed, lost race). The two existing `expect(entry.action).toBe('not-acted')` tests at lines 245 and 1311 pre-create content at the target, so `targetExistedAtStart = true` and they keep their `not-acted` contract. The B3 race test's `Promise.all` ensures both racers snapshot before either publishes, so the loser's snapshot is `false` and it reports `obtain-failed`.
Considered alternative: change the test to serialize the racers. Rejected — the test's name and intent are "concurrent clone race"; serializing would test a different contract.
Considered alternative: have `selectBootstrapLocation` not refuse on `existing-checkout` when a path was explicitly supplied, and let the publish step resolve the race. Rejected — this changes the line 245/1311 contract (pre-existing precious content) and forces a wasteful clone before the race is detected.

**5. `test/core/token-audit/management.test.ts:325` — CODE fix (error wrapping).**
Verdict: on Linux, `readDirectReport` opens the file with `O_NOFOLLOW` (`fs.constants.O_NOFOLLOW`). For a symlink, the open throws ELOOP — a raw NodeJS errno exception, not `AuditServiceError`. `AuditReportRepository.read()`'s catch only re-wraps `AuditServiceError` instances and rethrows other errors as-is:
```
catch (error) {
  if (error instanceof AuditServiceError) {
    throw new AuditServiceError(404, 'audit_not_found', '...');
  }
  throw error;  // <-- raw ELOOP reaches the test
}
```
On Windows the test skips the symlink assertion (`symlinkCreated = false` without Developer Mode), and the path-traversal assertions go through `safeDirectReportPath` which throws `AuditServiceError` directly — so Windows never exercises the gap.
Fix: in `AuditReportRepository.read()`, drop the `instanceof` gate and wrap ALL errors as `AuditServiceError(404, 'audit_not_found', 'No valid saved audit report matches that id.')`. This matches the contract the test encodes: any failure to read a direct report (symlink, missing, IO error) is reported as `audit_not_found` to the caller. The `safeDirectReportPath` pre-check still throws its own `AuditServiceError` for traversal attempts BEFORE this catch, so its message is preserved for that case; only the `readDirectReport` failure path is normalized.
Considered alternative: catch the ELOOP specifically in `readDirectReport` and throw `AuditServiceError` there. Rejected — there are other low-level IO errors (EACCES, EIO) that should also be normalized; the catch in `read()` is the right seam.

**6. `packages/ui/test/components/board-page.test.tsx:247,285` — TEST fix (async wait).**
Verdict: the component is correct. `BoardPage.handleChangeCreated` (line 214-216) sets `setDialogOpen(false)`, `setHighlightedName(changeId)`, `setRefreshNonce((n) => n + 1)`. The `useEffect([refreshNonce, selector, dataSelector])` (line 139) refires, calls `client.listChanges()`, and `setChanges(...)` on resolve. The test's `flushMicrotasks(6)` is insufficient under jsdom + CI load — the Preact re-render chain (state update → effect → fetch promise → state update → re-render) needs more than 6 microtask ticks when the scheduler is busy.
Fix: introduce a small `waitFor(predicate, { timeoutMs: 1000 })` helper in the test file (or import vitest's `vi.waitFor`) and replace the fixed-flush waits with `await waitFor(() => expect(container.textContent).toContain('submitted-change'))` and (for the error path) `await waitFor(() => expect(container.textContent).toContain("Change 'dup-change' already exists"))`. The fixed-count `flushMicrotasks` calls inside `act` for the dialog-open interactions stay — those are for synchronous event dispatch, not async refetch chains.
Considered alternative: increase `flushMicrotasks` count to 20. Rejected — still fragile; a polling wait is the standard jsdom pattern for "the UI should eventually reflect this state".

### Spec delta scope — why one, not three

Three of the six fixes change runtime behavior; only one warrants a spec delta:
- **Bootstrap race-loser action (delta'd, `store-bootstrap`):** the "clone target is chosen…" requirement previously said only "an existing checkout is never overwritten" — it did not distinguish a pre-existing checkout (refuse, don't act) from a concurrent race loss (act, lose, report failure). The new scenario "A concurrent race at the same target is reported as a lost race, not a refusal" makes that distinction durable. Without the delta, a future change could revert to `not-acted` for the race loser and no spec-level guard would catch it.
- **Audits-api socket teardown (NOT delta'd):** the test (`expect(oversized).toEqual({ status: 413, socketDestroyed: true })`) IS the contract — reject declared-oversize, then terminate the socket. The fix makes the code honor it. A delta would duplicate the test as a spec requirement with no new behavior.
- **AuditServiceError wrapping (NOT delta'd):** `expect(() => repository.read('linked.json')).toThrow(AuditServiceError)` IS the contract.

The single delta also satisfies the spec-driven schema's requirement that every change carry at least one delta (the validator enforces this at `rasen validate --changes`).

## Risks / Trade-offs

- **[Risk] The `req.socket.end()` teardown changes observable timing for ANY `rejectImport` caller (413/400/409 from audits-import).** → Mitigation: `socket.end()` is the standard graceful-close primitive; the 100ms `destroy()` fallback ensures the socket is reclaimed even if the peer ignores the FIN. The normal-request helper tests (`imports raw report bytes`, `rejects declared oversize bodies`) use a client that reads the full response and closes cleanly — unaffected.
- **[Risk] The bootstrap race-loser snapshot has its own window: if the winner publishes BEFORE the loser's snapshot, the loser still reports `not-acted`.** → Mitigation: `Promise.all` starts both racers concurrently; both snapshot early in `obtainAbsentStore` (before any clone). For one racer to snapshot after the other published, the loser would need to be delayed past the winner's entire clone+publish — possible under extreme load but far narrower than the current "any time before selectBootstrapLocation" window. The test's 30s `it(..., 30000)` timeout covers realistic scheduling.
- **[Risk] The `AuditReportRepository.read` error-wrap hides genuine bugs behind `audit_not_found`.** → Mitigation: the existing `safeDirectReportPath` pre-check still throws its own specific `AuditServiceError` for traversal attempts (preserving that message); only the `readDirectReport` IO-failure path is normalized. A genuine bug (e.g., ENOENT from a missing directory) was already being re-wrapped as 404 when it came back as `AuditServiceError` from `readDirectReport`'s post-open checks — this fix just extends the same treatment to non-AuditServiceError throws.
- **[Risk] The `RASEN_AGENT_RUNTIME: 'claude'` env pin in the codex test could mask a future regression where exec-bridge breaks under a real Codex host.** → Mitigation: the test's intent is specifically "under a Claude host, codex routes via exec-bridge"; a Codex-host regression needs its own test with `RASEN_AGENT_RUNTIME: 'codex'`. The pin makes the test honest about which host it's testing.
- **[Risk] The UI `waitFor` helper could introduce a new class of flake (timeout-based waits that mask real failures).** → Mitigation: use a 1000ms ceiling (well under vitest's default testTimeout); poll every ~10ms; fail loudly on timeout with the actual vs. expected textContent.
