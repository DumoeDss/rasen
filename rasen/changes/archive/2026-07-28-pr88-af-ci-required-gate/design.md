## Context

`.github/workflows/ci.yml` defines a 4-job CI pipeline:
1. `test_matrix` — Linux/macOS/Windows × Node 20/24, root build+test, 15 min timeout, `VITEST_MAX_WORKERS` env (2 on Windows, 4 elsewhere).
2. `lint` — root build + `tsc --noEmit` + `pnpm lint`.
3. `ui_build` — packages/ui build + test.
4. `nix-flake-validate` — conditional on Nix-related file changes.

Two aggregation jobs (`required-checks-pr`, `required-checks-main`) verify all jobs passed.

All triggers (`pull_request`, `merge_group`, `push`) are scoped to `branches: [main]` only. PR #88 targets `dev/0.1.5`, so none of these jobs ran.

## Goals / Non-Goals

**Goals:**
- M7: CI runs on `dev/0.1.5` PRs. Required-checks set is documented for the maintainer.
- M6: Determinable leaked-subprocess/handle root causes are fixed. Per-file duration guidance is recorded. The rest is honestly flagged as known-open/frontier.

**Non-Goals:**
- GitHub branch-protection configuration (admin action — frontier).
- "3 consecutive green on real Windows CI" sign-off (needs actual CI runs — frontier).
- Rewriting the test suite architecture.
- Adding `git diff --check` as a CI step (it should be a separate task in `ci.yml`; noted but may be a follow-up if the current `required-checks` job doesn't cover it).

## Decisions

### D1: M7 — Branch trigger expansion

Add `dev/0.1.5` to all three trigger stanzas:

```yaml
on:
  pull_request:
    branches: [main, dev/0.1.5]
  merge_group:
    branches: [main, dev/0.1.5]
  push:
    branches: [main, dev/0.1.5]
```

**Why not a glob (`dev/**`):** A glob would match any `dev/*` branch, including experimental ones. Explicit listing ensures CI runs only on active release branches. When a new release branch is cut, the maintainer adds it to the list (one-line change). This is deliberate and auditable.

**`git diff --check` in CI:** The review's §3 gate table shows `git diff --check` failed. The current CI does NOT have a `git diff --check` step. Add one to the `lint` job (after checkout, before type check) so it runs on every PR:

```yaml
- name: Check for whitespace errors
  run: git diff --check
```

This needs `fetch-depth: 0` (already set in `test_matrix` but NOT in `lint` — add it).

### D2: M7 — Required-checks documentation

Create `docs/ci-required-checks.md` listing the checks the maintainer must mark "required" in GitHub branch protection for `dev/0.1.5`:

- `Test` (the `test_pr_required` aggregation job)
- `Lint & Type Check`
- `UI Package Build`
- `All checks passed` (the `required-checks-pr` aggregation job)
- `Nix Flake Validation` (conditional — mark required if Nix is part of the release path)

The doc explicitly states this is a GitHub-admin action (Settings → Branches → Branch protection rules), not a code change.

### D3: M6 — Investigation scope

The review names specific symptoms: CLI subprocess non-exit, Windows EPERM teardown cascade, 10 s test timeouts. Investigation approach:

1. **CLI subprocess tests:** Search for `spawn`, `exec`, `child_process` in test files. Check whether spawned processes are killed in `afterEach`/`afterAll`. Known pattern from the codebase memory: `cli-e2e basic` and `spec/artifact-workflow/validate` tests are CLI-spawning and historically flaky on Windows (EBUSY rmdir + 10 s timeout).
2. **Windows EPERM cascade:** When one test's teardown fails to clean a temp directory, subsequent tests in the same worker hit EPERM on reuse. Fix: ensure `afterEach` uses `fs.rmSync(tempDir, { recursive: true, force: true })` with retry-on-EPERM.
3. **10 s test timeouts:** Identify tests that consistently approach the default 10 s vitest timeout. These may need explicit `test.setTimeout()` or splitting.

**What is shipped:** Only fixes that can be locally verified (e.g., adding missing `child.kill()` in an `afterEach`, adding EPERM retry to teardown). Everything else is recorded as known-open in the evidence doc.

**What is NOT shipped:** The "3 consecutive green" sign-off — this requires actual CI runs on GitHub Actions, which this session cannot perform.

## Risks / Trade-offs

- **[Glob vs explicit listing]** → Explicit listing is safer (no accidental CI on experimental branches) at the cost of a one-line edit per new release branch. This is the maintainer's call.
- **[M6 partial]** → Shipping only determinable fixes may not fully resolve the 95-failure cascade. The evidence doc must honestly state what was fixed vs what remains.
- **[`git diff --check` in lint job]** → Adding this step may surface pre-existing whitespace errors on other branches. The step should use `git diff --check origin/${{ github.base_ref }}...HEAD` to check only the PR's own diff, not the entire history.
