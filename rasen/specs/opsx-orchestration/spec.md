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
- **THEN** the worker SHALL invoke the stage's existing Rasen skill rather than reimplementing the stage logic

### Requirement: Capability Tiers Are Auto-Detected

The playbook SHALL consume the preflighted host runtime and dispatch modes, observe the collaboration capabilities available on that host, and choose execution mechanics accordingly while keeping the pipeline definition identical across tiers. Host identity SHALL decide which native adapter applies; capability tier SHALL decide whether that adapter can use warm continuation, fresh leaf spawning, or the single-context fallback.

#### Scenario: Tier A on Claude agent-teams

- **WHEN** the host is Claude and agent-teams provides role-isolated spawning plus agentId-based message continuation
- **THEN** the LEAD SHALL use the Claude-native adapter and MAY resume a specific worker via `SendMessage`
- **AND** only the LEAD SHALL originate `SendMessage`

#### Scenario: Tier A on Codex native collaboration

- **WHEN** the host is Codex and native spawn, messaging/follow-up, completion delivery, and event-driven wait tools are available
- **THEN** the LEAD SHALL use the Codex-native adapter for same-host stages
- **AND** SHALL use the Codex-specific completion and wait contract rather than Claude `SendMessage` semantics

#### Scenario: Tier B — spawn without warm continuation

- **WHEN** the selected native host can spawn leaf workers but cannot warm-continue a prior worker
- **THEN** the LEAD SHALL spawn a fresh worker per stage or round
- **AND** SHALL reconstruct each worker's context from the change directory and run-state

#### Scenario: Tier C — degraded fallback

- **WHEN** no compatible native subagent capability is available
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

Stages SHALL hand off through the change directory (review material: proposal, design, tasks, delta specs) and the change's work directory (process ephemera: reports, run-state, handoff documents — the `change-work-dir` capability), and the LEAD SHALL maintain a run-state record; `SendMessage` SHALL be used only for warm continuation, never as the inter-stage state channel. The LEAD SHALL resolve BOTH locations as absolute paths from `rasen status --change <n> --json` — the `changeRoot` field for review material and the `workDir` field for ephemera — before writing any blackboard artifact or run-state, so that all paths taught by the workflow are interpreted relative to the selected Rasen root (including a `--store`-selected store root) and never relative to the current working directory. When the payload carries no `workDir`, or when a given ephemeron already exists in the change directory, the LEAD SHALL use the change directory for that file (the sticky-legacy fallback of the `change-work-dir` capability). For a reconciler-engine run, run-state SHALL be bounded to operational bookkeeping the canonical Run does not model — worker handles and transcripts, gate-policy freeze, retention mode, strategy attempts, session-relay generation — plus clearly-labeled read-only projections of canonical facts; mechanical truth (stage status, rounds, phases, findings, outcomes) SHALL live in the canonical Run Record, and run-state SHALL never be read back to make a progression decision the Run owns. For a legacy run, run-state remains the authoritative record exactly as before.

#### Scenario: Durable handoff

- **WHEN** one stage's output feeds a later stage
- **THEN** the output SHALL be written to the change directory (review material) or the work directory (process ephemera) and read by the later worker
- **AND** the run SHALL survive a terminated worker or a new session because state lives on disk

#### Scenario: Run-state recorded

- **WHEN** the LEAD executes stages under the legacy engine
- **THEN** it SHALL record classification, selected pipeline, per-stage status, which worker handled each stage, review rounds, and open findings
- **AND** this record SHALL support resume and observability

#### Scenario: Reconciler-engine run-state carries bookkeeping, not mechanical truth

- **WHEN** the LEAD executes stages under the reconciler engine
- **THEN** run-state SHALL record the engine, worker handles, gate-policy freeze, retention mode, and strategy attempts
- **AND** stage/round/phase/finding/outcome facts SHALL be read from the canonical Run view
- **AND** any such facts mirrored into run-state SHALL be labeled as projection and SHALL NOT drive progression

