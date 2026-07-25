## Context

The 0.1.5 development UI currently exposes handoff policy in three places:

1. machine-level `handoff.threshold` and `handoff.roles.*` controls under a page-level Advanced Overrides disclosure;
2. runtime-bound Threshold Schemes with scalar and optional role overrides; and
3. `pipelines.<name>.handoff.<stage>` config-family instances under each pipeline's Configure disclosure.

The first two overlap for ordinary default/per-role policy, while the third creates a scope-layered exception that is less visible and less durable than changing the pipeline definition itself. The pipeline definition and HTTP wire types already accept a stage `handoff` block, and Canvas save already round-trips that shape, but the StagePanel cannot author it.

The page-level Advanced Overrides also contains `keepalive.runtimes.*` and `keepalive.contextFloor`. Those keys govern parked-worker lifecycle and cache behavior rather than threshold selection. The Pipelines Defaults area already owns the related `keepalive.enabled` and `keepalive.beatSeconds` controls.

The backend resolution order must remain unchanged. In particular, existing machine-level handoff keys and stage config-family instances can predate this UI cleanup and may still be the effective source after upgrade. Built-in pipelines also remain immutable; users duplicate them before editing a definition in Canvas.

## Goals / Non-Goals

**Goals:**

- Present Threshold Schemes and runtime bindings as the ordinary default/per-role handoff policy.
- Make a pipeline definition's stage `handoff.threshold` editable in Canvas in both supported threshold forms.
- Remove both web surfaces that create or edit legacy/scoped handoff config values without deleting or rewriting those values.
- Consolidate all visible keepalive settings in one lifecycle-focused Defaults subsection.
- Preserve Configure controls for per-stage gate, per-stage model, and per-role runtime.
- Keep locale catalogs, styling, specifications, and tests aligned with the simplified UI.

**Non-Goals:**

- Removing config-key registry entries, parsing, CLI access, API support, or resolution layers for legacy handoff values or `pipelines.<name>.handoff.<stage>`.
- Changing handoff precedence, threshold scheme semantics, or stored user configuration.
- Adding Canvas editors for pipeline-level handoff role maps, `maxRelays`, `stallLimit`, runtime session settings, or goal-loop internals.
- Making built-in pipelines editable in place.
- Moving the whole Pipelines config group back into the generic Config page.

## Decisions

### D1. Use one authoring surface per handoff intent

Threshold Schemes remain the ordinary policy surface for a runtime's scalar and optional role-specific handoff thresholds. Canvas becomes the authoring surface for a durable stage-specific exception in pipeline YAML.

The Pipelines list will no longer expose controls for machine legacy handoff keys or scoped stage handoff instances. The server may still report their effective results, and the graph view may continue to display effective handoff provenance, but the web UI will not mutate those compatibility layers.

This is preferred to retaining a smaller Advanced disclosure because the disclosure would continue to teach a parallel configuration model immediately before the first external release.

### D2. Remove legacy migration UI without mutating legacy data

`AdvancedOverrides`, `StageHandoffControl`, their migration link, and the coexistence notice that points to that surface will be removed. Loading the page performs no cleanup. Existing `handoff.*` and `pipelines.<name>.handoff.<stage>` values remain in configuration and continue through the current resolver precedence.

The Threshold Schemes empty-state/fallback explanation and effective source data remain sufficient to explain that compatibility resolution can still apply. Users needing to clean up a legacy value can continue to use supported CLI/config mechanisms; this change deliberately does not add another web editor.

This is preferred to an automatic migration because no lossless mapping exists without choosing scheme identity, bindings, and scope on the user's behalf.

### D3. Consolidate keepalive controls in Defaults → Keepalive

The existing Keepalive subsection in Pipelines Defaults will render the explicit key set:

- `keepalive.enabled`
- `keepalive.beatSeconds`
- `keepalive.runtimes.claude`
- `keepalive.runtimes.codex`
- `keepalive.contextFloor`

