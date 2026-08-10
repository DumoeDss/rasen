## Context

The consultation runtime (child 1, archived as `ecp-consultation-runtime`) defines the canonical consultation protocol: a `CONSULT` worker step from an eligible source Action, Teacher admission, advice settlement under exact recursive retirement, continuation grants, and independent budgeting. The runtime consumes a `RuntimeConsultationBinding` from the `RuntimeExecutionProfile.consultations` collection and matches it against a source Action's hierarchical path. A `teacherProfilePath` on the binding identifies the Teacher capability in the same profile's capabilities list.

Today there is no way to populate that `consultations` collection: the pipeline YAML schema has no `consultations` field, `resolveRuntimeExecutionProfile` has no consultation input, and no Teacher capability binding is ever constructed. The Teacher Advisor skill — the prompt that instructs a Teacher agent how to produce valid advice — does not exist. This change adds the workflow layer that makes the runtime reachable.

The relevant code surfaces:

- `src/core/pipeline-registry/types.ts` — `PipelineYamlSchema`, `StageSchema` (Zod pipeline definition).
- `src/core/pipeline-registry/profile-resolver.ts` — `resolveRuntimeExecutionProfile` builds capabilities and policy stages from the prepared definition and catalog.
- `src/core/pipeline-registry/execution-plan-internal.ts` — `RuntimeConsultationBindingZodSchema`, `RuntimeExecutionProfileInput.consultations`.
- `src/core/workflow-registry/builtins.ts` — `BUILT_IN_ADAPTERS`, `getBuiltInWorkflowDefinitions`.
- `src/core/templates/experts/` — expert skill template factory files.
- `src/core/templates/skill-templates.ts` — barrel re-export.

## Goals / Non-Goals

**Goals:**

- Add a `consultations` field to the pipeline YAML so authors can declare which stages are consultation-eligible and which Teacher skill serves them.
- Wire authored consultation bindings through `resolveRuntimeExecutionProfile` into the `RuntimeExecutionProfile.consultations` collection and add Teacher capability bindings to the capabilities list.
- Register the Teacher Advisor as a built-in expert workflow with a skill template that enforces the `teacher-consultation/advice/1` contract and read-only posture.
- Ensure consultation-free pipelines produce byte-identical profiles and digests.

**Non-Goals:**

- Defining Canvas authoring controls or visual sidecar rendering (child 3 Canvas).
- Changing the consultation runtime, executor, lifecycle reducer, or worker contracts.
- Providing a macOS exact process provider (macOS Teacher remains typed unavailable).
- Changing the `consultable-leaf` worker contract or its parsing.
- Adding a `consultations` field to individual pipeline stages (the binding is pipeline-level, referencing stages by id).

## Decisions

### 1. Put `consultations` at the pipeline top level, not on individual stages

The pipeline YAML gains a top-level `consultations` array. Each entry names a `sourceStage` (by stage id), a `teacherSkill`, and limits. This avoids modifying the `StageSchema` at all — the stage shape, its fields, and its parsing remain unchanged.

Alternative A was to add a `consultations` field to individual stages. That couples consultation authoring to the stage object and makes it harder to express multiple Teacher relationships from one stage (a stage might later consult different Teachers). Pipeline-level declarations with stage-id references are more flexible and touch less schema surface.

Alternative B was to embed the Teacher relationship in the BoundedLoop strategy. But consultations are mid-Action, not loop-boundary, so that placement is semantically wrong.

### 2. Resolve `sourceProfilePath` from the stage's canonical hierarchical path

The runtime matches consultation bindings by `binding.sourceProfilePath === hierarchicalPath`. The hierarchical path is determined by the capability binding resolver: `stage:<id>` for v1 definitions, `root:<id>` or `declaration:<bodyId>/node:<phaseId>` for v2 definitions. Rather than guessing the path at authoring time, the resolver computes it after capability bindings are resolved.

The pipeline-level consultation entry carries a `sourceStage` id. After `resolveCapabilityBindings` produces the capability bindings (which include the hierarchical paths), the resolver finds the binding whose stage id matches `sourceStage` and uses its `nodeId` as the `sourceProfilePath`. This is deterministic and never duplicates the path derivation logic.

### 3. Use `teacher:<skillName>` as the Teacher synthetic profile path

The `teacherProfilePath` must be a path in the capabilities list that the runtime can match when building the Teacher Action. A synthetic path `teacher:<skillName>` is:
- Stable across pipelines (same Teacher skill always gets the same path).
- Distinct from any stage path (`stage:`, `root:`, `declaration:`).
- Easy for the runtime to identify as a Teacher capability.

The resolver constructs a `RuntimeCapabilityBinding` at this path using the Teacher skill's catalog descriptor (for digest/version), `sandbox: read-only`, `workspace.access: 'none'`, and empty effects — satisfying the runtime's invariants for Teacher capabilities.

### 4. The Teacher Advisor skill template is an expert, not a workflow stage

The Teacher Advisor is registered as `kind: expert` in the built-in workflow registry, like `rasen-review`, `rasen-cso`, etc. It is never a pipeline stage that the LEAD dispatches; it is activated only by the consultation runtime when a `CONSULT` step triggers Teacher admission. The skill template carries the full prompt body that tells the Teacher agent what shape its input has (`teacher-consultation/invocation/1`) and what shape its output must have (`teacher-consultation/advice/1`).

### 5. Consultation limits are validated against `CONSULTATION_SERVER_LIMITS` at parse time

The pipeline YAML consultation entry carries `maxConsultationsPerInvocation` and `maxTeacherAttemptsPerConsultation` as positive integers. The Zod schema caps them at the server-owned maxima from `CONSULTATION_SERVER_LIMITS`. If a content `limits` override is present, each field is individually capped. This prevents a pipeline author from promising more consultation capacity than the runtime enforces.

### 6. No changes to `resolveRuntimeExecutionProfile` signature for existing callers

The existing `resolveRuntimeExecutionProfile(prepared, catalog, policyStages, sourceRevision, limits, nativeV2Inputs, trustedAdapters)` signature is extended with an optional `consultations` parameter. When omitted (the case for all existing call sites), the function behaves identically. When provided, it adds Teacher capability bindings and consultation entries to the returned profile. This preserves byte-identical profiles and digests for consultation-free pipelines.

## Risks / Trade-offs

- [Pipeline YAML schema growth could surprise existing parsers] → The `consultations` field is optional; `PipelineYamlSchema` uses `z.object` (not strict), so the field is accepted when present and absent when not. Existing pipelines are unaffected.
- [Teacher capability binding path could collide with a future stage path] → The `teacher:` prefix is reserved and no stage path uses it (stage paths are `stage:`, `root:`, `declaration:`).
- [Multiple pipelines with different Teacher skills could create catalog ambiguity] → The Teacher skill name is scoped per-pipeline; each pipeline's `teacherSkill` resolves independently against the shared capability catalog. No cross-pipeline state is introduced.
- [Profile digest changes when consultations are added] → This is by design: a pipeline with consultations has a different execution profile than one without. The digest is deterministic from the same inputs, so the same pipeline always produces the same digest.
- [The Teacher skill template cannot be mechanically tested against a real Teacher agent in CI] → The skill template content is tested structurally (contains the required contract names, decision values, and read-only language). Integration with a real agent is deferred to runtime acceptance.