#### Scenario: Run-state written to the work directory

- **WHEN** the LEAD starts recording run-state for a change with no pre-existing `auto-run.json` and the status payload reports a `workDir`
- **THEN** the LEAD SHALL write `auto-run.json` into that work directory
- **AND** `rasen pipeline resume <change>` resolved to the same root SHALL read the run-state (`hasRunState: true`)

#### Scenario: Run-state written to the selected root

- **WHEN** the change lives in a store-selected or non-cwd Rasen root
- **THEN** the LEAD SHALL write `auto-run.json` into the absolute location resolved from `rasen status --change <n> --json` (the work directory, or the change directory under the sticky-legacy fallback)
- **AND** `rasen pipeline resume <change>` resolved to that same root SHALL read the run-state (`hasRunState: true`)

### Requirement: Gate, Loop, Parallel, and Condition Interpretation

The LEAD SHALL interpret stage metadata: pause at gates, run loop stages as bounded loops (dispatching on `loop.kind`), run parallel-group stages concurrently, and skip stages whose condition is unmet. Under the reconciler engine, both loop kinds SHALL be driven through the canonical Run: the LEAD launches or resumes the Run, dispatches a role-isolated worker for each granted action, submits each result to the Run, and reads round, phase, findings, and outcome from the Run's view — the Run owns round counting, cap enforcement, actor separation, and termination for `review-cycle` exactly as it already does for `goal`. Under the legacy engine, the LEAD SHALL run the playbook's legacy loop protocol as before. The LEAD SHALL NOT keep an independent mechanical copy (round counters, cap checks, actor-separation verdicts, clean determinations) of any rule the canonical Run enforces.

#### Scenario: Gate pauses for the human

- **WHEN** a stage declares a `gate`
- **THEN** the LEAD SHALL pause after that stage, summarize what was done and what is next, and wait for human confirmation to continue, stop, or switch to manual

#### Scenario: Loop kind is dispatched

- **WHEN** a stage declares a `loop`
- **THEN** the LEAD SHALL narrow on `loop.kind`
- **AND** under the reconciler engine both `review-cycle` and `goal` SHALL be driven through the canonical Run's granted actions and view sections
- **AND** under the legacy engine `review-cycle` SHALL run the legacy bounded review→fix protocol and `goal` the legacy goal-loop protocol

#### Scenario: Review-cycle progression is owned by the canonical Run

- **WHEN** a `review-cycle` loop stage executes under the reconciler engine
- **THEN** rounds, phase order, the max-rounds cap, author ≠ verifier, and the clean/escalated outcome SHALL be enforced by the canonical Run
- **AND** the LEAD SHALL read them from the Run view's review-cycle section rather than tracking them itself
- **AND** a cap reached with open Blocker/Major findings SHALL surface as the Run's escalation, which the LEAD reports honestly

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

当 LEAD 执行一个 `decompose` 阶段时，它 SHALL 产出一份**拆分方案**，由一组子 change（每个都是可独立交付、可 review 的切片）和一个**依赖 DAG**（声明哪些子 change 必须先落地）组成。LEAD SHALL 在扇出之前自审这份方案（切片内聚性、任何并行同批的独立性依据，以及 DAG 的正确性），并且 MAY 在无人类确认下继续。仅当它无法产出一份安全方案时，它 SHALL 升级给人类。每个子 change SHALL 用 `rasen new change <semantic-name>` 创建，名称 SHALL 是语义化的 kebab-case 名（描述该切片交付什么）；调度用的节点 ID（如 `g-003` 一类）SHALL 只存在于组合运行状态的 metadata 中，SHALL NOT 进入 change 目录名（`file-placement` capability 的调度 ID 分离规则）。

#### Scenario: 在扇出前自审方案

- **WHEN** LEAD 为一个多交付物任务执行 decompose 阶段
- **THEN** 它 SHALL 产出一份方案，列出每个子 change 以及它们之间的依赖边
- **AND** 当方案安全时，它 SHALL 自审该方案并在无需人类确认的情况下开始扇出

