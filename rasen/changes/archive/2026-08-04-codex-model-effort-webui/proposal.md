## Why

The backend now supports generic Codex model ids and independently resolved reasoning effort, but the Pipelines WebUI cannot configure or explain that effort and does not suggest the Luna or Terra ids used by the new Codex path. This follow-up closes that presentation gap without changing backend resolution or restricting future/custom model ids.

## What Changes

- Add `gpt-5.6-luna` and `gpt-5.6-terra` to the shared, non-binding model suggestions while retaining all existing suggestions and arbitrary non-empty model entry.
- Extend the Pipelines Defaults role matrix with scoped effort controls for the default, planner, implementer, reviewer, fixer, and shipper keys.
- Add a per-stage effort control with inherit/unset behavior beside the existing gate and model controls.
- Consume the backend-provided effective effort value and source so the UI displays server resolution verbatim.
- Add complete English, Simplified Chinese, and Japanese strings for the new effort surfaces.
- Add focused UI, API, wire-model, and suggestion-parity coverage for rendering, scoped writes, inheritance, and effective provenance.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pipelines-ui`: Expose role-default and per-stage reasoning-effort configuration, effective provenance, and Luna/Terra model suggestions on the existing Pipelines controls.
- `pipeline-http-api`: Include effective effort and its independent source in the documented per-stage inventory contract.
- `ui-i18n`: Provide complete three-language coverage for the new Pipelines effort labels and actions.

## Impact

The change affects the Pipelines page and its shared model suggestions, frontend pipeline wire types and fixtures, existing Pipelines styling, the three UI locale catalogs, and focused Pipelines UI/config-control and management API tests. It adds no dependency, pipeline-definition mutation, backend precedence change, or breaking API behavior.
