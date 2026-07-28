# Required CI Checks — Branch Protection Configuration

This document lists every CI check that the maintainer must mark **required** in GitHub branch protection for each protected branch (`main`, `dev/0.1.5`, and future release branches).

> **This is a GitHub-admin action, not a code change.** Configuring branch protection is done in the GitHub UI: **Settings → Branches → Branch protection rules**. No edit to `.github/workflows/ci.yml` or any source file can enable required checks — the toggle lives entirely in GitHub's repository settings.

## Protected branches

| Branch | Purpose |
|---|---|
| `main` | Production release line |
| `dev/0.1.5` | Active development release line |

When a new release branch is cut (e.g. `dev/0.1.6`), add it to:
1. `.github/workflows/ci.yml` trigger stanzas (`pull_request.branches`, `merge_group.branches`, `push.branches`).
2. GitHub branch protection rules for the new branch.

## Checks to mark "required"

Mark these checks as required in branch protection for each protected branch:

| GitHub display name | Job in `ci.yml` | What it verifies |
|---|---|---|
| **Test** | `test_pr_required` | Aggregates the `test_matrix` job — Linux, macOS, Windows x Node 20/24. Build, full test suite, focused Windows server/UI path tests. |
| **Lint & Type Check** | `lint` | Build, `git diff --check` (whitespace/errors in PR diff), `tsc --noEmit`, `pnpm lint`, build-artifact verification. |
| **UI Package Build** | `ui_build` | `packages/ui` build, test, and `dist/index.html` verification. |
| **All checks passed** | `required-checks-pr` | Aggregation gate: verifies `test_matrix` + `lint` + `ui_build` + `nix-flake-validate` all passed (Nix may be skipped). This is the single rollup status that appears on the PR. |

### Conditional check

| GitHub display name | Job in `ci.yml` | When it runs |
|---|---|---|
| **Nix Flake Validation** | `nix-flake-validate` | Only when Nix-related files change (`flake.nix`, `flake.lock`, `package.json`, `pnpm-lock.yaml`, `scripts/update-flake.sh`, `.github/workflows/ci.yml`). Mark as required **only if** Nix is part of your release/distribution path. The `required-checks-pr` aggregation already treats "skipped" as passing. |

## How to configure

1. Navigate to **Settings → Branches** in the GitHub repository.
2. Click **Add rule** (or edit an existing rule) for the branch (e.g. `dev/0.1.5`).
3. Under **Require status checks to pass before merging**, check **Require branches to be up to date before merging**.
4. Search for and add each check listed above by its GitHub display name.
5. Save the rule.

> **Note:** GitHub only shows check names that have run at least once on the branch. If a check name does not appear in the search, trigger a CI run first (push a commit or open a PR targeting the branch), then refresh the branch protection page.

## Why this matters

PR #88 targeted `dev/0.1.5`, but CI only triggered on `main`. The GitHub status rollup showed only the Docs site check, giving a false "clean" signal — the full matrix (Linux/macOS/Windows × Node 20/24), root build/test/lint, and UI build never ran. Expanding the trigger and documenting the required-checks set ensures every PR to a release branch gets the same quality gate as `main`.