#### Scenario: 父成为规划容器

- **WHEN** decompose 阶段被执行
- **THEN** 父 change 的其余流水线阶段 SHALL 被标记为 delegated，且 SHALL NOT 在父级运行
- **AND** 每个子 change SHALL 运行解析出的 `childPipeline`（propose → apply → verify → review-loop → …）

#### Scenario: 子 change 使用语义名称而非调度 ID

- **WHEN** LEAD 创建拆分方案中的子 change
- **THEN** 每个子 change 目录名 SHALL 是语义化 kebab-case 名称
- **AND** 调度节点 ID 只出现在组合运行状态的 metadata 字段中

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

LEAD SHALL 维护一份**组合运行状态**记录（其路径用平台 path 模块构建，其文件名作为具名常量跟踪），落点为 execution root 的 ephemera 目录（`file-placement` capability；sticky-legacy 链兼容已存在于旧位置的记录），记载拆分方案、子 change 列表、依赖 DAG、每个子 change 的执行模式与并行同批、每个子 change 的流水线状态，以及当前可运行前沿。每个子 change SHALL 保留它自己的、按 change 计的运行状态。组合运行状态在恢复时 SHALL 为权威；子目录与产物存在性是交叉校验。

#### Scenario: 组合状态记录 DAG 与每个子 change 的状态

- **WHEN** LEAD 执行一次已拆分的运行
- **THEN** 组合运行状态 SHALL 记录每个子 change 的状态以及子 change 之间的依赖边

#### Scenario: 恢复计算下一个可运行子 change

- **WHEN** `rasen pipeline resume <parent>` 针对一个已拆分的父 change 运行
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

### Requirement: Archive Stage Resolves Per the Archive Timing Axis

The playbook SHALL interpret a pipeline's archive stage per the resolved archive timing and the recorded delivery mode: under `in-ship` the LEAD records the archive stage as satisfied with the reason "archived in ship" and dispatches nothing; under `on-merge` with a `push`/`local` delivery the archive stage runs immediately as today; under `on-merge` with a `pr` delivery the LEAD dispatches archive, and when it returns an unmerged refusal the LEAD SHALL record the stage as `pending` with an awaiting-merge note (including the PR URL) in run-state and end the run cleanly surfacing the open frontier — never busy-waiting or polling. A later `pipeline resume` re-enters the stage and re-attempts the check-on-invocation.

#### Scenario: Unmerged PR parks the archive stage without failing the run

- **WHEN** an orchestrated run reaches the archive stage of an on-merge `pr`-delivered change and the merge check reports the PR still open
- **THEN** the LEAD SHALL record the archive stage as pending with an awaiting-merge note in run-state
- **AND** SHALL end the run cleanly, surfacing the awaiting-merge state rather than looping or failing

#### Scenario: Resume re-attempts the merge check

- **WHEN** `pipeline resume` runs later for that change
- **THEN** the archive stage SHALL be re-attempted, performing a fresh merge check on invocation

#### Scenario: In-ship archive stage is a recorded no-op

- **WHEN** an orchestrated run under `in-ship` timing reaches the archive stage after ship recorded the in-ship archive
- **THEN** the LEAD SHALL record the stage as satisfied with the archived-in-ship reason and dispatch no worker

### Requirement: Codex dispatch follows the resolved route

The orchestration playbook SHALL dispatch a Codex target according to the preflighted dispatch mode. A Codex-hosted `native` stage SHALL use the host's native collaboration tools and a role-isolated leaf worker. A Claude-hosted Codex `exec-bridge` stage SHALL use the shipped non-interactive `codex exec` contract. The playbook SHALL NOT substitute one mode for the other or re-derive a target runtime after pipeline execution inspection.

#### Scenario: Same-host Codex uses native collaboration

