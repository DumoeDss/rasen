# Handoff: recursive Composite Pipeline research — lead

## Original intent

The user first asked whether the current prompt-owned `review-cycle` could be
decomposed into Pipeline/Canvas objects with bounded escape conditions. They
then broadened the idea: `auto`, `goal`, and `review-cycle` should all use one
recursive Pipeline model; `ReviewCycle` should be an expandable child Pipeline,
while `auto` and `goal` should stop being distinct top-level execution systems.

The latest explicit request was:

> 更新文档。然后分析一下我们如何开始。是把整个改进在0.1.5版本中发布，还是
> 部分改进（比如一开始说的review-cycly先行）做到0.1.5，还是整体都放到下一个
> 版本（比如0.1.6）。

That request has been completed as research/documentation only. No product code,
Pipeline definition, or Change artifact was intentionally modified.

## Position

Pipeline: none. This was a repo-level `rasen-explore` research session, not an
active Change Pipeline Run, so no `auto-run.json` or `sessionHandoff` was
created.

Context probe at handoff:

- runtime/model: Claude / `claude-opus-5`
- context: `229246 / 200000`
- pct: `1.14623` (114.623%)
- remainingTokens: `0`
- project handoff threshold: `0.7`
- transcript:
  `C:\Users\Sayo\.claude\projects\E--AI-ChatAI-Agents-VibeCodingProjects-workflow-Reference-OpenSpec-code\1106e7f4-809d-46b2-84d7-744dbed8498d.jsonl`

Research artifact:

- `rasen/work/issue-centered-automation-platform/deterministic-pipeline-kernel-research.md`
- Current title: `递归 Composite Pipeline 与确定性执行内核研究`
- It is currently an untracked file in an already-dirty worktree.

## Done / Remaining

Done:

- Inspected the current Pipeline schema, DAG validation, graph scheduler,
  Canvas cycle rejection, run-state/resume behavior, Codex structured result
  contracts, built-in `small-feature`, `full-feature`, `auto-decompose`, and
  all three goal-loop definitions.
- Read `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\GrokBuild.SKILL.md`
  completely and separated useful execution semantics from its Rhai-specific
  implementation.
- Read
  `rasen/work/issue-centered-automation-platform/north-star.md` completely in
  UTF-8 and calibrated the architecture against its domains and development
  commandments.
- Verified that `_orchestration.ts` already treats auto/goal/review-cycle as
  feature projections of one canonical prompt-owned playbook:
  `AUTO_FEATURES`, `GOAL_FEATURES`, and `REVIEW_CYCLE_FEATURES`.
- Expanded the research document from a review-cycle-specific proposal into:
  - one recursively composable but constrained `PipelineDefinition`;
  - `AtomicStage`, `CompositeRef`, `BoundedLoop`, `Choice`, `FanOut/Join`,
    `Gate`, and `Finish`;
  - `ReviewCycle` and `GoalLoop` as child Pipelines;
  - `auto` as Dispatch/Launch Policy;
  - `goal` as completion contract/preset;
  - one deterministic Change-level Execution Reconciler.
- Added a release analysis and concrete start sequence.
- Validated the document:
  - UTF-8;
  - 1602 lines / 55162 bytes at the last check;
  - H2 sections numbered 0 through 16;
  - 78 balanced code fences;
  - `git diff --check` clean.

Remaining:

- No implementation was requested or started.
- The release recommendation has not yet been formalized into a Rasen Change.
- Existing `pipeline-definition-api` artifacts have not been amended.
- No version field has been added to `PipelineYamlSchema`.
- No `CompositeRef`, `BoundedLoop`, compiler, reducer, journal, or runner exists
  yet.
- No successor session has been auto-launched; this is a repo-level handoff.

## Key decisions (and why)

- **There should be one execution model, not separate auto and goal runners.**
  `auto` selects/launches a root Pipeline; `goal` selects a work-product and
  completion-contract preset; both eventually call the same Reconciler.
