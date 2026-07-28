## Context

The root package and `packages/ui` are intentionally separate dependency graphs. The current `rasen-v*` workflow builds, releases, and publishes only the root CLI; the UI is already an npm package but has no release job and no runtime protocol/version handshake with the CLI management API. Rasen 0.1.5 publicly presents them as one management platform.

SemVer has exactly `major.minor.patch`; a value such as `0.1.5.1` is invalid. Pre-release forms such as `0.1.5-ui.1` sort below the stable release and are not selected by npm's normal `latest` behavior, so they do not solve stable UI-only servicing.

## Goals / Non-Goals

**Goals:**

- Publish CLI and UI as one deliberate, fail-closed release unit during 0.1.x.
- Make UI-only fixes releasable through an ordinary lockstep patch bump.
- Produce two verified tarballs and one curated GitHub Release from one tag.
- Keep missing npm credentials non-blocking while surfacing configured publication failures.
- Give both the GitHub Release and website one curated changelog source.

**Non-Goals:**

- Introduce independent UI versioning or a fourth version component.
- Add a management-API compatibility handshake in 0.1.5.
- Make npm publication transactional; npm has no cross-package atomic commit.
- Automatically create or push release tags.

## Decisions

### D1 — Strict lockstep through 0.1.x

Both package manifests carry the same version. Any stable release, including a UI-only correction, increments the shared patch and publishes both packages. Re-publishing an unchanged CLI under a new patch is acceptable: it expresses the tested compatibility set and avoids a stale global UI beside a newer CLI.

Alternative: independent versions require an API compatibility range, discovery handshake, and user-facing mismatch remediation that do not exist today. Revisit that model at or after a versioned management API.

### D2 — One canonical version guard

Add an ESM script that reads both manifests using `node:path`, validates canonical three-component SemVer, parses the exact `rasen-vX.Y.Z` tag supplied by CI, and fails on any mismatch. It also extracts the matching release-notes section from explicitly marked Rasen history.

The script has a check mode usable locally without a tag (package equality plus changelog section) and a release mode with the tag required.

### D3 — Build/package both dependency graphs in the release job

The release job:

1. installs the root with frozen pnpm;
2. installs `packages/ui` using its own frozen lockfile;
3. runs the lockstep guard;
4. tests/builds the root;
5. typechecks/tests/builds the UI;
6. packs each package into a controlled output directory;
7. verifies both tarballs;
8. creates the GitHub Release with both tarballs and extracted notes.

Keeping this in one job ensures the GitHub Release is not created from a partial build.

### D4 — One paired npm publication job

The npm job depends on the GitHub Release job, repeats checkout/install/build as needed on a clean runner, and runs the guard before publishing CLI then UI with provenance.

npm cannot atomically publish two packages. CLI-first is chosen because it is the required package and the UI is optional. Any second-publish failure fails loudly; the rerun procedure checks registry state and publishes only the missing exact tarball rather than bumping silently.

Alternative parallel publish jobs would allow one to appear successful while the overall pairing failed and would make operator recovery harder to read.

### D5 — Curated changelog markers

Add explicit `rasen-history:start` and `rasen-history:end` comments around the independent fork history. The release helper extracts one exact `## X.Y.Z` section and writes a temporary notes file under the runner temp directory. The site consumes the full bounded region from the same tag.

This avoids GitHub auto-generated notes becoming a second editorial source.

### D6 — UI pack verification is package-specific

The existing CLI guard continues to run the packed CLI's `--version`. A sibling paired guard inspects the UI tarball's package manifest version and requires `package/dist/index.html`; it does not try to execute a browser bundle under Node.

All temporary paths use `fs.mkdtemp`/`path.join` and are cleaned in `finally`, preserving Windows/macOS/Linux behavior.

## Risks / Trade-offs

- [Risk] CLI publish succeeds and UI publish fails. → Fail the workflow, retain exact packed artifacts on the GitHub Release, and document exact-version recovery; never pretend the pair was successful.
- [Risk] Publishing an unchanged CLI patch creates release noise. → The paired compatibility guarantee is more valuable during 0.1.x; CHANGELOG labels a UI-only release honestly.
- [Risk] Two dependency installs increase release time. → UI is small and its existing CI already proves the commands; correctness is preferred over sharing an undeclared workspace.
- [Risk] Root and UI package managers drift. → Both manifests/lockfiles are verified independently with pinned pnpm setup and frozen installs.
- [Trade-off] Tag-to-manifest equality is stricter than the old “manifest only” release. → This prevents a mistaken tag from publishing the wrong pair and is appropriate now that one tag coordinates three public outputs.

## Migration Plan

1. Set `packages/ui/package.json` and its lockfile to `0.1.5`, matching the root.
2. Add changelog markers and release helpers/tests.
3. Replace the release workflow's CLI-only build/publish paths with paired jobs.
4. Run both package test/build/pack guards locally.
5. A maintainer deliberately pushes `rasen-v0.1.5`; no implementation step creates the tag.

Rollback is a workflow revert before the tag. Published npm versions are immutable; after publication, corrections use the next shared patch.

## Open Questions

Independent UI servicing can be reconsidered after the management API exposes a versioned compatibility contract. It is intentionally deferred for 0.1.x.
