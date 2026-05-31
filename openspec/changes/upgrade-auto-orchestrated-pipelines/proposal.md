## Why

`/opsx:auto` today is a single-context linear recipe. One agent reads the auto skill and walks `propose → apply → verify → ...` itself; its so-called "dispatch agent" spawns nothing. Three consequences:

1. **No structural author ≠ verifier.** The same context plans, implements, reviews, and fixes. The author-vs-verifier invariant that `review-cycle` tries to enforce degrades to a same-context promise, because there is no separate actor to confirm a fix.
2. **No isolation.** One stage's exploration noise pollutes the next; a long apply transcript bleeds into the review.
3. **No intra-stage parallelism.** The expert matrix (`/review`, `/cso`, `/benchmark`, `/qa`) runs serially in prose.

The three pipelines (Full Feature / Small Feature / Bug Fix) are also hand-written prose. Adding a task type means hand-writing another prose block that drifts from the others — the structure does not scale.

We want every pipeline to run as **a LEAD agent orchestrating role-isolated subagents**: different tasks fully isolated, and within one task the LEAD can resume a specific subagent via `SendMessage` to continue with warm context. And we want pipelines to be **data**, so a new task type is a new definition, not new orchestration code.

## What Changes

A two-layer architecture that separates **what** runs from **how** it is orchestrated:

- **Pipeline registry (data — the WHAT).** Each task type is a declarative pipeline: an ordered DAG of stages, each stage carrying `{ skill, role, gate?, loop?, parallelGroup?, condition?, leadReview?, verifyPolicy? }`. Built-in definitions (`full-feature`, `small-feature`, `bug-fix`) ship in the package; users/projects extend via the same dual-root resolution OpenSpec already uses for schemas. Surfaced via CLI: `openspec pipeline list | show <name> | classify "<task>" | resume <change>` (all `--json`). Validated like schemas (acyclic, referenced skills/roles exist).