The enabled switch and beat control retain their project/global behavior. Runtime gates and context floor retain their global-only registry scopes, so they appear only in Global mode and use the existing `ConfigEntryRow` write/unset behavior and source badges.

The registry group remains `Pipelines`, and `packages/ui/src/config/grouping.ts` continues to exclude that group from generic Config. This keeps one owner for every Pipelines-group key and avoids exposing unrelated gate/model/runtime families in Config merely to rehome three lifecycle keys.

This is preferred to moving the keys into Config → Advanced because the existing Keepalive control already supplies the concept, explanation, and scope-aware editing context.

### D4. Keep Configure focused on live config families that remain intentional

The per-pipeline Configure disclosure will retain:

- stage gate config-family controls;
- stage model config-family controls; and
- role runtime config-family controls.

The nested Advanced stage thresholds disclosure and `StageHandoffControl` will be removed. Configure continues to write only scope-layered config values and never writes pipeline definition YAML.

### D5. Add a nested-field-safe Canvas handoff editor

The StagePanel will expose one optional handoff threshold selector with three states: inherit/not declared, fraction, and remaining tokens. Fraction and absolute inputs use the threshold constraints supplied by `PipelineCatalogResponse.handoff`; form switches seed a valid conventional value and the server's draft validation remains authoritative.

Updating or clearing the threshold must preserve an existing stage handoff block's unexposed `maxRelays` and `stallLimit`. Clearing the threshold removes the entire `handoff` property only when no other handoff fields remain; otherwise it retains the remaining block. This nested update will be implemented through a small pure draft helper so preservation and empty-block cleanup are unit-testable independently of the canvas DOM.

The editor patches the `WirePipelineDefinitionStage` draft, so ordinary dirty-state, validation, save, and `origin: ui` behavior apply without a new API. A built-in pipeline still requires Duplicate before the editor is available.

This is preferred to writing a scoped config instance from Canvas because Canvas represents durable pipeline-definition intent and already saves the authoritative definition.

### D6. Remove obsolete presentation code and reuse threshold vocabulary

Styles dedicated only to `.pipelines-advanced`, `.pipeline-stage-advanced`, `.stage-control--handoff`, and the removed migration notice will be deleted when no remaining component uses them. The Canvas field will reuse the established threshold form and inherit vocabulary, adding only Canvas/keepalive-specific localized copy that is needed in English, Japanese, and Simplified Chinese.

Tests will assert absence as well as presence: no page-level Advanced Overrides, no Configure stage handoff editor, keepalive lifecycle keys in the Defaults subsection only at their valid scope, and Canvas dual-form edit/clear/save preservation behavior.

## Risks / Trade-offs

- **[Risk] Existing hidden config can still affect an effective threshold.** → Preserve effective source reporting in server-backed views and backend resolution; do not claim that removing the UI removes the value.
- **[Risk] Clearing a Canvas threshold could drop unexposed relay limits.** → Centralize nested patching in a pure helper and test threshold replacement, threshold-only deletion, and preservation of `maxRelays`/`stallLimit`.
- **[Risk] Rehomed global-only keepalive controls could appear editable in Local mode.** → Filter each explicit key through the same registry scope visibility check used by current Defaults controls and cover project/store/global modes.
- **[Trade-off] Legacy values no longer have a web cleanup path.** → Accept this intentionally for a simpler 0.1.5 UI; CLI/config compatibility remains available and no existing value is lost.
- **[Trade-off] Configure still contains gate/model/runtime scoped overrides.** → Keep them because this change settles handoff ownership only; removing those families requires separate product decisions.

## Migration Plan

1. Ship the UI/spec/test changes without changing backend schemas or resolver precedence.
2. On upgrade, stored legacy handoff keys and stage instances continue to resolve exactly as before.
3. Users create ordinary handoff policy through Threshold Schemes and bindings; users duplicate a built-in pipeline before adding a durable Canvas stage threshold.
4. Rollback requires only restoring the removed UI components and copy; no data migration or reverse rewrite is necessary.

## Open Questions

None. The scope and ownership model are settled for 0.1.5.
