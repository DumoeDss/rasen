# Rasen Scripts

Utility scripts for Rasen maintenance and development.

## update-flake.sh

Updates `flake.nix` pnpm dependency hash automatically.

**When to use**: After updating dependencies (`pnpm install`, `pnpm update`).

**Usage**:
```bash
./scripts/update-flake.sh
```

**What it does**:
1. Reads version from `package.json` (dynamically used by `flake.nix`)
2. Automatically determines the correct pnpm dependency hash
3. Updates the hash in `flake.nix`
4. Verifies the build succeeds

**Example workflow**:
```bash
# After dependency updates
pnpm install
./scripts/update-flake.sh
git add flake.nix
git commit -m "chore: update flake.nix dependency hash"
```

## postinstall.js

Post-installation script that runs after package installation.

## pack-version-check.mjs

Packs the CLI into a temporary project and verifies its installed
`rasen --version` output matches the root package manifest.

## release-contract.mjs

Validates the 0.1.x lockstep release contract:

- root CLI and `packages/ui` use the same canonical `X.Y.Z` version;
- an optional `--tag rasen-vX.Y.Z` identifies that exact version;
- `CHANGELOG.md` contains a bounded Rasen history and one matching release
  section;
- `--notes-output <path>` writes that curated section for the GitHub Release.

`0.1.5.1` is not SemVer. During 0.1.x, a UI-only correction after 0.1.5
advances both manifests to 0.1.6 and releases both packages from
`rasen-v0.1.6`; the CLI may contain no functional change.

## paired-pack-check.mjs

Runs the CLI pack/version guard and packs the UI into a cross-platform
temporary directory, requiring the shared version plus
`package/dist/index.html`. Run after building the UI:

```bash
pnpm --dir packages/ui build
pnpm check:paired-pack
```

The tag-triggered release workflow runs the lockstep guard, tests/builds both
dependency graphs, uploads both tarballs with curated notes, then publishes
the CLI followed by the UI when `NPM_TOKEN` is configured. npm cannot publish
two packages atomically: if the UI publish fails after the CLI succeeds, the
workflow fails and the exact GitHub Release artifacts are retained for
operator recovery.
