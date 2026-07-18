## Context

Configuration today lives in four disconnected surfaces:

1. **Global** `~/.rasen/config.json` — read/written by `getGlobalConfig`/`saveGlobalConfig` (`src/core/global-config.ts`), validated by `GlobalConfigSchema` (zod, `.passthrough()`) in `src/core/config-schema.ts`. `rasen config set` gates keys through `KNOWN_TOP_LEVEL_KEYS` (`featureFlags`, `profile`, `delivery`, `workflows`); `proactive` and `repoMode` are real fields of the `GlobalConfig` interface with defaults but are NOT in the schema or known-key set, so setting them requires `--allow-unknown`.
2. **Project** `<root>/rasen/config.yaml` — `ProjectConfigSchema` (`src/core/project-config.ts`), resilient field-by-field parsing, hand-edit only. `rasen config --scope project` is rejected in a `preAction` hook (`src/commands/config.ts:219-225`). There is no programmatic write path today.
3. **Pipeline YAML** — `handoff.threshold` etc. per pipeline/stage, resolved by `resolveStageHandoffConfig` (`src/core/pipeline-registry/types.ts:449`) with precedence stage > role > pipeline > `DEFAULT_HANDOFF_CONFIG` (threshold 0.5). Only one shipped pipeline (`goal-loop-research`) declares a handoff block; every other stage lands on the built-in default. There is no user-tunable knob.
4. **Environment** — telemetry opt-out is env-only (`RASEN_TELEMETRY=0`, `DO_NOT_TRACK=1`, CI detection) in `src/telemetry/index.ts:isTelemetryEnabled()`, a synchronous check. Telemetry state (`anonymousId`, `noticeSeen`) already lives in `~/.rasen/config.json` under `telemetry` via `src/telemetry/config.ts`.

This change is child 1 of 3 in the unified-config portfolio. Child 2 (`unified-config-api`) serves the same data over a localhost HTTP JSON API from inside the CLI; child 3 ships an optional web UI package. The architectural mandate for this child: all merge/source-metadata logic must land in a reusable in-process module, not inside the command handler.

## Goals / Non-Goals

**Goals:**
- One command surface (`rasen config`) that can read and write both scopes with validated keys.
- Promote the scattered knobs (`handoff.threshold`, `telemetry.enabled`, `proactive`, `repoMode`, `autopilot.*`) to formal, discoverable config keys.
- A no-arg interactive editor showing the full effective configuration with per-key source provenance.
- `resolveEffectiveConfig()` as the designed seam the HTTP API sibling consumes unchanged.

