---
name: rasen-npm-pack
description: Build and verify an npm .tgz from an unreleased Rasen branch with a failure-safe temporary -dev.local version, provide cross-machine installation steps, and avoid publishing by default
license: MIT
compatibility: Requires the Rasen repository, Node.js 20.19 or newer, pnpm 9.15.9, and npm.
metadata:
  author: rasen
  version: "1.0"
  generatedBy: "0.1.4"
---

# /rasen:npm-pack — Package an Unreleased Rasen CLI or UI

Create or inspect an installable npm tarball for the current unreleased Rasen
working tree. Prefer this workflow when the user needs to test a branch on
another machine before the corresponding npm release exists.

By default the helper packs the root CLI package (`@atelierai/rasen`). Pass
`--package packages/ui` to pack the management UI (`@atelierai/rasen-ui`)
instead — same dev-local versioning, same failure-safe restore. The CLI and UI
are separate npm packages: the UI tarball is **not** bundled inside the CLI
tarball, and `rasen ui` resolves it at runtime from the globally installed
`@atelierai/rasen-ui` (see Phase 4).

## Safety boundary

- Default to a local npm tarball. Do not run `npm publish`, persist a package
  version change, create a release, push a branch, or install globally unless
  the user explicitly requests that action.
- The packaging helper temporarily changes only the target `package.json` version
  from `<version>` to `<version>-dev.local.<n>` (an auto-incrementing per-package,
  per-base-version index; see Phase 3), keeps that value through build and pack,
  and restores the original file bytes in `finally`. The target is the root
  `package.json` by default, or `packages/ui/package.json` under `--package
  packages/ui`. Do not edit that `package.json` concurrently while the helper is
  running.
- Treat the current working tree as package input. Inspect and report staged,
  unstaged, and untracked source changes before building; do not silently omit or
  discard them.
- Preserve unrelated work. Write actual tarballs below the globally ignored
  repository-local `./artifacts/` directory by default, and never delete or
  overwrite an existing tarball unless the user asks.
- Never describe SHA-256 package digests as publisher authentication or trust.
- Distinguish npm tarballs from Rasen workflow packages:
  - npm installs `.tar`, `.tar.gz`, or `.tgz` package archives;
  - `.rasenpkg` is workflow data and must be imported with
    `rasen workflow import <file.rasenpkg>` after a compatible CLI is installed.

## Phase 1: Inspect the package source

Run these checks from the Rasen repository root:

```bash
git status --short --branch
node --version
pnpm --version
npm --version
node -p "const p=require('./package.json'); p.name + '@' + p.version"
```

Confirm the following before continuing:

- Node.js is at least 20.19;
- pnpm matches the repository's declared `packageManager` version;
- the target manifest names a package under the `@atelierai/` scope — the CLI
  `@atelierai/rasen` (root, exposes `bin/rasen.js`) or, with `--package
  packages/ui`, the UI `@atelierai/rasen-ui`;
- the user understands whether uncommitted source changes should be included;
- the target manifest has a stable `major.minor.patch` version that can safely be
  labeled `<version>-dev.local` for the local tarball.

The UI package (`packages/ui`) is **not** part of a pnpm workspace (there is no
`pnpm-workspace.yaml` at the repo root); it has its own lockfile and `node_modules`.
If the UI build fails to resolve a dependency, install UI deps inside the package
dir rather than at the root:

```bash
# from the repo root, only if a UI dep is missing from packages/ui/node_modules:
pnpm --dir packages/ui install
```

If dependencies are missing, use the locked install rather than updating them:

```bash
pnpm install --frozen-lockfile
```

Do not use `npm version` for this one-off package: it can update lockfiles and
invoke version lifecycle behavior. Use the skill helper so `pnpm-lock.yaml`
remains untouched and the exact original `package.json` bytes are restored.

## Phase 2: Build and inspect without creating an archive

Use the supporting helper from the repository root. In the standard local-docs
setup it is exposed through `.claude/skills/`:

```bash
node .claude/skills/rasen-npm-pack/scripts/pack-dev-local.mjs --dry-run
```

The helper performs this sequence as one failure-safe operation:

1. read and retain the exact root `package.json` bytes;
2. temporarily change `version` to `<original-version>-dev.local.<n>`;
3. run `pnpm run build`;
4. run `npm pack --dry-run --json --ignore-scripts` while the temporary version
   is still active;
5. restore and verify the original `package.json` bytes in `finally`.

State explicitly that `--dry-run` creates no `.tgz`. Review the JSON and verify
that the package contains the runtime surfaces expected by the current manifest,
including at least:

- `bin/rasen.js`;
- compiled `dist/` entry points and locale catalogs;
- `schemas/`, `skills/`, and `pipelines/`;
- `scripts/postinstall.js`;
- `package.json`, `README.md`, and `LICENSE`.

Also inspect for accidental secrets, local configuration, source-only fixtures,
or other files that should not ship. Use the package's `files` allowlist as the
primary boundary; do not broaden it without a concrete packaging requirement.

## Phase 3: Create the npm tarball

Only create the archive when the user asks for an actual package. Run the helper
without `--dry-run` so build and pack both observe the temporary dev version:

```bash
node .claude/skills/rasen-npm-pack/scripts/pack-dev-local.mjs
```