- **WHEN** a stage reports host Codex, target Codex, and dispatch mode `native`
- **THEN** the LEAD dispatches the leaf through the native Codex collaboration surface
- **AND** does not start a redundant `codex exec` process for that stage

#### Scenario: Claude-to-Codex keeps the verified exec bridge

- **WHEN** a stage reports host Claude, target Codex, dispatch mode `exec-bridge`, and bridge `codex-exec`
- **THEN** the playbook uses a `codex exec` invocation with stdin closed, `--json`, last-message capture, per-role sandbox/model/effort, the appended flat-hierarchy guard, and contract-schema-constrained returns
- **AND** template and skill bodies are inlined client-side rather than resolved from Codex prompt files

#### Scenario: Codex exec-bridge identity remains thread-based

- **WHEN** a Codex exec-bridge worker is recorded
- **THEN** its record carries `runtime`, role, dispatch mode, `threadId` captured from the JSON event stream, sandbox/model/effort metadata, and rollout path as the durable transcript pointer
- **AND** no turn id is fabricated for Codex exec mode

#### Scenario: Unsupported route never reaches dispatch

- **WHEN** execution preflight identifies an unsupported host × target pair
- **THEN** the playbook receives no executable stage for that pair
- **AND** does not silently substitute the host runtime for the explicit target

### Requirement: Claude exec-bridge dispatch follows the resolved route

The orchestration playbook SHALL dispatch a Claude target according to the preflighted route. A Codex-hosted stage reporting dispatch mode `exec-bridge` and bridge `claude-print` SHALL use the shipped `rasen agent dispatch --runtime claude` contract. Claude-native stages SHALL keep using the native Task/Agent lifecycle. Generic exec-bridge guidance SHALL distinguish Claude session IDs from Codex thread IDs.

#### Scenario: Codex-to-Claude uses the shipped bridge

- **WHEN** a stage reports host Codex, target Claude, dispatch mode `exec-bridge`, and bridge `claude-print`
- **THEN** the LEAD writes the fully inlined leaf prompt to a prompt file and invokes `rasen agent dispatch --runtime claude`
- **AND** passes the stage's result contract, model, effort, sandbox, and working directory without constructing a raw shell command

#### Scenario: Claude bridge completion records session identity

- **WHEN** the Claude bridge returns a successful structured receipt
- **THEN** the LEAD records runtime `claude`, dispatch mode `exec-bridge`, the returned `sessionId`, working directory, and any surfaced transcript/model/sandbox/effort metadata
- **AND** does not fabricate a native `agentId` or Codex `threadId`

#### Scenario: Claude bridge resumes explicitly

- **WHEN** the LEAD re-engages a completed Claude exec-bridge worker below its handoff threshold
- **THEN** it invokes the bridge with the worker's exact recorded `sessionId` and working directory
- **AND** does not use `SendMessage`, `--continue`, or a latest-session lookup

#### Scenario: Claude bridge failure follows worker-death accounting

- **WHEN** the bridge returns a timeout, CLI failure, protocol failure, or invalid contract receipt
- **THEN** the LEAD classifies and records the failure using that receipt before choosing retry, exact-session resume, or reconstruction
- **AND** never reports the stage clean from an unvalidated result

#### Scenario: Claude-native dispatch remains unchanged

- **WHEN** a stage reports host Claude, target Claude, and dispatch mode `native`
- **THEN** the LEAD continues to use the native Task/Agent, agentId, transcript, and SendMessage lifecycle
- **AND** does not start the external Claude bridge

### Requirement: Codex-native completion and synchronization are event-driven

For a Codex-native worker, the playbook SHALL treat the worker's final `DONE` or `HANDOFF` response as the completion channel automatically delivered to the parent mailbox. It SHALL reserve `send_message` for necessary intermediate coordination and SHALL NOT require a duplicate completion message. When the critical path depends on unfinished Codex-native workers, the LEAD SHALL use sparse event-driven synchronization: one long barrier-sized `wait_agent` call, woken by mailbox or user activity, rather than reflexively repeating short timeout waits. The LEAD SHALL wait again only when a meaningful wake has been consumed and required dependencies remain.

