# teacher-consultation-canvas Specification

## Purpose
TBD - created by archiving change teacher-consultation-canvas. Update Purpose after archive.
## Requirements
### Requirement: Canvas can author consultation bindings for a source stage

The pipeline Canvas SHALL provide authoring controls that allow a pipeline author to add, edit, and remove a consultation binding for an AtomicStage node. When an AtomicStage node is selected and the pipeline definition contains a consultation binding whose source stage references that node, the Canvas SHALL display a Teacher Consultation section showing the bound Teacher skill and limits. When no binding exists for the selected node, the Canvas SHALL offer an action to add one. The authoring controls SHALL consume the pipeline `consultations` field shape (`sourceStage`, `teacherSkill`, `maxConsultationsPerInvocation`, `maxTeacherAttemptsPerConsultation`, optional content `limits`) and SHALL NOT modify any Definition node, graph edge, or stage execution field.

#### Scenario: Author adds a consultation binding from the Canvas

- **WHEN** the author selects an AtomicStage node in a v2 pipeline definition and chooses to add a Teacher consultation
- **THEN** the Canvas SHALL create a new entry in the pipeline-level `consultations` array with `sourceStage` set to the selected node's stage id
- **AND** the Teacher skill selector SHALL populate from the pipeline capability catalog's skill list
- **AND** the default limits SHALL be positive integers within the server maxima

#### Scenario: Author edits consultation limits

- **WHEN** the author changes the max-consultations or max-attempts value for an existing binding
- **THEN** the Canvas SHALL update the corresponding field on the pipeline-level `consultations` entry
- **AND** the Canvas SHALL NOT modify the stage execution, capability binding, or any Definition node

#### Scenario: Author removes a consultation binding

- **WHEN** the author removes the consultation binding for a selected AtomicStage
- **THEN** the Canvas SHALL remove the matching entry from the pipeline-level `consultations` array
- **AND** the selected AtomicStage node and all its other properties SHALL remain unchanged

#### Scenario: v1 pipeline preserves consultations through Canvas round-trip

- **WHEN** the author loads a v1 pipeline that declares `consultations`, edits an unrelated field, and saves
- **THEN** the saved definition SHALL retain the `consultations` array with the same bindings and limits
- **AND** the management API SHALL re-validate the consultations against the pipeline YAML schema

#### Scenario: Existing Canvas authoring is unchanged

- **WHEN** a pipeline without consultation bindings is loaded into the Canvas
- **THEN** the Canvas SHALL display no consultation section
- **AND** all existing BoundedLoop strategy authoring, AtomicStage execution editing, Gate/Choice/FanOut/Join editors, and parallel member controls SHALL remain available and unchanged

### Requirement: The Teacher skill selector reflects the capability catalog honestly

The Canvas consultation Teacher skill selector SHALL populate from the pipeline capability catalog response. A Teacher skill that is registered but disabled in the active profile SHALL appear greyed-out and SHALL not be selectable. The selector SHALL NOT assume that a hosted backend, a continuable backend, or generic availability implies Teacher availability. The selector SHALL NOT promise that a consultation will succeed at runtime.

#### Scenario: Registered Teacher skill appears in the selector

- **WHEN** the built-in `teacher-advisor` workflow is registered and the active profile enables it
- **THEN** the Teacher skill selector SHALL list it with its capability id and version
- **AND** the author SHALL be able to select it for a consultation binding

#### Scenario: Disabled Teacher skill is visible but not selectable

- **WHEN** the active profile does not enable the Teacher Advisor skill
- **THEN** the selector SHALL show the skill greyed-out with a visual indicator that it is disabled
- **AND** the author SHALL not be able to select it

#### Scenario: Selector does not claim runtime availability

- **WHEN** the author opens the Teacher skill selector
- **THEN** the UI SHALL NOT display any claim that the Teacher is available, will execute, or is guaranteed to respond
- **AND** the Canvas SHALL defer to the runtime's pre-activation availability verdict

### Requirement: The Run detail view renders canonical consultation state

The Run detail view SHALL detect the `consultation/1` section in the projected `ChangeRunView` and render a read-only consultation observability panel. Each consultation entry SHALL display the consultation state, ordinal, source and Teacher identities (as short id forms), advice decision (when committed), independent used/max consultation and Teacher-attempt counters, continuation state (when present), and typed failure reason (when present). The panel SHALL NOT render advice bodies, question content, evidence content, or backend-private runtime references.

#### Scenario: Consultation entries are rendered from the canonical projection

- **WHEN** a Run's projected `ChangeRunView` contains a `consultation/1` section with entries
- **THEN** the Run detail view SHALL render one read-only card per entry
- **AND** each card SHALL show the state, ordinal, source model/runtime, Teacher model/runtime (when admitted), advice decision (when committed), used/max counters, continuation state (when present), and failure reason (when present)

#### Scenario: Run without consultations shows no panel

- **WHEN** a Run's projected `ChangeRunView` has no `consultation/1` section
- **THEN** the Run detail view SHALL not render a consultation observability panel
- **AND** the existing root-dag, review-cycle, goal, bounded-loop-lifecycle, and parallel sections SHALL remain unchanged

#### Scenario: Panel renders projection facts only

- **WHEN** the consultation observability panel renders an entry
- **THEN** it SHALL display only the fields present in the canonical projected entry
- **AND** SHALL NOT display advice rationale, steps, cautions, evidence notes, question text, attempted approaches, or constraints
- **AND** SHALL NOT offer continuation, retry, cancel, or any interactive execution control

### Requirement: UI API types mirror the consultation view section and binding shape

The UI API types SHALL include a `ConsultationViewSection` interface that mirrors the authoritative `ConsultationViewSectionSchema` from the change-run contracts: `kind: 'consultation'`, `version: 1`, and entries carrying consultation id, ordinal, state, source/teacher identity fields, advice decision, counters, limits, continuation, and failure. The `ChangeRunViewSection` union SHALL include `ConsultationViewSection`. A `getConsultationSection(view)` extractor SHALL return the typed section or null. The UI API types SHALL include a `WireConsultationBinding` interface mirroring `ConsultationBindingYamlSchema`, and `WirePipelineDefinitionV1` SHALL include an optional `consultations` field.

#### Scenario: Consultation section is typed and extractable

- **WHEN** the management API serves a `ChangeRunView` containing a `consultation/1` section
- **THEN** the UI `getConsultationSection` SHALL return it as a typed `ConsultationViewSection`
- **AND** the section SHALL NOT fall through to the `AdditiveViewSection` catch-all

#### Scenario: Wire consultation binding mirrors the server schema

- **WHEN** the management API serves a pipeline definition with `consultations`
- **THEN** the UI `WirePipelineDefinitionV1.consultations` SHALL be typed as `WireConsultationBinding[]`
- **AND** each entry SHALL expose `sourceStage`, `teacherSkill`, `maxConsultationsPerInvocation`, `maxTeacherAttemptsPerConsultation`, and optional content `limits`
