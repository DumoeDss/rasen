## Why

Upstream `8ac624b` (chore: remove stale npm lockfile, #1319) removes a 4,978-line vestigial `package-lock.json` and switches CI to derive the pnpm version from `package.json`'s `packageManager` field instead of pinning `version: 9` in every `pnpm/action-setup@v4` step. The fork carries the same dead `package-lock.json` (~179 KB, last touched 2026-07-06) even though it uses pnpm exclusively (`pnpm-lock.yaml`), and the same duplicated `version: 9` pins. Carrying the pick removes a confusing second lockfile that can mislead contributors and drift from `pnpm-lock.yaml`, and makes the pnpm version single-sourced.

## What Changes

- **Delete `package-lock.json`** — vestigial npm lockfile; the project builds and installs with pnpm only.
- **Add `packageManager: "pnpm@9.15.9"` to `package.json`** so `pnpm/action-setup@v4` reads the version from package metadata.
- **Strip `with: version: 9`** from the `pnpm/action-setup@v4` steps in `.github/workflows/ci.yml` (3 occurrences on the fork: the `test_pr`, `test_matrix`, and `lint` jobs) and in `.github/workflows/deploy-docs.yml` (1 occurrence).
- **Ignore a root `package-lock.json`** in `.gitignore` (`/package-lock.json`) so it cannot be reintroduced accidentally.

## Fork adaptations vs upstream

- The upstream hunk touching `.github/workflows/release-prepare.yml` is **dropped** — that file was deleted during the rasen fork (release runs via `rasen-v*` tag → `release.yml`).
- The upstream 4th `ci.yml` hunk (a changesets-gated `pnpm/action-setup` step) is **dropped** — the changesets job does not exist on the fork.
- The `package.json` `author` field diverged (`DumoeDss` vs upstream `OpenSpec Contributors`); the `packageManager` hunk anchors on `"type": "module"` / `"publishConfig"`, which are intact, so it applies without touching `author`.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `fork-release-preparation`: the repository declares a single package-manager source of truth (`packageManager` in `package.json`), does not track an npm `package-lock.json`, and CI derives the pnpm version from package metadata rather than a hardcoded pin.

## Impact

- **Files:** `package-lock.json` (delete), `package.json` (+1 line), `.gitignore` (+1 line), `.github/workflows/ci.yml` (−3 pins), `.github/workflows/deploy-docs.yml` (−1 pin).
- **Verification:** `CI=true pnpm install --ignore-workspace` (repo is nested in an outer pnpm workspace; must use `--ignore-workspace`) confirms `pnpm-lock.yaml` still satisfies `--frozen-lockfile` after the `package.json` edit; `pnpm build` sanity. No runtime code changes, so no vitest suite is behaviorally affected.
- **Serial edge:** child `win-flake` (C) also edits `ci.yml` and MUST run after this change (shared file). This change removes `version: 9`; C restructures the job graph. Applying C first would conflict on the same steps.
- **Constraint:** do not touch the Nix job in `ci.yml`; `flake.nix` `pnpmDeps.hash` is separately known-stale and out of scope for this batch.
- **Delivery:** local ship (commit only, pathspec-scoped); no push, no tag.

## Simple vs Complex

**Simple** — tooling/packaging only, no runtime logic; verification is install + build.
