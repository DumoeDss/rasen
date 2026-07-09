# opsx-orchestration Specification

## Purpose
Define the LEAD orchestration model for driving a pipeline of stages — the LEAD as sole orchestrator, auto-detected capability tiers, role isolation enforcing author≠verifier, the change-directory blackboard and run-state, gate/loop/parallel/condition interpretation, and bounded loops that escalate rather than silently pass.
## Requirements
### Requirement: LEAD Is the Sole Orchestrator

The orchestration SHALL run as a single LEAD agent that spawns leaf worker subagents; workers SHALL NOT themselves spawn subagents.

#### Scenario: Flat hierarchy

- **WHEN** a pipeline is executed under the playbook
- **THEN** all stage dispatch, loop control, triage, and routing SHALL be performed by the LEAD
- **AND** each worker SHALL perform a single unit of work and return its result to the LEAD
- **AND** no worker SHALL spawn a further subagent

#### Scenario: Workers invoke existing skills

- **WHEN** the LEAD dispatches a stage
- **THEN** the worker SHALL invoke the stage's existing OPSX skill rather than reimplementing the stage logic

### Requirement: Capability Tiers Are Auto-Detected

The playbook SHALL detect the host's capability tier and choose execution mechanics accordingly, while keeping the pipeline definition identical across tiers.

#### Scenario: Tier A — agent-teams

- **WHEN** running on Claude Code with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
- **THEN** the LEAD SHALL spawn role-isolated workers AND MAY resume a specific worker via `SendMessage` for warm-context continuation
- **AND** only the LEAD SHALL originate `SendMessage`

#### Scenario: Tier B — spawn without warm resume

- **WHEN** subagent spawning is available but agent-teams is not
- **THEN** the LEAD SHALL spawn a fresh worker per stage or round
- **AND** SHALL reconstruct each worker's context from the change directory and run-state

#### Scenario: Tier C — degraded fallback

- **WHEN** no subagent capability is available
- **THEN** the LEAD SHALL execute the pipeline sequentially in a single context
- **AND** this tier SHALL be treated as the explicit fallback, not the primary path

### Requirement: Role Isolation Enforces Author ≠ Verifier

The LEAD SHALL assign distinct workers by role so that a fix is always confirmed by a non-author.

#### Scenario: Distinct actors per role

- **WHEN** stages of different roles execute
- **THEN** the reviewer worker SHALL NOT be the implementer worker
- **AND** the fixer of a design-level finding SHALL NOT be the original author
- **AND** the worker that re-reviews a fix SHALL NOT be the worker that authored the fix

#### Scenario: Tier C equivalent check

- **WHEN** running under the single-context fallback
- **THEN** the non-author confirmation SHALL degrade to an independent gate-run plus diff-read recorded in run-state, and this SHALL be marked as the fallback

### Requirement: Change Directory Blackboard and Run-State

Stages SHALL hand off through the change directory (review material: proposal, design, tasks, delta specs) and the change's work directory (process ephemera: reports, run-state, handoff documents — the `change-work-dir` capability), and the LEAD SHALL maintain a run-state record; `SendMessage` SHALL be used only for warm continuation, never as the inter-stage state channel. The LEAD SHALL resolve BOTH locations as absolute paths from `openspec status --change <n> --json` — the `changeRoot` field for review material and the `workDir` field for ephemera — before writing any blackboard artifact or run-state, so that all paths taught by the workflow are interpreted relative to the selected OpenSpec root (including a `--store`-selected store root) and never relative to the current working directory. When the payload carries no `workDir`, or when a given ephemeron already exists in the change directory, the LEAD SHALL use the change directory for that file (the sticky-legacy fallback of the `change-work-dir` capability).

#### Scenario: Durable handoff

- **WHEN** one stage's output feeds a later stage
- **THEN** the output SHALL be written to the change directory (review material) or the work directory (process ephemera) and read by the later worker
- **AND** the run SHALL survive a terminated worker or a new session because state lives on disk

#### Scenario: Run-state recorded

