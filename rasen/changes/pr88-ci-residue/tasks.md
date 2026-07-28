## 1. Failure 2 — audits-api incomplete-upload socket teardown (CODE fix)

Verdict: real bug in `rejectImport`. The `setTimeout(() => req.destroy(), 10)` teardown holds the socket ~3s per incomplete-upload call (RST races the client's read; under CI load two sequential calls exceed 30s). Verified locally: the fix drops the test from ~6s to ~130ms, 3/3 stable passes.

- [x] 1.1 In `src/core/management-api/router.ts` inside the `/api/v1/audits/import` POST handler, replace the `rejectImport` teardown. Current code:
  ```ts
  res.once('finish', () => {
    const teardown = setTimeout(() => req.destroy(), 10);
    teardown.unref();
  });
  sendError(res, status, code, message, fix);
  ```
  New code:
  ```ts
  res.once('finish', () => {
    // Graceful FIN so the client reads the JSON before EOF; a bare destroy()
    // races the client's read and returns status 0.
    req.socket?.end();
    // Belt-and-suspenders: if the peer ignores the FIN, force-close shortly.
    const teardown = setTimeout(() => req.socket?.destroy(), 100);
    teardown.unref();
  });
  sendError(res, status, code, message, fix);
  ```
  Keep the surrounding comment about why we don't destroy synchronously, but update it to mention FIN vs. RST.
- [x] 1.2 Run `pnpm exec vitest run test/core/management-api/audits-api.test.ts` — all 6 tests should pass, the "terminates incomplete upload sockets" test in well under 1s.

## 2. Failure 5 — AuditServiceError on symlink read (CODE fix)

Verdict: real bug. On Linux, `readDirectReport`'s `O_NOFOLLOW` open of a symlink throws ELOOP (a raw NodeJS error). `AuditReportRepository.read()`'s catch only re-wraps `AuditServiceError` instances, letting ELOOP propagate. Windows skips the assertion (no symlink without Developer Mode).

- [x] 2.1 In `src/core/token-audit/management.ts`, change `AuditReportRepository.read()`'s catch block. Current:
  ```ts
  catch (error) {
    if (error instanceof AuditServiceError) {
      throw new AuditServiceError(404, 'audit_not_found', 'No valid saved audit report matches that id.');
    }
    throw error;
  }
  ```
  New (wrap ALL errors — any IO failure to read a direct report is reported as `audit_not_found`):
  ```ts
  catch (error) {
    throw new AuditServiceError(404, 'audit_not_found', 'No valid saved audit report matches that id.');
  }
  ```
  The `safeDirectReportPath` pre-check (called before `readDirectReport`) still throws its own `AuditServiceError` for path traversal with its own message, so that contract is preserved.
- [x] 2.2 Run `pnpm exec vitest run test/core/token-audit/management.test.ts` — all 9 tests should pass locally on Windows (symlink assertion skipped). The fix is verified by reasoning + the existing path-traversal assertions; full Linux confirmation comes from the CI run.

## 3. Failure 4 — B3 race loser action (CODE fix)

Verdict: real race-window bug. When two concurrent `buildBootstrapReport` calls target the same path and one racer's `selectBootstrapLocation` runs AFTER the other's `publishStagedCheckout`, the loser sees `location.kind === 'refused'` (existing-checkout) and gets `entry.action = 'not-acted'`. The test expects `obtain-failed` (lost the race). Locally both racers reach `selectBootstrapLocation` before either publishes, so both proceed to publish where the loser correctly drops to `obtain-failed` via `publishStagedCheckout`'s EEXIST path.

- [x] 3.1 In `src/core/store/bootstrap.ts` inside `obtainAbsentStore`, capture the target's existence BEFORE calling `selectBootstrapLocation`. Insert immediately before the `const location = selectBootstrapLocation(...)` call:
  ```ts
  // Snapshot whether the user-supplied target already existed. If it was
  // absent at the start of this call but selectBootstrapLocation refuses
  // with `existing-checkout`, another process published between our snapshot
  // and the location probe — that's a lost race (obtain-failed), not a
  // refusal to clobber pre-existing user content (not-acted).
  const targetExistedAtStart =
    inputs.suppliedPath !== undefined && inputs.suppliedPath.length > 0
      ? fs.existsSync(inputs.suppliedPath)
      : false;
  ```
- [x] 3.2 In the `if (location.kind === 'refused')` branch that currently sets `entry.action = 'not-acted'`, change to:
  ```ts
  entry.action = targetExistedAtStart ? 'not-acted' : 'obtain-failed';
  ```
  Leave the diagnostic push, `target`, `fix`, and `return 'not-acted'` → `return entry.action` (or branch the return) as appropriate to keep the function's return type correct. The function returns `'obtained' | 'obtain-failed' | 'declined' | 'not-acted'` so `obtain-failed` is already in the union.
- [x] 3.3 Verify the two `expect(entry.action).toBe('not-acted')` tests at `bootstrap-obtain.test.ts:245` (pre-existing precious content) and `:1311` (pre-existing non-empty dir) still pass — they pre-create content at the target, so `targetExistedAtStart = true` keeps `not-acted`.
- [x] 3.4 Run `pnpm exec vitest run test/core/store/bootstrap-obtain.test.ts` — all 44 tests should pass, including "exactly one publish succeeds when two obtains race on the same target".

## 4. Failure 1 — codex dispatchMode assertion (TEST fix)

Verdict: the test inherits the developer's `CLAUDECODE=1` via `runCLI`'s `mergeEnv(process.env, ..., options.env)`. On CI (no `CLAUDECODE`), host resolves to `unknown` → codex routes to `legacy-fallback`, not `exec-bridge`. The assertion `dispatchMode: 'exec-bridge'` is correct for a Claude host — the test just doesn't pin the host it assumes.

- [x] 4.1 In `test/commands/pipeline-store-root-selection.test.ts`, inside the single `it('agents writes a runtime config instance under the store root (no YAML copy)', ...)` block (around line 287), change the `runCLI` call's `options.env` from `env` to `{ ...env, RASEN_AGENT_RUNTIME: 'claude' }`. Do NOT add this to the suite-level `beforeEach` `env` — other tests in the file have runtime-independent assertions and a global pin would mask future regressions. Do NOT set `RASEN_AGENT_RUNTIME` globally on CI.
- [x] 4.2 Run `pnpm exec vitest run test/commands/pipeline-store-root-selection.test.ts` — all 11 tests should pass. For confidence the fix doesn't depend on the developer shell, run with `RASEN_AGENT_RUNTIME` explicitly unset in the surrounding shell — the pinned per-test env still produces `exec-bridge`.

## 5. Failure 3 — bootstrap registration registry corruption (TEST fix)

Verdict: the test's regex `new RegExp(\`.*${store.root}.*\\\\n?\`, 'g')` matches ONLY the `local_path:` line on Linux (forward slashes match naturally), leaving a malformed store entry whose `backend` has `type: git` but no `local_path`. That fails `GitBackendConfigSchema.local_path: z.string().min(1)` → `parseStoreRegistryState` throws → `readRegistryEntries` returns `{entries: [], failure}` → `buildStoreFirstReport` returns a `blocked` report with no `store` field → `report.store?.registered` is `undefined`. On Windows the regex never matches (`\\` unescaped in the pattern), so the entry stays and the test passes for the wrong reason.

- [x] 5.1 In `test/core/store/bootstrap-obtain.test.ts`, replace the regex-based unregister in the `it('registers the Store checkout during apply', ...)` test (around lines 537-542). Current:
  ```ts
  const reg = fs.readFileSync(getStoreRegistryPath({ globalDataDir }), 'utf-8');
  const updated = reg.replace(
    new RegExp(`.*${store.root}.*\\n?`, 'g'),
    ''
  );
  fs.writeFileSync(getStoreRegistryPath({ globalDataDir }), updated, 'utf-8');
  ```
  New (use the proper registry mutation seam):
  ```ts
  await updateStoreRegistryState(
    (state) => {
      if (!state) return { version: 2, stores: {} };
      const next = { ...state, stores: { ...state.stores } };
      delete next.stores[store.id];
      return next;
    },
    { globalDataDir }
  );
  ```
  Add `updateStoreRegistryState` to the existing import from `../../../src/core/store/foundation.js` (alongside `getStoreRegistryPath`, `readOptionalStoreMetadataState`, etc.).
- [x] 5.2 Run `pnpm exec vitest run test/core/store/bootstrap-obtain.test.ts -t "registers the Store checkout during apply"` — the single test should pass, with `report.store?.registered === true`.

## 6. Failure 6 — board-page post-submit timing (TEST fix, packages/ui)

Verdict: the component is correct (`handleChangeCreated` → `setRefreshNonce` → `useEffect` → `listChanges` → `setChanges`). The test's `flushMicrotasks(6)` is insufficient under jsdom + CI load. Round-2 never touched `packages/ui`; this is pre-existing timing debt.

- [x] 6.1 `cd packages/ui && pnpm install` (the package is not in the root workspace and has no `node_modules` in this worktree — needed before its test suite can run).
- [x] 6.2 In `packages/ui/test/components/board-page.test.tsx`, add a `waitFor` helper near the existing `flushMicrotasks` helper (or import `vi.waitFor`):
  ```ts
  async function waitFor<T>(fn: () => T, { timeoutMs = 1000 }: { timeoutMs?: number } = {}): Promise<T> {
    const start = Date.now();
    while (true) {
      try { return fn(); } catch { /* keep polling */ }
      if (Date.now() - start > timeoutMs) throw new Error(`waitFor timed out after ${timeoutMs}ms`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  ```
- [x] 6.3 In the `it('successful submit: ...')` test, replace the two trailing `await act(async () => { await flushMicrotasks(); })` after the submit with a polling wait on the post-submit UI:
  ```ts
  await act(async () => {
    await waitFor(() => {
      expect(container.querySelector('.new-change-dialog')).toBeNull();
    });
    await waitFor(() => {
      expect(container.textContent).toContain('submitted-change');
    });
  });
  ```
  Keep the existing assertion that `card.classList.contains('board-card--highlighted')` is true, and `(client.listChanges as any).mock.calls.length` is 2.
- [x] 6.4 In the `it('error path: ...')` test, replace the single trailing flush after submit with:
  ```ts
  await act(async () => {
    await waitFor(() => {
      expect(container.textContent).toContain("Change 'dup-change' already exists");
    });
  });
  ```
- [x] 6.5 Run `cd packages/ui && pnpm test -- test/components/board-page.test.tsx` — the "successful submit" and "error path" tests should pass reliably on repeated runs.

## 7. Verification (matrix-relevant subset, all 6 failures)

- [x] 7.1 From the repo root, run the CLI subset that covers the linux-bash residue:
  ```bash
  pnpm exec vitest run \
    test/core/management-api/audits-api.test.ts \
    test/core/token-audit/management.test.ts \
    test/core/store/bootstrap-obtain.test.ts \
    test/commands/pipeline-store-root-selection.test.ts
  ```
  Confirm 100% pass, no flakes on a second run.
- [x] 7.2 Run `cd packages/ui && pnpm test -- test/components/board-page.test.tsx`. Confirm both "New change submission" tests pass.
- [ ] 7.3 Run the full root test suite once (`pnpm test`) to confirm no regressions from the three code fixes (the socket teardown, AuditServiceError wrap, and bootstrap race-loser action each touch code that other tests exercise).
- [x] 7.4 Run `pnpm run build` and `pnpm run typecheck` (or `pnpm exec tsc --noEmit`) to confirm the code fixes compile cleanly across the matrix. The LEAD handles the actual ship/PR push and triggering CI on both linux-bash and windows-pwsh. (or `pnpm exec tsc --noEmit`) to confirm the code fixes compile cleanly across the matrix. The LEAD handles the actual ship/PR push and triggering CI on both linux-bash and windows-pwsh.
