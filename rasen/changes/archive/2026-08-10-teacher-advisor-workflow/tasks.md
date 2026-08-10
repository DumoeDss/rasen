## 1. Pipeline YAML consultation schema

- [x] 1.1 Add `ConsultationBindingYamlSchema` to `src/core/pipeline-registry/types.ts`: a Zod strict object with `sourceStage` (non-empty string), `teacherSkill` (non-empty string), `maxConsultationsPerInvocation` (positive int, max 64), `maxTeacherAttemptsPerConsultation` (positive int, max 16), and optional `limits` (strict object with content-bound fields capped at `CONSULTATION_SERVER_LIMITS` values). Import `CONSULTATION_SERVER_LIMITS` from `src/core/change-run/consultation-contracts.ts`.
- [x] 1.2 Add `consultations: z.array(ConsultationBindingYodSchema).optional()` to `PipelineYamlSchema` in the same file. Export the derived `ConsultationBindingYaml` type.
- [x] 1.3 Add a `superRefine` on `PipelineYamlSchema` that validates each consultation entry's `sourceStage` references an existing stage with `kind: 'standard'` in the same pipeline's `stages` array. Reject with a typed error naming the bad reference.

## 2. Teacher Advisor skill template

- [x] 2.1 Create `src/core/templates/experts/teacher-advisor.ts` exporting `getTeacherAdvisorSkillTemplate(): SkillTemplate`. The template `name` is `rasen-teacher-advisor`. The `description` identifies it as a read-only Teacher Advisor that receives a `teacher-consultation/invocation/1` and returns `teacher-consultation/advice/1`.
- [x] 2.2 Write the `instructions` body to include: (a) the invocation contract shape (`contract`, `consultationId`, `teacherAttempt`, `source`, `question`, `allowedDecisions`); (b) the advice contract shape and its required fields; (c) the three allowed decisions and their semantics (`plan` = propose a path forward, `correction` = adjust the current approach, `stop` = advise stopping, advisory only); (d) the read-only constraint (no file edits, no commands, no external effects); (e) the requirement to bind advice to the exact `consultationId` and `teacherAttempt` from the invocation; (f) guidance on analyzing the problem summary, question, attempted approaches, constraints, and evidence pointers.
- [x] 2.3 Add `getTeacherAdvisorSkillTemplate` to `src/core/templates/experts/index.ts` and `src/core/templates/skill-templates.ts` barrel re-exports.

## 3. Built-in workflow registration

- [x] 3.1 Add an adapter entry to `BUILT_IN_ADAPTERS` in `src/core/workflow-registry/builtins.ts`: `{ id: 'teacher-advisor', dirName: 'rasen-teacher-advisor', skill: getTeacherAdvisorSkillTemplate, kind: 'expert' }`.
- [x] 3.2 Add `'teacher-advisor'` to the `BUILT_IN_WORKFLOW_IDS` array in the same file (selectable as an expert in profiles and auto-installed by pipelines that declare consultations).
- [x] 3.3 Verify `getBuiltInWorkflowDefinitions()` returns the new entry with a valid digest and sidecar files resolved from `skills/experts/rasen-teacher-advisor/` (create the directory with at minimum a placeholder sidecar if none exists).

## 4. Profile resolver consultation wiring

- [x] 4.1 Add an optional `consultations` parameter to `resolveRuntimeExecutionProfile` in `src/core/pipeline-registry/profile-resolver.ts`. The type is `readonly ConsultationBindingYaml[] | undefined`.
- [x] 4.2 After `resolveCapabilityBindings` returns the capability bindings, if `consultations` is provided and non-empty: for each entry, find the source stage's hierarchical `nodeId` from the resolved capabilities by matching the stage id (for v1: `stage:<sourceStage>`, for v2: the authored hierarchical path containing the stage id).
- [x] 4.3 For each distinct `teacherSkill` in the consultation entries, resolve the Teacher skill's descriptor from the `catalog` (key: `skill:<teacherSkill>`). If missing, throw a typed error. Construct a `RuntimeCapabilityBinding` at `teacher:<teacherSkill>` with `sandbox: read-only`, `workspace: { access: 'none', resources: [] }`, empty `effects`, and the skill digest from the descriptor.
- [x] 4.4 Build the `RuntimeConsultationBinding[]` collection: for each consultation entry, map `sourceProfilePath` to the source stage's resolved hierarchical path, `teacherProfilePath` to `teacher:<teacherSkill>`, and carry through the limits. Sort the array by `sourceProfilePath` then `teacherProfilePath` for deterministic digest.
- [x] 4.5 Pass the consultation bindings and Teacher capability bindings through to `createRuntimeExecutionProfile`. The Teacher capability bindings are appended to the capabilities array; the consultation bindings populate the optional `consultations` field on `RuntimeExecutionProfileInput`.
- [x] 4.6 When `consultations` is `undefined` or empty, produce exactly the same capabilities array, policy stages, and profile input as before this change (no Teacher bindings, no consultations field). Verify with a byte-identity test.

## 5. Pipeline launch threading

- [x] 5.1 Identify the launch-time call site(s) of `resolveRuntimeExecutionProfile` that need to thread the pipeline's `consultations` field. The primary call site is in the pipeline launch path where `PipelineYaml` is available alongside the prepared definition.
- [x] 5.2 Thread `prepared.authoredSource.consultations` (or the parsed `PipelineYaml.consultations`) through to the profile resolver. Use the same parsed pipeline YAML that produced the prepared definition so the bindings are consistent.
- [x] 5.3 Verify that `resolveDiscoveryReconcilerSupportProfile` also resolves Teacher capability bindings when consultations are declared, so the discovery/projection plane is consistent with the launch profile.

## 6. Focused tests

- [x] 6.1 Pipeline YAML consultation parsing: valid binding accepted, unknown sourceStage rejected, limit exceeding server maxima rejected, omitted consultations produces no consultation field.
- [x] 6.2 Profile resolver consultation test: a pipeline with one consultation entry produces a profile with (a) a Teacher capability binding at `teacher:<skill>`, (b) a consultation binding with the correct source and teacher paths and limits.
- [x] 6.3 Profile resolver multi-source test: two consultation entries for the same Teacher skill produce one Teacher capability binding and two consultation entries.
- [x] 6.4 Profile resolver preservation test: a pipeline without consultations produces byte-identical capabilities, policy stages, and profile digest as before the change. Use a snapshot or golden-file comparison.
- [x] 6.5 Teacher catalog resolution test: if the Teacher skill is not in the catalog, profile construction fails with a typed error before producing a profile.
- [x] 6.6 Built-in workflow registration test: `getBuiltInWorkflowDefinitions()` includes `teacher-advisor` with `kind: 'expert'`, a non-empty digest, and the correct skill directory name.
- [x] 6.7 Skill template content conformance test: the generated `instructions` string contains the `teacher-consultation/advice/1` contract name, the three decision values (`plan`, `correction`, `stop`), the advisory-only language for `stop`, and the read-only constraint.
- [x] 6.8 Cross-platform path test: the synthetic `teacher:<skill>` path uses no platform-specific separators; verify on Windows that no backslash appears in the path.

## 7. Architecture index and validation

- [x] 7.1 Run `node ./bin/rasen.js validate teacher-advisor-workflow --strict --json` and fix any issues until it passes.
- [x] 7.2 Run the TypeScript build (`pnpm build` or equivalent) and fix any type errors.
- [x] 7.3 Run the relevant test suites and verify no regressions in existing pipeline, profile, or workflow tests.
