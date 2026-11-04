# Independent Review: teacher-advisor-workflow (child 3)

**Reviewer**: Independent (fresh context)
**Date**: 2026-08-10
**Branch**: feat/teacher-advisor-workflow

## Verification Results (re-run independently)

| Check | Result |
|---|---|
| `pnpm exec tsc --noEmit` | CLEAN (no output) |
| `validate teacher-advisor-workflow --strict --json` | `valid: true`, 0 issues |
| Targeted tests (2 files) | 30 passed, 0 failed |
| Broad no-regression (34 files) | 691 passed, 1 skipped, 0 failed |

## Focus Area A: Byte-identical preservation

**CLAIM CONFIRMED.** When `consultations` is undefined or empty, `resolveConsultationBindings` returns `{ teacherBindings: [], consultationBindings: [] }`. The spread operators `[...capabilities, ...teacherBindings]` and `[...finalPolicyStages, ...teacherPolicyStages]` are no-ops with empty arrays. The conditional spread `...(hasConsultations ? { consultations } : {})` adds no key when `hasConsultations` is false. The runtime's `normalizeProfileInput` sees no `consultations` field, so the digest computation at `execution-plan-internal.ts:492` takes the `normalized.consultations === undefined` branch and hashes only `normalized.capabilities` — identical to before.

**Test 6.4 discrimination**: the test compares `profileDigest`, `capabilityProfileDigest`, `policyDigest`, capabilities arrays (deep equality), and `'consultations' in profile` across three call variants (no param, undefined param, empty array param). If any Teacher binding were accidentally appended, the capabilities arrays would differ and all three digests would change. If the consultations key were accidentally added, the `'consultations' in` assertion would fail. The test IS discriminating for the most likely failure modes (broken early-return in `resolveConsultationBindings`, accidental capability append, accidental key spread).

## Focus Area B: Task 3.1/3.2 deviation

**DEVIATION IS ARCHITECTURALLY CORRECT.** Tasks 3.1/3.2 said to register in `BUILT_IN_ADAPTERS` + `BUILT_IN_WORKFLOW_IDS` in `builtins.ts`. The implementer instead registered in `experts.ts` via `getExpertSkillDefinitions()`. This is the correct registration path for expert-kind workflows:

- The existing test at `builtins.test.ts:80` explicitly asserts `expect(experts.some((expert) => workflowIds.has(expert.id))).toBe(false)` — experts must NOT appear in `BUILT_IN_WORKFLOW_IDS`.
- All 13 experts (benchmark, careful, chrome-use, codex, cso, design-consultation, design-review, investigate, office-hours, qa, review, teacher-advisor, workflow-author) are registered via `getExpertSkillDefinitions()` in `experts.ts`.
- `getBuiltInExpertDefinitions()` composes experts into the unified `loadWorkflowCatalog` with `kind: 'expert'`, `source: 'built-in'`, and a digest computed from the skill template + sidecar tree.
- The Teacher Advisor resolves its sidecar from `skills/experts/teacher-advisor/contracts.md` via `resolveExpertSidecarDir('teacher-advisor')`.
- Test 6.6 verifies the entry appears with `kind: 'expert'`, `dirName: 'rasen-teacher-advisor'`, and a non-empty digest.

Had the implementer followed tasks 3.1/3.2 literally (adding to `BUILT_IN_ADAPTERS` + `BUILT_IN_WORKFLOW_IDS`), the Teacher Advisor would have been incorrectly selectable as a workflow and would have failed the `builtins.test.ts:80` assertion.

## Focus Area C: Teacher capability + policy invariants

**ALL INVARIANTS SATISFIED.**

The Teacher capability binding constructed in `resolveConsultationBindings` (profile-resolver.ts ~line 800):
- `actionKind: 'agent'` — satisfies runtime check at `execution-plan-internal.ts:457`
- `workspace: { access: 'none', resources: [] }` — satisfies check at line 459-460
- `effects: []` — satisfies check at line 461
- `nodeId: 'teacher:<skillName>'` — distinct from all stage paths (`stage:`, `root:`, `declaration:`)

