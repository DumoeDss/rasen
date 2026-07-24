# Design: init-profile-lock

## Context

Profile selection is machine-global today: the active profile (`full`/`core`/`custom`) lives in `~/.rasen/config.json` (`src/core/global-config.ts`), and saved named profiles are YAML definitions under `<global-config-dir>/profiles/<name>.yaml` (`src/core/named-profiles.ts`, `resolveProfileDefinition`). The only project-scope control is the `workflows` array in `rasen/config.yaml` (`ProjectConfigSchema`, `src/core/project-config.ts`), a verbatim id list consumed by the shared resolution seam `resolveProjectWorkflowSelection` (`src/core/profiles.ts:161`), which `update`, drift detection (`profile-sync-drift.ts`), and the management API's `resolveBaseSelectionIds` (`workflow-enablement.ts`) all flow through.

`rasen init --profile <full|core|custom>` exists (`init.ts`, `resolveProfileOverride`) but is a one-run selection: it is validated, used to resolve the install set, and discarded. `createConfig` writes `config.yaml` through `serializeConfig` (`config-prompts.ts`) emitting only `schema` and `projectId`. The comment-preserving single-key writer `updateProjectConfigKey` (`project-config.ts`) exists for editing a config that is already on disk. CLI-settable keys are declared once in `CONFIG_KEY_REGISTRY` (`config-keys.ts`); `profile` is currently global-only there, `workflows` is global+project.

Named profiles can be created (`profile new`), applied (`use`), listed, deleted, imported, and exported — but not edited in place.

Decisions below were confirmed with the user (2026-07-24): `rasen profile update` targets saved named-profile definitions; lockable values are `full`, `core`, and named profiles (not `custom`); an existing `workflows` override wins over the lock with a warning.

## Goals / Non-Goals

**Goals:**

- Let `rasen init --profile <value>` pin the choice into the project's `rasen/config.yaml` so it survives later `rasen update` runs.
- Honor the lock at every point that resolves a project's workflow selection (update, extend-mode init, drift, management API) through the single existing seam.
- Provide `rasen profile update [name]` to edit a saved named profile definition in place.
- Provide a supported way to change or remove a lock (`rasen config set/unset profile --project`, or re-running `init --profile`).

**Non-Goals:**

- Locking to `custom` (it names the mutable global selection; a lock to it has no stable referent).
- Changing the semantics of the bare `rasen profile` editor or `rasen profile use` — both stay machine-global.
- Store-scope `profile` (store scope stays rejected).
- Writing a lock when `--profile` is not given — plain `rasen init` behavior is unchanged.
- Sharing named profile definitions through the project repo (definitions stay machine-global; `profile export`/`import` already covers exchange).

## Decisions

### D1: The lock is a reference by name, resolved at read time

`profile: <name>` in `rasen/config.yaml` stores only the name; the definition is loaded when selection is resolved, so edits to the named profile flow to locked projects on their next `rasen update`.

*Alternative considered:* snapshotting the profile's contents into the project (effectively writing the `workflows` array). Rejected — that mechanism already exists as the override, duplicates the definition, and drops the "update the profile once, apply everywhere" loop the user asked for.

### D2: One resolution seam, three layers

`resolveProjectWorkflowSelection` gains the lock layer: project `workflows` override → project `profile` lock → user-wide profile. The result's `mode` gains a `'locked-profile'` value so callers (`update.ts` output note, drift, management API) can present it. `resolveBaseSelectionIds` in `workflow-enablement.ts` mirrors the same order.

*Alternative considered:* resolving the lock at each call site. Rejected — the whole point of the seam (per its own doc comment) is that install, prune, and drift can never disagree.

### D3: Expert-dimension semantics differ by lock kind

