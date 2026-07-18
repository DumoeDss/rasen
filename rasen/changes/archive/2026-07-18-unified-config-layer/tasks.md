## 1. Config-key registry and schemas

- [x] 1.1 Create `src/core/config-keys.ts`: `ConfigKeyDefinition` interface and the registry table (global: profile, delivery, workflows, featureFlags.*, proactive, repoMode, telemetry.enabled; project: schema, autopilot.gates, autopilot.selection, archive.timing, archive.destination; both: handoff.threshold) with types, enums, range validators, defaults, descriptions, and groups
- [x] 1.2 Extend `GlobalConfigSchema` in `src/core/config-schema.ts` with typed `proactive`, `repoMode`, `telemetry` (enabled + passthrough for anonymousId/noticeSeen), and `handoff.threshold` fields; keep `.passthrough()`
- [x] 1.3 Make `validateConfigKeyPath` scope-aware, delegating to the registry (preserve `featureFlags.<name>` wildcard handling and global `--allow-unknown` semantics; project scope has no bypass); mark `telemetry.anonymousId`/`telemetry.noticeSeen` as not settable
- [x] 1.4 Add `handoff: { threshold }` to `ProjectConfigSchema` in `src/core/project-config.ts` with resilient drop-invalid-field parsing and a range warning
- [x] 1.5 Unit tests: registry/schema round-trip consistency test (every registry key accepted by its scope's schema), key-path validation per scope, resilient handoff parsing (valid, out-of-range dropped with warning, absent)

## 2. Project config write path

- [x] 2.1 Implement `updateProjectConfigKey(projectRoot, keyPath, value | undefined)` in `src/core/project-config.ts` using `yaml` `parseDocument` (comment/order-preserving set and delete, `.yml` alias via `resolveConfigFilePath`, create `rasen/config.yaml` content when the key is set in a config-less-but-valid project shape only if a config file already exists — otherwise error with guidance)
- [x] 2.2 Validate registry constraints before writing and re-parse the modified document through the resilient parser as a post-write sanity check
- [x] 2.3 Unit tests: set/unset preserve comments and unrelated fields, nested key creation, unset of absent key, invalid value rejected without touching the file

## 3. Effective-config resolution module

- [x] 3.1 Create `src/core/effective-config.ts`: `resolveEffectiveConfig({ projectRoot? })` returning `EffectiveConfigEntry[]` (definition, effective value, source `default|global|project|env-override`, raw per-layer values) with precedence env > project > global > default
- [x] 3.2 Wire telemetry env kill-switches (`RASEN_TELEMETRY=0`, `DO_NOT_TRACK=1`, CI) into the env-override layer for `telemetry.enabled`
- [x] 3.3 Unit tests: default-only, project-over-global, env-over-all, no-project-root resolution, explicit projectRoot different from cwd

## 4. Telemetry toggle

- [x] 4.1 Extend `isTelemetryEnabled()` in `src/telemetry/index.ts`: after env checks, consult `telemetry.enabled` via a memoized synchronous config read (missing/unparseable file fails open to enabled)
- [x] 4.2 Tests: config-disabled sends nothing, env enable does not beat CI, env opt-out beats config enable, unreadable config falls back to enabled

## 5. Handoff threshold consumption

- [x] 5.1 Extend `resolveStageHandoffConfig` in `src/core/pipeline-registry/types.ts` with an optional config-layers argument (`{ projectThreshold?, globalThreshold? }`) slotted between pipeline handoff and built-in defaults (threshold only); extend the `source` union with `project-config` and `global-config`
- [x] 5.2 Thread the config-layer values into `resolveStageHandoffConfig` call sites (pipeline show/resolution paths) from project/global config
- [x] 5.3 Add threshold reporting to `rasen agent context` (`src/commands/agent.ts` + `src/core/agent-context.ts`): resolve project (cwd) > global > default 0.5, output `threshold`, `thresholdSource`, `shouldHandoff` in JSON and the human line; exit code stays 0
- [x] 5.4 Tests: resolution precedence including both config layers and pipeline-beats-config, agent context JSON/human output with and without project config

## 6. CLI: --scope project and promoted keys

- [x] 6.1 Remove the `preAction` project-scope rejection in `src/commands/config.ts`; validate `--scope` as enum `global|project` and thread it into `path`/`list`/`get`/`set`/`unset`
- [x] 6.2 Implement project-scope behavior for those subcommands (path → resolved config.yaml path; list → parsed project config; get/set/unset → registry-validated read/write via `updateProjectConfigKey`), with a clear failure outside a Rasen project
- [x] 6.3 Ensure promoted global keys (`proactive`, `repoMode`, `telemetry.enabled`, `handoff.threshold`) set/get/unset without `--allow-unknown`, with registry validation errors naming constraints
- [x] 6.4 CLI tests: project scope get/set/unset/list/path happy paths, outside-project failure, unknown project key rejection, promoted key set without --allow-unknown, invalid enum/range rejections

## 7. Interactive full-view editor

- [x] 7.1 Implement the no-arg `rasen config` editor: grouped key rows with effective value + source annotation from `resolveEffectiveConfig()`, type-appropriate prompts (select for enum/boolean, validated input for number/string), scope prompt for both-scope keys inside a project, refresh-and-loop until exit, Ctrl+C → exit 130 (reuse `isPromptCancellationError` and `config profile` styling)
- [x] 7.2 Handle non-editable rows: project-only keys outside a project (disabled or omitted), `workflows` as a pointer row to `rasen config profile`, env-overridden keys annotated `env-override`
- [x] 7.3 Non-TTY no-arg: print the effective view (key, value, source per line) and exit 0, with a `--help` hint line
- [x] 7.4 Tests: non-TTY effective view output and exit code; editor prompt-flow unit tests for value writing per type and scope selection (mock prompts)

## 8. Docs and verification

- [x] 8.1 Update user-facing docs for `rasen config` (project scope, new keys, interactive editor, telemetry toggle) where config docs exist
- [x] 8.2 Run the full test suite (`pnpm test`) and `rasen validate unified-config-layer`; fix regressions
