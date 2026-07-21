## Why

The pipeline-library sibling makes pipelines packageable and installable, but two gaps remain from portfolio decision #4. First (c): a pipeline can name `codex` as a stage's runtime, yet nothing checks that the codex CLI is actually available until a stage is mid-dispatch — `validatePipelineForExecution` today validates skill presence and child-pipeline resolution but never scans runtime, so a missing codex binary fails deep inside a run instead of before it. Second (d): the `workflow-author` and `workflow-review` experts author and review workflows only — they have no guidance for pipeline authoring/review — and the package trust posture (community packages are executable prompts) is not stated honestly anywhere in the docs.

This change closes both: a pre-dispatch runtime preflight with an injectable codex prober, and the expert + docs work that gives pipeline packages the same authoring/review support and an explicit, honest trust boundary. It depends on the pipeline-library sibling (whose CLI verbs the experts reference) and must precede the expert-integration sibling, since both edit the same expert templates.

## What Changes

### 1. Runtime preflight probes codex availability before dispatch (c)

Extend `validatePipelineForExecution` (`src/core/pipeline-registry/execution-validation.ts`) so that, after the existing skill checks, it resolves each stage's effective runtime via `resolveStageRuntimeConfig` (precedence: stage `runtime` > pipeline `agents.<role>` > default `claude`), across all stages **including decompose children** — reusing the same child-pipeline recursion the skill loop already uses. If any effective runtime is `codex`, it probes CLI availability once per invocation via an **injectable prober** (default: a real `codex --version`-level check; tests inject a fake). If codex is required but unavailable, it fails **before dispatch** with an error naming the two exits: override the affected role(s) to `claude` (via `rasen pipeline agents <name> --<role> claude` — verb from the sibling, re-verify), or install the codex CLI. When no stage resolves to codex, no probe runs.

### 2. Codex availability prober (c)

Add a small, injectable `probeCodexAvailability()` to the codex module (`src/core/codex/`), where no availability probe exists today (only shell snippets inside expert templates). It runs a bounded `codex --version`-level check and returns a boolean. The preflight memoizes its result within a single validation invocation so a pipeline with several codex stages probes at most once. Injecting the prober keeps the preflight unit-testable without a codex binary, following the codebase's established "separate function that accepts an injected set" testability convention.

### 3. Pipeline authoring/review experts (d)

Extend the `workflow-author` and `workflow-review` expert templates (`src/core/templates/experts/workflow-author.ts`, `workflow-review.ts` — currently workflow-only) to also cover pipeline authoring and review: `pipeline.yaml` structure (stages, role, gate, loop, decompose/`childPipeline`, per-role runtime), the `rasen pipeline init/validate/import/export/delete` loop (verbs from the sibling — mark as dependency, re-verify against its final surface), and the package trust posture. The review expert gains pipeline-specific review dimensions (stage DAG acyclicity, decompose recursion bound, runtime/model resolvability, skill enablement).

### 4. Trust-boundary docs (d)

State the trust boundary explicitly in `docs/workflow-packages.md`: community packages are executable prompts; the mitigations are transactional install + content digest + structural validation + the author/review experts; there is no signature system and no marketplace. Use honest limitation language — a digest verifies byte integrity, not safety; validation is structural, not behavioral; the review expert is a mitigation, not a guarantee. (Per the established convention, `docs/zh/workflow-packages.md` does not exist and a whole-file translation stays out of scope; English-fallback applies.)

### 5. Expected parity-hash churn (call it out so the implementer isn't surprised)

Editing the two expert templates regenerates four pinned values in `test/core/templates/skill-templates-parity.test.ts`: `EXPECTED_FUNCTION_HASHES['getWorkflowAuthorSkillTemplate']` and `['getWorkflowReviewSkillTemplate']`, and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES['rasen-workflow-author']` and `['rasen-workflow-review']`. This is expected, intentional churn — the parity test is a change-detector; regenerate the four hashes as part of the change.

## Capabilities

### Modified Capabilities

- `opsx-pipeline-registry`: pipeline execution preflight resolves effective runtimes across all stages (including decompose children) and fails before dispatch when a required codex runtime is unavailable, naming the override/install exits.
- `workflow-library`: the workflow-author/workflow-review experts cover pipeline authoring/review, and the package trust boundary is documented.

## Impact

- `src/core/pipeline-registry/execution-validation.ts` — runtime scan + codex preflight (injectable prober)
- `src/core/codex/` (new file, e.g. `availability.ts`) — `probeCodexAvailability()`
- `src/core/templates/experts/workflow-author.ts`, `workflow-review.ts` — pipeline authoring/review guidance
- `docs/workflow-packages.md` — trust-boundary section
- `rasen/specs/opsx-pipeline-registry/spec.md`, `rasen/specs/workflow-library/spec.md` — deltas
- Tests: preflight with injected prober (codex present/absent, decompose children, no-codex no-probe), regenerated parity hashes for the two experts
- Constraints: no version bump; depends on the pipeline-library sibling's CLI verbs (re-verify exact names at implementation); must precede expert-integration (shared expert-template edits); parity-hash churn is expected.
