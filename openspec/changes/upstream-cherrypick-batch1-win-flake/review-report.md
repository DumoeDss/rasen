# Review Report — upstream-cherrypick-batch1-win-flake

**VERDICT: APPROVE** — faithful port of upstream `296ecbc` onto the rebranded fork; all upstream hardening semantics present, fork-specific isolation and branding preserved, CI job graph sound. 0 Blocker / 0 Major / 0 Minor / 1 Trivial.

Reviewer: reviewer-c (did not author). Scope: 13 uncommitted working-tree files. Cross-checked against `git show 296ecbc` and `git show HEAD`.

## Per-lens confirmation

### Lens 1 — run-cli.ts merged harness (highest risk) — PASS
- **Upstream hardening all present:** `mergeEnv` (lines 67-91) and `terminateProcessTree` (93-113, win32 `taskkill /pid <pid> /t /f`, else `process.kill(-pid, 'SIGKILL')`) are byte-identical to upstream. `detached: process.platform !== 'win32'` (166); `activeCliChildren.add(child)` after `unref()` (172); always-on `setTimeout(...)` with `timeoutMs = options.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS` (152, 178-181); `clearTimeout` + `activeCliChildren.delete` in both `error` (194-195) and `close` (204-205); `if (timedOut) reject(...)` descriptive-error branch before resolve (210-223).
- **Fork XDG isolation PRESERVED inside mergeEnv:** `XDG_CONFIG_HOME`/`XDG_DATA_HOME: isolatedConfigHome` both retained (158-159); `isolatedConfigHome = mkdtempSync(...)` and its `mkdtempSync`/`os` imports intact (2-3, 20). `options.env` is merged last, so per-test env overrides still win.
- **RASEN_TELEMETRY '0':** correct (160) — upstream's `OPENSPEC_TELEMETRY` correctly rebranded.
- **Teardown wiring:** `vitest.setup.ts` swaps the import to `{ ensureCliBuilt, terminateActiveCliChildren }` and replaces the `setTimeout(process.exit(0))` body with `terminateActiveCliChildren();` — byte-identical to upstream's post-image.
- `runCommand` (build helper) left untouched, as intended.

### Lens 2 — ci.yml 8-edit port — PASS
All 8 enumerated edits applied and only those: (1) `test_pr` deleted; (2) `test_matrix` `if:` broadened to pr||merge_group||push||workflow_dispatch; (3) `vitest_workers` 4/4/2 per leg; (4) `VITEST_MAX_WORKERS` env on Run tests; (5) coverage artifact → `coverage-report-${{ github.event_name }}`; (6) `test_pr_required` job (name `Test`, needs `[test_matrix]`, `if: always() && (pr||merge_group)`, verifies `result == 'success'`); (7) `required-checks-pr` needs + verify-step repointed `test_pr` → `test_matrix` ("Matrix test job failed"); (8) `required-checks-main` and Nix job untouched.
- **YAML parses** (js-yaml): 7 jobs — changes, test_matrix, test_pr_required, lint, nix-flake-validate, required-checks-pr, required-checks-main.
- **Nix job byte-identical:** `git diff HEAD -- ci.yml` shows zero hunks in the nix job body (lines 160-218 unchanged).
- **No unsatisfiable required check:** `required-checks-pr` needs `[test_matrix, lint, nix-flake-validate]` — test_matrix now runs on PR (edit 2), `lint` has no `if:` (runs on all events), `nix-flake-validate` skip is handled by the `!= 'skipped'` guard. The literal `Test` required status check is preserved on PRs via `test_pr_required`. No permanently-pending PR risk.

### Lens 3 — temp-cleanup.ts semantics — PASS
Byte-identical to upstream. `fs.rmSync(target, { recursive, force, maxRetries: 5, retryDelay: 100 })` with an undefined-guard. Bounded retries (Node's built-in rmSync retry, scoped to EBUSY/ENOTEMPTY/EPERM/EMFILE), no infinite loop; `force` suppresses only ENOENT, so a genuine failure still throws after 5 attempts (no swallowing).

### Lens 4 — hand-fixed files — PASS
Enumerated every upstream hunk per file against the applied diff; all present, none silently dropped. Only brand context lines differ:
- `workset.test.ts`: 5 `cleanupTempPath` swaps + import; `delete process.env.RASEN_ENABLE_CLI_AGENT_OPENERS;` retained.
- `store-lifecycle.test.ts`: import, `JOURNEY_TIMEOUT_MS`, `cleanupTempPath(base)`, 3 `it(...)` timeout args; `Using Rasen root` / `rasen new change` assertions retained.
- `context.test.ts` (import + `CONTEXT_MATRIX_TIMEOUT_MS` + afterEach swap + 1 it-arg), `doctor.test.ts` (import + afterEach swap), `capstone-journeys.test.ts`, `legacy-groups-removed.test.ts`, `store-git.test.ts`, `store-remote.test.ts` (incl. `GIT_JOURNEY_TIMEOUT_MS`), `store-root-selection.test.ts` — all hunk-for-hunk identical to upstream.

### Lens 5 — spec delta — PASS
`specs/ci-test-harness/spec.md` valid (`node bin/rasen.js validate` → green) and accurate: three ADDED requirements (matrix-on-PR + bounded workers, hardened CLI-spawn harness with `RASEN_TELEMETRY=0` + XDG isolation, retrying temp cleanup) faithfully describe the code.

## Cross-check of the full-suite claim
`node build.js` OK; `vitest run store-lifecycle capstone-journeys` → **10/10 passed** (both historically-flaky files green, 19.6s). Corroborates the recorded 2186/0.

## Scope
Working tree touches exactly the 13 target files (12 modified + `temp-cleanup.ts` new). No product-source scope creep. Untracked `upstream-cherrypick-batch1*` dirs are sibling change docs.

## Findings

**[Trivial] tasks.md 4.3 misfiles a constant name.** Task 4.3 lists `GIT_JOURNEY_TIMEOUT_MS` as a `store-lifecycle.test.ts` const, but that constant belongs to `store-remote.test.ts` (upstream); store-lifecycle uses only `JOURNEY_TIMEOUT_MS`. The **code is correct** and matches upstream — only the task note is slightly off. No action required.
