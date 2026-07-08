## MODIFIED Requirements

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

## ADDED Requirements

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
