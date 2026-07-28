## Why

Today Rasen decides which tools to refresh by looking at the project directory and asking "which tool folders already contain a Rasen skill?" That misses the point: a tool folder can appear for any number of reasons unrelated to a user's choice — a stray `.agent` directory, a shared worktree, a prior experiment, a `cp -r`. Whatever the cause, `rasen update` treats every tool whose folder happens to hold a Rasen artifact as "configured" and refreshes it, including into tools the user never opted into. The user has no way to say "I only want rasen in Claude Code for this project" and have that decision stick.

The same user who runs `rasen init` in five project directories then has to run `rasen update` five times after every upgrade. A machine-wide project registry already exists at `~/.rasen/projects/registry.json`, but it records no version and no tool selection, so `rasen update` cannot offer to upgrade the other registered projects in one pass.

This change solves both problems with one coherent substrate: a durable, per-project record of the tools the user selected and the Rasen version that project runs, plus an `update` flow that honors the record across every project on the machine.

## What Changes

- **Rasen remembers the tools you selected, per project.** `rasen init` SHALL persist the user's tool selection into the project's own `rasen/config.yaml` under a new `tools:` key. This is the authoritative record of "which tools did the user opt into for this project?" It travels with the repo, so a clone, fork, or worktree inherits the same selection.
- **Existing installs are migrated losslessly.** On the first `rasen init` or `rasen update` after this ships, a project that has Rasen artifacts on disk but no `tools:` key SHALL seed the key from whatever tools are currently detected. No install loses its tools.
- **`rasen update` honors the manifest.** Update SHALL refresh only the tools listed in the manifest. A tool whose directory exists on disk but was never selected is no longer silently refreshed — `detectNewTools` already points the user at `rasen init` if they want to add it.
- **Rasen tracks the installed version per project.** The machine-wide registry entry for each project SHALL gain optional `tools`, `installedVersion`, and `lastUpdated` fields, mirroring the manifest and the version stamp `rasen update` writes. The registry stays best-effort — it never breaks or visibly slows a user command.
- **`rasen update` can upgrade every project on the machine.** After updating the current project, update SHALL surface other registered projects that are behind and offer to upgrade them. Interactive runs get a prompt (all / select / skip); scripts get a `--all-projects` flag; `--only-this` skips the prompt entirely. A project can opt out with `update.pin: true` in its `rasen/config.yaml`. Missing directories and permission errors are summarized, never fatal.

### Decisions the proposal locks (override now if needed)

- **Manifest location: hybrid, not "~/.rasen only".** Source of truth for tool selection lives in the project's `rasen/config.yaml` (travels with the repo — a clone, fork, or worktree inherits the same selection and a fresh machine resolves it without guessing). The machine-wide registry under `~/.rasen/projects/registry.json` mirrors that selection and caches the installed version, so multi-project scans are fast and still answer the user's literal "~/.rasen" mental model. Splitting the two mirrors the existing pattern: `projectId` lives in `rasen/config.yaml`, the registry mirrors identity and caches liveness. If the user prefers a machine-local-only manifest (does not travel with the repo), say so now — the rest of the design changes only at the read/write seam.
- **Multi-project prompt default: Skip.** The prompt never auto-upgrades; consent is always a positive action. `--all-projects` is the scripting escape hatch and respects `update.pin`.
- **Pinning: explicit per-project opt-out via `update.pin: true`.** Pinned projects stay in the registry for visibility (`rasen doctor`) but are never offered by the multi-project prompt and never touched by `--all-projects`.

## Capabilities

### New Capabilities

- `project-install-manifest`: the per-project authoritative record of selected tools and installed Rasen version — where it lives, how `rasen init` and `rasen update` maintain it, the one-time migration from on-disk artifacts, and how it relates to the machine-wide registry cache.

### Modified Capabilities

- `cli-init`: init SHALL persist the user's selected tool IDs into `rasen/config.yaml`'s new `tools:` key on every init/re-init.
- `cli-update`: update SHALL read the manifest as the authoritative configured-tool set (with one-time migration fallback), record the installed version into the registry, and offer multi-project upgrade with explicit consent and pinning support.
- `project-registry`: registry entries SHALL carry optional `tools`, `installedVersion`, and `lastUpdated` cache fields, kept best-effort and never breaking existing reads.

## Impact

- **Project repository**: `rasen/config.yaml` gains two optional keys (`tools:` and `update.pin:`); both are resilient-field-parsed like every other key, so an older binary that does not know them simply ignores them. Existing projects gain them losslessly on the first init/update via one-time migration.
- **Machine-local state**: `~/.rasen/projects/registry.json` entries grow three optional fields. The registry schema's zod `.strict()` stays back-compat (optional fields, not unknown ones), so an older binary reading a newer registry still works; a newer binary reading an older registry sees absent fields and falls back to on-disk detection.
- **Code**: `src/core/init.ts`, `src/core/update.ts`, `src/core/project-config.ts`, `src/core/project-registry.ts`, `src/core/project-home.ts` (`touchProjectRegistry` self-heal learns `installedVersion`), `src/core/shared/tool-detection.ts` (a new `resolveConfiguredTools` that reads the manifest with migration fallback, used by update and init), and the `rasen update` CLI flag surface.
- **Cross-platform**: every new path is built with `path.join`/`path.resolve`; tests use `path.join` for expected paths; the registry's existing canonicalization handles Windows path casing. A Windows-CI verification task covers registry round-trips with the new fields.
- **Compatibility**: nothing previously written becomes unreadable. An older binary reading a newer registry or a newer config simply ignores the new fields. The migration is one-time and idempotent.
- **Out of scope**: redesigning the profile system, the delivery surface, or the registry's worktree/move/gc semantics; adding new tool directory auto-discovery beyond what `detectNewTools` already does; making `rasen update` asynchronous or backgrounded.