#### Scenario: Native final response completes the worker

- **WHEN** a Codex-native leaf returns its final structured `DONE` result
- **THEN** the LEAD consumes the automatically delivered completion
- **AND** the worker is not instructed to send an identical `DONE` through `send_message`

#### Scenario: Native handoff is delivered once

- **WHEN** a Codex-native leaf reaches a handoff trigger and returns `HANDOFF`
- **THEN** the LEAD accounts for that final result through the automatic completion channel
- **AND** no duplicate mailbox completion is required

#### Scenario: Critical-path wait is sparse

- **WHEN** the next action truly depends on an unfinished Codex-native worker
- **THEN** the LEAD issues one event-driven wait with a barrier-sized timeout
- **AND** does not poll worker status through repeated 30- or 60-second wait timeouts

#### Scenario: Independent work avoids unnecessary waiting

- **WHEN** the DAG has useful work that does not depend on the unfinished worker
- **THEN** the LEAD continues that work
- **AND** defers `wait_agent` until a real synchronization barrier

#### Scenario: Claude-native completion is unchanged

- **WHEN** a Claude-native stage is dispatched
- **THEN** the existing Task/agentId/transcript and proven `SendMessage` completion guidance remains in force
- **AND** the Codex-native automatic-final rule is not applied to it

### Requirement: Codex worker lifecycle follows the shipped signals

The orchestration playbook SHALL describe Codex worker continuation, revival, failure handling, occupancy, and parallelism in terms of the shipped, live-verified lifecycle semantics: resume by explicit thread id with sandbox fixed at thread creation (resume accepts no sandbox flag — changing sandbox requires a fresh thread); death detected from the rollout event log as an unterminated final turn, with an interrupted-worker revival notice on re-engagement; rate-limit failures retried with capped exponential backoff while model-not-available failures are surfaced as fatal and unrecognized failures escalate rather than being guessed; occupancy probed via `rasen agent context --transcript <rolloutPath>` under the same thresholds as Claude workers (a zero-turn rollout reading 0% is normal); and at most one concurrent writer per thread id.

#### Scenario: Resume guidance reflects creation-time sandbox

- **WHEN** the playbook describes re-engaging an existing Codex worker
- **THEN** it SHALL show resume by explicit thread id with the standard capture flags and stdin closed
- **AND** it SHALL state that the thread's sandbox is fixed at creation and cannot be overridden on resume

#### Scenario: Death and revival guidance

- **WHEN** the playbook describes detecting and reviving a dead Codex worker
- **THEN** it SHALL define death as the rollout's last turn-opening event lacking a completion or abort event
- **AND** it SHALL direct the LEAD to include the interrupted-worker revival notice (the last action may not have completed; re-verify state) in the revival message

#### Scenario: Failure classes drive distinct handling

- **WHEN** the playbook describes a failed Codex turn
- **THEN** it SHALL distinguish retryable rate-limit failures (retried with backoff on the order of 20 seconds, doubling, capped) from fatal model-availability failures (not retried) and unrecognized failures (escalated per the worker-death taxonomy)

#### Scenario: Occupancy and parallel discipline

- **WHEN** the playbook describes probing a Codex worker's context or running Codex workers in parallel
- **THEN** it SHALL probe with `rasen agent context --transcript <rolloutPath>` applying the existing threshold family unchanged
- **AND** it SHALL permit any number of independent single-thread workers while forbidding two concurrent writers on one thread id

#### Scenario: Session relay stays a LEAD-side mechanism

- **WHEN** the playbook's session-relay guidance is inspected
- **THEN** it SHALL note that a LEAD session relay does not disturb Codex workers — the successor session resumes their recorded thread ids — and SHALL NOT require any Codex-side relay mechanism

### Requirement: Codex project context passes by prompt reference

