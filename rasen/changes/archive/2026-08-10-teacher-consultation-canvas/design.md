## Context

The consultation runtime (child 1, archived as `ecp-consultation-runtime`) defines the canonical consultation protocol: a `CONSULT` worker step, Teacher admission, advice settlement, continuation grants, and independent budgeting. The Teacher Advisor workflow (child 3, archived as `teacher-advisor-workflow`) adds the pipeline YAML `consultations` field (`sourceStage`, `teacherSkill`, limits), the built-in Teacher Advisor expert, and the execution profile resolver that produces `RuntimeConsultationBinding` entries.

The canonical Run view projector (`src/core/change-run/internal/projector.ts`) already emits a `consultation/1` section with entries carrying consultation id, ordinal, state, source/Teacher identities, advice decision, independent used/max counters, continuation state, and typed failure reason. The management API serves this section transparently as part of `ChangeRunView.sections` — no management API code change is needed for the data to reach the UI.

The gap is purely in the UI layer:

- The UI API types (`packages/ui/src/api/types.ts`) have no `ConsultationViewSection` type — the section falls through to the generic `AdditiveViewSection` catch-all and is never rendered by name.
- The UI API types' `WirePipelineDefinitionV1` does not mirror the server-side `PipelineYamlSchema.consultations` field added by child 3 — the field is served by the server but not typed in the UI.
- `WirePipelineDefinitionV2` preserves the field via `[key: string]: any`, but there is no typed shape for the Canvas to read or edit.
- The Canvas (`V2NodePanel.tsx`, `draft.ts`, `PipelineCanvasPage.tsx`) has no consultation authoring controls.
- The Run detail view has no consultation observability rendering.

The relevant code surfaces:

- `packages/ui/src/api/types.ts` — UI mirror of wire types (`WirePipelineDefinitionV1/V2`, `ChangeRunView`, `ChangeRunViewSection`, section extractors).
- `packages/ui/src/canvas/V2NodePanel.tsx` — per-node property editor (AtomicStage, BoundedLoop, Gate, etc.).
- `packages/ui/src/canvas/draft.ts` — immutable draft helpers (`updateBoundedLoopContract`, `AtomicStageExecutionPatch`, etc.).
- `packages/ui/src/canvas/PipelineCanvasPage.tsx` — main Canvas page (load, edit, save).
- `src/core/change-run/contracts.ts` — authoritative `ConsultationViewSectionSchema` (source of truth for the UI mirror).
- `src/core/pipeline-registry/types.ts` — authoritative `ConsultationBindingYamlSchema` (source of truth for the binding wire type).
- `src/core/management-api/runs.ts` — serves `ChangeRunView` including the consultation section (already passing it through).

## Goals / Non-Goals

**Goals:**

- Let a pipeline author add, edit, and remove consultation bindings from the Canvas, choosing a source stage and Teacher skill with per-invocation and per-consultation limits.
- Surface the canonical projected consultation state in the Run detail view, consuming only the `consultation/1` view section from the Record-backed projection.
- Preserve all existing Canvas V2 lifecycle authoring — BoundedLoop strategy editor, AtomicStage execution editor, Gate/Choice/FanOut/Join editors — with zero behavioral change.
- Mirror the `consultations` field and `ConsultationViewSection` in the UI API types so the UI is type-safe and the section stops falling through to the additive catch-all.

**Non-Goals:**

- Changing the consultation runtime, executor, lifecycle reducer, worker contracts, or Teacher Advisor skill template.
- Adding a new management API endpoint or management API wire type — the existing run view endpoint already serves the consultation section.
- Rendering advice bodies, question bodies, or evidence content in the observability panel — the projection carries digests and state, not raw content.
- Making the Canvas authorize continuation, widen consultation content, or validate advice from projected limits — those are runtime authority, not projection facts.
- Providing a visual sidecar edge in the DAG graph between source and Teacher nodes — the Teacher is not a graph node; the relationship is pipeline-level metadata.
- Handling macOS Teacher availability — the observability panel reflects whatever availability the projection reports honestly.

## Decisions

### 1. Put the consultation authoring section in V2NodePanel for AtomicStage nodes

When an AtomicStage node is selected and the definition has a consultation binding whose `sourceStage` matches the node's stage id, V2NodePanel shows a "Teacher Consultation" section. The section displays the Teacher skill selector (populated from the catalog), max-consultations and max-attempts limit fields, and a remove button. When no binding exists for the selected stage, the section offers an "Add Teacher consultation" action.

This is consistent with the existing interaction model (select a node, edit its properties) and avoids introducing a new panel or navigation surface. The BoundedLoop strategy capability editor already demonstrates a per-node section that edits pipeline-level catalog selections.

Alternative A was a separate pipeline-level "Consultations" tab. That introduces a new panel, navigation surface, and draft system, which is disproportionate for a small array of optional bindings. Alternative B was embedding the editor in the BoundedLoop node — but a consultation source is an AtomicStage, not the loop, and multiple stages could each have bindings.

### 2. Store consultation bindings on the pipeline-level consultations array, not on the node

The draft helpers in `draft.ts` gain `addConsultationBinding`, `updateConsultationBinding`, and `removeConsultationBinding` functions that operate on the pipeline-level `consultations` array. For v1 definitions, this is `WirePipelineDefinitionV1.consultations`. For v2 definitions, it is the `consultations` key preserved by `[key: string]: any` and typed via a new optional field.