- **WHEN** the LEAD executes stages
- **THEN** it SHALL record classification, selected pipeline, per-stage status, which worker handled each stage, review rounds, and open findings
- **AND** this record SHALL support resume and observability

#### Scenario: Run-state written to the work directory

- **WHEN** the LEAD starts recording run-state for a change with no pre-existing `auto-run.json` and the status payload reports a `workDir`
- **THEN** the LEAD SHALL write `auto-run.json` into that work directory
- **AND** `openspec pipeline resume <change>` resolved to the same root SHALL read the run-state (`hasRunState: true`)

#### Scenario: Run-state written to the selected root

- **WHEN** the change lives in a store-selected or non-cwd OpenSpec root
- **THEN** the LEAD SHALL write `auto-run.json` into the absolute location resolved from `openspec status --change <n> --json` (the work directory, or the change directory under the sticky-legacy fallback)
- **AND** `openspec pipeline resume <change>` resolved to that same root SHALL read the run-state (`hasRunState: true`)

### Requirement: Gate, Loop, Parallel, and Condition Interpretation

The LEAD SHALL interpret stage metadata: pause at gates, run loop stages as bounded loops (dispatching on `loop.kind` — `review-cycle` runs the bounded review→fix loop, `goal` runs the bounded goal-loop), run parallel-group stages concurrently, and skip stages whose condition is unmet.

#### Scenario: Gate pauses for the human

- **WHEN** a stage declares a `gate`
- **THEN** the LEAD SHALL pause after that stage, summarize what was done and what is next, and wait for human confirmation to continue, stop, or switch to manual

#### Scenario: Loop kind is dispatched

- **WHEN** a stage declares a `loop`
- **THEN** the LEAD SHALL narrow on `loop.kind`
- **AND** for `review-cycle` it SHALL run the bounded review→fix loop (Step E)
- **AND** for `goal` it SHALL run the bounded goal-loop (Step L)

#### Scenario: Parallel group runs concurrently

- **WHEN** multiple stages share a `parallelGroup` and their conditions are met
- **THEN** the LEAD SHALL dispatch their workers concurrently and collect all results before proceeding

#### Scenario: Condition gates a stage

- **WHEN** a stage declares a `condition` that is not met for the current change
- **THEN** the LEAD SHALL skip that stage and record the skip

### Requirement: Bounded Loops Escalate, Never Silently Pass

Loop stages SHALL be bounded by a max-rounds cap and SHALL escalate to the human on the cap with unresolved Blocker/Major findings.

#### Scenario: Cap reached with open blockers

- **WHEN** a loop stage reaches its max-rounds cap with unresolved Blocker or Major findings
- **THEN** the LEAD SHALL stop and escalate to the human with the open findings and the round history
- **AND** SHALL NOT report the stage as clean

### Requirement: 拆分产出一份由 LEAD 自审的方案

当 LEAD 执行一个 `decompose` 阶段时，它 SHALL 产出一份**拆分方案**，由一组子 change（每个都是可独立交付、可 review 的切片）和一个**依赖 DAG**（声明哪些子 change 必须先落地）组成。LEAD SHALL 在扇出之前自审这份方案（切片内聚性、任何并行同批的独立性依据，以及 DAG 的正确性），并且 MAY 在无人类确认下继续。仅当它无法产出一份安全方案时，它 SHALL 升级给人类。每个子 change SHALL 用 `openspec new change <child-id>` 创建。

#### Scenario: 在扇出前自审方案

- **WHEN** LEAD 为一个多交付物任务执行 decompose 阶段
- **THEN** 它 SHALL 产出一份方案，列出每个子 change 以及它们之间的依赖边
- **AND** 当方案安全时，它 SHALL 自审该方案并在无需人类确认的情况下开始扇出

#### Scenario: 父成为规划容器

- **WHEN** decompose 阶段被执行
- **THEN** 父 change 的其余流水线阶段 SHALL 被标记为 delegated，且 SHALL NOT 在父级运行
- **AND** 每个子 change SHALL 运行解析出的 `childPipeline`（propose → apply → verify → review-loop → …）

