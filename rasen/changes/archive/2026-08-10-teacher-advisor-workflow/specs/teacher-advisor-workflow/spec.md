## ADDED Requirements

### Requirement: Pipeline definitions can declare opt-in consultation bindings

A pipeline YAML SHALL accept an optional top-level `consultations` collection. Each entry SHALL name a `sourceStage` (matching a `standard` stage `id` in the same pipeline), a `teacherSkill` (the skill name of the Teacher Advisor capability, e.g. `rasen-teacher-advisor`), and positive integer limits (`maxConsultationsPerInvocation`, `maxTeacherAttemptsPerConsultation`). An entry MAY declare content `limits` overriding server maxima. A pipeline without a `consultations` collection SHALL preserve its existing execution profile digest and scheduling behavior with no consultation state.

#### Scenario: Valid consultation binding is accepted
- **WHEN** a pipeline YAML declares a `consultations` entry whose `sourceStage` names an existing `standard` stage and whose `teacherSkill` is a non-empty string
- **THEN** the pipeline SHALL parse and validate successfully
- **AND** the resolved execution profile SHALL contain a consultation binding whose `sourceProfilePath` resolves to the source stage's hierarchical path and whose `teacherProfilePath` resolves to the Teacher capability's synthetic path

#### Scenario: Unknown source stage is rejected
- **WHEN** a pipeline YAML declares a `consultations` entry whose `sourceStage` does not match any `standard` stage id in the same pipeline
- **THEN** pipeline validation SHALL fail with a typed error identifying the unknown stage reference
- **AND** no execution profile SHALL be produced

#### Scenario: Consultation-free pipeline is unchanged
- **WHEN** a pipeline YAML omits the `consultations` collection
- **THEN** its resolved execution profile SHALL contain no `consultations` entries and no Teacher capability bindings
- **AND** its profile digest and capability bindings SHALL remain identical to a pipeline parsed before this change

#### Scenario: Teacher limits are bounded by server maxima
- **WHEN** a pipeline YAML declares consultation limits that exceed the server-owned maxima (`maxConsultationsPerInvocation` > 64, `maxTeacherAttemptsPerConsultation` > 16, or content bounds above their server caps)
- **THEN** pipeline validation SHALL fail with a typed error identifying the exceeded limit
- **AND** no execution profile SHALL be produced

### Requirement: The Teacher Advisor is a registered built-in expert workflow

The system SHALL register a built-in workflow named `teacher-advisor` with `kind: expert` and skill directory `rasen-teacher-advisor`. The workflow SHALL be installable through profiles and package exports like other expert workflows. The skill SHALL carry a description that identifies it as a read-only Teacher Advisor that produces structured advice and never mutates the workspace.

#### Scenario: Teacher Advisor appears in the built-in catalog
- **WHEN** the built-in workflow catalog is loaded
- **THEN** it SHALL contain a `teacher-advisor` entry with `kind: expert` and skill directory `rasen-teacher-advisor`
- **AND** the entry SHALL have a non-empty digest computed from the skill template and sidecar files

#### Scenario: Teacher Advisor skill is installable
- **WHEN** a profile selects the Teacher Advisor workflow and `rasen update` runs
- **THEN** a `SKILL.md` SHALL be generated in `.claude/skills/rasen-teacher-advisor/` with frontmatter and instructions from the skill template
- **AND** the skill SHALL be invokable by the Claude Code agent when a consultation is admitted

### Requirement: The Teacher Advisor skill produces strictly shaped advice

The Teacher Advisor skill template SHALL instruct the Teacher agent to accept a `teacher-consultation/invocation/1` input, analyze the question against the evidence and constraints, and return exactly one `teacher-consultation/advice/1` result. The skill SHALL instruct the agent that its advice decision is restricted to `plan`, `correction`, or `stop`, that `stop` is advisory and does not constitute Run authority, and that the Teacher has no workspace mutation or external-effect capability. The skill SHALL bind the advice to the exact consultation id and Teacher attempt from the invocation.