**Non-Goals:**
- No HTTP API, no `rasen config ui` command, no web UI package (later siblings).
- No editing of free-form project fields (`context`, `rules`, `quality-rules`, `references`, `openers`) through `config set` or the editor — they stay hand-edit (multi-line/structured content; the editor shows them read-only as "hand-edit" entries at most, and MAY simply omit them).
- No change to pipeline YAML syntax or per-stage/role override semantics.
- No version bumps, no migration of existing config files (all new keys optional, defaults preserve today's behavior).

## Decisions

### D1: A declarative config-key registry is the single source of truth

New module `src/core/config-keys.ts` exporting a table of key definitions:

```ts
interface ConfigKeyDefinition {
  key: string;                          // dot path, e.g. "handoff.threshold"
  scopes: ('global' | 'project')[];     // where it may be SET
  type: 'boolean' | 'number' | 'string' | 'enum';
  enumValues?: readonly string[];
  validate?: (value: unknown) => string | null;  // extra constraint, e.g. (0,1] range
  defaultValue: unknown;                // built-in default (display + resolution)
  description: string;                  // one-liner for editor + errors
  group: string;                        // editor grouping, e.g. "Workflow", "Autopilot", "Telemetry"
}
```

Registry contents (initial): global-only — `profile`, `delivery`, `workflows`, `featureFlags.*`, `proactive`, `repoMode`, `telemetry.enabled`; project-only — `schema`, `autopilot.gates`, `autopilot.selection`, `archive.timing`, `archive.destination`; both scopes — `handoff.threshold` (project wins over global).

`validateConfigKeyPath` in `config-schema.ts` becomes scope-aware and delegates to the registry (keeping its existing special-casing for `featureFlags.<name>` wildcards). `--allow-unknown` keeps working for global scope exactly as today (forward-compat escape hatch); project scope rejects unknown keys outright — the YAML schema is resilient on read but we refuse to write keys nothing consumes.

*Why over extending the two zod schemas ad hoc:* validation, the interactive editor, effective-config resolution, and (next sibling) the HTTP API all need the same key metadata (type, scope, default, description). Without one table each surface re-derives it and drifts — the exact scatter this change removes.

### D2: `handoff.threshold` — one key, project scope with global fallback, below pipeline YAML

Key shape: `handoff: { threshold: number }` in both `rasen/config.yaml` (added to `ProjectConfigSchema` with the same resilient drop-invalid-field parsing as `autopilot`) and `~/.rasen/config.json` (added to `GlobalConfigSchema`). Range (0, 1], matching `HandoffThresholdSchema`.

Consumption — `resolveStageHandoffConfig` gains two layers, slotted between pipeline config and built-in defaults:

```
stage handoff > pipeline handoff.roles[role] > pipeline handoff
  > project config handoff.threshold > global config handoff.threshold > built-in default (0.5)
```

The `source` field vocabulary extends with `'project-config' | 'global-config'`. Config layers tune **threshold only** — `maxRelays`/`stallLimit` remain pipeline/default concerns (they are orchestration-loop caps, not a user comfort knob). Because callers of `resolveStageHandoffConfig` are synchronous and pipeline-resolution happens with a known project root, the resolved config values are passed in as a new optional argument (`{ projectThreshold?, globalThreshold? }`) rather than the resolver doing file I/O — the function stays pure and testable; call sites obtain the values from `resolveEffectiveConfig()`/`readProjectConfig`.

*Why below pipeline YAML rather than above:* pipeline-declared thresholds are deliberate per-pipeline/per-stage engineering (e.g. goal-loop-research), while the config key answers "what should the default be on this machine/project". Since almost no shipped pipeline declares a threshold, the config key takes effect in practice everywhere, without silently overriding explicit pipeline tuning or breaking the published `pipeline-handoff-config` resolution contract for existing declarations.

`rasen agent context` also consumes it: the probe resolves the threshold (project config from cwd if resolvable, else global, else 0.5 — role-agnostic, since a transcript probe has no stage identity), and reports `threshold`, `thresholdSource`, and `shouldHandoff` (`pct >= threshold`) in both the one-line and `--json` outputs. Exit code stays 0 regardless — it remains a probe, not a gate.

### D3: `telemetry.enabled` — config toggle beneath env overrides

New optional boolean `telemetry.enabled` inside the existing `telemetry` block of `~/.rasen/config.json` (same file/block as `anonymousId`/`noticeSeen` — no second telemetry home). Precedence in `isTelemetryEnabled()`: env kill-switches first (`RASEN_TELEMETRY=0`, `DO_NOT_TRACK=1`, CI auto-disable — unchanged), then `telemetry.enabled === false` disables, then default enabled.

`isTelemetryEnabled()` is synchronous and hot (guards every event); `src/telemetry/config.ts` is async. Rather than rewriting the telemetry pipeline async, the check does a lazy synchronous read of the config file (`fs.readFileSync`, memoized per process, swallow-on-error → default enabled). This mirrors how `getGlobalConfig()` already reads the same file synchronously.

`rasen config set telemetry.enabled false` goes through the normal global set path; the registry marks `telemetry` as supporting only the `enabled` nested key from the CLI (`anonymousId`/`noticeSeen` stay machine-managed, not user-settable).

### D4: Project-scope writes preserve the YAML document

New `updateProjectConfigKey(projectRoot, keyPath, value | undefined)` in `src/core/project-config.ts` using the `yaml` package's `parseDocument` API: load `rasen/config.yaml` (honoring the existing `.yml` alias resolution via `resolveConfigFilePath`), set/delete the node in place, stringify. Comments, ordering, and unknown fields survive because we edit the document tree, not a re-serialized JS object. Writes are validated against the registry BEFORE touching the document, and the modified document is re-parsed through `ProjectConfigSchema`'s resilient parser as a post-write sanity check (mirroring the validate-before-save pattern of global `config set`). `--scope project` resolves the project root the same way other repo-local commands do; outside a Rasen project it fails with the standard "no rasen/ directory found" guidance.

*Why not round-trip through `stringifyYaml(parsed object)`:* that would destroy user comments and field ordering in a file that is documented as hand-editable — an unacceptable regression for existing users.

### D5: `resolveEffectiveConfig()` — the reusable seam (API sibling contract)

New module `src/core/effective-config.ts`:

```ts
type ConfigSource = 'default' | 'global' | 'project' | 'env-override';
interface EffectiveConfigEntry {
  definition: ConfigKeyDefinition;
  value: unknown;          // effective value after merge
  source: ConfigSource;    // highest-precedence layer that produced it
  scopeValues: { global?: unknown; project?: unknown };  // raw per-layer values
}
function resolveEffectiveConfig(options?: { projectRoot?: string }): EffectiveConfigEntry[];
```

Merge order per key: env-override (today only telemetry's env kill-switches surface here, reported as `env-override` with the env-forced value) > project (when the key is project-scoped and a project root resolves) > global > default. The function takes an explicit optional `projectRoot` instead of assuming cwd so the HTTP API sibling can serve any registered project. **This module plus `updateProjectConfigKey`/`saveGlobalConfig` is the exact in-process surface the `unified-config-api` child wraps in HTTP handlers — no command-layer logic may be needed by the API.** The command layer (list/get/editor) renders `EffectiveConfigEntry[]`; it computes nothing itself.

### D6: No-arg `rasen config` — interactive full-view editor

TTY: an `@inquirer/prompts` `select` loop styled after the existing `config profile` picker (chalk header, `[current]`-style annotations, `isPromptCancellationError` → exit 130):

1. Header lists groups; the select shows every registry key as `group / key = value (source)` (source dims when `default`), plus "Exit".
2. Choosing a key prompts by type: `select` for enums/booleans, `input` with registry validation for numbers/strings.
3. For a both-scope key inside a project, a scope select (project | global) precedes the value prompt; outside a project, project-scoped keys are shown but disabled ("requires a Rasen project").
4. After each write, the effective view refreshes (re-resolve) and the loop continues until Exit. Writes echo the same `Set <key> = <value>` line as `config set`.

Non-TTY no-arg: print the effective view (same rows, plain text, one key per line with value and source) and exit 0 — scriptable, and consistent with `config profile`'s non-interactive stance of never hanging. Today's no-arg behavior is Commander help output; replacing it is intentional and the subcommand help remains via `rasen config --help`.

The `preAction` scope-rejection hook is removed; `--scope` becomes a validated enum (`global` default, `project`), threaded to subcommands via command options.

## Risks / Trade-offs

- [Two `handoff.threshold` consumers could drift (pipeline resolver vs agent-context probe)] → both resolve through `resolveEffectiveConfig()` / one shared helper for the config-layer fallback; the delta spec pins both behaviors.
- [Comment-preserving YAML editing is more fragile than object serialization] → post-write re-parse through the resilient schema; unit tests cover comments, `.yml` alias, quoted keys, and unset-to-empty-document.
- [Sync config read in `isTelemetryEnabled()` adds a startup file read] → memoized once per process; the same file is already read synchronously by `getGlobalConfig()` on most commands.
- [Replacing no-arg help output changes existing muscle memory] → `rasen config --help` unchanged; the non-TTY effective view includes a trailing hint line pointing at `--help`.
- [Registry vs zod schema double-bookkeeping] → the registry covers only CLI-settable scalar keys; zod schemas remain the parse-time authority. A unit test asserts every registry key round-trips through its scope's schema, catching drift mechanically.
- [Project scope resolution ambiguity in worktrees/stores] → `--scope project` uses the same nearest-root resolution as other repo-local commands; store/project-flag routing is out of scope for this child (documented limitation, revisit with the API sibling which takes explicit project ids).

## Migration Plan

Purely additive. New keys absent → identical behavior to today (threshold 0.5, telemetry on, gates on). No data migration, no version bump (version stays whatever `package.json` says). Rollback = revert; config files written by the new code remain readable by old code (unknown keys passthrough in global JSON; project YAML resilient parsing drops unknown fields with a warning at worst).

## Open Questions

- Whether the editor should surface read-only informational rows for hand-edit fields (`context`, `rules`) or omit them entirely — implementation may start with omission; the spec requires only registry keys.
- Whether `workflows` (array-valued) appears in the editor as editable or as a pointer to `config profile` — recommended: pointer row that launches nothing, labeled "use `rasen config profile`", since the profile picker already owns that interaction.
