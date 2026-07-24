## Why

Canvas-authored pipelines are currently rejected unless they contain both an independent reviewer stage and a bounded review-cycle loop, even when the user intentionally builds a lightweight verification, research, or goal-loop pipeline. The `origin: ui` provenance marker should identify where a definition came from, not silently impose the stricter safety policy reserved for unattended autopilot composition.

## What Changes

- Limit the hard quality-floor validation rule to pipelines with `origin: composed`.
- Allow structurally valid `origin: ui` pipelines to omit `role: reviewer`, `loop.kind: review-cycle`, or both.
- Keep `origin: ui` as saved provenance and preserve every other schema, graph, decompose, and skill validation rule.
- Add core and management-API regression coverage for the distinct `composed`, `ui`, and origin-free behaviors.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `opsx-pipeline-registry`: Scope the mandatory reviewer plus review-cycle quality floor to autopilot-composed pipelines while treating `ui` only as provenance.
- `pipeline-http-api`: Ensure draft validation accepts floor-free Canvas definitions while continuing to reject floor-free composed definitions and enforce all other validation rules.
- `pipelines-ui`: Align the Canvas validation-and-save contract so a floor-free `origin: ui` draft is not blocked for those omissions alone.

## Impact

- Core pipeline parsing and draft validation in `src/core/pipeline-registry/`.
- Pipeline draft-validation behavior exposed by `POST /api/v1/pipeline-validation`.
- Canvas validation-and-save specification; no Canvas implementation change is required.
- Focused registry and management-API regression tests.
- No persisted schema migration, new policy field, Canvas format change, or dependency change.
