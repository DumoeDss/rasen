# fork-release-preparation Specification

## Purpose
Establish the fork's independent release identity and delivery pipeline for phase 1: reset to a `0.1.0` semver baseline, carry dual copyright, declare the fork and its install guide in the README, record a fork-baseline CHANGELOG entry, provide a fork-runnable tag-triggered release workflow, verify a clean pack inventory, and keep actual release publication as a human-escalated step.

## Requirements
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

The repository SHALL provide a GitHub Actions workflow that, on a `rasen-v*` version tag push, builds the package and uploads the packaged tarball to a GitHub Release, without relying on bun, `build:browse`, or Playwright. The workflow SHALL trigger only on the `rasen-v*` namespace so that inherited upstream `v*` tags never fire it. The dead upstream-gated `release-prepare.yml` SHALL be removed.

#### Scenario: Release workflow builds and uploads on tag

- **WHEN** a `rasen-v*` tag is pushed (e.g., `rasen-v0.1.0`)
- **THEN** the workflow checks out, sets up pnpm and node, runs `pnpm install --frozen-lockfile`, `pnpm build`, and `npm pack`, and uploads the resulting `rasen-<version>.tgz` to a GitHub Release

#### Scenario: Inherited upstream tags do not trigger a release

- **WHEN** an inherited upstream `v*` tag (such as `v1.5.0`) is present or pushed
- **THEN** the release workflow does not run, because it matches only `rasen-v*`

#### Scenario: Release workflow is fork-runnable

- **WHEN** the workflow is inspected
- **THEN** it is not gated to the upstream repository and it invokes no bun, `build:browse`, or Playwright steps

#### Scenario: Dead legacy workflow removed

- **WHEN** the `.github/workflows/` directory is inspected
- **THEN** `release-prepare.yml` no longer exists

### Requirement: Verified Clean Pack Inventory

Local packaging SHALL produce a tarball for the `rasen` package containing the whitelisted directories and no removed-tool, backend, or legacy-tooling residue, and the inventory SHALL be recorded for review.

#### Scenario: Pack contains only intended contents

- **WHEN** `npm pack` is run and the tarball contents are listed
- **THEN** `dist`, `bin`, `schemas`, `pipelines`, and `scripts` are present, `bin/rasen.js` is the CLI entry, and there is no browse residue, no `posthog` residue, no `.changeset/` residue, and no `telemetry-backend/` directory

#### Scenario: Inventory is recorded

- **WHEN** the pack verification completes
- **THEN** the tarball inventory is recorded in the change notes

### Requirement: Release Delivery Is Escalated, Not Automated

Creating or pushing the release tag, publishing the GitHub Release, and publishing to npm SHALL NOT be performed as part of this change; they are escalated for human action.

#### Scenario: No tag, release, or publish during implementation

- **WHEN** this change is implemented
- **THEN** no `rasen-v0.1.0` tag is created or pushed, no GitHub Release is published, and no `npm publish` is run; these steps (including the fork's first `rasen-v0.1.0` release and `npm publish rasen@0.1.0`) are left for human-initiated delivery

### Requirement: Changeset-Free Release Process

The project SHALL release via simple manual semver plus GitHub Release notes, without the changesets toolchain. The `.changeset/` directory, the changesets-coupled package scripts (`release`, `release:ci`, `changeset`), and the `@changesets/*` devDependencies SHALL NOT be present.

#### Scenario: No changesets residue

- **WHEN** the repository is inspected
- **THEN** there is no `.changeset/` directory, `package.json` has no `changeset`/`release`/`release:ci` scripts, and `package.json` lists no `@changesets/*` devDependencies

#### Scenario: Frozen install still resolves

- **WHEN** `pnpm install --frozen-lockfile` is run after the changesets removal
- **THEN** it resolves successfully against the updated lockfile
- **AND** `pnpm build` succeeds

#### Scenario: Local pack guard retained

- **WHEN** a maintainer prepares a release
- **THEN** the `check:pack-version` script and `scripts/pack-version-check.mjs` remain available to verify the packed tarball's CLI `--version` matches `package.json`

### Requirement: Single Package-Manager Source of Truth

The repository SHALL declare pnpm as its sole package manager through package metadata and SHALL NOT track an npm `package-lock.json`, so that contributors and CI resolve exactly one lockfile (`pnpm-lock.yaml`) and one pnpm version.

#### Scenario: No npm lockfile is tracked

- **WHEN** the repository is checked out
- **THEN** no `package-lock.json` exists at the repository root
- **AND** `.gitignore` ignores a root `package-lock.json` so it cannot be reintroduced accidentally

#### Scenario: pnpm version is declared in package metadata

- **WHEN** CI provisions pnpm via `pnpm/action-setup@v4`
- **THEN** the pnpm version is read from the `packageManager` field in `package.json` rather than a hardcoded `version:` pin in each workflow step

#### Scenario: Frozen install still succeeds

- **WHEN** `pnpm install --frozen-lockfile` runs after the package-manager declaration is added
- **THEN** the install succeeds against the existing `pnpm-lock.yaml` without re-resolving dependencies
