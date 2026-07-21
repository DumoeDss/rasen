## 1. Codex availability prober (c)

- [x] 1.1 Add `probeCodexAvailability(): boolean` in a new `src/core/codex/availability.ts` — bounded `codex --version`-level spawn, non-throwing, returns true only on clean success (spawn error / non-zero / timeout → false)
- [x] 1.2 Export it from the codex module index

## 2. Runtime preflight (c)

- [x] 2.1 Extend `validatePipelineForExecution` (`src/core/pipeline-registry/execution-validation.ts`) to accept `options?: { probeCodex?: () => boolean }` defaulting to `probeCodexAvailability`
- [x] 2.2 After the skill checks, resolve each stage's effective runtime via `resolveStageRuntimeConfig` across all stages AND decompose children (reuse the existing skill-loop recursion at :55-59)
- [x] 2.3 If the effective-runtime set contains `codex`, call the prober at most once (memoize); on unavailable, throw a pre-dispatch error (e.g. `pipeline_runtime_unavailable`) naming both exits — override role to claude (`rasen pipeline agents <name> --<role> claude`; RE-VERIFY verb/flag against the pipeline-library sibling) or install codex
- [x] 2.4 When no stage resolves to codex, do not probe and do not fail on runtime grounds

## 3. Pipeline authoring/review experts (d)

- [x] 3.1 Extend `src/core/templates/experts/workflow-author.ts` with a pipeline-authoring path (pipeline.yaml structure: stages/role/gate/loop/decompose/childPipeline/runtime; the `rasen pipeline init → validate → import` loop; trust posture) — RE-VERIFY the sibling's CLI verbs
- [x] 3.2 Extend `src/core/templates/experts/workflow-review.ts` with pipeline review dimensions (stage-DAG acyclicity, unique ids, decompose recursion bound, runtime/model resolvability, skill enablement; static-validate-first)
- [x] 3.3 Keep both experts' security-boundary framing (CLI static validator) intact

## 4. Trust-boundary docs (d)

- [x] 4.1 Add a "Trust boundary" section to `docs/workflow-packages.md` (executable prompts; mitigations = transactional install + digest + validate + review experts; no signatures/marketplace; honest limits — digest = integrity not safety, validation = structural not behavioral, review = mitigation not guarantee)
- [x] 4.2 Do NOT create `docs/zh/workflow-packages.md` (whole-file translation out of scope; English fallback), consistent with child 3

## 5. Parity-hash churn (expected)

- [x] 5.1 Regenerate `EXPECTED_FUNCTION_HASHES['getWorkflowAuthorSkillTemplate']` and `['getWorkflowReviewSkillTemplate']` in `test/core/templates/skill-templates-parity.test.ts`
- [x] 5.2 Regenerate `EXPECTED_GENERATED_SKILL_CONTENT_HASHES['rasen-workflow-author']` and `['rasen-workflow-review']`
- [x] 5.3 Confirm NO other pinned hash moves (if one does, the edit leaked beyond the two experts)

## 6. Tests

- [x] 6.1 Preflight with injected prober: codex-present passes; codex-absent fails before dispatch with both remedies named
- [x] 6.2 Preflight covers a decompose child whose stage resolves to codex
- [x] 6.3 Pure-claude pipeline: prober never called; several-codex-stage pipeline: prober called at most once
- [x] 6.4 `probeCodexAvailability` returns false on spawn error / timeout without throwing
- [x] 6.5 Run `pnpm test` in the worktree and confirm green (isolate Windows CLI-spawn flake per project convention)
- [x] 6.6 (review-routed addition) `resolvePipelineExecutionSkillSets` pre-filters the stored profile's workflow roots through `filterKnownWorkflowRoots` (warn + drop) before calling `resolveWorkflowSelection`, mirroring the same stale-id boundary fix already applied at `update.ts`/`init.ts`; a config listing an unknown id (e.g. retired `ff`) degrades to a warning instead of throwing `WorkflowSelectionError` at `validatePipelineForExecution`

## 7. Validate

- [x] 7.1 Run `rasen validate concept-coherence-pipeline-preflight-trust --strict` and resolve findings
