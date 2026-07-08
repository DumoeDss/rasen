## ADDED Requirements

### Requirement: Fork-Baseline Version

The package version SHALL be reset to `0.1.0` as the fork's independent semver baseline, discontinuing upstream's 1.5.x line, without changing the package name or bin in phase 1.

#### Scenario: Version is the fork baseline

- **WHEN** `package.json` is inspected
- **THEN** its `version` is `0.1.0` and its `name` and `bin` are unchanged from before this change

### Requirement: Dual-Copyright License

The `LICENSE` SHALL retain MIT terms and carry both the upstream copyright line and the fork maintainer's copyright line.

#### Scenario: Both copyright holders are present

- **WHEN** the `LICENSE` file is read
- **THEN** it contains `Copyright (c) 2024 OpenSpec Contributors` and `Copyright (c) 2026 DumoeDss`, under unchanged MIT permission terms

### Requirement: Fork Declaration and Install Guide in README

The `README.md` SHALL declare that the project is an independently maintained fork and SHALL provide an install guide for the tgz release, and it SHALL NOT reference the removed browse tool or Playwright.

#### Scenario: Fork declaration is present

- **WHEN** the top of `README.md` is read
- **THEN** it states the project is forked from OpenSpec (MIT) and independently maintained by DumoeDss, not affiliated with Fission-AI

#### Scenario: Install section covers fork install and prerequisites

- **WHEN** the README INSTALL section is read
- **THEN** it describes installing the tgz from GitHub Releases, states `engines.node >= 20.19.0`, lists the chrome-use prerequisites (Chrome, Node 22+, remote-debugging, first-CDP permission popup), warns to uninstall any upstream `openspec` first due to the `openspec` bin conflict, and notes alignment with upstream v1.5.0

#### Scenario: No browse or Playwright references

- **WHEN** the README is inspected
- **THEN** it contains no reference to the browse tool or Playwright as install prerequisites or features

### Requirement: CHANGELOG Fork Baseline

The `CHANGELOG.md` SHALL record a `0.1.0` fork-baseline entry while retaining the upstream version history.

#### Scenario: 0.1.0 entry tops retained history

- **WHEN** `CHANGELOG.md` is read
- **THEN** a `0.1.0` fork-baseline entry appears above the retained upstream 1.5.0 history

### Requirement: Tag-Triggered Release Workflow

The repository SHALL provide a new GitHub Actions workflow that, on a version tag push, builds the package and uploads the packaged tarball to a GitHub Release, without relying on bun, `build:browse`, or Playwright, and without disturbing the dead upstream-gated `release-prepare.yml`.

#### Scenario: Release workflow builds and uploads on tag

- **WHEN** a `v*` tag is pushed
- **THEN** the workflow checks out, sets up pnpm and node, runs `pnpm install --frozen-lockfile`, `pnpm build`, and `npm pack`, and uploads the resulting tgz to a GitHub Release

#### Scenario: Release workflow is fork-runnable

- **WHEN** the new workflow is inspected
- **THEN** it is not gated to the upstream repository and it invokes no bun, `build:browse`, or Playwright steps

#### Scenario: Legacy workflow left intact

- **WHEN** `release-prepare.yml` is inspected
- **THEN** it is unchanged (its `if: github.repository == 'Fission-AI/OpenSpec'` guard keeps it inert in the fork)

### Requirement: Verified Clean Pack Inventory

Local packaging SHALL produce a tarball containing the whitelisted directories and no removed-tool or backend residue, and the inventory SHALL be recorded for review.

#### Scenario: Pack contains only intended contents

- **WHEN** `npm pack` is run and the tarball contents are listed
- **THEN** `dist`, `bin`, `schemas`, `pipelines`, and `scripts` are present, and there is no browse residue and no `telemetry-backend/` directory

#### Scenario: Inventory is recorded

- **WHEN** the pack verification completes
- **THEN** the tarball inventory is recorded in the change notes

### Requirement: Release Delivery Is Escalated, Not Automated

Creating or pushing the release tag and publishing the GitHub Release SHALL NOT be performed as part of this change; they are escalated for human action.

#### Scenario: No tag or release is created during implementation

- **WHEN** this change is implemented
- **THEN** no `v0.1.0` tag is created or pushed and no GitHub Release is published; these steps are left for human-initiated delivery