- A locked **named profile** resolves its definition's ids verbatim plus dependency closure, bypassing the `expertSelectionExplicit` migration marker — same reasoning as the `workflows` override: a saved definition is an explicit, individually-authored list, never a legacy all-experts install.
- A locked **built-in** (`full`/`core`) resolves through `resolveDesiredWorkflowSelection` with the marker honored, exactly as if it were the user-wide profile — preserving the non-regressive expert guarantee for legacy installs.

### D4: `--profile` persists for every value except `custom`

`--profile` accepts `full`, `core`, `custom`, and saved profile names. Explicit `full`/`core`/`<named>` are persisted as the lock: fresh init emits the key through `serializeConfig`; extend mode writes through `updateProjectConfigKey` (comment-preserving; the file exists in extend mode). `custom` keeps today's one-run behavior and is never persisted.

*Alternative considered:* a separate `--lock` flag keeping `--profile` one-shot. Rejected — the user's request is precisely "specify a profile at init and lock it"; two flags add a mode the workflow doesn't need, and the only value whose persistence would be meaningless (`custom`) is carved out instead.

### D5: `rasen profile update` edits definitions only

It opens the existing picker (`promptForNewProfileState`) seeded from the stored definition and saves back via the named-profile save path with overwrite allowed. It never touches the current global selection (`applyProfileState` is not called) or any project file — consistent with the snapshot contract ("Saved profile is a snapshot") and with `rasen profile`'s existing scope. Built-in and reserved names (`full`, `core`, `custom`) are rejected; a TTY is required (the picker is the whole command); without a name it prompts among saved profiles like `profile delete`.

### D6: Reads tolerate, writes validate

- **Parse/resolve time** (config.yaml may arrive via git from a machine without the named profile): a lock naming a missing or invalid definition produces a warning and falls back to the user-wide profile; `profile: custom` in the file is treated the same way. Commands never fail because of a broken lock — matching config-loading's resilient policy.
- **Write time** (local, interactive): `rasen init --profile <unknown>` and `rasen config set profile <unknown> --project` fail listing the available profiles — catching typos where they happen.

### D7: Registry gains project scope for `profile` with per-scope values

`CONFIG_KEY_REGISTRY`'s `profile` entry becomes global+project (mirroring `workflows`): global keeps the `full`/`core`/`custom` enum; project scope accepts `full`, `core`, or a saved profile name and rejects `custom`; store scope stays rejected. This makes `rasen config set/unset profile --project` and the config UI's generic row the supported lock-editing path without widening `rasen profile`'s scope.

### D8: Warnings name what was shadowed or missing

When both `workflows` and `profile` are present, resolution uses `workflows` and warns naming the shadowed lock. When a lock falls back (missing definition, `custom`), the warning names the profile and the fallback. All new strings go through the message-key registries into the three locale catalogs.

## Risks / Trade-offs

- [Lock names a machine-local definition but `config.yaml` is committed and shared] → parse-time fallback with a warning that names the missing profile and points at `rasen profile import`/`rasen profile new`; docs state that named definitions are per-machine.
- [`rasen update` vs `rasen profile update` naming collision could confuse] → help text and docs contrast them explicitly ("refresh this project's installed skills" vs "edit a saved profile definition").
- [Persisting `--profile` changes behavior for scripts that used it as a one-shot] → scope is small (the flag previously had no lasting effect beyond generated files; the new key only adds a lock those scripts can `config unset`); called out in changelog/docs.
- [Registry entries have one declared type; per-scope value sets are new] → implement as the registry's existing extra-constraint hook keyed by scope; the round-trip consistency test covers both scopes so registry and schemas cannot drift.
- [Drift/board UI writes a `workflows` override that silently defeats the lock] → not silent: resolution warns about the shadowed lock, and the update output labels the governing layer (`override` vs `locked profile`).

## Migration Plan

Purely additive. Existing projects have no `profile` key and behave exactly as today; rollback is removing the key (`rasen config unset profile --project` or deleting the line). No global-config migration, no version stamp change beyond the normal release.

## Open Questions

(none — the three scope-shaping questions were resolved with the user; see Context)
