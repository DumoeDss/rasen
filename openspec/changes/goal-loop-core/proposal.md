## Why

`/opsx:auto` can only drive tasks whose "done" is a code-change document (propose → apply → verify → ship → archive). It cannot drive tasks whose "done" is a *condition* — a measurable threshold (Lighthouse → 90, p99 latency ≤ 200ms) or a quality judgment against a rubric — because every built-in pipeline assumes the product is a single reviewable diff. This leaves a class of legitimate, well-bounded tasks (performance optimization, rubric-driven quality work, autoresearch-style research/writing) outside the autopilot's reach. goal-loop adds a harness loop — repeat modify→judge until a stop condition is met or a round cap is hit — so `/opsx:goal` can drive them with the same role-isolated orchestration as `/opsx:auto`.

## What Changes

- **New loop kind on `StageLoopSchema`**: the stage loop schema becomes a discriminated union on `kind` with the existing `review-cycle` variant plus a new `goal` variant. The `goal` variant carries a required **gate** discriminated union (exactly one of `measure` or `evaluate` per pipeline — no combination in v1), `maxRounds`, and `loopStallLimit`. Field name is `loopStallLimit` (gate-neutral; avoids collision with `HandoffConfigSchema.stallLimit`). **Backward compatible**: the existing `review-cycle` shape validates unchanged.
- **Run-state additions** (additive): `loopConfig` (the injected effective gate config at runtime) and `loopProgress` (best-effort derived cache; `goal-run.json` is the authoritative position).
- **Orchestration playbook**: the existing "Step E" loop handling is generalized to dispatch on `loop.kind`; a new **Step L (goal-loop)** defines the per-round protocol — inject gate config once, warm-reuse one implementer across rounds, run the gate (measure = deterministic command; evaluate = fresh reviewer worker ≠ implementer), record `{round, score?, measurePassed?, evaluateSatisfied?, detail?, gaps?, error?, gitTreeFingerprint}` to `goal-run.json`, stop on satisfaction, and trigger LEAD strategy review after `loopStallLimit` consecutive no-progress rounds.
- **Three backend pipelines** (registered as data, homogeneous — one gate type each): `goal-loop-measure` (measure gate → code-edit iterate → ship → archive), `goal-loop-evaluate` (evaluate gate → code-edit iterate → ship → archive), `goal-loop-research` (evaluate gate → prose/research iterate → `report` tail, with a lower implementer handoff threshold for earlier relay).
- **Three skill templates**: `openspec-goal-plan` (define-goal stage; produces `goal-plan.md`, no proposal/design/specs), `openspec-goal-iterate` (the student; work-product-aware code vs prose dispatch; never spawns child subagents), `openspec-goal-report` (research pipeline's report tail).
- **New `/opsx:goal` entry**: an `openspec-opsx-goal` skill + `OPSX: Goal` command template mirroring `auto.ts`'s structure. The LEAD classifies the task and selects ONE backend pipeline (explicit override wins: `measure|evaluate|research` selector or `--pipeline goal-loop-<variant>`).
- **Pipeline display generalization**: `pipeline show` renders goal-loop gate info alongside the existing review-cycle loop label.
- **Unit tests**: schema (goal gate validates; review-cycle shape still valid), built-ins (3 new pipelines load and pass validators), pipeline parsing (goal-loop case).

Non-goals (deferred to `goal-loop-validation`): end-to-end tests, kill-resume integration tests, and user-facing docs. No new agent role is introduced — the existing `implementer`, `reviewer`, `planner`, and `shipper` roles are reused.

## Capabilities

### New Capabilities

- `goal-loop-workflow`: The goal-driven iteration loop mechanism — the `kind: goal` loop semantics, the measure/evaluate gate contract, `maxRounds` + `loopStallLimit` bounds, stall detection, the `goal-run.json` authoritative record, run-state `loopConfig`/`loopProgress`, and the resume protocol. Covers the behavioral contract of the loop and the three registered backend pipelines.
- `opsx-goal-command`: The `/opsx:goal` user-facing entry — LEAD classification among the three backend pipelines, the explicit override surface, and the three skill templates (`openspec-goal-plan`, `openspec-goal-iterate`, `openspec-goal-report`) plus the `OPSX: Goal` command template.

### Modified Capabilities

- `opsx-pipeline-registry`: `StageLoopSchema` becomes a discriminated union on `kind` (`review-cycle` | `goal`); the built-in pipelines requirement now also covers the three `goal-loop-*` pipelines; `pipeline show` renders goal-loop gate metadata.
- `opsx-orchestration`: The playbook's loop handling generalizes to dispatch on `loop.kind` (Step E covers `review-cycle`); a new Step L defines the goal-loop round protocol (inject, warm-reuse implementer, gate, record, stop, stall, resume).

## Impact

- **Schema/types** (`src/core/pipeline-registry/types.ts`): `StageLoopSchema` converted from a plain `z.object` to `z.discriminatedUnion('kind', [...])`; new gate discriminated union; `superRefine` enforces measure-gate needs `threshold` or `target`.
- **Run-state** (`src/core/pipeline-registry/run-state.ts`): two additive optional fields on `RunStateSchema` (`loopConfig`, `loopProgress`); `passthrough()` keeps existing readers unaffected.
- **Orchestration** (`src/core/templates/workflows/_orchestration.ts`): Step E prose generalized; new Step L section appended to the `ORCHESTRATION_PLAYBOOK` template string.
- **Pipeline display** (`src/commands/pipeline.ts`, ~line 641): the `loop=${...}` meta line generalized to render goal-loop gate info.
- **Pipelines** (`pipelines/goal-loop-{measure,evaluate,research}/pipeline.yaml`): three new pipeline directories, auto-discovered by the registry (no code registration needed).
- **Skill templates** (`src/core/templates/workflows/goal-*.ts` + new `goal-command.ts`): new template files; registration entries added to the hardcoded lists in `src/core/shared/skill-generation.ts` (`getSkillTemplates`, `getCommandTemplates`) and re-exported from `src/core/templates/skill-templates.ts`.
- **Tests** (`test/core/pipeline-registry/{pipeline,builtins}.test.ts`, schema tests): new goal-loop cases; the existing `review-cycle` assertion at `pipeline.test.ts:74` must remain green.
- **Hard constraint**: existing `full-feature` / `small-feature` / `bug-fix` pipelines and the `review-cycle` loop get ZERO behavior change. The discriminated union must keep the `review-cycle` shape valid and the three existing pipelines' tests green.
