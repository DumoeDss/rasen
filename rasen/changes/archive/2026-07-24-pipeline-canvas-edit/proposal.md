## Why

Children 1-3 delivered the complete substrate for online pipeline assembly — a unified management-side API with detail/validation/save/catalog contracts, and a read-only DAG canvas — but a user still cannot compose or modify a pipeline without hand-writing YAML. This finale turns the canvas into the assembly editor the portfolio was scoped for: drag-and-drop composition from the installed-skill palette, structural editing with live feedback, and a validate-then-save flow that keeps every server-side guarantee (bridge invariant, quality floor, round-trip fidelity) intact.

## What Changes

- The pipeline graph route gains an Edit mode (same route, in-page toggle; Edit offered only when the detail reports `editable: true` and always for new drafts). View mode stays exactly child 3's read-only behavior.
- Structural editing on the canvas: move stage cards freely (session-only positions — the definition stores no coordinates; reopening re-runs auto-layout), connect stages to add `requires` edges, delete edges and stages (deleting a stage removes it and every `requires` reference to it). Connections that would close a cycle are rejected instantly client-side with a transient explanation; the server dry-run remains the authority.
- A palette panel fed by `GET /api/v1/pipeline-catalog`: installed skills (disabled ones greyed with their state named, not hidden), dragged onto the canvas to create stages via `screenToFlowPosition`; vocabulary pickers everywhere come from the catalog response, never from literals retyped in UI code.
- A stage properties side panel (selection-driven): edits id, role, skill, gate, condition, verifyPolicy, model, runtime, and parallelGroup, plus review-cycle loop kind and max rounds; definition fields the panel does not expose are preserved verbatim through edit and save (round-trip fidelity extends into the editor). Pipeline-level name/description editing in the header.
- Validation overlay: a Validate action (and pre-save gate) posts the draft to `POST /api/v1/pipeline-validation`; returned issues are mapped through their locator paths onto the offending nodes/edges/panel fields and listed in an issues drawer; error-severity issues block save.
- Save flow via `POST /api/v1/pipelines` `op: 'save'`: the client stamps `origin: 'ui'` on the definition, validates first, then saves; a name-collision refusal (422) offers an explicit overwrite retry; a busy bridge (409) offers retry; success refreshes and exits to view mode.
- New-pipeline entry on the Pipelines page ("Assemble in canvas"): a name-first dialog, then the graph route opens in Edit mode with a minimal draft — no reserved URL segment, so pipelines named `new` are never shadowed.
- Dirty-state protection: an unsaved-changes indicator, in-app navigation confirm, and a browser unload guard while dirty; Discard reverts to the server definition.
- UI mirror + client: `PipelineValidationRequest/Issue/Response`, `PipelineCatalogResponse/Skill` mirror entries and the `save` member of `PipelineMutationRequest`; client functions `validatePipeline` and `getPipelineCatalog`. Drive-by (review-accepted Minor from child 3): tighten `PipelineAgentRuntimeConfig.runtime` to required, matching the core schema's parsed output.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipelines-ui`: the graph view gains an edit mode (composition, palette, property panel, validation overlay, save); the "pipeline validation has no UI surface on this page" carve-out is replaced — validation now has exactly one UI surface, the canvas editor; the library-management requirement's op enumeration acknowledges save as a canvas-editor-only operation (init/import/export/delete dialogs unchanged).

## Impact

- Code: `packages/ui/src/canvas/` (PipelineCanvasPage edit mode, new PalettePanel, StagePanel, IssuesDrawer, draft-state module `draft.ts` with pure graph-mutation + cycle-check functions beside `layout.ts`), `packages/ui/src/components/PipelinesPage.tsx` (Assemble-in-canvas entry + per-pipeline Edit links), `packages/ui/src/api/types.ts` (validation/catalog/save mirror entries + runtime drive-by), `packages/ui/src/api/client.ts` (two functions). No server changes — all four child-2 contracts consumed as shipped. No routing changes beyond passing an initial-mode/draft hint.
- Tests: pure draft-module tests (cycle rejection, stage add/delete with requires cleanup, field preservation of unexposed definition fields, issue-path mapping), page tests with the flow mocked (mode gating on `editable`, dirty guards, validate-blocks-save, collision/busy retries, origin stamp on the posted body), vitest config inherits child 3's alias setup (vite.config.ts AND vitest.config.ts are separate — both already aliased).
- Follows through on the portfolio's quality-floor design: an `origin: 'ui'` draft missing reviewer/review-cycle stages surfaces the floor violation as a validation issue in the editor before save hard-fails it.