The orchestration playbook SHALL direct the LEAD to pass per-change context to Codex workers by naming the change-directory artifact paths in the dispatch prompt — a verified mechanism, workers genuinely read referenced files — and SHALL reserve repo-root AGENTS.md for repo-global conventions that apply to every worker, not per-change context. The playbook SHALL NOT rely on nested AGENTS.md auto-discovery (or worker working-directory placement) to inject change context.

#### Scenario: Change context by prompt reference

- **WHEN** the playbook shows a Codex dispatch prompt for a change
- **THEN** it SHALL name the change directory's artifact files (proposal/design/tasks) as paths the worker must read
- **AND** it SHALL present file reference as verified worker behavior rather than aspiration

#### Scenario: AGENTS.md scope guidance

- **WHEN** the playbook mentions AGENTS.md for Codex workers
- **THEN** it SHALL scope AGENTS.md to repo-global conventions and SHALL NOT direct the LEAD to relocate workers into change directories to trigger nested discovery

### Requirement: Message batching to a live worker
When the LEAD has several consecutive instructions for the same live (not parked) worker and does not need an intermediate result between them, the playbook SHALL direct the LEAD to combine them into a single `SendMessage` rather than sending them as separate messages — each `SendMessage` delivery rebases the worker's conversation and re-taxes its cache, so sending N instructions separately pays that cost N times for no benefit over paying it once.

#### Scenario: Two instructions with no intermediate result needed are batched
- **WHEN** the LEAD has two follow-up instructions ready for the same worker at the same time, and does not need the worker's response to the first before issuing the second
- **THEN** the LEAD SHALL send them as a single `SendMessage`, not two separate messages

#### Scenario: An instruction that depends on an intermediate result is not batched
- **WHEN** the LEAD's second instruction depends on the worker's response to the first
- **THEN** the LEAD SHALL send them as separate messages in sequence, since batching does not apply when an intermediate result is actually needed

### Requirement: Planning-Root and Execution-Root Blackboard

Stages SHALL hand off through durable files at the per-class landing locations of the `file-placement` capability: review material (proposal, design, tasks, delta specs, planning-context) under `changeRoot`; evidence (reports) under the payload's `evidenceDir`; handoff documents under `handoffDir`; run-state and other process ephemera under `ephemeraDir`. `SendMessage` SHALL be used only for warm continuation, never as the inter-stage state channel. The LEAD SHALL resolve every location as an absolute path from `rasen status --change <n> --json` (or the instructions payloads) before writing any blackboard artifact, so all paths are interpreted relative to the selected Rasen root — including a `--store`-selected store root — and never relative to the current working directory. The sticky-legacy chain applies to every ephemeron and report: a file that already exists at a legacy location (the machine-home work directory or the change directory) keeps living there; one file's state is never split across locations.

#### Scenario: Durable handoff

- **WHEN** one stage's output feeds a later stage
- **THEN** the output SHALL be written to its class's landing location and read by the later worker
- **AND** the run SHALL survive a terminated worker or a new session because state lives on disk

#### Scenario: Run-state recorded in the execution root

- **WHEN** the LEAD starts recording run-state for a change with no pre-existing `auto-run.json`
- **THEN** the LEAD SHALL write `auto-run.json` into the payload's `ephemeraDir`
- **AND** `rasen pipeline resume <change>` resolved to the same root SHALL read the run-state (`hasRunState: true`)

#### Scenario: Run-state resumes from a legacy location

- **WHEN** a change's `auto-run.json` already lives in the machine-home work directory or the change directory
- **THEN** the LEAD SHALL keep reading and writing that file in place
- **AND** SHALL NOT create a second run-state file in the ephemera directory

#### Scenario: Store-selected run writes to the selected root

- **WHEN** the change lives in a store-selected or non-cwd Rasen root
- **THEN** review material, evidence, and handoff SHALL be written to the absolute store-side locations from the payload, and ephemera to the execution root's ephemera directory
- **AND** `rasen pipeline resume <change>` resolved to that same root SHALL read the run-state (`hasRunState: true`)

