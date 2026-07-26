# Executable Composite Pipelines 0.1.6 — Planning Context

## User intent

> `$rasen-auto auto-decompose` 由你开始推进整个0.1.6的开发吧，直到任务结束。
> 在dev/0.1.6的基础上再创建开发分支，合理拆分changes，每一阶段提交代码，
> 最终提pr到dev/0.1.6

## Branch and delivery

- Base: `origin/dev/0.1.6` at `3e8d1d389cc6612c2bbd8c051cbf8b256189fe03`
- Development branch: `feat/0.1.6-executable-composite-pipelines`
- Delivery: one final PR targeting `dev/0.1.6`
- Child Changes commit locally at review-clean stage boundaries; no child push or child PR
- Other worktrees are out of scope and must remain untouched

## Authoritative research

Read first:

- `rasen/work/issue-centered-automation-platform/deterministic-pipeline-kernel-research.md`

The research is finalized. Its locked direction is:

- Product paradigm: **Executable Composite Pipeline (ECP)**
- Public contract: **Pipeline Definition v2**
- Nested reusable unit: **Composite**
- Feedback primitive: **BoundedLoop / Bounded Feedback Scope**
- Runtime kernel: **Pipeline Reconciler**
- Canvas is the Definition/authoring plane
- Operations is the Change-run observation/control plane
- The canonical Run Record is the only runtime truth

## 0.1.6 product boundary

`0.1.6` is complete only when the following form one end-to-end product closure:

1. Pipeline Definition v2 and v1 normalization/compatibility
2. Canvas authoring for the v2 vocabulary and constrained Custom Composite
3. Compiler to immutable `ChangeRunPlan`
4. Deterministic Pipeline Reconciler and canonical durable Run Record
5. Change-run Operations derived from that record
6. Built-in Change Pipelines and thin `auto` / `goal` / `review-cycle` launch surfaces
7. Real dogfood proving built-in and Canvas-authored Custom Composite use the same contract

## Required invariants

- Root ordinary control flow remains a DAG.
- Feedback is expressed only through bounded scopes with limits, typed outcomes, evidence,
  and explicit exits.
- No recursive Composite calls and no nested loops in 0.1.6.
- Built-in and Custom Composite definitions share one compiler/runtime contract.
- `reconcile(plan, record) -> NextActions` is deterministic and mechanically pure.
- Agent/command/host adapters execute typed actions; only validated committed results advance.
- One Run freezes `engine: legacy | reconciler`; ownership never mixes in a Run.
- Operations, Markdown, timelines, and compatibility state are projections, never a second
  mutable truth.
- Open Blocker/Major findings fail closed before ship.
- `auto-decompose`, portfolio, Issue Execution Plan, distributed scheduling, and cross-project
  Operations remain outside the product boundary and are deferred to `0.2.0`.

## Implementation slicing constraints

- Decompose into independently reviewable child Changes with an explicit dependency DAG.
- Each child must be an end-to-end vertical slice where practical: definition, validation,
  runtime, projection/UI, and tests move together.
- Shared contracts must land before consumers.
- Dependency edges are serialized; uncertain overlap is serialized.
- Avoid a “runtime first, UI later” split that recreates divergent truths.
- Avoid a single big-bang Change.

## Initial decomposition hypotheses

The LEAD expects at least these capability seams, subject to codebase research:

- v2 definition model, normalization, compiler, and validation
- canonical run record, action/result contracts, and deterministic Reconciler
- Canvas v2 and constrained Custom Composite authoring
- Change-run Operations APIs and UI
- built-in Pipeline migration plus launcher/preset/adapter convergence and end-to-end dogfood

The planner must verify file/spec ownership, refine dependencies, and keep sibling contracts
mutually consistent. Append durable repository findings and decisions to this file after every
proposal.

## Durable repository findings — decomposition

- `PipelineYamlSchema` is currently the v1 public truth and already feeds loader, registry,
  management wire types, Canvas mirrors, validation, built-in YAML, and CLI. Definition v2 must
  deepen this seam rather than add a sibling parser.
- Canvas already keeps a full `WirePipelineDefinition` draft and round-trips through management
  validation/save; it should evolve in place instead of introducing a second Composite editor
  data model.
- `auto-run.json`, `goal-run.json`, `portfolio-run.json`, Markdown reports, management runs
  projections, and prompt orchestration currently overlap in meaning. The new canonical Change
  Run Record must live behind one run module and treat all existing forms as inputs for legacy
  recovery or derived projections, never peer writers.
- The built-in Pipeline YAMLs and generated auto/goal/review-cycle templates are both product
  consumers and compatibility surfaces. Migrating only one would preserve duplicate mechanical
  ownership.
- The seven child Changes are strictly serial: `ecp-definition-v2 -> ecp-run-spine ->
  ecp-review-cycle -> ecp-custom-composite -> ecp-goal-loop -> ecp-full-feature ->
  ecp-product-closure`.
- Design-it-twice selected a hybrid shared Interface: a public Definition `prepare` seam and
  a product runtime facade with `start / resume / complete / inspect / control`. The pure
  Reconciler, commit reducer, canonical Record, storage CAS, and projections remain hidden
  Implementation/internal test seams.
- Result completion is stable-ActionId/idempotency based so parallel completions compose;
  human/Operations controls remain RecordVersion-checked.
- Safe extensibility is limited to versioned typed capabilities, declarative non-recursive
  Composite definitions, trusted execution Adapters, and read-only projections. The compiled
  control algebra remains closed.