### Requirement: 沿依赖严格串行执行

对于由依赖边连接的任意两个子 change，LEAD SHALL 按拓扑顺序**严格串行**地运行它们。在每一个前置子 change 都已实现并通过其 review loop 之前，依赖它的子 change 流水线 MUST NOT 启动，且 LEAD MUST NOT 让前置与其依赖者并发运行。

#### Scenario: 依赖者等待其前置

- **WHEN** 子 change B 依赖子 change A
- **THEN** 在 A 已实现且 review 干净之前，LEAD SHALL NOT 启动 B 的流水线
- **AND** B 与 A SHALL NOT 并发运行

#### Scenario: 链的拓扑排序

- **WHEN** 子 change 形成依赖链 A → B → C
- **THEN** LEAD SHALL 按 A、然后 B、然后 C 的顺序执行它们

### Requirement: 仅在可证明独立时并行执行

LEAD SHALL 仅当全部成立时才并行运行子 change：(1) 任一方向都不存在依赖边，(2) 这些子 change **不共享**任何触及的能力、规格目录或文件，且 (3) 宿主为 Tier A（agent-teams）。当无法积极确证独立性时，LEAD SHALL 默认采用串行执行。并行 SHALL 需要一份积极的独立性证明，而绝非仅仅是「没有声明依赖边」。

#### Scenario: Tier A 下相互独立的子 change 并行运行

- **WHEN** 两个子 change 没有依赖边、触及集无重叠，且宿主为 Tier A
- **THEN** LEAD MAY 把它们并发派发给各自独立的 worker 团队

#### Scenario: 并行不设固定上限

- **WHEN** 在 Tier A 下有多个相互独立的子 change
- **THEN** LEAD MAY 并发运行全部这些子 change，且 SHALL NOT 施加一个固定的并发同批数量上限

#### Scenario: 触及集重叠时即便无声明边也强制串行

- **WHEN** 两个子 change 没有声明的依赖边，但触及同一能力或文件
- **THEN** LEAD SHALL 把它们视为串行，且 SHALL NOT 并发运行它们

#### Scenario: 独立性不确定时默认串行

- **WHEN** LEAD 无法积极确证两个子 change 相互独立
- **THEN** 它 SHALL 串行运行它们

#### Scenario: 非 Tier-A 宿主绝不并行

- **WHEN** 宿主为 Tier B 或 Tier C
- **THEN** 无论独立性如何，LEAD SHALL 串行运行所有子 change

### Requirement: 子 change 的流水线可逐个覆盖

每个子 change SHALL 默认运行该 decompose 阶段解析出的 `childPipeline`。组合运行状态 MAY 为单个子 change 记录一个覆盖流水线，使其运行一条不同的、仍**不含 decompose** 的流水线（例如一个子是 `bug-fix` 而其同级是 `full-feature`）。LEAD SHALL 把每个子 change 实际运行的流水线记录在组合运行状态中。

#### Scenario: 子 change 使用默认 childPipeline

- **WHEN** 某个子 change 没有覆盖流水线
- **THEN** 它 SHALL 运行该 decompose 阶段的 `childPipeline`

#### Scenario: 子 change 覆盖其流水线

- **WHEN** 组合方案为某个子 change 记录了一条不同的、不含 decompose 的流水线
- **THEN** 该子 change SHALL 运行其覆盖流水线，而其同级仍运行默认流水线

### Requirement: 组合运行状态

LEAD SHALL 在父 change 目录维护一份**组合运行状态**记录（其路径用平台 path 模块构建，其文件名作为具名常量跟踪），记载拆分方案、子 change 列表、依赖 DAG、每个子 change 的执行模式与并行同批、每个子 change 的流水线状态，以及当前可运行前沿。每个子 change SHALL 保留它自己的、按 change 计的运行状态。组合运行状态在恢复时 SHALL 为权威；子目录与产物存在性是交叉校验。