- **ReviewCycle and GoalLoop are expandable child Pipelines.** They share loop
  lifecycle, round identity, limits, recovery, journal, budget, and exits while
  retaining different input/output and success semantics.
- **The model is recursive but constrained.** Root dependencies and Composite
  call graph remain acyclic; only `BoundedLoop` repeats; v1 must not allow
  arbitrary graph cycles, recursive Composite calls, or nested loops.
- **Do not flatten domain levels.** Issue Execution Plan nodes are Changes;
  every Change owns a Pipeline Run; review/goal Composites live inside that
  Change Run. Similar graph mechanics do not erase planning/execution/
  acceptance boundaries.
- **Current `auto-decompose` eventually moves upward.** It creates multiple
  Changes and dependencies, so in the north-star architecture it belongs to
  Dispatch/Execution Plan rather than a normal Change-level child Pipeline.
  That move waits for the Issue/Execution Plan line.
- **Design the contract generally; implement vertically.** Define a general
  Composite/Loop contract from the start, but implement only the minimum needed
  by one real ReviewCycle first. Do not build the whole workflow platform.
- **Recommended release split:**
  - `0.1.5`: ship the current management platform and add only the Pipeline v1
    format/compatibility boundary;
  - `0.1.6`: generic minimal Composite contract plus ReviewCycle as the first
    deterministic runner slice;
  - `0.1.7`: migrate GoalLoop and converge auto/goal onto one launcher, only
    after 0.1.6 dogfood proves the model;
  - `0.2.0`: Issue Execution Plan, target projects, Issue acceptance, and
    auto-decompose moving into Dispatch.
- **Do not put ReviewCycle runner into 0.1.5.** The 0.1.5 changelog already
  carries management UI, daemon sessions, Canvas, Pipeline library, Store
  config scope, keepalive, and audit. The current capability baseline explicitly
  states that no programmatic `rasen pipeline run` engine exists. Adding one
  now would make 0.1.5 a two-center release.
- **Do not put the entire unified architecture into one 0.1.6 big bang.**
  Review, goal, launcher, Canvas, portfolio, and Issue-level movement must be
  independently evidenced.
- **0.1.5 needs a Pipeline content version boundary.** It is the first release
  exposing round-trippable Pipeline definitions and a Pipeline library, while
  `PipelineYamlSchema` itself is unversioned. Historical unversioned YAML should
  normalize to v1; unknown future versions should fail closed; v1 flat
  `stage.loop` should remain readable and compile into future Composite Run
  Plans.
- **Run Plan is historical execution evidence, not a second mutable truth.**
  Freeze normalized execution structure and record source revision/digest; do
  not copy Issue content into a separately editable snapshot.
- **Prompt strength remains at judgment seams.** Agents judge findings,
  severity, fix strategy, and satisfaction. The program owns ordering, rounds,
  actor identity, limits, budgets, recovery, schema validation, and exits.

## Dead ends & gotchas

- **Arbitrary Canvas cycle edges were rejected.** Current Pipeline scheduling
  uses topological order plus a completed set. A literal back-edge leaves round
  identity, reopening, output versioning, downstream invalidation, and resume
  undefined. Use an explicit bounded scope instead.
- **A review-cycle-only runtime was rejected as the target architecture.** It
  would work for the first demo but hard-code the wrong abstraction and require
  redesign for GoalLoop.
- **A fully generic IR/compiler/event platform before dogfood was also
  rejected.** It repeats the Harness failure: horizontal architecture first,
  true E2E last.
- **“Put everything in 0.1.5” was rejected.** It changes the execution
  architecture late in an already-large release.
- **“Put ReviewCycle runner in 0.1.5” was rejected.** It still introduces the
  absent programmatic runner and a second release center.
- **“Put everything in 0.1.6” was rejected.** The version boundary is cleaner,
  but the scope remains a big bang.
