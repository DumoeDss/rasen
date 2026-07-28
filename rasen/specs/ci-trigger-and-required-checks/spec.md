# ci-trigger-and-required-checks Specification

## Purpose
The project's required CI runs on the active release branch (dev/0.1.5), not only main, and includes a scoped whitespace/diff check. The set of checks a maintainer must mark required in branch protection is documented as a one-time GitHub-admin action.
## Requirements
### Requirement: CI runs on pull requests targeting active release branches

The project CI workflow SHALL trigger on pull requests, merge groups, and pushes targeting `main` and any active release branch (currently `dev/0.1.5`). The full job matrix — build, test, lint, type check, UI build and test — SHALL run for every PR to these branches. A PR that targets a release branch SHALL NOT appear "clean" on GitHub merely because no CI job ran.

#### Scenario: A PR targeting dev/0.1.5 triggers the full CI matrix

- **WHEN** a pull request is opened or updated targeting `dev/0.1.5`
- **THEN** the CI workflow runs the test matrix (Linux, macOS, Windows × Node 20 and 24)
- **AND** the lint, type check, UI build, and UI test jobs run
- **AND** the required-checks aggregation job reports the combined result on the PR

#### Scenario: A PR targeting main still triggers CI

- **WHEN** a pull request targets `main`
- **THEN** the CI workflow runs exactly as before — the release-branch addition does not regress the main-branch trigger

### Requirement: The required-checks set is documented for branch protection configuration

The project SHALL maintain a document listing every CI check that the maintainer must mark "required" in GitHub branch protection for each protected branch. The document SHALL state that configuring branch protection is a GitHub-admin action (Settings → Branches), not a code change, and SHALL name each check by its GitHub display name.

#### Scenario: A maintainer configures branch protection for dev/0.1.5

- **WHEN** the maintainer reads the required-checks documentation
- **THEN** the document lists each check name (Test, Lint & Type Check, UI Package Build, All checks passed)
- **AND** the document states that enabling "required" is a GitHub-admin action
- **AND** the document names the GitHub navigation path to configure it

### Requirement: CI checks for whitespace errors in the PR diff

The CI workflow SHALL run `git diff --check` on the PR's own diff to catch trailing whitespace and blank-line-at-EOF errors before merge. A PR with whitespace errors SHALL fail CI rather than passing silently.

#### Scenario: A PR with trailing whitespace fails CI

- **WHEN** a PR diff contains trailing whitespace or blank lines at end of file
- **THEN** the CI lint job fails with a `git diff --check` error naming the file and line