The V2NodePanel section reads and writes through these helpers. It does not store consultation data on the node object — the node is the selection context, not the data location.

This matches child 3's Decision 1 (pipeline-level, not per-stage-field) and avoids any change to `DefinitionNode` types or the graph model.

### 3. Mirror WireConsultationBinding and add consultations to both wire definition versions

`WirePipelineDefinitionV1` gains an optional `consultations?: WireConsultationBinding[]` field mirroring the server-side `PipelineYamlSchema.consultations` from child 3. `WirePipelineDefinitionV2` gains an optional `consultations?: WireConsultationBinding[]` field typed alongside the existing `[key: string]: any` passthrough. The UI type `WireConsultationBinding` mirrors `ConsultationBindingYamlSchema` exactly: `sourceStage`, `teacherSkill`, `maxConsultationsPerInvocation`, `maxTeacherAttemptsPerConsultation`, optional content `limits`.

The server already serves and accepts this field for v1 pipelines. For v2 definitions, the server's `DefinitionSourceV2` preserves unknown extension fields losslessly, and the management API's `preparePipelineDefinitionForManagement` round-trips them. Adding the typed field to the UI side makes the Canvas type-safe without requiring a server-side definition model change.

### 4. Mirror ConsultationViewSection and add getConsultationSection to UI types

The UI types gain a `ConsultationViewSection` interface that mirrors the authoritative `ConsultationViewSectionSchema` from `src/core/change-run/contracts.ts`: `kind: 'consultation'`, `version: 1`, and an `entries` array with consultationId, ordinal, state, source/teacher identities, advice decision, counters, limits, continuation, and failure. The `ChangeRunViewSection` union adds `ConsultationViewSection` as a member. A `getConsultationSection(view)` extractor returns the typed section or null, matching the pattern of `getRootDagSection`, `getReviewCycleSection`, etc.

The observability panel calls `getConsultationSection` and renders each entry as a read-only card: consultation id short form, ordinal, state badge, source model/runtime, Teacher model/runtime (when admitted), advice decision (when committed), used/max counters, continuation state (when present), and failure reason (when present).

### 5. The observability panel renders projection facts only

The panel does not attempt to reconstruct advice bodies, question content, evidence content, session diagnostics, or backend-private runtime references. It renders exactly what the canonical projection carries: identities (as id digests), states, decisions, counters, digests, and typed failure reasons. It does not offer continuation actions, retry buttons, or any interactive control that could be mistaken for execution authority.

This enforces the constraint from planning-context.md: Canvas projections consume the canonical Record-backed grant/settlement contract and must not treat raw SessionHost result bytes, Teacher root exit, or a Teacher-completed signal as advice.

### 6. The Teacher skill selector uses the existing capability catalog

The `PipelineCatalogResponse.skills` array already includes built-in expert workflows. Since child 3 registered `teacher-advisor` as a built-in expert, the Teacher Advisor skill appears in the catalog with its capability id/version. The consultation editor's Teacher skill selector filters `catalog.skills` for entries whose skill name matches a `teacherSkill` identifier (e.g., `rasen-teacher-advisor`).

No new catalog endpoint or skill-discovery mechanism is needed. If the Teacher Advisor skill is not installed or is disabled in the active profile, the selector shows it greyed-out (matching the existing BoundedLoop strategy capability selector behavior for disabled skills).

### 7. v1 pipelines edited in Canvas preserve consultations

When the Canvas loads a v1 pipeline that has `consultations`, the field is present on `WirePipelineDefinitionV1`. When the user edits the pipeline (entering draft mode), the consultations field is cloned with the rest of the definition via `structuredClone`. The draft helpers operate on the cloned definition. When saved, the management API receives the v1 definition with the updated `consultations` field and re-validates it against `PipelineYamlSchema`.

No v1-to-v2 conversion of the consultations field is needed because the Canvas does not convert v1 pipelines to v2 — it serves and saves them in their authored version.

## Risks / Trade-offs

- [Adding a section to V2NodePanel could grow the file further] → The section is a self-contained component (like `BoundedLoopDetails` or `GateDetails`), not inline JSX in the main render body. It is imported and rendered conditionally.
- [Consultations on v2 definitions rely on `[key: string]: any` passthrough] → The server's `DefinitionSourceV2` preserves unknown fields, and the management API round-trips them. Adding a typed `consultations?` field to the UI's `WirePipelineDefinitionV2` makes the Canvas type-safe. The server-side definition model is unchanged (child 3 owns the v1 YAML schema).
- [The observability panel shows id digests, not human-readable names] → The canonical projection carries opaque identity digests, not display names. This is by design: the projection is a mechanical truth surface. A future change could add a resolution layer, but this change renders the raw projected identity faithfully.
- [Canvas cannot verify Teacher availability at authoring time] → The catalog shows the Teacher Advisor skill as enabled or disabled based on the active profile, but exact Teacher availability depends on the process-provider lane and platform. The editor warns that availability is platform-dependent and defers to the runtime's pre-activation verdict.
- [A v1 pipeline edited in Canvas retains the `consultations` field through structuredClone] → This is safe because `structuredClone` handles plain JSON-serializable objects. The field is a simple array of plain objects matching `ConsultationBindingYamlSchema`.
