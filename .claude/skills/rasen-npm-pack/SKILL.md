---
name: rasen-npm-pack
description: Build and verify an npm .tgz from an unreleased Rasen branch without changing package.json, stamping the local build so `rasen --version` identifies it, provide cross-machine installation steps, and avoid publishing by default
license: MIT
compatibility: Requires the Rasen repository, Node.js 20.19 or newer, pnpm 9.15.9, and npm.
metadata:
  author: rasen
  version: "2.0"
  generatedBy: "0.1.4"
---

# /rasen:npm-pack — Package an Unreleased Rasen CLI or UI

Create or inspect an installable npm tarball for the current unreleased Rasen
working tree. Prefer this workflow when the user needs to test a branch on
another machine before the corresponding npm release exists.

By default the helper packs the root CLI package (`@atelierai/rasen`). Pass
`--package packages/ui` to pack the management UI (`@atelierai/rasen-ui`)
instead — same build stamp, same failure-safe cleanup. The CLI and UI
are separate npm packages: the UI tarball is **not** bundled inside the CLI
tarball, and `rasen ui` resolves it at runtime from the globally installed
`@atelierai/rasen-ui` (see Phase 4).

## The local build stamp (why `package.json` is never edited)

The packed version stays exactly what the manifest says (`0.1.7`, not
`0.1.7-dev.local.3`). The local build is identified by one extra shipped file,
`dist/build-info.json` — channel plus the commit it was built from — which the
CLI renders in `rasen --version`:

```
0.1.7 (dev.local c915bf8e)
```

Two properties make this the correct trade:

- **Version-equality contracts stay intact.** Rasen compares version strings in
  several places — installed skill `generatedBy` stamps
  (`src/core/shared/tool-detection.ts`), the daemon adopt/spawn handshake
  (`src/commands/daemon.ts`), `.rasenpkg` `minRasenVersion` preflight
  (`src/core/workflow-package/version-gate.ts`), and the CLI/UI lockstep
  release checks (`scripts/release-contract.mjs`). A `-dev.local.N` suffix made
  every one of them report a spurious mismatch on a locally built CLI, so
  verification on the test machine kept failing for reasons unrelated to the
  branch under test.
- **A same-version reinstall still updates.** The earlier version bump was
  justified by "npm would otherwise skip an unchanged version". That is false
  for a local tarball: `npm install -g ./pkg.tgz` re-extracts and replaces the
  install even when `name@version` is identical (verified on npm 11.16.0 —
  build 1 → build 2 of `0.1.7` was observed to replace the installed CLI).

The stamp is absent from every published install: only this helper writes it —
after `pnpm run build`, before `npm pack` — and `build.js` deletes `dist/` at
the start of every build, so a plain `pnpm run build`, a CI build, and a
registry install all print the bare version. `rasen --version` therefore stays
byte-identical to `package.json` on a normal install, and its first
whitespace-delimited token is always the canonical `X.Y.Z` even on a local
build.

A monotonic per-package build index still exists, but only to name the
artifact file (`...-local.3.tgz`) and keep repeated packs distinguishable on
disk. It is deliberately absent from the stamp: the commit identifies the
code, and npm caching never needed defeating.

## Safety boundary

- Default to a local npm tarball. Do not run `npm publish`, change a package
  version, create a release, push a branch, or install globally unless the user
  explicitly requests that action.
- The helper never modifies `package.json`. Its only mutation of the work tree
  is `<package>/dist/build-info.json`, written after the build and removed in
  `finally`; `dist/` is gitignored, so the tracked tree is untouched either way.
- Treat the current working tree as package input. Inspect and report staged,
  unstaged, and untracked source changes before building; do not silently omit
  or discard them. The stamp records the short `commit` the build came from,
  so the packed provenance is visible on the target machine. Say so explicitly
  when the tree was dirty — the stamp does not encode that.
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
- the target manifest has a canonical `major.minor.patch` version (the helper
  refuses anything else, and keys the build counter on `<name>@<version>`).

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

Do not use `npm version` for a local test build: it changes a tracked file,
can update lockfiles, and invokes version lifecycle behavior. The stamp
mechanism exists precisely so no version change is needed.

## Phase 2: Build and inspect without creating an archive

Use the supporting helper from the repository root. In the standard local-docs
setup it is exposed through `.claude/skills/`:

```bash
node .claude/skills/rasen-npm-pack/scripts/pack-dev-local.mjs --dry-run
```

The helper performs this sequence as one failure-safe operation:

1. resolve the next local build index for `<name>@<version>`;
2. run `pnpm run build` (which wipes and regenerates `dist/`);
3. write `dist/build-info.json` with the channel and short commit;
4. run `npm pack --dry-run --json --ignore-scripts`;
5. remove `dist/build-info.json` in `finally` and confirm it is gone.

State explicitly that `--dry-run` creates no `.tgz` and does not consume the
build index. Review the JSON and verify that the reported `version` is the
unchanged manifest version and that the package contains the runtime surfaces
expected by the current manifest, including at least:

- `bin/rasen.js`;
- compiled `dist/` entry points and locale catalogs;
- `dist/build-info.json` (the local build stamp — present only in these local
  tarballs, never in a published release);