### Requirement: Codex dispatch applies the resolved model and effort to an isolated worker

The orchestration playbook SHALL read each stage's final `model`, `modelSource`, `effort`, and `effortSource` from the execution view and SHALL pass present values to the selected Codex dispatch mechanism without re-deriving configuration. A Codex-native worker that receives a model or effort override SHALL be created without a full-history fork so the requested agent type and reasoning effort can take effect; the worker prompt SHALL seed the concrete change artifacts it needs. A Codex process worker SHALL run through `rasen agent dispatch --runtime codex` and SHALL be recorded with dispatch mode `exec-bridge`.

#### Scenario: Native Luna Max worker uses no-history creation
- **WHEN** a Codex-hosted stage resolves model `gpt-5.6-luna` and effort `max` and uses native dispatch
- **THEN** the LEAD creates the worker with those resolved values and without a full-history fork
- **AND** the prompt names the change artifacts that seed the isolated worker

#### Scenario: Native Terra worker uses the same configurable path
- **WHEN** a Codex-hosted stage resolves model `gpt-5.6-terra` and a supported effort and uses native dispatch
- **THEN** the LEAD forwards that exact model/effort pair with no model-family special case and without a full-history fork

#### Scenario: Arbitrary model override is forwarded unchanged
- **WHEN** a Codex-native or Codex process stage resolves an unknown non-empty model id
- **THEN** the LEAD forwards that id unchanged through the selected route
- **AND** it does not attempt model discovery or substitute a known Luna or Terra model

#### Scenario: Native override is not claimed on an inheriting fork
- **WHEN** a Codex-native worker requires a model or effort different from the parent
- **THEN** the playbook SHALL not use a full-history fork that inherits the parent's agent type, model, and effort

#### Scenario: Codex process route uses the shipped bridge
- **WHEN** the route matrix selects a Codex exec-bridge stage, or a caller explicitly requests a process-durable Codex thread
- **THEN** the LEAD invokes `rasen agent dispatch --runtime codex` with the resolved model and effort when present
- **AND** it accepts completion only from an `ok: true` structured receipt

#### Scenario: Existing same-host default remains native
- **WHEN** a Codex-hosted stage has no explicit process-thread request and the route matrix selects the ordinary same-host route
- **THEN** it remains a Codex-native dispatch and no new pipeline dispatch-mode field is required

### Requirement: Codex thread continuation is exact, structured, and batched

The orchestration playbook SHALL record a Codex bridge receipt's exact thread id, transcript when available, sandbox, model, and effort in the worker record. Every warm continuation SHALL call the same bridge with that exact thread id and the appropriate `leaf` or `evaluate` contract. When multiple consecutive instructions are ready and no intermediate result is needed, the LEAD SHALL combine them into one meaningful continuation so process startup and model context cost are not paid for microtasks. Separate independent threads SHALL remain dispatchable concurrently; one thread SHALL have one active writer.

#### Scenario: Later process resumes the exact worker thread
- **WHEN** a LEAD session restarts after recording a Codex bridge worker
- **THEN** the successor resumes the recorded thread id through `rasen agent dispatch --runtime codex --resume <threadId>`
- **AND** it does not use a native agent id, spawn label, or latest-thread lookup

#### Scenario: Completion-shaped continuation keeps its contract
- **WHEN** the LEAD asks a warm Codex thread to finish remaining tasks or evaluate a gate
- **THEN** it selects the corresponding shared structured contract and accepts only the validated receipt result

#### Scenario: Consecutive instructions are batched
- **WHEN** several instructions target the same warm thread and none depends on an intermediate answer
- **THEN** the LEAD combines them into one continuation rather than starting one process turn per microtask

#### Scenario: Parallel workers use independent thread ids
- **WHEN** independent Codex process stages run concurrently
- **THEN** each receipt records a distinct thread id and no thread receives concurrent continuations

