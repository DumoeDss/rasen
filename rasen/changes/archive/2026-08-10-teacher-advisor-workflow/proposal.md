## Why

The consultation runtime (child 1, archived) defines the canonical protocol, durable state, exact Teacher authority, and continuation semantics for implementer-to-Teacher advice. But the runtime ships no installable workflow, no skill prompt, no pipeline authoring surface, and no registry entry. Without this workflow layer, no pipeline can declare a consultation binding and no Teacher Action can be constructed, so the runtime capability is unreachable in production.

## What Changes

- Add the **Teacher Advisor** built-in workflow: a skill template (`getTeacherAdvisorSkillTemplate`) that instructs the Teacher agent to produce strictly shaped `teacher-consultation/advice/1` output (`plan | correction | stop`), to stay read-only, and to bind advice to the exact consultation invocation identity.
- Add a **Teacher Advisor expert skill** (`rasen-teacher-advisor`) to the built-in workflow registry, the skill template factory, and the generated sidecar install path. Register it as `kind: expert` so it is installed alongside workflows but never run as a pipeline stage.
- Add a top-level **`consultations`** field to the pipeline YAML schema. Each entry maps a source stage (by stage id) to a Teacher capability and declares `maxConsultationsPerInvocation`, `maxTeacherAttemptsPerConsultation`, and content limits. This is the authoring surface that child 3 (Canvas) will later bind visually.
- Wire the authored consultation bindings through `resolveRuntimeExecutionProfile` so that: (a) the Teacher capability binding is added to the execution profile's capabilities list at a synthetic Teacher profile path, and (b) the `consultations` collection on the `RuntimeExecutionProfile` is populated with the frozen binding shape the runtime consumes.
- Add the Teacher Advisor capability to the capability catalog snapshot so its skill digest is resolvable during profile construction.
- Add focused tests for: pipeline YAML consultation validation, profile resolver consultation binding creation, Teacher capability digest resolution, built-in workflow registration, and Teacher Advisor skill template content conformance.

## Capabilities

### New Capabilities

- `teacher-advisor-workflow`: The installable Teacher Advisor workflow, its strict consultation prompt/result contracts, pipeline-level consultation binding authoring, execution profile wiring, built-in registry integration, and focused tests.

### Modified Capabilities

None. All changes are additive: the `consultations` pipeline field is a new optional top-level key, the Teacher Advisor workflow is a new built-in, and the profile resolver gains a new optional input without changing any existing binding or digest for consultation-free pipelines.

## Impact

- **Pipeline YAML schema** (`src/core/pipeline-registry/types.ts`): gains an optional `consultations` collection on `PipelineYamlSchema`.
- **Profile resolver** (`src/core/pipeline-registry/profile-resolver.ts`): `resolveRuntimeExecutionProfile` gains an optional `consultations` input; when present, Teacher capability bindings and consultation bindings are added to the returned `RuntimeExecutionProfile`.
- **Workflow registry** (`src/core/workflow-registry/builtins.ts`): gains the `teacher-advisor` built-in adapter entry.
- **Skill templates** (`src/core/templates/experts/teacher-advisor.ts`): new expert template file.
- **Skill template barrel** (`src/core/templates/skill-templates.ts`): re-exports the new factory.
- **Pipeline launch path**: the consultation bindings must be threaded from the authored pipeline YAML through to `resolveRuntimeExecutionProfile` at launch time.
- **Tests**: new focused tests for the YAML schema, profile resolver, and registry integration.
- **No changes** to the consultation runtime (`ecp-consultation-runtime`), the executor, the consultation lifecycle, the worker contracts, or the canonical Record. This change consumes those exported shapes only.
