# Proposal: init-profile-lock

## Why

`rasen init --profile` applies a profile for that single run and then forgets it: nothing records the choice, so the next `rasen update` silently reverts the project to the machine-global profile. A project that should stay on a specific profile (for example a team's shared named profile) cannot be pinned to it — the only project-scope control today is the verbatim `workflows` list, which duplicates a profile's contents instead of referencing it by name. Separately, a saved named profile cannot be edited after creation (only deleted and recreated), so keeping a referenced profile current is needlessly destructive.

## What Changes

- `rasen init --profile <value>` accepts named profiles in addition to `full`/`core`/`custom`, and persists the choice as a new `profile` key in the project's `rasen/config.yaml` — the profile lock. `--profile custom` keeps its current one-shot behavior and is never persisted (it references the mutable global selection, so a lock to it is meaningless). Running `rasen init` without `--profile` writes no lock and behaves exactly as today.
- The project config (`rasen/config.yaml`) gains an optional `profile` string field, parsed under the existing resilient field-by-field policy.
- Workflow selection resolution honors the lock everywhere selection is resolved (update, extend-mode init, drift detection, management API): precedence is project `workflows` override > project `profile` lock > machine-global profile. A lock naming a missing or invalid profile falls back to the global profile with a warning; when both `workflows` and `profile` are present, `workflows` wins and a warning names the shadowed lock.
- New `rasen profile update [name]` subcommand edits a saved named profile definition in place: the picker opens seeded from the stored snapshot and saves back to the same definition file. Built-in profiles (`full`, `core`) and `custom` are rejected. Editing a definition does not change the current global selection; projects pick up the new contents on their next `rasen update`.
- The `profile` configuration key becomes settable at project scope (mirroring the existing `workflows` key), so the lock can be changed or removed with `rasen config set profile <value> --project` / `rasen config unset profile --project`; store scope remains rejected.
- All new user-facing strings land in the three locale catalogs (`en`, `ja`, `zh-cn`).

## Capabilities

### New Capabilities

(none — every change extends an existing capability)

### Modified Capabilities

- `profiles`: two new requirements — project-scope profile lock resolution (precedence, fallback, drift parity) and editing a saved named profile definition via `rasen profile update`.
- `cli-init`: `--profile` accepts named profiles; an explicit `--profile` value other than `custom` is persisted into `rasen/config.yaml` on fresh init and updated in extend mode; the invalid-profile error names the available values including saved profiles.
- `config-loading`: the project config carries an optional `profile` field, parsed resiliently.
- `cli-update`: update in a project carrying a profile lock resolves the selection from the locked profile instead of the global profile, and says so in its output.
- `config-key-registry`: the `profile` key gains project scope alongside its existing global scope; store scope stays rejected.

## Impact

- `src/core/profiles.ts` — `resolveProjectWorkflowSelection` gains the lock layer between the `workflows` override and the global profile.
- `src/core/project-config.ts` — `ProjectConfigSchema` and the resilient parser gain the `profile` field.
- `src/core/init.ts` / `src/core/config-prompts.ts` — `--profile` validation extends to named profiles; `serializeConfig`/`createConfig` persist the lock; extend mode updates an existing config via the comment-preserving key writer.
- `src/core/update.ts`, `src/core/profile-sync-drift.ts`, `src/core/management-api/workflow-enablement.ts` — consume the extended resolution seam so install, prune, drift, and the board UI never disagree.
- `src/commands/profile.ts` / `profile-editor.ts` / `profile-messages.ts` — new `update` subcommand; `src/core/named-profiles.ts` gains an overwrite-capable save path for editing.
- `src/core/config-keys.ts` — `profile` registry entry gains project scope with per-scope value validation.
- `src/locales/{en,ja,zh-cn}.json` — new profile UI and warning strings (catalog parity enforced by tests).
- Tests: `test/core/profiles.test.ts`, `test/core/project-config.test.ts`, `test/core/init.test.ts`, `test/core/update.test.ts`, `test/core/named-profiles.test.ts`, `test/commands/profile.test.ts`, `test/core/config-keys.test.ts`, plus locale catalog parity.
- No breaking change for existing projects: absent `profile` key preserves today's behavior; the one-shot `--profile custom` path is unchanged.
