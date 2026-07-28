## Why

Rasen's handoff and worker-reuse thresholds are currently scattered across pipeline, project, store, global, preset, and default layers without a reusable machine-level policy or a runtime-aware selection mechanism. Now that runtime capabilities have a canonical registry, the threshold core can add named schemes and capability-safe runtime bindings while keeping every execution path on one deterministic resolver.

## What Changes

- Add strict machine-level threshold scheme files that package handoff and reuse thresholds under reusable names.
- Add `thresholds.bindings.<runtime>` configuration across global, store, and project scopes, including a reserved `default` fallback row and runtime-aware placeholder validation.
- Add a synchronous, pure threshold resolver that consumes caller-injected layers and applies one documented precedence model for handoff, reuse, schemes, legacy config, presets, and defaults.
- Update pipeline inspection and agent-context probing to use the shared resolver; agent-context results also report the detected runtime.
- Add headless `rasen scheme list` and `rasen scheme show` commands for inspecting machine-level schemes.
- Add focused core and CLI coverage for scheme validation, binding fallback, threshold precedence, runtime reporting, malformed files, and cross-platform paths.
- Keep pipeline-management UI, localization, and orchestration-template prose outside this change.

## Capabilities

### New Capabilities

- `threshold-schemes`: Machine-level named scheme storage, strict validation, inspection, and headless list/show commands.
- `runtime-threshold-bindings`: Runtime-to-scheme bindings and the unified handoff/reuse threshold resolution contract.

### Modified Capabilities

- `config-key-registry`: Add the runtime-aware `thresholds.bindings.<runtime>` wildcard family and family-specific placeholder validation.
- `cli-agent-context`: Report the detected runtime and resolve handoff reporting through runtime-bound schemes before legacy layers.
- `pipeline-handoff-config`: Insert bound scheme values into the established per-stage handoff resolution order.
- `worker-reuse-config`: Insert bound scheme values into role-level and pipeline-level reuse resolution.

## Impact

This change affects the core config-key registry, global/project/store config schemas, effective-config loading, pipeline threshold types and resolution, agent-context reporting, CLI registration, and their tests. It introduces machine-local scheme files under the global config directory but does not change the package version, existing pipeline YAML syntax, `AI_TOOLS`, runtime keepalive behavior, or dependency set.