- **Orchestration playbook (instructions — the HOW).** One shared LEAD playbook, consumed by `auto` and `review-cycle`, that interprets ANY pipeline DAG:
  - **Capability tiers (auto-detected):** **A** — Claude Code with agent-teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`): spawn role subagents AND resume them via `SendMessage` for warm-context continuation. **B** — spawn available, no agent-teams: fresh subagent per stage/round, context cold-reconstructed from the change directory. **C** — no subagent capability: single-context sequential fallback (today's behavior). The pipeline definition is identical across tiers; only the HOW differs.
  - **Role-isolated leaf subagents.** The LEAD is the sole orchestrator (Claude subagents cannot themselves spawn — the hierarchy is flat: LEAD + leaf workers). Each worker invokes an EXISTING stage skill (`openspec-propose`, `openspec-apply`, `openspec-gstack-review`, …) — stage logic is not reimplemented.
  - **Change directory as the durable blackboard.** Stages hand off through OpenSpec artifacts on disk; `SendMessage` is used only for same-task warm continuation, not as the inter-stage state channel. A LEAD-owned run-state file records stage status, which worker did what, review rounds, and open findings — enabling resume and observability.
  - **Structural author ≠ verifier.** Reviewer ≠ implementer; the fixer of a design-level finding ≠ the original author; the re-reviewer ≠ the fixer. The LEAD enforces by assigning distinct workers.
  - **Gates / loops / parallel groups / conditions.** Human pause points, the bounded review→fix loop, concurrent expert reviewers, and conditional expert selection are all DAG metadata the LEAD honors. Loops are capped and escalate to the human on the cap.

- **`auto` upgraded.** Classify the task → select a pipeline → interpret its DAG via the orchestration playbook. The orchestration now spans `office-hours / propose / apply` as well. Two task-shaped behaviors are added:
  - **Optional propose direction-review gate** (parameter-controlled, e.g. `--review-plan`): after the propose worker returns and before implementation, the LEAD — holding the original user intent — reviews the proposal/design/specs/tasks for direction drift and can bounce it back. The LEAD did not author the proposal, so this does not violate author ≠ verifier.
  - **Adaptive Bug-Fix verify:** simple fixes (single file / non-core path / sufficient tests) pass on a green unit-test gate; complex fixes spawn a dedicated test/verification worker for deeper checking.

- **`review-cycle` corrected and unified.** It is rewritten to consume the SAME orchestration playbook as its inner loop, with the primary/fallback ordering fixed: the `SendMessage`-driven multi-agent path is the PRIMARY mechanism and single-context is the explicit fallback (today they are inverted). `author ≠ verifier` becomes structural rather than a same-context convention.

## Capabilities

### New Capabilities
- `opsx-pipeline-registry`: data-driven pipeline definitions (`pipelines/<name>/pipeline.yaml`), the `PipelineGraph` (stage DAG + topo-sort), dual-root resolution (package + user + project), the `openspec pipeline list|show|classify|resume --json` command group, and pipeline validation.
- `opsx-orchestration`: the shared LEAD orchestration playbook — capability tiers A/B/C, role-isolated leaf subagents invoking existing stage skills, the change-directory blackboard + run-state, structural author ≠ verifier, gate/loop/parallelGroup/condition interpretation, bounded loops, and human escalation.

### Modified Capabilities
- `opsx-auto-command`: `auto` is rewritten to consume `opsx-pipeline-registry` (classification + DAG) and execute it via `opsx-orchestration`; adds the optional propose direction-review gate and the adaptive Bug-Fix verify policy.
- `review-cycle-workflow`: rewritten to share the `opsx-orchestration` playbook as its inner loop and to make the `SendMessage` multi-agent path primary with single-context as the explicit fallback.
- `command-generation`: a new shared orchestration-playbook module is added and re-exported; the `auto` and `review-cycle` templates are regenerated to reference it.

## Impact

- **New (data):** `pipelines/full-feature/pipeline.yaml`, `pipelines/small-feature/pipeline.yaml`, `pipelines/bug-fix/pipeline.yaml`; add `pipelines/` to `package.json` `files`.
- **New (core):** `src/core/pipeline-registry/{types,pipeline,graph,resolver,state,index}.ts` mirroring `src/core/artifact-graph/*`. Factor the dual-root directory logic into a shared `createDualRootResolver(name)` reused by both schemas and pipelines.
- **New (CLI):** `src/commands/pipeline.ts` (`PipelineCommand` with `list/show/classify/resume`); register the `pipeline` command group in `src/cli/index.ts`.
- **New (instructions):** `src/core/templates/workflows/_orchestration.ts` — the shared LEAD orchestration playbook fragment.
- **Edit:** `src/core/templates/workflows/auto.ts` (interpret pipeline DAG via the playbook; add propose-review gate + adaptive verify), `src/core/templates/workflows/review-cycle.ts` (share playbook; invert primary/fallback), `src/core/templates/skill-templates.ts` + `src/core/shared/skill-generation.ts` (wire the playbook), `src/commands/validate.ts` (extend validation to pipelines).
- **Tests:** `test/core/pipeline-registry/*` (types/parser/graph/resolver/state), `test/commands/pipeline.test.ts` + e2e in `test/cli-e2e/`, updated `test/commands/auto*`/`review-cycle` assertions; a regression test that **adding a new task type requires only a new `pipeline.yaml`, with no `.ts` change**.
- **Docs (on implementation):** `docs/opsx-workflow-guide.md`, `docs/commands.md`, `docs/workflows.md`, `docs/supported-tools.md` (tier annotations), and `docs/zh/` mirrors.
- **Phasing:** P1 lands the orchestration playbook + tiers + role isolation with pipelines still inline in `auto` (proves the architecture on real Claude Code); P2 promotes pipelines to the data-driven registry + CLI and makes `auto` thin; P3 formalizes run-state, verifies the B/C fallbacks, and updates docs.
- **Backward compatible:** Tier C reproduces today's single-context behavior; the `core` profile and existing schemas/artifact-graph are unaffected; the `spec-driven` schema is not modified.
