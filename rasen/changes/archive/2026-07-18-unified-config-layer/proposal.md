## Why

Rasen's configuration is scattered across surfaces with uneven ergonomics: global keys are settable via `rasen config`, but per-project options in `rasen/config.yaml` are hand-edit only (`--scope project` is explicitly rejected as "not yet implemented"), the context-handoff threshold is not a config key at all (it lives only in pipeline YAML and skill prose), telemetry can only be disabled through environment variables, and real global keys like `proactive`/`repoMode` are rejected without `--allow-unknown`. Users asked for one unified configuration entry point. This change builds the unified CLI config layer; a follow-up sibling exposes it over a local HTTP API, and a third ships an optional web UI on top — so the resolution logic built here must be reusable in-process.

## What Changes

- `rasen config --scope project` becomes real: `get`/`set`/`unset`/`list`/`path` read and write `rasen/config.yaml` with the same UX as global scope (validated keys, type coercion, actionable errors), preserving existing YAML comments and unrelated hand-edited fields.
- A declarative config-key registry becomes the single source of truth for every CLI-settable key: path, scope (global / project / both), type, allowed values, default, description, and display group. Key validation, the interactive editor, and effective-config resolution all read from it.
- New formal config keys:
  - `handoff.threshold` — the context-handoff occupancy threshold, settable at project scope with global fallback (new key; today thresholds exist only in pipeline YAML and defaults). Pipeline resolution slots it between pipeline-level config and built-in defaults; `rasen agent context` reports the resolved threshold and whether occupancy exceeds it.
  - `telemetry.enabled` — telemetry on/off as a config toggle (global scope), written to the same `~/.rasen/config.json` `telemetry` block the anonymous id lives in. Environment opt-outs (`RASEN_TELEMETRY=0`, `DO_NOT_TRACK=1`, CI) keep overriding the config value.
  - `proactive` and `repoMode` join the known global keys — settable without `--allow-unknown`, validated against their real types.
  - `autopilot.gates` (and its sibling `autopilot.selection`) become settable via `rasen config set --scope project`, replacing hand-editing.
- No-arg `rasen config` opens an interactive full-view editor (same `@inquirer/prompts` style as `config profile`): keys grouped by area, each showing its current effective value and source annotation (`default` | `global` | `project` | `env-override`); selecting a key prompts a type-appropriate edit and writes to the right scope. Non-TTY invocations print the effective view non-interactively instead of erroring.
- A reusable in-process resolution module `resolveEffectiveConfig()` in `src/core/` merges defaults + global + project + env overrides and returns per-key values with source metadata. The interactive editor is its first consumer; the HTTP API sibling (`unified-config-api`) will be its second — this module is the designed seam.

## Capabilities

### New Capabilities
- `config-resolution`: effective-configuration resolution — merge default, global, project, and environment-override layers into per-key values with source metadata, exposed as a reusable in-process module and consumed by the interactive editor (and by the future config API).
- `config-key-registry`: the declarative registry of CLI-settable configuration keys (scope, type, default, description, group) that drives validation, help, and the editor for both scopes.

### Modified Capabilities
- `cli-config`: `--scope project` subcommand support, no-arg interactive full-view editor with source annotations, expanded known global keys (`proactive`, `repoMode`, `telemetry.enabled`, `handoff.threshold`).
- `config-loading`: project config schema accepts the new `handoff.threshold` key (resilient field-by-field parsing, invalid values dropped with a warning like other fields).
- `global-config`: global config schema gains `proactive`, `repoMode`, `telemetry`, and `handoff` as typed known fields (previously passthrough-only or env-only).
- `telemetry`: opt-out requirement extends to a persistent `telemetry.enabled` config value beneath the existing environment-variable opt-outs.
- `pipeline-handoff-config`: resolution order gains two layers — project `handoff.threshold` then global `handoff.threshold` — between pipeline-level config and built-in defaults.
- `cli-agent-context`: the probe reports the resolved handoff threshold, its source, and whether measured occupancy meets it.

## Impact

- **Code**: `src/commands/config.ts` (scope plumbing, project subcommands, interactive editor), `src/core/config-schema.ts` (known-key logic delegating to the registry), new `src/core/config-keys.ts` + `src/core/effective-config.ts`, `src/core/project-config.ts` (schema + `handoff` block + YAML-preserving write path), `src/core/global-config.ts` (typed fields), `src/telemetry/index.ts` (config-aware enable check), `src/core/pipeline-registry/types.ts` (threshold resolution layers), `src/commands/agent.ts` / `src/core/agent-context.ts` (threshold reporting).
- **APIs**: new exported `resolveEffectiveConfig()` contract that the `unified-config-api` sibling will serve over HTTP — its shape (per-key value + source) is part of this change's deliverable.
- **Dependencies**: no new packages; `yaml` (already a dependency) provides comment-preserving document editing, `@inquirer/prompts` (already a dependency) provides the editor UI.
- **Compatibility**: existing config files keep working unchanged; all new keys are optional with today's behavior as the default. No breaking changes.
