## Why

The consultation runtime (child 1) and Teacher Advisor workflow (child 3) define and implement the canonical consultation protocol, durable state, and pipeline YAML `consultations` field. But an author cannot create or edit a consultation binding through the Canvas, and an operator cannot observe consultation state (pending Teacher, committed advice, continuation, exhaustion) through the management UI. The runtime already projects a canonical `consultation/1` view section from the Record, but the UI types and renderers do not surface it.

## What Changes

- Add Canvas V2 authoring controls for pipeline-level consultation bindings: a source-stage selector, Teacher-skill selector (from the capability catalog), and per-invocation / per-consultation limit fields. The controls consume the `consultations` field shape defined by child 3 and produce the same `ConsultationBindingYamlSchema` input.
- Add a typed `ConsultationViewSection` mirror to the UI API types and a `getConsultationSection` extractor, so the canonical projected section stops falling through to the generic additive section catch-all.
- Add a read-only consultation observability panel to the Run detail view that renders consultation state (source identity, Teacher identity, advice decision, independent used/max counters, continuation state, typed failure reason) from the canonical Record-backed projection only.
- Preserve all existing Canvas V2 lifecycle authoring (BoundedLoop strategy editor, AtomicStage execution editor, Gate/Choice/FanOut/Join editors) — additive only.
- Reflect Teacher availability honestly: the Canvas does not assume hosted = Teacher-available, and the observability panel does not treat raw SessionHost result bytes, a Teacher root exit, or a Teacher-completed signal as advice.

## Capabilities

### New Capabilities

- `teacher-consultation-canvas`: Canvas V2 authoring controls and observability rendering for Teacher consultation bindings and their canonical projected state.

### Modified Capabilities

_(None — the Teacher Advisor skill appears in the pipeline capability catalog by virtue of its existing built-in expert registration from child 3. No existing spec-level behavior changes.)_

## Impact

- **Canvas** (`packages/ui/src/canvas/`): new consultation binding editor component, pipeline-level consultation draft helpers in `draft.ts`, integration into `V2NodePanel.tsx` or a dedicated pipeline-level panel.
- **UI API types** (`packages/ui/src/api/types.ts`): add `ConsultationViewSection`, `getConsultationSection`, `WireConsultationBinding` mirror types.
- **Run detail view** (`packages/ui/src/`): add a consultation observability section to the Run detail rendering.
- **Management API** (`src/core/management-api/`): no changes needed — the canonical projector already emits the `consultation/1` view section and the management API passes `ChangeRunView.sections` through transparently.
- **Pipeline definition** (`src/core/pipeline-registry/definition.ts`): no changes to the definition node model — consultations remain pipeline-level metadata, not graph nodes.
- **Pipeline catalog** (`src/core/management-api/pipelines.ts`): the Teacher Advisor skill appears in the existing catalog response by virtue of being a registered built-in expert workflow (child 3).
