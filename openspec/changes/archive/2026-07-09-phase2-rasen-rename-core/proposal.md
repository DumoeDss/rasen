## Why

The fork is being released as an independent product under the brand **rasen** (螺旋, "loops that ascend"). Phase 1 shipped under the inherited `openspec` identity as a deliberate deferral; Phase 2 completes the identity switch. This child (C1) does the core code rename — package name, CLI binary, brand-visible strings, environment variables, and the global config directory — so that a stranger can `npm i -g rasen` and get a CLI named `rasen` that stores its config under a `rasen` directory and phones telemetry home under the rasen brand. Docs (C2), release plumbing (C3), and the telemetry endpoint domain (C4) are separate children that depend on this one.

## What Changes

- **BREAKING** — Package identity: `name` becomes `rasen` (unscoped), the installed binary is renamed `openspec` → `rasen`, and `repository`/`homepage`/`author` point at `github.com/DumoeDss/rasen`. Version stays `0.1.0`.
- **BREAKING** — Environment variables rename to the `RASEN_` namespace with no compatibility shim (the fork has never published a release, so there are no external users to break): `OPENSPEC_TELEMETRY`, `OPENSPEC_CONCURRENCY`, `OPENSPEC_ENABLE_CLI_AGENT_OPENERS`, `OPENSPEC_NO_AUTO_CONFIG` → `RASEN_*`. `DO_NOT_TRACK` and the `CI` auto-off are industry conventions, not brand variables, and are kept unchanged.
- **BREAKING** — The global config/data directory renames `openspec` → `rasen` (`~/.config/rasen`, `%APPDATA%\rasen`, `~/.local/share/rasen`, and their `XDG_*` variants). A one-time startup migration copies an existing old-brand directory to the new location when the new one is absent, preserving the telemetry `anonymousId` and `noticeSeen` — config is never silently dropped.
- Brand-visible strings across `src/` become rasen: the Commander program name, `--help`/command descriptions, the telemetry first-run notice, and the `openspec <verb>` CLI-invocation examples embedded in generated skill/command templates (`openspec update` → `rasen update`, etc.).
- Upstream-repo references that point users at the wrong project are repointed to the fork: the `openspec feedback` GitHub-issue URL and the "Learn more / Feedback" links printed by `init`/`update`.
- The skill-templates-parity golden-master hashes are regenerated (every template's text changes — this is expected, not a regression).
- LICENSE keeps its `Copyright (c) 2024 OpenSpec Contributors` line (MIT requirement); the `Copyright (c) 2026 DumoeDss` maintainer line is already present.

**Explicitly NOT renamed** (would break existing user workspaces or the workflow ecosystem — LEAD decision):
- The user-project workspace directory `openspec/` and every path/constant that names it (`OPENSPEC_ROOT_DIR`, `OPENSPEC_SPECS_DIR`, `OPENSPEC_CHANGES_DIR`, `OPENSPEC_ARCHIVE_DIR`, `OPENSPEC_DIR_NAME`, etc. — values stay `openspec`).
- The `opsx:` slash-command prefix.
- The `<!-- OPENSPEC:START -->` / `<!-- OPENSPEC:END -->` marker pair embedded in already-initialized user files (renaming breaks re-detection on `update`/cleanup).
- Spec/schema identifiers (`spec-driven`, schema names) that identify existing project workspaces.

## Capabilities

### New Capabilities
- `rasen-cli-identity`: The published package name, CLI binary name, and brand-visible surface (program name, help, generated command examples) are `rasen`; the `RASEN_` environment-variable namespace for non-telemetry brand variables; and the explicit preservation contract for the workspace directory, `opsx:` prefix, workspace markers, and schema identifiers.

### Modified Capabilities
- `telemetry`: The opt-out environment variable is `RASEN_TELEMETRY` (not `OPENSPEC_TELEMETRY`); the first-run notice and tracked version identify the product as rasen.
- `global-config`: The global config/data directory is named `rasen`; a one-time migration adopts an existing old-brand directory (preserving `anonymousId`/`noticeSeen`) rather than dropping it.
- `cli-feedback`: The `feedback` command directs users to the fork's issue tracker (`DumoeDss/rasen`), not upstream.

## Impact

- **Package**: `package.json` (`name`, `bin`, `repository`, `homepage`, `author`, `keywords`; `dev:cli` script path). Changeset/release scripts are left to C3.
- **Binary**: `bin/openspec.js` → `bin/rasen.js`, with all live references updated (`package.json` bin value, `dev:cli`, `scripts/pack-version-check.mjs`, CLI-spawning tests under `test/`).
- **Source**: brand strings across ~136 files in `src/`; env-var reads in `src/telemetry/index.ts`, `src/cli/index.ts`, `src/commands/validate.ts`, `src/core/completions/command-registry.ts`, `src/core/openers.ts`, `src/core/completions/installers/{bash,zsh}-installer.ts`; config dir in `src/core/global-config.ts`; feedback/URL strings in `src/commands/feedback.ts`, `src/core/init.ts`, `src/core/update.ts`.
- **Tests**: `test/core/templates/skill-templates-parity.test.ts` (both hash tables regenerated); any test asserting on the old bin name, old env-var names, old config dir, or notice text.
- **Out of scope**: README/docs (C2), `release.yml`/`.changeset` removal (C3), telemetry endpoint URL (C4), the `telemetry-backend/` directory (owned by another session — must not be touched).
