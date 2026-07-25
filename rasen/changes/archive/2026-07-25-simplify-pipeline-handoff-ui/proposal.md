## Why

The Pipelines page currently exposes three competing ways to tune handoff thresholds—schemes, legacy machine keys, and temporary per-stage config instances—making a pre-release UI feel more complex than the product model requires. Before the first external 0.1.5 release, the UI should make runtime-bound Threshold Schemes the ordinary policy path and the Canvas the durable home for stage-specific pipeline exceptions, while preserving compatibility for existing configuration.

## What Changes

- Remove the Pipelines page's top-level Advanced Overrides surface and stop exposing legacy `handoff.threshold` / `handoff.roles.*` as ordinary web controls.
- Keep legacy machine handoff values and `pipelines.<name>.handoff.<stage>` instances readable in backend resolution so existing installations retain their effective behavior.
- Move the global-only keepalive runtime gates and context floor into the existing Defaults → Keepalive lifecycle area, alongside the keepalive enabled switch and beat control.
- Remove the Configure disclosure's temporary per-stage handoff instance editor while retaining its stage gate, stage model, and per-role runtime controls.
- Add dual-form stage-definition handoff threshold editing to the Canvas StagePanel, including inherit/remove behavior and round-trip preservation of other stage handoff fields.
- Update Pipelines UI specifications, localized copy, styles, and focused tests to reflect the simplified ownership model.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pipelines-ui`: Replace legacy and temporary handoff override surfaces with Canvas-authored stage definition thresholds, and consolidate keepalive lifecycle controls in the Defaults area.

## Impact

- Affects `packages/ui` Pipelines and Canvas components, Config grouping assumptions, UI locale catalogs, styles, fixtures, and component/canvas tests.
- Revises the durable `pipelines-ui` contract; threshold scheme, pipeline loader, config API, and handoff resolver contracts remain compatible.
- Does not delete or rewrite stored legacy handoff values or per-stage config instances, and does not change their backend precedence.
