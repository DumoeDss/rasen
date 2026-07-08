## Why

rename-core made the package `rasen`; the release plumbing still assumes the old world. The release workflow triggers on `v*` — which collides with the dozens of upstream `v0.1.0…v1.5.0` tags the fork inherited and would misfire on `git push --tags`. Release publication still runs through changesets whose config points at `Fission-AI/OpenSpec`, and `release-prepare.yml` is dead code gated to the upstream repo. A stale `result/bin/openspec` check in CI will now fail because the binary is `rasen`. And one `update.test.ts` assertion breaks because its hardcoded "stale" version sentinel happens to equal the live fork version. This change makes the fork independently releasable under the `rasen-v*` tag namespace with a simple, changeset-free flow.

## What Changes

- **Tag namespace `rasen-v*`**: `.github/workflows/release.yml` triggers on `rasen-v*` instead of `v*` (first release will be `rasen-v0.1.0`). This sidesteps the inherited upstream `v*` tags and defuses the `git push --tags` footgun (upstream tags can never match `rasen-v*`).
- **Fix stale CI brand references** in `.github/workflows/ci.yml`: the nix build-output check `result/bin/openspec` → `result/bin/rasen` and its "openspec binary" / "OpenSpec version" echo strings, so the nix job passes post-rename.
- **Remove changesets** entirely: delete `.changeset/` (config pinned to `Fission-AI/OpenSpec`, plus pending changeset entries), drop the `release`/`release:ci`/`changeset` scripts and the `@changesets/*` devDependencies from `package.json`, and delete the dead upstream-gated `release-prepare.yml`. Releases move to simple semver + GitHub Release notes.
- **Fix the pre-existing `update.test.ts` failure**: demote the three hardcoded "stale" `generatedBy: "0.1.0"` sentinels to `"0.0.1"` so they no longer equal the live fork version (`0.1.0`). The dynamic `generatedBy: "${version}"` at the current-version site stays. The package version is NOT changed.
- **npm publish preparation** (prepare only — the user publishes): a local `npm pack` + `tar -tzf` inventory verification (dist/bin/schemas/pipelines/scripts present, `bin/rasen.js` correct, no browse/posthog/changesets residue, README is the rasen README), plus documenting the publish command and the existing `rasen@0.0.1` npm placeholder (real publish will be `0.1.0`).
- **USPTO trademark recheck**: a 5-minute `tmsearch.uspto.gov` search for "rasen", result recorded in the change directory (the film "Ring 2 / Rasen" is a known same-name non-software work — expected and fine).

## Capabilities

### New Capabilities
<!-- None. This change modifies the existing fork-release-preparation capability. -->

### Modified Capabilities
- `fork-release-preparation`: The release workflow triggers on the `rasen-v*` tag namespace; releasing no longer uses changesets (simple semver + GitHub Release notes) and removes the dead `release-prepare.yml`; the escalated human delivery actions are updated to the rasen-branded first release (`rasen-v0.1.0` tag + GitHub Release + `npm publish rasen@0.1.0`); the clean-pack inventory reflects the renamed package.

## Impact

- **Workflows**: `.github/workflows/release.yml` (trigger), `.github/workflows/ci.yml` (nix bin check), delete `.github/workflows/release-prepare.yml`.
- **Changesets**: delete `.changeset/` directory.
- **Package**: `package.json` scripts (`release`, `release:ci`, `changeset` removed; `check:pack-version` kept as a standalone guard) and devDependencies (`@changesets/cli`, `@changesets/changelog-github` removed); `pnpm-lock.yaml` re-synced by `pnpm install`.
- **Tests**: `test/core/update.test.ts` (sentinels at lines 653, 782, 836).
- **Out of scope / must NOT touch**: README/docs (C2/deferred), `src/**` brand strings (rename-core done), the telemetry endpoint (C4). No pushing, tagging, or publishing — local commit only; the tag/Release/publish are escalated to the user at run end.
