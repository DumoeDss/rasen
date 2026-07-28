## Why

Rasen's CLI and optional web UI now form one management product but are published independently: the tag workflow publishes only the CLI, the UI package can remain stale, and there is no runtime compatibility negotiation between them. For the 0.1.x line, releasing both packages at one version from one deliberate tag is the smallest reliable contract.

## What Changes

- Require the root CLI package and `packages/ui` package to declare the same exact SemVer before a release can proceed.
- Extend the existing `rasen-v*` workflow to validate the tag/package version relationship, build and test both packages, and publish both from the same successful release run.
- Use one `NPM_TOKEN` gate and preserve the existing behavior that an absent token skips npm publication without blocking the GitHub Release.
- Treat UI-only fixes during 0.1.x as lockstep patch releases: both packages advance together (for example `0.1.5` to `0.1.6`) even when the CLI has no functional code change.
- Generate the GitHub Release body from the matching curated `CHANGELOG.md` section so the release page and website can share one source of truth.
- Add local/static release guards for version equality, exact tag matching, changelog extraction, and package inventory/version checks for both tarballs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `fork-release-preparation`: Extend the tag-triggered delivery contract from one CLI package to a lockstep CLI/UI release with curated release notes.

## Impact

- `.github/workflows/release.yml` jobs, permissions, artifacts, and npm publication behavior.
- Root `package.json`, `packages/ui/package.json`, both lockfiles, and release-check scripts/tests.
- Maintainer release procedure: one exact version bump across both packages and one `rasen-vX.Y.Z` tag.
- npm receives `@atelierai/rasen` and `@atelierai/rasen-ui` at the same version; a failed configured publication remains visible and fails the release run.
