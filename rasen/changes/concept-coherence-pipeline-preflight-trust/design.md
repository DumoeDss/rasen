## Context

This is the execution-safety and trust half of portfolio decision #4, split out from `concept-coherence-pipeline-library` (per the sibling sketch at the end of that change's design.md). It depends on the library sibling — the experts reference its CLI verbs — and must precede `concept-coherence-expert-integration` because both edit the `workflow-author`/`workflow-review` expert templates.

Verified facts (from the pipeline-library research this builds on):
- `validatePipelineForExecution(pipeline, projectRoot)` (`execution-validation.ts:47`) validates skill presence/enablement and recurses into decompose children for the skill check, but **never scans runtime**.
- `resolveStageRuntimeConfig(stage, pipeline, modelLayers?)` (`types.ts:449`) resolves effective runtime as stage `runtime` > pipeline `agents.<role>` > `claude`; `AgentRuntimeSchema = 'claude' | 'codex'`.
- **No codex-CLI availability probe exists in code** — only shell snippets (`which codex`) inside expert/skill templates. A programmatic probe is net-new.
- The two experts are pinned in `skill-templates-parity.test.ts` both as function hashes (`:139-140`) and generated-content hashes (`:186-187`).

## Goals / Non-Goals

**Goals**
- Fail a pipeline run before dispatch when a stage needs codex and codex is unavailable, with an actionable message.
- Keep the preflight unit-testable without a codex binary (injectable prober).
- Give pipelines the same authoring/review expert support workflows have, and document the trust boundary honestly.

**Non-Goals**
- No signature system, no marketplace (explicit non-goal, stated in the trust docs).
- No change to how runtimes are dispatched or to `resolveStageRuntimeConfig` precedence — only a read-time preflight.
- No `'expert'` kind / registry integration for these experts (that is child 6). This change only edits their template prose.

## Decisions

### D1. Preflight scans effective runtime, mirroring the existing skill recursion

Add a runtime scan to `validatePipelineForExecution` after the skill checks. Walk every stage of the pipeline and, for each decompose stage, its resolved child pipeline (the exact recursion the skill loop already does at `execution-validation.ts:55-59`), calling `resolveStageRuntimeConfig` per stage to get the effective runtime. Collect the distinct effective runtimes. This keeps the preflight's traversal identical to what it already does, so decompose children are covered for free.

### D2. Injectable prober, memoized per invocation

Signature becomes `validatePipelineForExecution(pipeline, projectRoot?, options?)` where `options.probeCodex?: () => boolean` defaults to the real `probeCodexAvailability`. The preflight calls the prober at most once per invocation (memoize the first result) so a pipeline with several codex stages does not shell out repeatedly. Injecting the prober is the testability seam — tests pass a fake returning true/false and never touch a real binary. This follows the codebase's stated convention (`pipeline.ts:226`: "a SEPARATE function that accepts an injected set so it [is testable]").

`probeCodexAvailability()` lives in a new `src/core/codex/availability.ts`, runs a bounded `codex --version`-level check (spawn with a short timeout, non-throwing), and returns a boolean. It is the single real implementation; everything else injects.

### D3. Pre-dispatch failure names both exits

If the effective-runtime set contains `codex` and the prober reports unavailable, throw a validation error (e.g. code `pipeline_runtime_unavailable`) BEFORE dispatch. The message names the two exits explicitly:
1. Override the affected role(s) to claude — `rasen pipeline agents <name> --<role> claude` (verb/flag from the pipeline-library sibline; **re-verify the exact surface** at implementation, since that sibling's apply is concurrent), or a stage-level `runtime: claude` override in the pipeline.yaml.
2. Install the codex CLI.

When no stage resolves to codex, the prober is never called (so a pure-claude pipeline never probes and never fails on codex grounds).

### D4. Extend the two experts to cover pipelines

`workflow-author` gains a pipeline-authoring path: `pipeline.yaml` structure (stages, `role`, `gate`, `loop`, `decompose`/`childPipeline`, per-role `runtime`), the `rasen pipeline init → validate → import` loop, and the package trust posture. `workflow-review` gains pipeline review dimensions: stage DAG acyclicity and unique ids, decompose recursion bound, runtime/model resolvability, skill enablement, and the same static-validate-first discipline it applies to workflows. Both continue to treat the CLI static validator as the security boundary. The CLI verbs referenced come from the pipeline-library sibling and are marked in the prose as the dependency; re-verify their names before finalizing.

### D5. Trust boundary stated honestly in docs/workflow-packages.md

A "Trust boundary" section states: community packages are executable prompts; the mitigations are transactional install + content digest + structural validation + author/review experts; there is no signature system and no marketplace. Honest limitations: a digest proves byte integrity and that what you install is what was packaged — NOT that the prompt is safe; `validate` is structural, not behavioral; the review expert is a mitigation, not a guarantee; provenance is whatever the distributor claims (git/PR), not a verified identity. This concretizes the trust position child 3 declared in the concept doc. `docs/zh/workflow-packages.md` does not exist; whole-file translation stays out of scope (English fallback), consistent with child 3.

### D6. Parity-hash churn is expected and specified

Editing the two expert template bodies changes their pinned hashes. The implementer MUST regenerate, in `test/core/templates/skill-templates-parity.test.ts`:
- `EXPECTED_FUNCTION_HASHES['getWorkflowAuthorSkillTemplate']` (currently `2070707436…`) and `['getWorkflowReviewSkillTemplate']` (currently `341e9e8c…`)
- `EXPECTED_GENERATED_SKILL_CONTENT_HASHES['rasen-workflow-author']` (currently `6c220e31…`) and `['rasen-workflow-review']` (currently `4bb0575e…`)

These current values are cited so the implementer can confirm they are the ones that move (and that no OTHER hash moves — if another does, the edit leaked beyond the two experts). This is intentional change-detector churn, not a regression.

## Risks / Trade-offs

- **Prober portability**: `codex --version` behavior/exit codes vary by install; the probe must treat any clean success as available and any spawn error/non-zero/timeout as unavailable, without throwing. Bounded timeout avoids hanging a run on a wedged binary.
- **Concurrent dependency drift**: the library sibling's CLI verbs are cited in expert prose and the preflight error; its apply runs concurrently, so exact names could shift. Mitigated by marking every such identifier for re-verification.
- **Expert-template edits are load-bearing for child 6**: child 6 also edits these experts. Ordering (this change first) is enforced by the LEAD's DAG amendment; the parity hashes will move again in child 6 — expected.

## Migration Plan

Additive/behavioral-guard only. Pure-claude pipelines are unaffected (no probe). A codex pipeline on a machine without codex now fails fast with guidance instead of mid-run. No config or artifact changes.

## Open Questions

None blocking. Whether to cache the codex probe across invocations (process-level) vs per-invocation is resolved as per-invocation — simplest, testable, and avoids cross-run staleness; a codex install/uninstall between runs is then always reflected.
