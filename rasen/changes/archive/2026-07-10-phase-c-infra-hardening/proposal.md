## Why

Rasen's fork is code-complete but its release infrastructure has one genuine gap and three guarantees that hold today only by accident. The `rasen-v*` tag workflow builds a tarball and attaches it to a GitHub Release but never publishes to the npm registry, so `npm install -g rasen` cannot work — the primary distribution channel is missing. Meanwhile the CI OS matrix, the Nix pnpm-hash freshness check, and the production telemetry endpoint each work but are not pinned by a spec, so a future edit could silently regress them and the production telemetry path (`telemetry.rasen.io`) has never been verified end-to-end. Phase C hardens these so a single tag push ships both channels and the guarantees survive future changes.

## What Changes

- **Add an npm publish job to `release.yml`** that runs after the existing tarball job on a `rasen-v*` tag, publishes the version already in `package.json` (version-agnostic), uses npm provenance, and gracefully skips with a loud notice when `NPM_TOKEN` is not configured — so a maintainer who tags before adding the secret gets a working GitHub Release, not a red build.
- **Extend the CI test matrix with node-version coverage**: keep the existing 3-OS legs at the `engines` floor (Node 20.19.0) and add one Linux leg at the current Node major, so the declared `>=20.19.0` support range is verified at both ends rather than only at the floor.
- **Codify the existing Nix pnpm-hash freshness guarantee**: the CI Nix job already fails when `flake.nix`'s `pnpmDeps.hash` is stale (because `nix build` re-fetches against `pnpm-lock.yaml`), but no requirement states this, so a job reordering could quietly drop the check. Add a scenario pinning it.
- **Verify the production telemetry endpoint end-to-end and codify its contract**: probe `telemetry.rasen.io` for valid TLS and a 202 to a synthetic well-formed event, emit one real CLI event against it, and record the evidence — with a documented graceful outcome (record status as a pending external dependency, do not block the change) if Cloudflare TLS provisioning is still in flight.

No product source changes are expected: `src/telemetry/index.ts` already targets the correct endpoint with a sound fire-and-forget design; the telemetry work is verification, not code. All release/CI edits are validated statically (no tag is pushed).

## Capabilities

### New Capabilities

_None. This change hardens existing infrastructure capabilities via deltas._

### Modified Capabilities

- `fork-release-preparation`: the tag-triggered release workflow now also publishes to the npm registry; delivery is no longer fully manual — tag creation/push stays human-initiated, but publication is automated on that tag when `NPM_TOKEN` is present.
- `ci-test-harness`: the test matrix gains a node-version dimension covering both the `engines` floor and the current Node major.
- `ci-nix-validation`: the flake-build requirement gains a scenario pinning that a stale `pnpmDeps.hash` fails CI.
- `telemetry-backend`: adds a requirement that the production custom-domain endpoint serves valid TLS and accepts CLI-emitted events end-to-end, with a recorded-verification obligation.

## Impact

- **Files**: `.github/workflows/release.yml` (new publish job), `.github/workflows/ci.yml` (matrix node dimension). No changes to `flake.nix`, `src/telemetry/*`, `package.json`, CHANGELOG, README, or docs.
- **Secrets / config**: introduces a dependency on a repository `NPM_TOKEN` secret (documented for the user; graceful skip if absent). npm provenance requires `id-token: write` permission on the publish job.
- **External dependencies**: telemetry verification depends on Cloudflare having completed TLS provisioning for `telemetry.rasen.io`; the change degrades gracefully if not.
- **Boundary**: no push, no tag, no version bump — release-workflow changes are static-verified only. Phase A/B surfaces (version, CHANGELOG, docs/specs branding) are untouched.
