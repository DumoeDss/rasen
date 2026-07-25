# Planning Context

## User intent

Simplify the Pipelines UI before the first external 0.1.5 release:

- Remove the Pipelines page's top-level **Advanced Overrides** surface.
- Make Threshold Schemes the normal home for default and optional per-role handoff thresholds.
- Keep legacy `handoff.threshold` / `handoff.roles.*` values readable as compatibility fallback, but stop presenting them as normal Pipelines UI controls.
- Move independent keepalive lifecycle controls out of the removed threshold-oriented surface.
- Remove the per-pipeline Configure surface's temporary `pipelines.<name>.handoff.<stage>` editor.
- Author a pipeline definition's stage-specific `handoff` value in the Canvas StagePanel instead.
- Keep the Configure controls for stage gate, stage model, and per-role runtime in this change.
- Update the durable specs, localized UI, styles, and tests coherently.

## Established product model

- Threshold Scheme `handoff` and `handoffRoles` define the ordinary runtime-aware policy.
- Canvas edits durable pipeline-definition exceptions, including `stage.handoff`.
- Scope-layered stage handoff instances remain readable by the backend for compatibility, but are no longer created or managed from the web UI.
- Built-in pipelines remain read-only in Canvas; a user duplicates one before changing its definition.
- Keepalive runtime/context controls govern worker lifecycle and cache behavior, not threshold selection, so they must not be presented as threshold overrides.

## Codebase findings

- `packages/ui/src/components/PipelinesPage.tsx` owns both `AdvancedOverrides` and the Configure-only `StageHandoffControl`.
- `packages/ui/src/canvas/StagePanel.tsx` edits gate, model, and runtime but currently has no handoff editor, even though the pipeline definition schema already supports `stage.handoff`.
- `packages/ui/src/config/grouping.ts` excludes Workflow, Autopilot, and Pipelines registry groups because the Pipelines page currently claims them; rehoming keepalive controls must account for that filter.
- `rasen-v0.1.4` had no Pipelines page, but did expose `handoff.threshold` through the generic Config UI. Existing values must keep resolving after upgrade.
- Main specs currently require both the Advanced Overrides surface and per-stage handoff instance editing; this change must revise those contracts rather than only deleting JSX.
- All five keepalive registry keys remain in the `Pipelines` group; consolidating them in the existing Defaults → Keepalive area preserves one UI owner and does not require reopening the group in generic Config.
- The pipeline catalog already supplies shared handoff fraction/remaining-token constraints, so the Canvas editor can validate both forms without duplicating core limits.

## Run decisions

- Pipeline: `small-feature`.
- Gate policy: `off`, source `flag` (`--no-gate`).
- Selection policy: `manual`, source `default`.
- Runtime roles: planner/implementer/reviewer/fixer/shipper all `claude`.