The Teacher policy stage synthesized by `synthesizeTeacherPolicyStage` (profile-resolver.ts ~line 870):
- `sandbox: 'read-only'` — satisfies check at line 458
- `nodeId` matches the Teacher capability binding's `nodeId`

BOTH are appended: capabilities get `[...capabilities, ...teacherBindings]` and policy stages get `[...finalPolicyStages, ...teacherPolicyStages]`. The runtime check at line 450 (`teacherCapability === undefined || teacherPolicy === undefined`) therefore passes.

## Focus Area D: Verification theater

| Guard | Location | Behavioral test? | Discriminating? |
|---|---|---|---|
| `superRefine` sourceStage validation | `types.ts` PipelineYamlObjectSchema | Test 6.1 "rejects unknown sourceStage" (line 157) | YES — removing the superRefine makes the unknown-stage parse succeed, failing the `expect(parsed.success).toBe(false)` assertion |
| `.max()` on maxConsultationsPerInvocation | `types.ts` ConsultationBindingYamlSchema | Test 6.1 "rejects maxConsultationsPerInvocation exceeding server maxima" (line 175) | YES — removing `.max()` makes the parse succeed |
| `.max()` on maxTeacherAttemptsPerConsultation | `types.ts` ConsultationBindingYamlSchema | Test 6.1 (line 185) | YES — same mutation analysis |
| `.max()` on content limits fields | `types.ts` ConsultationContentLimitsYamlSchema | Test 6.1 "rejects content limits exceeding server maxima" (line 221) | YES |
| Catalog-missing-Teacher error | `profile-resolver.ts` resolveConsultationBindings | Test 6.5 "fails when Teacher skill is not in the catalog" (line 397) | YES — removing the throw makes the function produce a profile, failing the `expect(...).toThrow` assertion |

**Minor gap (see findings below):** the superRefine test does not exercise the `kind === 'standard'` filter. The test uses a nonexistent stage ID, which fails regardless of the kind filter. Removing `.filter((stage) => stage.kind === 'standard')` from the guard would not cause any test to fail.

## Focus Area E: Scope discipline

**ADDITIVE ONLY. CONFIRMED.** The diff touches 9 files (6 source, 3 test/fixture). No edits to:
- Consultation runtime (`src/core/change-run/consultation-contracts.ts`, `consultation-runtime.ts`, etc.)
- Executor (`frozen-action-executor`)
- Lifecycle reducer
- Worker contracts (`consultable-leaf`)
- Canvas (`packages/ui/`)

The only existing-file modifications are additive: new optional parameters, new schema fields, new expert entries, and threading the new field through existing call sites.

## Findings

### Minor-1: superRefine kind-filter is untested

**File**: `src/core/pipeline-registry/types.ts` (PipelineYamlObjectSchema superRefine)
**Summary**: The `.filter((stage) => stage.kind === 'standard')` in the sourceStage validation is not exercised by any test; the test at line 157 uses a nonexistent stage ID, which fails regardless of the kind filter.
**Failure scenario**: If someone removes the `.filter((stage) => stage.kind === 'standard')`, a consultation could reference a `decompose` stage, which would pass parse-time validation but fail at runtime in `findSourceStageNodeId` (less graceful error). No test would catch the regression.
**Recommendation**: Add a test case with a `decompose` stage and a consultation referencing it; assert the parse fails with the kind-specific error.

### Nit-1: Consultation binding secondary sort is dead code for valid inputs

**File**: `src/core/pipeline-registry/profile-resolver.ts` (resolveConsultationBindings sort)
**Summary**: The resolver sorts consultation bindings by `(sourceProfilePath, teacherProfilePath)`, but the runtime's `normalizeProfileInput` rejects duplicate `sourceProfilePath` entries, making the secondary sort by `teacherProfilePath` unreachable for any profile that passes validation.
**Impact**: None — the sort is correct and deterministic; it's just slightly over-specified.

## Overall Verdict

**CLEAN**

The implementation is sound, additive-only, and all five focus areas check out. The byte-identity invariant is genuinely preserved with a discriminating test. The task 3.1/3.2 deviation is the correct architectural choice. All high-risk guards have behavioral tests. The one Minor finding (untested kind-filter) is a defense-in-depth gap, not a functional bug — the runtime would still reject the invalid binding, just less gracefully.
