## 1. M7 — Expand CI trigger to dev/0.1.5

- [x] 1.1 In `.github/workflows/ci.yml`, change `pull_request.branches`, `merge_group.branches`, and `push.branches` from `[main]` to `[main, dev/0.1.5]`
- [x] 1.2 Add a `git diff --check` step to the `lint` job: add `fetch-depth: 0` to the checkout step (currently only `test_matrix` has it), then add a step `Check for whitespace errors` running `git diff --check` before the type check

## 2. M7 — Required-checks documentation

- [x] 2.1 Create `docs/ci-required-checks.md` listing: Test (the `test_pr_required` aggregation), Lint & Type Check, UI Package Build, All checks passed (the `required-checks-pr` aggregation). State this is a GitHub-admin action (Settings → Branches → Branch protection rules → `dev/0.1.5`). Note Nix Flake Validation is conditional and optional for "required" marking

## 3. M6 — Test stability investigation (partial)

- [x] 3.1 Search test files for `spawn`/`exec`/`child_process` usage. Identify tests that spawn CLI subprocesses without killing them in `afterEach`/`afterAll`. Fix any missing cleanup (add `child.kill()` in teardown)
- [x] 3.2 Check temp-directory teardown in `afterEach` hooks. Add EPERM-retry logic where missing: wrap `fs.rmSync(dir, { recursive: true, force: true })` in a try/catch with one retry after 100ms for Windows file-locking delays
- [x] 3.3 Identify tests consistently approaching the 10s vitest timeout. Record per-file duration guidance in the evidence doc. Add explicit `test.setTimeout()` where a test legitimately needs more time
- [x] 3.4 Record M6 findings in `docs/audits/pr88-round2-evidence-reconciliation.md`: what was fixed, what remains known-open, and the explicit frontier flag for "3 consecutive green on real Windows CI"

## 4. Verification

- [x] 4.1 Validate `.github/workflows/ci.yml` syntax (yaml lint or `gh workflow view` if available)
- [x] 4.2 Run `git diff --check` — must be clean
- [x] 4.3 Run any modified test files in isolation to confirm fixes don't regress
- [x] 4.4 Run `pnpm exec tsc --noEmit` — confirm no type errors
