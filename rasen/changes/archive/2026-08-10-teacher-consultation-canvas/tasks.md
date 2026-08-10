## 1. UI API types — consultation wire types and view section mirror

- [x] 1.1 Add `WireConsultationBinding` interface to `packages/ui/src/api/types.ts` mirroring `ConsultationBindingYamlSchema` from `src/core/pipeline-registry/types.ts` (`sourceStage`, `teacherSkill`, `maxConsultationsPerInvocation`, `maxTeacherAttemptsPerConsultation`, optional content `limits`)
- [x] 1.2 Add optional `consultations?: WireConsultationBinding[]` field to `WirePipelineDefinitionV1`
- [x] 1.3 Add optional `consultations?: WireConsultationBinding[]` field to `WirePipelineDefinitionV2` alongside the existing `[key: string]: any` passthrough
- [x] 1.4 Add `ConsultationViewSection` interface mirroring `ConsultationViewSectionSchema` from `src/core/change-run/contracts.ts` (`kind: 'consultation'`, `version: 1`, entries with consultationId, ordinal, state, source/teacher identity fields, advice decision, counters, limits, continuation, failure)
- [x] 1.5 Add `ConsultationViewSection` to the `ChangeRunViewSection` union type
- [x] 1.6 Add `getConsultationSection(view: ChangeRunView): ConsultationViewSection | null` extractor matching the pattern of `getRootDagSection` / `getReviewCycleSection`

## 2. Canvas draft helpers — consultation binding operations

- [x] 2.1 Add `ConsultationBindingPatch` type to `packages/ui/src/canvas/draft.ts` for partial consultation binding edits
- [x] 2.2 Add `addConsultationBinding(def: WirePipelineDefinition, binding: WireConsultationBinding): WirePipelineDefinition` that appends to the pipeline-level `consultations` array, handling both v1 and v2 definitions
- [x] 2.3 Add `updateConsultationBinding(def: WirePipelineDefinition, sourceStage: string, patch: ConsultationBindingPatch): WirePipelineDefinition` that patches a binding by `sourceStage` id
- [x] 2.4 Add `removeConsultationBinding(def: WirePipelineDefinition, sourceStage: string): WirePipelineDefinition` that removes a binding by `sourceStage` id
- [x] 2.5 Add `getConsultationBindingForStage(def: WirePipelineDefinition, stageId: string): WireConsultationBinding | undefined` helper for reading the binding associated with a selected AtomicStage

## 3. Canvas authoring — V2NodePanel consultation section

- [x] 3.1 Create `packages/ui/src/canvas/ConsultationBindingEditor.tsx` component: renders a Teacher Consultation section for an AtomicStage that has (or could have) a consultation binding
- [x] 3.2 Implement Teacher skill selector inside the editor that populates from `PipelineCatalogResponse.skills`, filtering for entries whose skill name could serve as a `teacherSkill` (e.g., `rasen-teacher-advisor`); disabled skills appear greyed-out and unselectable
- [x] 3.3 Implement limit fields (`maxConsultationsPerInvocation`, `maxTeacherAttemptsPerConsultation`) using the existing `IntegerContractField` component with positive-integer minimums and server-maximum caps
- [x] 3.4 Implement add-binding action (when no binding exists for the selected stage) and remove-binding action (when one does)
- [x] 3.5 Integrate `ConsultationBindingEditor` into `V2NodePanel.tsx`: render it as a section below the existing `V2ExecutionEditor` for `AtomicStage` nodes, conditional on the definition having a matching binding or the user choosing to add one
- [x] 3.6 Wire the editor to call `onConsultationPatch` callback on the `PipelineCanvasPage` draft loop, routing through the draft helpers from task group 2

## 4. Canvas page — wire consultation draft into PipelineCanvasPage

- [x] 4.1 Add consultation patch routing to `PipelineCanvasPage.tsx`: when the `ConsultationBindingEditor` calls back, apply the draft helper to the current draft definition and update the draft state
- [x] 4.2 Ensure consultation bindings survive the `structuredClone` draft-entry path for both v1 and v2 definitions (verify no non-cloneable values are introduced)
- [x] 4.3 Route server validation diagnostics that target the `consultations` path to the consultation editor section (map `definitionIssuePathTarget` results for consultation-related diagnostics)

## 5. Run detail — consultation observability panel

- [x] 5.1 Create `packages/ui/src/components/ConsultationObservabilityPanel.tsx` component: renders read-only cards for each entry in a `ConsultationViewSection`
- [x] 5.2 For each consultation entry, display: consultation id short form (first 12 chars), ordinal, state badge (`requested` / `teacher-active` / `advice-committed` / `continuation-sent` / `settled` / `unavailable` / `ambiguous`), source model/runtime, Teacher model/runtime (when admitted), advice decision badge (when committed: `plan` / `correction` / `stop`), used/max counters, continuation state (when present), failure reason (when present)
- [x] 5.3 Ensure the panel renders projection facts only: no advice bodies, question content, evidence content, session diagnostics, or backend-private references
- [x] 5.4 Integrate `ConsultationObservabilityPanel` into the Run detail view: call `getConsultationSection(view)` and render the panel when the section is present
- [x] 5.5 Verify the panel does not offer continuation, retry, cancel, or any interactive execution control

## 6. Tests

- [x] 6.1 Test `WireConsultationBinding` type and `getConsultationSection` extractor: verify the consultation section is typed and extractable from a `ChangeRunView` that includes it, and returns null when absent
- [x] 6.2 Test draft helpers: `addConsultationBinding`, `updateConsultationBinding`, `removeConsultationBinding`, `getConsultationBindingForStage` for both v1 and v2 definitions, verifying immutability and correct array operations
- [x] 6.3 Test `ConsultationBindingEditor` rendering: verify it shows the Teacher skill selector with correct enabled/disabled state, limit fields, add/remove actions; verify it calls the correct patch callback
- [x] 6.4 Test `ConsultationObservabilityPanel` rendering: verify it renders entries with correct state badges, counters, and failure reasons from a fixture `ConsultationViewSection`; verify it renders no advice bodies or interactive controls
- [x] 6.5 Test V2NodePanel integration: verify the consultation section appears for AtomicStage nodes with a binding, does not appear for other node kinds, and preserves all existing editors unchanged
- [x] 6.6 Test v1 pipeline round-trip: load a v1 pipeline with `consultations`, edit an unrelated field, verify the `consultations` array is preserved through the draft cycle