#### Scenario: 组合状态记录 DAG 与每个子 change 的状态

- **WHEN** LEAD 执行一次已拆分的运行
- **THEN** 组合运行状态 SHALL 记录每个子 change 的状态以及子 change 之间的依赖边

#### Scenario: 恢复计算下一个可运行子 change

- **WHEN** `openspec pipeline resume <parent>` 针对一个已拆分的父 change 运行
- **THEN** 它 SHALL 读取组合运行状态加各子状态，并报告其前置已完成的下一个（些）子 change

#### Scenario: 部分失败时停止受影响的链并升级

- **WHEN** 某个子 change 的流水线在运行中失败或升级
- **THEN** LEAD SHALL 停止该子 change 的依赖链、保留已完成的独立子 change 不动，并连同未完成的前沿一起升级上报

### Requirement: 拆分递归防护

拆分 SHALL 在每个组合中至多发生一次，且仅在顶层。当 LEAD 运行某个子 change 的 `childPipeline` 时，它 SHALL NOT 进一步拆分该子 change。

#### Scenario: 子流水线运行不进行拆分

- **WHEN** LEAD 让某个子 change 走完它的 `childPipeline`
- **THEN** 对该子 change SHALL NOT 评估或执行任何 decompose 阶段

### Requirement: 子 change 本地交付，组合级统一交付

当一次已拆分（decompose）运行中的子 change 执行其流水线的 ship 阶段时，该阶段 SHALL 以 `local` 交付模式运行：仅提交（commit），SHALL NOT push，也 SHALL NOT 创建 PR。对外交付（push 或 PR）SHALL 在全部子 change 完成后，由 LEAD 在父/组合层按解析出的交付模式执行且**恰好一次**。组合发生部分失败时，已完成子 change 的提交 SHALL 保留在本地且 SHALL NOT 被推送——LEAD SHALL 连同未完成前沿一起升级上报，绝不交付不完整的组合。

#### Scenario: 子 change 的 ship 仅提交

- **WHEN** 某个子 change 的流水线执行到 ship 阶段
- **THEN** 该 ship SHALL 以 local 模式运行（仅 commit）
- **AND** SHALL NOT push 也 SHALL NOT 创建 PR

#### Scenario: 组合完成后统一交付

- **WHEN** 组合中的全部子 change 均已完成其流水线
- **THEN** LEAD SHALL 在父/组合层解析交付模式并执行一次统一的 push 或 PR 交付

#### Scenario: 部分失败时不交付

- **WHEN** 某个子 change 失败或升级导致组合未全部完成
- **THEN** 已完成子 change 的提交 SHALL 保留在本地
- **AND** LEAD SHALL NOT 执行组合级 push/PR，而 SHALL 升级上报

### Requirement: Goal-Loop Round Protocol in the Playbook

The orchestration playbook SHALL include a dedicated goal-loop step (Step L) that the LEAD executes when a stage's `loop.kind` is `goal`. The step SHALL define, per round: inject the effective gate config (read from `goal-plan.md`) into run-state once before round 1; dispatch the implementer (warm-reused across rounds); run the gate (`measure` = run the command and parse `{score, passed, detail}`; `evaluate` = dispatch a fresh reviewer worker returning `{satisfied, gaps}`); append the round record to `goal-run.json`; stop on satisfaction or at `maxRounds` (marking `maxRounds-exhausted`); and trigger LEAD strategy review after `loopStallLimit` consecutive non-progressing rounds. Resume SHALL read the authoritative last record in `goal-run.json` to decide tail vs. next-round vs. round-1.

#### Scenario: Playbook dispatches on loop kind

- **WHEN** the LEAD encounters a stage with a `loop` field
- **THEN** it SHALL narrow on `loop.kind`
- **AND** `review-cycle` SHALL run the existing review→fix protocol (Step E) unchanged
- **AND** `goal` SHALL run the goal-loop protocol (Step L)

#### Scenario: Gate config injected before round one

