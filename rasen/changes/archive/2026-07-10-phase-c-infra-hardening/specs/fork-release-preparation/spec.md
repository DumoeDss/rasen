## ADDED Requirements

### Requirement: Automated npm Publish on Tag

On a `rasen-v*` version tag push, after the tarball build succeeds, the repository SHALL publish the package to the npm registry using the version already declared in `package.json`, with npm provenance attestation. Publication SHALL be gated on a configured `NPM_TOKEN` repository secret; when that secret is absent the workflow SHALL skip publication with a visible notice rather than failing the release, so the GitHub Release tarball is never blocked by unconfigured npm credentials.

#### Scenario: Publish runs after a successful tarball build

- **WHEN** a `rasen-v*` tag is pushed and the tarball build job succeeds
- **THEN** a distinct publish job runs that depends on the tarball job
- **AND** it runs `npm publish` for the version in `package.json` with provenance enabled
- **AND** it authenticates using the `NPM_TOKEN` repository secret via the standard registry auth token, with no committed `.npmrc`

#### Scenario: Version comes from package.json, not the tag

- **WHEN** the publish job runs
- **THEN** the published version is read from `package.json` and no version is derived from the tag name or bumped by the workflow

#### Scenario: Missing token skips gracefully with a notice

- **WHEN** a `rasen-v*` tag is pushed and the `NPM_TOKEN` secret is not configured
- **THEN** the publish job does not attempt `npm publish` and does not fail the release
- **AND** it emits a visible workflow notice stating that npm publish was skipped because `NPM_TOKEN` is not set
- **AND** the GitHub Release tarball from the tarball job is still produced

#### Scenario: A configured token that fails still surfaces the failure

- **WHEN** `NPM_TOKEN` is configured but `npm publish` itself fails (for example a registry error or a duplicate version)
- **THEN** the publish job fails loudly rather than being silently skipped

## MODIFIED Requirements

### Requirement: Tag-Triggered Release Workflow

The repository SHALL provide a GitHub Actions workflow that, on a `rasen-v*` version tag push, builds the package, uploads the packaged tarball to a GitHub Release, and publishes the package to the npm registry (subject to the `NPM_TOKEN` gate), without relying on bun, `build:browse`, or Playwright. The workflow SHALL trigger only on the `rasen-v*` namespace so that inherited upstream `v*` tags never fire it. The dead upstream-gated `release-prepare.yml` SHALL NOT be present.

#### Scenario: Release workflow builds and uploads on tag

- **WHEN** a `rasen-v*` tag is pushed (e.g., `rasen-v0.1.0`)
- **THEN** the workflow checks out, sets up pnpm and node, runs `pnpm install --frozen-lockfile`, `pnpm build`, and `npm pack`, and uploads the resulting `rasen-<version>.tgz` to a GitHub Release

#### Scenario: Release workflow publishes to npm on tag

- **WHEN** a `rasen-v*` tag is pushed and `NPM_TOKEN` is configured
- **THEN** the workflow publishes the package to the npm registry after the tarball build, so both the GitHub Release and npm channels ship from one tag push

#### Scenario: Inherited upstream tags do not trigger a release

- **WHEN** an inherited upstream `v*` tag (such as `v1.5.0`) is present or pushed
- **THEN** the release workflow does not run, because it matches only `rasen-v*`

#### Scenario: Release workflow is fork-runnable

- **WHEN** the workflow is inspected
- **THEN** it is not gated to the upstream repository and it invokes no bun, `build:browse`, or Playwright steps

### Requirement: Release Delivery Is Escalated, Not Automated

Creating or pushing the release tag SHALL NOT be performed automatically; it is a human-initiated action. Once a maintainer pushes a `rasen-v*` tag, GitHub Release upload and npm publication are performed automatically by the release workflow (npm publication subject to the `NPM_TOKEN` gate). Publishing therefore requires a deliberate human tag push plus a configured `NPM_TOKEN`, but is no longer a separate manual `npm publish` step.

#### Scenario: No tag is created or pushed during implementation

- **WHEN** this change is implemented
- **THEN** no `rasen-v*` tag is created or pushed and no GitHub Release is published as part of the change; the release workflow's live behavior is verified statically only

#### Scenario: Publication is human-gated at the tag

- **WHEN** a maintainer wants to ship a release
- **THEN** they must deliberately push a `rasen-v*` tag and have `NPM_TOKEN` configured for the npm channel; the workflow does not publish on its own without a human tag push
