## MODIFIED Requirements

### Requirement: Automated npm Publish on Tag

On a `rasen-v*` version tag push, after the release build succeeds, the repository SHALL publish both `@atelierai/rasen` and `@atelierai/rasen-ui` to the npm registry at the same version with npm provenance attestation. Publication SHALL be gated on a configured `NPM_TOKEN` repository secret; when that secret is absent the workflow SHALL skip both publications with a visible notice rather than failing the GitHub Release.

#### Scenario: Both packages publish after a successful release build

- **WHEN** a `rasen-v*` tag is pushed, both package builds and release guards succeed, and `NPM_TOKEN` is configured
- **THEN** one publication job publishes the CLI package and UI package at their shared declared version
- **AND** both publishes use provenance and the standard registry authentication token

#### Scenario: Version comes from package manifests

- **WHEN** the publish job runs
- **THEN** each published version comes from its package manifest
- **AND** a pre-publication guard has already proven that both manifests and the release tag identify the same exact version

#### Scenario: Missing token skips gracefully with a notice

- **WHEN** a `rasen-v*` tag is pushed and `NPM_TOKEN` is not configured
- **THEN** the publish job attempts neither package publication and does not fail the release
- **AND** it emits a visible workflow notice naming both skipped packages
- **AND** the GitHub Release assets remain available

#### Scenario: A configured publication failure is visible

- **WHEN** `NPM_TOKEN` is configured but either package publication fails
- **THEN** the publication job fails loudly and does not report a successful paired npm release

### Requirement: Tag-Triggered Release Workflow

The repository SHALL provide one GitHub Actions workflow that, on a `rasen-v*` version tag push, validates lockstep package versions, builds and tests the CLI and UI, uploads both package tarballs to a GitHub Release with curated notes, publishes both packages to npm subject to the `NPM_TOKEN` gate, and notifies the site only after the GitHub Release succeeds. The workflow SHALL trigger only on the `rasen-v*` namespace.

#### Scenario: Release workflow validates and builds both packages

- **WHEN** a canonical `rasen-vX.Y.Z` tag is pushed
- **THEN** the workflow checks out the tagged source, installs both locked dependency graphs, verifies exact version equality, runs CLI and UI tests/builds, packs both packages, and uploads both tarballs

#### Scenario: Release notes come from the curated changelog

- **WHEN** the release is created for `rasen-vX.Y.Z`
- **THEN** its body is the exactly matching `X.Y.Z` section extracted from the bounded Rasen history in `CHANGELOG.md`

#### Scenario: Release workflow publishes both packages

- **WHEN** release validation succeeds and `NPM_TOKEN` is configured
- **THEN** both `@atelierai/rasen@X.Y.Z` and `@atelierai/rasen-ui@X.Y.Z` are published from the same tagged run

#### Scenario: Inherited upstream tags do not trigger a release

- **WHEN** an inherited upstream `v*` tag is present or pushed
- **THEN** the release workflow does not run

#### Scenario: Dead legacy workflow remains absent

- **WHEN** `.github/workflows/` is inspected
- **THEN** `release-prepare.yml` is absent

## ADDED Requirements

### Requirement: Lockstep CLI and UI Version

During the Rasen 0.1.x line, the CLI and UI packages SHALL declare the same canonical SemVer and a release tag SHALL identify that exact version. A UI-only fix SHALL advance both package patch versions even when the CLI has no functional code change.

#### Scenario: Versions match

- **WHEN** the release guard inspects root `package.json`, `packages/ui/package.json`, and `rasen-vX.Y.Z`
- **THEN** all three versions are identical and canonical

#### Scenario: UI-only patch is released

- **WHEN** a UI-only fix follows the `0.1.5` release
- **THEN** both package manifests advance to `0.1.6` and the maintainer releases `rasen-v0.1.6`

#### Scenario: Four-component version is rejected

- **WHEN** a manifest or tag uses a value such as `0.1.5.1`
- **THEN** the release guard rejects it as non-SemVer and no package is built or published

#### Scenario: Version drift is rejected

- **WHEN** either package version differs from the other package or tag
- **THEN** the release guard fails before GitHub Release creation and npm publication

### Requirement: Paired Package Verification

Local and CI release guards SHALL pack both packages and SHALL verify that each tarball advertises the shared release version and contains its required entry output.

#### Scenario: Both package tarballs are valid

- **WHEN** paired package verification runs
- **THEN** the CLI tarball reports the expected CLI version and contains its CLI entry
- **AND** the UI tarball reports the same package version and contains `dist/index.html`

#### Scenario: UI output is missing

- **WHEN** the UI package pack lacks `dist/index.html`
- **THEN** verification fails before publication
