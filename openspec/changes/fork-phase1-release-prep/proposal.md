## Why

With browse replaced by chrome-use (A1/A2/A3) and telemetry migrated to the maintainer's own Cloudflare Worker (B1/B2), the fork is functionally independent of upstream infrastructure but still presents as upstream: version 1.5.0, single-copyright MIT, no fork declaration, and a release pipeline permanently gated off for forks. This change (batch C, the final portfolio child) prepares the fork's first independent release — version reset, dual copyright, fork-declaring README with an INSTALL section, a CHANGELOG baseline, and a new tag-triggered Release Action — and locally verifies the packaged tarball is clean. It does NOT create the tag or publish the release; those outward-facing delivery steps are escalated to the user at run end.

## What Changes

- **`package.json` version reset**: `1.5.0` → `0.1.0` (the fork's independent semver starting point; it does not continue upstream's 1.5.x line). Per the fork-publish-strategy design, `repository`/`homepage` are NOT changed in phase 1 (that is bundled with the phase-2 npm publish); `name`, `bin` (`openspec`), and branding stay as-is in phase 1.
- **`LICENSE` dual copyright**: keep `Copyright (c) 2024 OpenSpec Contributors`, ADD `Copyright (c) 2026 DumoeDss` — MIT terms unchanged.
- **`README.md`**: add a top fork-declaration blockquote (`> Forked from OpenSpec (MIT) by Fission-AI — independently maintained by DumoeDss, not affiliated with Fission-AI.`); ensure a CI badge reflects the fork's CI; add an INSTALL section (tgz install from GitHub Releases, `engines.node >= 20.19.0`, chrome-use prerequisites — Chrome + Node 22+ + remote-debugging + first-CDP permission popup, a warning to uninstall any upstream `openspec` first because the `openspec` bin conflicts, and a note that the fork is "aligned with upstream v1.5.0"). No browse/playwright mentions anywhere.
- **`CHANGELOG.md`**: add a new `0.1.0` fork-baseline entry on top of the retained upstream 1.5.0 history.
- **New `.github/workflows/release.yml`**: triggered on `v*` tag push — checkout, setup pnpm + node, `pnpm install --frozen-lockfile`, `pnpm build`, `npm pack`, and `gh release upload` the tgz. No bun, no `build:browse`, no playwright. The dead `release-prepare.yml` (permanently gated by `if: github.repository == 'Fission-AI/OpenSpec'`) is left untouched.
- **Local pack verification**: `npm pack` + `tar -tzf` inventory confirming `dist`/`bin`/`schemas`/`pipelines`/`scripts` are present with ZERO browse residue and no `telemetry-backend/`; the inventory is recorded in the change notes.

**HARD SCOPE BOUNDARY**: creating/pushing the `v0.1.0` tag and publishing the actual GitHub Release are outward-facing, portfolio-level delivery actions — NOT part of this change's implementation. C prepares and locally verifies everything; the LEAD escalates the tag + Release to the user at run end.

## Capabilities

### New Capabilities
- `fork-release-preparation`: The repository is prepared for the fork's first independent tgz release — fork-baseline version, dual-copyright LICENSE, fork-declaring README with an INSTALL guide, a CHANGELOG baseline, a tag-triggered Release Action that builds and uploads a clean tarball (no bun/browse/playwright), and a verified pack inventory free of browse and backend residue.

### Modified Capabilities
<!-- None. Version/LICENSE/README/CHANGELOG/workflow are repository artifacts, not an existing spec capability. browse/playwright removal from package.json is A3's. -->

## Impact

- **Files**: `package.json` (version only), `LICENSE`, `README.md`, `CHANGELOG.md`, new `.github/workflows/release.yml`; change notes for the pack inventory.
- **Depends on**: A3 (browse fully removed from package.json/tree — so pack is clean) and B2 (telemetry client shipped — posthog-node gone). Both review-clean.
- **Files whitelist unchanged**: `files` stays `dist`/`bin`/`schemas`/`pipelines`/`scripts/postinstall.js` — `telemetry-backend/` and `skills/` are auto-excluded from the tarball (verified in B1/A1 findings); C only verifies, does not edit the whitelist.
- **Telemetry note**: transport is `node:https` to `https://openspec-telemetry.ws11579.workers.dev` (B2's shipped deviation, not native fetch; it ignores `HTTP(S)_PROXY`) — if the README documents telemetry, describe that behavior.
- **Out of scope**: the actual tag + GitHub Release (user-escalated); any rename/bin-change/npm-publish/`repository`-homepage change (phase 2).