#### Scenario: Skill template carries the advice contract
- **WHEN** the Teacher Advisor skill template is generated
- **THEN** its instructions SHALL name the `teacher-consultation/advice/1` contract and its required fields (`contract`, `consultationId`, `teacherAttempt`, `decision`, `rationale`, `steps`, `cautions`, `evidenceNotes`)
- **AND** SHALL name the three allowed decisions and state that `stop` is advisory only

#### Scenario: Skill template enforces read-only posture
- **WHEN** the Teacher Advisor skill template is generated
- **THEN** its instructions SHALL state that the Teacher is read-only, SHALL NOT modify files or workspace state, and SHALL NOT execute commands that change product state
- **AND** SHALL state that the Teacher observes the workspace only through the consultation-sponsored read

### Requirement: The execution profile includes Teacher capability bindings for consultation pipelines

When a pipeline declares a `consultations` collection and the execution profile is resolved, the resolver SHALL add one Teacher capability binding to the profile's capabilities list for each distinct `teacherSkill`. The Teacher capability binding SHALL use a synthetic hierarchical path derived from the Teacher skill name (e.g. `teacher:rasen-teacher-advisor`), a read-only sandbox, `none` or `read` workspace access, and zero declared effects. The resolver SHALL populate the `consultations` collection on the `RuntimeExecutionProfile` with each binding's `sourceProfilePath` set to the source stage's resolved hierarchical path and `teacherProfilePath` set to the Teacher's synthetic path.

#### Scenario: Teacher capability binding is added to the profile
- **WHEN** a pipeline with a consultation binding is resolved into an execution profile
- **THEN** the profile's capabilities SHALL include a binding at the Teacher's synthetic path with `sandbox: read-only`, `workspace.access: none`, and an empty effects array
- **AND** the profile's `consultations` collection SHALL contain an entry mapping the source stage's hierarchical path to the Teacher's synthetic path with the frozen limits

#### Scenario: Multiple stages share one Teacher
- **WHEN** a pipeline declares consultation bindings for two source stages that reference the same `teacherSkill`
- **THEN** the profile SHALL contain one Teacher capability binding at the shared synthetic path
- **AND** the `consultations` collection SHALL contain two entries, each mapping its source stage path to the same Teacher path

#### Scenario: Teacher digest is resolved from the capability catalog
- **WHEN** the Teacher capability binding is constructed
- **THEN** its `authoredCapability.version`, `contract.digest`, and `adapter.contentDigest` SHALL be the skill content digest from the capability catalog for the Teacher's skill id
- **AND** a missing Teacher skill in the catalog SHALL fail before profile construction with a typed error

### Requirement: Consultation binding paths use stable hierarchical identifiers

The `sourceProfilePath` in a resolved consultation binding SHALL be the source stage's canonical hierarchical path as produced by the capability binding resolver (`stage:<id>` for v1 definitions, `root:<id>` or `declaration:<bodyId>/node:<phaseId>` for v2 definitions). The `teacherProfilePath` SHALL be `teacher:<teacherSkill>` using the exact skill name from the pipeline YAML. Both paths SHALL be forward-slash-free identifiers that the runtime can match against the capabilities list.

#### Scenario: Source path matches the stage capability path
- **WHEN** a consultation binding is resolved for a v1 pipeline stage named `implement`
- **THEN** the `sourceProfilePath` SHALL be `stage:implement`
- **AND** the runtime SHALL find the corresponding capability binding at that path

#### Scenario: Teacher path is stable across pipelines
- **WHEN** two different pipelines declare consultation bindings with `teacherSkill: rasen-teacher-advisor`
- **THEN** both `teacherProfilePath` values SHALL be `teacher:rasen-teacher-advisor`
- **AND** the capability catalog SHALL resolve the same skill digest for both
