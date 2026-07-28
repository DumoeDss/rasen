## Why

Moving a project between in-repo planning and a store is currently a hand-crafted ritual: manually moving `specs/` and `changes/`, hand-editing the `store:` pointer in `config.yaml`, and hoping the registry mode flips. The same is true for relocating an existing archive when `archive.destination` changes — the config flips where FUTURE archives land, but the existing archive stays behind, leaving a split-brain state. Users who adopt stores today must perform multi-step file surgery that the CLI understands but does not offer as commands.

## What Changes

- New `rasen store adopt [path] --to <store-id>` — migrate an in-repo project's planning content (specs, changes, optionally archive) into a registered store, convert the repo to a config-only pointer (`store: <id>`), register the project, and refresh the registry mode. Records per-project ownership in a migration manifest so the move is reversible.
- New `rasen store eject <project-id> [--from <store-id>]` — the inverse: copy the project's owned specs/changes back into the repo's planning directory, remove the `store:` pointer, and restore in-repo mode. Uses the adopt manifest; without one, requires explicit `--all` with confirmation.
- New `rasen archive relocate --to <in-repo|external|store>` — move the EXISTING archive contents to the chosen destination and flip `archive.destination` in the same operation, so data and config never disagree.
- New `rasen home prune` — list and remove orphaned machine-home entries (`~/.rasen/projects/*` whose registry key no longer exists on disk or whose home directory is unreferenced), with dry-run by default.
- `rasen store doctor` gains drift diagnostics: pointer to an unregistered store, planning shape and `store:` pointer both present (ambiguous mode), and manifest/filesystem mismatch.
- All migration commands are git-safe: copy → verify → delete, never touch the git index, and print suggested per-repo commit commands on completion. All support `--dry-run` and `--json`.

## Capabilities

### New Capabilities

- `store-adopt`: migrating an in-repo project's planning content into a store, including pointer conversion, ownership manifest, name-collision policy, and archive handling options.
- `store-eject`: restoring a store-hosted project back to in-repo planning using the ownership manifest, including the manifest-less `--all` fallback.
- `archive-relocate`: moving existing archive contents between in-repo, external (machine home), and store destinations while atomically flipping the `archive.destination` config.
- `machine-home-prune`: discovering and cleaning orphaned machine-home directories and stale registry entries, dry-run first.

### Modified Capabilities

- `store-registration`: `store doctor` adds drift diagnostics (pointer to unregistered store, ambiguous planning-shape+pointer state, adopt-manifest mismatch).
- `archive-destination`: destination changes performed via `archive relocate` move existing archive contents together with the config flip (the config-only flip remains valid but the relocate path becomes the recommended, non-split-brain surface).

## Impact

- CLI: new subcommands under `rasen store` (`adopt`, `eject`), new `rasen archive relocate`, new `rasen home prune`; extended `rasen store doctor`.
- Core: `core/store/*` (setup/register/add-project machinery), `core/project-config.ts` (`store:` pointer read/write), `core/project-home.ts` / `core/project-registry.ts` (mode derivation and refresh), `core/change-work.ts` (archive destination resolution).
- New persisted metadata: per-project ownership manifest in the store (extends store metadata; coordinates with `store-project-namespace`).
- Cross-platform: all moves via `path.join`, copy-verify-delete semantics safe on Windows (no cross-device rename assumptions).
- No breaking changes: existing manual migration remains valid; commands are additive.
