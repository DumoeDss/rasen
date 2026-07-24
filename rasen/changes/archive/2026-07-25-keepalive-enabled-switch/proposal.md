## Why

Keepalive parking is valuable for Claude prompt-cache reuse, but it can waste time and held concurrency when Claude Code is configured to run another model or when a project does not want parked workers at all. Users need an explicit, scope-aware off switch that is enforced both when orchestration dispatches workers and when `rasen agent wait` is invoked directly.

## What Changes

- Add a boolean `keepalive.enabled` configuration key, defaulting to `true`, settable at global and project scope with project values overriding global values.
- Make orchestration resolve the effective switch once at run start and assign reusable parking horizons only when keepalive is enabled and the stage runtime is Claude; all other workers receive `ONE_SHOT` prompts with no parking protocol.
- Make `rasen agent wait` immediately stand down with reason `keepalive-disabled` when the effective switch is false, without blocking or mutating beat state.
- Extend the Pipelines Defaults keepalive control to show the effective enabled state and write or unset it in Global or project-local mode.
- Add localized registry and UI copy plus focused config, command, orchestration-template, and UI coverage.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `config-key-registry`: Register and resolve the global/project `keepalive.enabled` boolean with a default of `true`.
- `cli-agent-wait`: Add the explicit disabled gate and its immediate `keepalive-disabled` stand-down outcome.
- `pipelines-ui`: Expose the effective switch alongside the existing beat control and allow scope-correct edits with localized copy.

## Impact

The change affects the config registry and schemas, effective config resolution, keepalive config parsing, `rasen agent wait`, the generated orchestration playbook, localized config descriptions, and the Pipelines Defaults keepalive component and translations. It preserves the existing runtime gate, the 270-second configured beat default, and the internal 100-second unreadable/invalid-config fuse. No dependency or public command-line syntax changes are required.
