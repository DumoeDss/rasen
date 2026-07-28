## Why

The PR #88 acceptance review found two CI/test-infra issues:

1. **M7:** `.github/workflows/ci.yml` triggers only on `main` branch PRs. PR #88 targets `dev/0.1.5`, so the entire CI matrix (Linux/macOS/Windows × Node 20/24), root build/test/lint, UI build/test, and `git diff --check` never ran for this PR. The GitHub status rollup showed only the Docs site check — giving a false "clean" signal.
2. **M6:** The root test suite is unstable at scale (2-worker 15 min timeout, 4-worker ~95 failures including CLI subprocess non-exit, Windows EPERM teardown cascade, 10 s test timeouts). The review demands investigation of determinable root causes and per-file duration guidance, while flagging that "3 consecutive green on real Windows CI" cannot be asserted locally.

## What Changes

- **M7 (code-fixable):** Add `dev/0.1.5` to `pull_request.branches`, `merge_group.branches`, and `push.branches` in `.github/workflows/ci.yml`. Consider a glob pattern (`dev/**`) for future release branches. Add a docs section (in the round-2 evidence doc or a standalone `docs/ci-required-checks.md`) listing the required-checks set the maintainer must mark "required" via GitHub branch protection — this toggle is a GitHub-admin action, NOT code (flagged as frontier).
- **M6 (partial investigation):** Investigate leaked-subprocess/handle root causes by reading test setup/teardown code. Fix any determinable issues (e.g., missing `child.kill()` in `afterEach`, unclosed server handles, missing `--forceExit` guidance). Record per-file duration guidance for known-slow tests. Flag "3 consecutive green on real Windows CI" as a frontier that needs actual CI runs.

## Capabilities

### New Capabilities

- `ci-trigger-and-required-checks`: The CI workflow runs on PRs targeting active release branches (not just `main`), and the required-checks set is documented for the maintainer to configure in GitHub branch protection.

### Modified Capabilities

## Impact

- `.github/workflows/ci.yml` — add `dev/0.1.5` to branch triggers (M7).
- `docs/ci-required-checks.md` or a section in the round-2 evidence doc — required-checks checklist (M7).
- Test files — any determinable handle/subprocess leak fixes (M6, scoped to what can be locally verified).
- `docs/audits/pr88-round2-evidence-reconciliation.md` — updated with M6 investigation findings.
- **Frontier (NOT code):** GitHub branch-protection "required" toggle — admin action by the maintainer.
- **Frontier (NOT local):** "3 consecutive green on real Windows CI" — needs actual CI runs after the trigger fix.