- **Do not make runtime infrastructure into Canvas business nodes.** Keepalive,
  transcript resume, backend, sandbox, retries, idempotency, budget admission,
  timeouts, and journal commit are Run Policy/adapters.
- **Current relevant Change artifacts can be stale relative to code.**
  `rasen/changes/pipeline-definition-api/` currently commits a flat
  `WirePipelineDefinition = PipelineYaml` round-trip contract and says there
  are no persisted format changes. Its tasks are unchecked. The current code/
  changelog also reflects later decisions in places (for example UI-origin
  quality-floor behavior), so re-run status and inspect the live diff before
  editing artifacts; do not assume the artifact is already synchronized.
- **Dirty worktree warning.** Many unrelated user changes and untracked
  artifacts exist. Preserve them; never reset or overwrite them.

## Eliminated hypotheses

- **Hypothesis: current Canvas is strictly linear.** Ruled out by
  `PipelineGraph`, `requires`, branches, convergence, and `parallelGroup`.
  It is DAG-only, not line-only.
- **Hypothesis: current loop schema means runtime owns the loop.** Ruled out by
  `_orchestration.ts` and the skills: `loop.kind` is declared in YAML, but LEAD
  prompt text still executes review/goal rounds and maintains most semantics.
- **Hypothesis: GrokBuild Rhai should become the Rasen Pipeline language.**
  Ruled out by Canvas/static-analysis needs, same-process-only resume, lack of
  workflow nesting/timeouts/throttles, and imperative control flow. Borrow its
  semantics, not Rhai.
- **Hypothesis: a clean ReviewCycle can complete an Issue.** Ruled out by the
  north-star three-layer quality model. It only makes the Change's downstream
  ship stage ready; Issue acceptance is independent.
- **Hypothesis: auto-decompose is just another nested Composite.** Ruled out by
  its production of child Changes and a portfolio DAG. It belongs at the
  Execution Plan seam in the target model.

## Working set

Files intentionally created/modified by this research:

- `rasen/work/issue-centered-automation-platform/deterministic-pipeline-kernel-research.md`
- `rasen/handoff/composite-pipeline-version-strategy.md`

Primary evidence files:

- `rasen/work/issue-centered-automation-platform/north-star.md`
- `rasen/work/issue-centered-automation-platform/current-capabilities-0.1.5.md`
- `rasen/work/issue-centered-automation-platform/roadmap.md`
- `rasen/changes/pipeline-definition-api/{proposal.md,design.md,tasks.md}`
- `rasen/changes/pipeline-definition-api/specs/**/spec.md`
- `rasen/changes/pipeline-online-assembly/planning-context.md`
- `src/core/pipeline-registry/types.ts`
- `src/core/pipeline-registry/pipeline.ts`
- `src/core/pipeline-registry/graph.ts`
- `src/core/pipeline-registry/run-state.ts`
- `src/commands/pipeline.ts`
- `src/core/templates/workflows/_orchestration.ts`
- `src/core/templates/workflows/auto.ts`
- `src/core/templates/workflows/goal-command.ts`
- `pipelines/{small-feature,full-feature,auto-decompose,goal-loop-*}/pipeline.yaml`
- `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\GrokBuild.SKILL.md`
- `CHANGELOG.md`
- root and UI `package.json`

Important local facts observed:

- manifests: `0.1.5`
- latest tag: `rasen-v0.1.4`
- current branch at handoff: `feat/store-context-unification`
- research document is untracked
- worktree contains many unrelated modifications

## Next action

In a fresh session, read
`rasen/work/issue-centered-automation-platform/deterministic-pipeline-kernel-research.md`
section 15 first, then ask the user to confirm the recommended release split.
If confirmed, the first authorized artifact action is to amend the existing
`pipeline-definition-api` proposal/design/spec/tasks with the Pipeline content
v1 compatibility boundary; do not start the Composite runner implementation
until a separate `0.1.6` Change has been proposed and accepted.