- `schemas/`, `skills/`, and `pipelines/`;
- `scripts/postinstall.js`;
- `package.json`, `README.md`, and `LICENSE`.

Also inspect for accidental secrets, local configuration, source-only fixtures,
or other files that should not ship. Use the package's `files` allowlist as the
primary boundary; do not broaden it without a concrete packaging requirement.

## Phase 3: Create the npm tarball

Only create the archive when the user asks for an actual package:

```bash
node .claude/skills/rasen-npm-pack/scripts/pack-dev-local.mjs
```

By default the helper creates `./artifacts/` and writes
`<name>-<version>-local.<n>.tgz` there, where `<n>` is an auto-incrementing
per-package, per-version index (repeated packs yield `...-local.1.tgz`,
`...-local.2.tgz`, ...). Only the filename and the stamp carry the index; the
manifest inside the tarball keeps the canonical version, and npm ignores the
filename when installing. The index is `max(persisted counter, highest existing
indexed tarball in the destination) + 1`; the counter is keyed by
`<name>@<version>` and lives under the skill dir
(`.claude/skills/rasen-npm-pack/.devlocal-counters.json`), so the CLI and UI
keep independent monotonic indices even when they share a version.

npm packs into a staging directory created inside the destination, and the
helper renames the result to the indexed filename — so a plain
`<name>-<version>.tgz` already sitting in the destination is never clobbered.
The helper prints the exact absolute archive path, entry count, packed and
unpacked sizes, integrity, and shasum after npm finishes.

If the user requested another destination, use:

```bash
node .claude/skills/rasen-npm-pack/scripts/pack-dev-local.mjs --pack-destination <directory>
```

### Packaging the management UI

Pass `--package <dir>` to target `@atelierai/rasen-ui` instead of the CLI. The
helper reads `packages/ui/package.json`, runs `pnpm run build` (Vite) with its
cwd inside `packages/ui`, stamps `packages/ui/dist/build-info.json`, packs from
there with `--ignore-scripts`, and removes the stamp in `finally`:

```bash
node .claude/skills/rasen-npm-pack/scripts/pack-dev-local.mjs --package packages/ui
```

`--package` composes with `--dry-run`, `--force`, and `--pack-destination`. The
name guard accepts any `@atelierai/*` package, so a stray `--package` pointing at
an unrelated manifest is refused. The UI has no CLI entry point, so its stamp is
provenance data only — it ships as a static asset and nothing renders it.

The helper creates the default or explicit destination directory when
necessary. If the indexed archive already exists, it stops before building;
only use `--force` after the user explicitly approves replacing that file:

```bash
node .claude/skills/rasen-npm-pack/scripts/pack-dev-local.mjs --force
```

The stamp is removed after successful packing and after ordinary build/pack
failures. After an abrupt `SIGKILL`, power loss, or host crash, check for a
leftover `dist/build-info.json`; `pnpm run build` also clears it, because the
build wipes `dist/`.

Do not invent the scoped-package filename. Capture and report the path the
helper actually prints, together with the manifest version, packed size, and
integrity value.

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

`npm ls -g` reports the plain manifest version and therefore cannot distinguish
a local build from the registry build — `rasen --version` is the check that can:
a local build appends `(dev.local <commit>)` after the version. Also use an
unreleased feature command, such as `rasen workflow --help`, as the behavioral
smoke check.

Reinstalling a newer local build over an older one works even though the
version is unchanged: npm replaces the installed package from the tarball.
Match the commit in `rasen --version` against the commit the helper printed to
confirm the target is running the intended build. Two builds from the SAME
commit print the same line — distinguish them by the artifact filename the
helper reported, or commit first.

To smoke-test a tarball on the build machine without disturbing the real global
install, install it under a throwaway prefix:

```bash
npm install -g --prefix /tmp/rasen-verify --ignore-scripts ./artifacts/<generated-package>.tgz
/tmp/rasen-verify/bin/rasen --version
```

### UI tarball installation

The UI is a separate package and is **not** bundled with the CLI. Install its
tarball globally on its own:

```bash
npm install -g ./atelierai-rasen-ui-<ui-version>-local.<n>.tgz
npm ls -g @atelierai/rasen-ui --depth=0
```

`rasen ui` resolves the UI at runtime via `resolveUiPackageDir()` — it looks for
the globally installed `@atelierai/rasen-ui`'s `dist/` next to the CLI, so
reinstalling the UI tarball is all that is needed for `rasen ui` to serve the new
build. There is no `rasen-ui --version` (the package has no `bin`); verify via
`npm ls -g` instead, or read `dist/build-info.json` from the installed package.

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
to Node.js. Private repositories also require working GitHub credentials. A Git
install carries no build stamp, so `rasen --version` reports the bare version
there.

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
5. the build stamp written (channel and commit), whether the packed tree was
   dirty, and confirmation that the stamp was removed from `dist/` and that
   `package.json` was never modified;
6. the exact archive path and the (unchanged) package version when created;
7. target-machine installation and smoke-test commands, including the
   `rasen --version` line the target should print;
8. anything not verified, including skipped tests.

Do not claim that a tarball exists after `npm pack --dry-run`, and do not claim a
remote installation succeeded unless it was actually performed and observed.