- **WHEN** a goal-loop stage begins and no round has run yet
- **THEN** the LEAD SHALL read `goal-plan.md`, merge the concrete gate config into the iterate stage's `loopConfig` in run-state
- **AND** SHALL assert that a measure gate has its `command` before dispatching round 1

#### Scenario: Round record recorded to goal-run.json

- **WHEN** a goal-loop round's gate completes
- **THEN** the LEAD SHALL append `{round, score?, measurePassed?, evaluateSatisfied?, detail?, gaps?, error?, gitTreeFingerprint}` to `goal-run.json`

### Requirement: LEAD May Apply Trivial Inline Fixes

The playbook's "you do NOT author stage outputs yourself" rule SHALL carry an explicit exception: the LEAD does not author WHOLE stage artifacts, but MAY apply trivial inline fixes per Step E.2 (which are then re-reviewed by a non-author). A one-character or otherwise trivial finding SHALL NOT require spawning a separate fixer worker.

#### Scenario: trivial inline fix is permitted

- **WHEN** the generated playbook opener (sole-orchestrator rule) is inspected
- **THEN** it SHALL state that the LEAD does not author whole stage artifacts but MAY apply trivial inline fixes per Step E.2
- **AND** SHALL state those inline fixes are re-reviewed by a non-author

### Requirement: Child Pipeline Gate Semantics Under Portfolio Orchestration

Step G SHALL define how a `childPipeline`'s internal `gate: true` stages resolve under portfolio orchestration. "Proceeds automatically (no human gate)" SHALL be stated to govern the decompose decision only, not the children's own gates. Child gates SHALL resolve per the parent run's gate directive: an autonomously-launched parent run treats child gates as auto-continue checkpoints (recorded, not paused per child), unless the user requested gating, in which case they collapse into one per-child checkpoint. The precedence SHALL be stated: parent directive > child pipeline `gate`.

#### Scenario: child gates resolve by parent directive

- **WHEN** the generated Step G is inspected
- **THEN** it SHALL state that "proceeds automatically" governs the decompose decision only
- **AND** SHALL state that child pipeline gates resolve per the parent run's directive (auto-continue by default, or one collapsed per-child checkpoint if the user requested gating)
- **AND** SHALL state the precedence parent-directive over child-pipeline-gate

### Requirement: Loop-Stage Per-Role Threshold Resolution

The playbook SHALL state that inside a loop stage (which carries a single nominal `role` but dispatches reviewers, implementers, and fixers) the LEAD resolves each dispatched worker's handoff threshold by that worker's ACTUAL role (`handoff.roles[<dispatched role>]`), not by the loop stage's nominal `role`.

#### Scenario: reviewer inside a review-loop uses the reviewer threshold

- **WHEN** the generated Step E / Step H is inspected
- **THEN** it SHALL state that a worker dispatched inside a loop stage resolves its handoff threshold by its own role, not the loop stage's nominal role
- **AND** SHALL give the reviewer-in-review-loop case (reviewer threshold, not the stage's fixer threshold)

### Requirement: parallelGroup Tier-C Degradation

Step D's `parallelGroup` interpretation SHALL state that under Tier C (no subagent capability) the group's members run sequentially in the single context, collecting all results before proceeding — the collect-all-before-proceeding invariant holding across tiers.

#### Scenario: parallelGroup runs sequentially under Tier C

- **WHEN** the generated Step D parallelGroup rule is inspected
- **THEN** it SHALL state that under Tier C members run sequentially in one context and all results are collected before proceeding

### Requirement: Run-State Records Session Relay Generation

The canonical run-state example in Step F SHALL include `sessionHandoff.n` (the relay generation), so the session-relay generation cap (Step H.7, `maxRelays`) can trip. The example SHALL not omit `n`, since a `sessionHandoff` record without `n` reads as generation 1 and never advances.

#### Scenario: sessionHandoff carries a generation field

- **WHEN** the generated Step F run-state example is inspected
- **THEN** the `sessionHandoff` object SHALL include an `n` field
- **AND** SHALL note it is the relay generation capped by Step H.7 at `maxRelays`