By default the helper creates `./artifacts/` and writes
`<name>-<original-version>-dev.local.<n>.tgz` there, where `<n>` is an
auto-incrementing per-package, per-base-version index (repeated packs of the
same package yield `...-dev.local.1.tgz`, `...-dev.local.2.tgz`, ...). The index
is `max(persisted counter, highest existing indexed tarball in the destination)
+ 1`; the counter is keyed by `<name>@<base-version>` and lives under the skill
dir (`.claude/skills/rasen-npm-pack/.devlocal-counters.json`), so the CLI and UI
keep independent monotonic indices even when they share a base version. It keeps
the number monotonic even after old tarballs are deleted, so reinstalling a fresh
build always updates — npm would otherwise skip an unchanged version. `--dry-run`
previews the next index without consuming it. The helper prints the exact
absolute archive path after npm finishes. If the user requested another destination, use:

```bash
node .claude/skills/rasen-npm-pack/scripts/pack-dev-local.mjs --pack-destination <directory>
```

### Packaging the management UI

Pass `--package <dir>` to target `@atelierai/rasen-ui` instead of the CLI. The
helper reads `packages/ui/package.json`, bumps its version to
`<ui-version>-dev.local.<n>`, runs `pnpm run build` (Vite) with its cwd inside
`packages/ui`, packs from there with `--ignore-scripts`, and restores the UI
manifest in `finally`:

```bash
node .claude/skills/rasen-npm-pack/scripts/pack-dev-local.mjs --package packages/ui
```

`--package` composes with `--dry-run`, `--force`, and `--pack-destination`. The
name guard accepts any `@atelierai/*` package, so a stray `--package` pointing at
an unrelated manifest is refused.

The helper creates the default or explicit destination directory when
necessary. If the expected archive already exists, it stops before changing
`package.json`; only use `--force` after the user explicitly approves replacing
that file:

```bash
node .claude/skills/rasen-npm-pack/scripts/pack-dev-local.mjs --force
```

It restores `package.json` after successful packing and after ordinary
build/pack failures.
After an abrupt `SIGKILL`, power loss, or host crash, inspect `package.json` and
Git status before continuing because no process can execute `finally` in those
conditions.

Do not invent the scoped-package filename. Capture and report the filename npm
actually prints, together with its absolute path, manifest version, packed size,
and integrity value when available.

## Phase 4: Provide cross-machine installation instructions

For a transferred local tarball, provide this target-machine command using the
actual path:

```bash
npm install -g ./<generated-package>.tgz
```

Verify the installation with commands appropriate to the requested feature:

```bash
npm ls -g @atelierai/rasen --depth=0
rasen --version
rasen workflow --help
```

The tarball should report `<original-version>-dev.local.<n>`, so `rasen --version`
can distinguish it from the registry build. Also use an unreleased feature
command, such as `rasen workflow --help`, as the behavioral smoke check.

### UI tarball installation

The UI is a separate package and is **not** bundled with the CLI. Install its
tarball globally on its own:

```bash
npm install -g ./atelierai-rasen-ui-<ui-version>-dev.local.<n>.tgz
npm ls -g @atelierai/rasen-ui --depth=0
```

`rasen ui` resolves the UI at runtime via `resolveUiPackageDir()` — it looks for
the globally installed `@atelierai/rasen-ui`'s `dist/` next to the CLI, so
reinstalling the UI tarball is all that is needed for `rasen ui` to serve the new
build. There is no `rasen-ui --version` (the package has no `bin`); verify via
`npm ls -g` instead.

A target installing a prepared tarball does not need TypeScript or pnpm. It does
need a supported Node.js/npm environment, and npm will install runtime
dependencies and run the packaged lifecycle scripts unless the installer opts
out of scripts.

## Alternative distribution paths

### Install from Git

Use this only when the user prefers convenience over a prebuilt artifact. Pin a
pushed commit SHA for reproducibility; a branch name is mutable.

```bash
npm install -g "github:pashifika/rasen#<pushed-commit-sha>"
```

Before suggesting this path, inspect `package.json`. This repository's `prepare`
script runs `pnpm run build`, so the target needs Git and pnpm 9.15.9 in addition
to Node.js. Private repositories also require working GitHub credentials.

### Publish a prerelease channel

Use this for repeated testing across many machines. Publishing is external and
immutable for a given version, so require explicit user authorization and a
unique prerelease version such as `0.1.5-beta.0`.

```bash
npm publish --tag next
npm install -g @atelierai/rasen@next
```

Explain that `--tag next` leaves the default `latest` channel unchanged. Do not
publish, move dist-tags, or alter version files as part of this skill unless the
user separately authorizes those actions.

### Install a remote tarball URL

npm also accepts an HTTP(S) URL to a valid npm tarball:

```bash
npm install -g https://example.invalid/path/to/rasen.tgz
```

This is suitable for a trusted CI artifact or release asset. Mention the hosting
service's authentication, retention, and integrity implications when relevant.

## Completion report

Report:

1. the source branch and commit used;
2. whether uncommitted changes were included;
3. commands that actually ran and their results;
4. whether the run was dry-run only or created a `.tgz`;
5. the temporary dev version and confirmation that `package.json` was restored;
6. the exact archive path and package version when created;
7. target-machine installation and smoke-test commands;
8. anything not verified, including skipped tests.

Do not claim that a tarball exists after `npm pack --dry-run`, and do not claim a
remote installation succeeded unless it was actually performed and observed.
