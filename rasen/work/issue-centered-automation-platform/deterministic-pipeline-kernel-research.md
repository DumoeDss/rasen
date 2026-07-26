# Executable Composite Pipeline 与确定性 Reconciler 研究

> 状态：方向研究已定稿；`0.1.5` 格式兼容切片已实现并合并；`0.1.6` 定位为
> Executable Composite Pipelines，后续仍需通过正式 Change proposal/spec/design
> 接受实现规格  
> 日期：2026-07-26  
> 修订：2026-07-26，范围从 review-cycle 个案扩展到 auto、goal、review-cycle
> 的统一 Pipeline 模型，并增加发布切片建议  
> 方向修订：2026-07-26，不再把语义统一拆分到 `0.1.6`/`0.1.7`；`0.1.6`
> 从第一天建立完整但受约束的 Change-level 执行骨架，并在同一版本内依次接入
> root DAG、ReviewCycle、GoalLoop、auto/goal/review-cycle 入口和 Change-level
> built-in Pipelines  
> 最终定稿：2026-07-26，将 Definition v2、Canvas、受约束的 Custom Composite、
> Compiler/Reconciler、canonical Run Record 与 Change-run Operations 视为同一
> 产品范式的不可拆闭环，全部纳入 `0.1.6`  
> 实施回写：2026-07-26，记录 Pipeline 内容格式 v1、两轮独立评审、安全修复、
> PR #79 合并，以及 PR #80 完成 spec 同步与 Change 归档  
> 范围：当前 Rasen Pipeline/Canvas、`rasen-auto`、`rasen-goal`、
> `rasen-review-cycle`、`GrokBuild.SKILL.md`，以及 `north-star.md` 对这些研究的
> 再次校准

## 0. 结论摘要

本研究最初从 `review-cycle` 的拆分开始，但进一步核对现有 `auto`、`goal` 和
共享 orchestration source 后，结论应提升为：

> `auto` 和 `goal` 不应是两类执行器。唯一的一等执行对象应是可层级组合的
> `PipelineDefinition`；review-cycle 和 goal-loop 是可展开的 Composite，
> auto 是选择并启动 Pipeline 的策略。

统一模型可以概括为：

```text
PipelineDefinition = Graph<Node>

Node =
  AtomicStage
  Composite
  BoundedLoop
  Choice
  FanOut / Join
  Gate
  Finish
```

其中：

- `small-feature`、`full-feature`、goal pipeline 等是 root Pipeline 模板；
- `ReviewCycle`、`GoalLoop` 是可复用、可展开的小 Pipeline；
- `BoundedLoop` 重复执行一个 Composite，并拥有明确 limits 和 exits；
- `rasen-auto` 是 Dispatch/Launch Policy，不拥有另一套 runtime；
- `rasen-goal` 是 completion contract/preset 的入口，不拥有另一套 runtime；
- 所有 root Pipeline 和 Composite 都由同一个 Execution Reconciler 推进。

这套新范式正式称为 **Executable Composite Pipeline（可执行复合 Pipeline）**：

> 一种可声明、可层级组合、可执行、可恢复、可观察和可控制的 Pipeline。普通
> 控制依赖保持 DAG；反馈通过拥有明确 limits、typed outcomes、evidence 和恢复
> 边界的 `BoundedLoop` 表达；全部机械推进由 `Pipeline Reconciler` 根据
> immutable Run Plan 与 committed Run Record 决定。

术语分层：

- **Executable Composite Pipeline**：完整产品范式；
- **Pipeline Definition v2**：公开的层级定义与 Custom Composite contract；
- **Composite**：可复用的嵌套执行单元；
- **BoundedLoop / Bounded Feedback Scope**：有界反馈控制原语；
- **Pipeline Reconciler**：确定性控制内核；
- **Canvas**：Definition/authoring plane；
- **Operations**：Run observation/control plane。

此次方向修订进一步锁定：

> `0.1.6` 不发布一个只接管 `review-loop` 的局部 runner。root Pipeline 与嵌套
> Composite 必须从第一次 reconciler-engine Run 起就由同一个 Reconciler、同一个
> immutable Change Run Plan 和同一个 canonical Run Record 所有；ReviewCycle
> 是第一个复杂垂直证明，GoalLoop 是同一版本内的第二个真实消费者，auto/goal/
> review-cycle 入口在该版本内收敛成 launcher/preset/compatibility adapter。

这里的“整体框架先行”不是先建设无人使用的通用工作流平台，而是先锁定完整的
Change-level 产品闭环，再让每一种能力同时贯穿 Definition、Canvas、Compiler/
Reconciler、Run Record 与 Operations，并立即由真实 Pipeline 证明：

```text
Definition v2 / Custom Composite
        │
        ▼
Canvas authoring ──> Compiler / immutable ChangeRunPlan
                              │
                              ▼
                       Pipeline Reconciler
                              │
                              ▼
                    canonical Run Record
                              │
                              ▼
                    Change-run Operations

每种原语都纵向贯穿上述闭环，并由 built-in/custom Pipeline dogfood。
```

可以把当前 `review-cycle` 从一个“大提示词 workflow”拆成 Pipeline 中的对象，
但不应通过允许顶层 Pipeline 出现任意回边来实现。

更稳健的模型是：

```text
顶层 Pipeline：仍然是 DAG

verify ──> [ review-loop：有界 Composite/Loop Stage ] ──> ship
                       │
                       ├─ clean ───────────────> 正常出口
                       ├─ exhausted/stalled ───> escalated 出口
                       ├─ blocked ─────────────> 等待决策或升级
                       └─ failed/cancelled ────> 失败或终止出口
```

`review-loop` 内部不是一个黑盒提示词，而是一个有类型、有状态、可恢复的作用域：

```text
review
  -> triage
  -> fix
  -> delta re-review
  -> decide
       ├─ clean      -> exit
       ├─ needs_fix  -> 下一轮 review
       └─ escalate   -> exit
```

这里的“回到下一轮”由执行内核推进，不是 Canvas 中一条普通依赖边，也不由 LEAD
根据长提示词临场解释。

对 GrokBuild 的结论是：应借用它的执行语义，不应照搬 Rhai。

值得借用的部分包括：

- 控制流只依赖不可变输入和已提交结果；
- Agent 返回结构化、可校验结果；
- `parallel()` 是有预算约束的 barrier；
- 运行定义与参数在一次 Run 内不可变；
- journal 只在外部调用结果返回后提交；
- 使用 fingerprint 检测无进展；
- 证明型 Gate 缺证据时 fail closed；
- Agent 做判断，脚本执行不变量。

Rasen 更适合的形态是：

```text
声明式 Pipeline / Canvas
        │
        ▼
静态校验与最小编译
        │
        ▼
不可变 Change Run Plan + 来源 revision/hash
        │
        ▼
小型确定性 Execution Reconciler
        │
        ├─ Project Runtime
        ├─ Agent Backend
        ├─ Command / Gate Adapter
        └─ Evidence / Run Record
```

最关键的 north-star 校准是：不要建设无限制的通用工作流平台，但也不要让一个
`review-loop` 子运行与 prompt-owned 外层 DAG 形成两个状态所有者。第一条实现
切片先用 `bug-fix` 证明统一 root runner 的最小骨架与 adaptive verify 的显式
outcome routing，再用 `small-feature` 的
`review-loop` 证明可恢复、可证明的 Composite；随后在同一个 `0.1.6` 中用
`goal-loop` 验证共同抽象，并接入 `full-feature` 的 condition/FanOut/Join。
每一步都必须同时交付相应的 v2 definition、Canvas authoring、runtime 语义和
Operations projection。开放式脚本、递归调用和 nested loop 仍不进入首版。

发布上不建议把新范式塞回 `0.1.5`，也不建议把 `0.1.6` 扩张到 portfolio、
Issue 平台、任意脚本和无界 authoring：

```text
0.1.5  当前管理平台闭环 + Pipeline 格式版本/兼容边界
0.1.6  Executable Composite Pipelines：
       Definition v2 + Canvas + Custom Composite + Reconciler + Operations
       + ReviewCycle/GoalLoop + 统一入口 + Change-level built-ins
0.1.7  不预留任何使上述范式成立所必需的能力；仅按 0.1.6 真实证据安排增强
0.2.0  Issue Execution Plan + auto-decompose 上移到 Dispatch/Planning Domain
```

其中 `0.1.5` 一行已经从建议变成已完成事实：产品 PR
[#79](https://github.com/DumoeDss/rasen/pull/79) 已合并到 `dev/0.1.5`，随后
归档/spec 同步 PR [#80](https://github.com/DumoeDss/rasen/pull/80) 也已合并。
这次实现只建立内容格式与兼容边界，没有引入程序化 Pipeline runner，因此为
`0.1.6` 直接建立统一 Change-level runner 留出了干净版本边界。

最终目标不是弱化提示词，而是把提示词收缩到它最擅长的判断 seam：

> 程序决定“何时、按什么约束、执行哪一步”；Agent 判断“代码意味着什么、问题
> 是否成立、怎样修改、证据是否足够”。

## 1. 研究问题与证据范围

本研究回答六个问题：

1. 当前 Canvas 是否只能线性处理，为什么不能直接添加循环边？
2. `review-cycle` 能否拆成 Pipeline 中可编排、可观察的对象？
3. `auto`、`goal`、`review-cycle` 是否只是同一执行模型的不同投影？
4. GrokBuild 能否帮助 Rasen 从“声明式 Pipeline + 极强提示词编排”演进到
   “声明式 Pipeline + 小型确定性内核 + 专注判断的代理”？
5. 这条路线是否符合 Rasen 的 north-star，实施顺序应该如何修正？
6. 哪些能力应进入 `0.1.5`、`0.1.6` 及后续版本？

主要证据：

- `src/core/pipeline-registry/types.ts`
- `src/core/pipeline-registry/pipeline.ts`
- `src/core/pipeline-registry/graph.ts`
- `src/core/pipeline-registry/run-state.ts`
- `src/commands/pipeline.ts`
- `src/core/templates/workflows/_orchestration.ts`
- `src/core/templates/workflows/auto.ts`
- `src/core/templates/workflows/goal-command.ts`
- `src/core/templates/workflows/review-cycle.ts`
- `.codex/skills/rasen-auto/SKILL.md`
- `.codex/skills/rasen-goal/SKILL.md`
- `.codex/skills/rasen-review-cycle/SKILL.md`
- `pipelines/auto-decompose/pipeline.yaml`
- `pipelines/goal-loop-measure/pipeline.yaml`
- `pipelines/goal-loop-evaluate/pipeline.yaml`
- `pipelines/goal-loop-research/pipeline.yaml`
- `pipelines/small-feature/pipeline.yaml`
- `pipelines/full-feature/pipeline.yaml`
- `packages/ui/src/canvas/draft.ts`
- `packages/ui/src/canvas/PipelineCanvasPage.tsx`
- `src/core/codex/contracts.ts`
- `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\GrokBuild.SKILL.md`
- `rasen/work/issue-centered-automation-platform/north-star.md`
- `rasen/work/issue-centered-automation-platform/current-capabilities-0.1.5.md`
- `rasen/changes/archive/2026-07-26-pipeline-definition-api/`
- [PR #79：Pipeline 内容格式 v1](https://github.com/DumoeDss/rasen/pull/79)
- [PR #80：spec 同步与 Change 归档](https://github.com/DumoeDss/rasen/pull/80)

## 2. 当前 Pipeline 并非严格线性，而是 DAG-only

把当前 Canvas 称作“只能线性处理”在产品体验上可以理解，但在数据模型上并不
完全准确。当前 Pipeline 已经支持：

- 多个 `requires`；
- 分支；
- 汇合；
- `parallelGroup`；
- 按已完成依赖计算 ready frontier；
- 稳定排序的拓扑执行顺序。

`PipelineGraph.getBuildOrder()` 使用 Kahn 拓扑排序，
`getNextStages(completed)` 根据依赖是否完成返回 ready stages
（`src/core/pipeline-registry/graph.ts:71-133`）。

真正的限制是：它是一个**严格无环的有向图**。

- 服务端解析 Pipeline 时显式调用 `validateNoCycles`
  （`src/core/pipeline-registry/pipeline.ts:35-42`）；
- DFS 检测到回边后抛出 `Cyclic dependency detected`
  （`src/core/pipeline-registry/pipeline.ts:145-188`）；
- Canvas 连接前调用 `wouldCreateCycle`
  （`packages/ui/src/canvas/draft.ts:143-152`）；
- UI 直接拒绝会形成环的连线
  （`packages/ui/src/canvas/PipelineCanvasPage.tsx:350-357`）。

所以更准确的描述是：

> 当前 Canvas 能编排 DAG，但不能表达具有运行时状态和退出语义的反馈循环。

这不是单纯放开前端连线限制就能解决的问题。当前调度器以“stage 是否已经完成”
为核心状态；一旦允许普通回边，“完成过的节点是否要重新打开、哪一轮、使用哪次
输出、下游是否需要失效”都没有定义。直接允许环会同时破坏：

- 拓扑排序；
- ready frontier；
- completed set 的含义；
- resume 的下一节点计算；
- stage artifact 的身份；
- retry 与新一轮执行的区别；
- 下游已经完成结果的有效性。

因此不建议把任意 cyclic graph 作为 Pipeline 的基础模型。

## 3. 当前 review-cycle 已“声明循环”，但没有“执行循环”

当前 Rasen 已经迈出了半步：

- `StageLoopSchema` 有 `review-cycle` 和 `goal` 两种 loop kind；
- `review-cycle.maxRounds` 默认是 3
  （`src/core/pipeline-registry/types.ts:207` 附近）；
- `small-feature`、`full-feature` 和 `auto-decompose` 都把 `review-loop`
  声明成一个带 `loop.kind: review-cycle` 的 stage；
- `ship` 依赖这个 `review-loop`。

例如 `small-feature` 的外层定义是：

```yaml
- id: review-loop
  skill: rasen-review-cycle
  role: fixer
  requires: [verify]
  loop:
    kind: review-cycle
    maxRounds: 3

- id: ship
  skill: rasen-ship
  requires: [review-loop]
```

但执行语义主要仍写在 `_orchestration.ts` 和 skill 的长提示词里。当前 LEAD 需要
阅读并执行如下协议：

1. 派 reviewer 做 review；
2. 按修复规模 triage；
3. 把修复路由给 implementer 或独立 fixer；
4. 捕获 fix delta；
5. 由非作者 re-review；
6. 判断 clean、继续下一轮或执行 escalation ladder；
7. 维护 round、relay、stall、blocked streak、worker 生命周期和 report。

Pipeline runtime 看到的仍是一个原子 stage。也就是说：

```text
声明层知道“这是循环”
运行层却不知道“循环目前在哪一步”
```

这会产生四类成熟度缺口：

1. **控制流不够确定**  
   轮次、退出、策略重试、worker 重用和升级依赖 LEAD 正确理解提示词。

2. **状态粒度过粗**  
   resume 只能看到 `review-loop` 的整体状态，无法自然回答当前是第几轮、
   正在 fix 还是 re-review、哪一个 finding 尚未闭合。

3. **证据是报告，不是运行契约**  
   `review-cycle-report.md` 很有价值，但 Markdown 不应承担下一状态计算。

4. **Canvas 声明与真实行为不等价**  
   Canvas 展示一个节点，实际运行却是多个角色、多轮调用和多个退出分支。

## 4. 推荐对象模型：顶层 DAG + 有界 Composite Loop

### 4.1 为什么 Loop 应是作用域，而不是普通边

循环需要拥有普通 dependency edge 不具备的语义：

- round identity；
- 每轮输入和输出；
- 最大轮次；
- stall 检测；
- blocker 连续计数；
- 外部调用预算；
- 每种退出原因；
- 退出后是否允许下游继续；
- 本轮产生的 evidence；
- crash 后从哪个原子边界恢复。

因此应该引入 `LoopStage` 或更一般的 `CompositeStage`。顶层图仍然无环；循环的
“回边”是作用域内部的控制语义，由 Reconciler 解释。

### 4.2 Review-loop 内部对象

建议至少显式化以下逻辑对象：

| 对象 | 类型 | 职责 |
| --- | --- | --- |
| Review | judgment invocation | 对当前 review target 产出结构化 findings |
| Triage | judgment invocation | 判定 finding 有效性、严重度、修复规模与修复角色 |
| Fix | effectful invocation | 修改代码并产出精确 delta 与 tree identity |
| Re-review | independent judgment | 由非作者验证本轮修复，不重新自证 |
| Decide | pure policy | 根据结构化结果决定 clean、next round 或 escalate |
| Report projection | pure projection | 从 Run Record 生成 `review-cycle-report.md` |

`Decide` 不应是一个“让 Agent 决定下一步”的节点。Agent 可以判断 finding 是否
成立、是否解决；程序根据已验证结果和策略决定下一状态。

### 4.3 最小数据契约

第一版不需要先发明完整的通用 typed-port 语言，但 review-loop 内部必须停止
依赖自由文本猜测。最小契约可以包含：

```ts
type Finding = {
  id: string
  severity: "blocker" | "major" | "minor" | "trivial"
  location?: string
  claim: string
  evidence: EvidenceRef[]
  status: "open" | "resolved" | "accepted_known" | "invalid"
}

type TriageDecision = {
  findingId: string
  disposition: "fix_inline" | "route_author" | "route_fixer" | "reject"
  rationale: string
}

type FixResult = {
  findingIds: string[]
  actor: ActorRef
  beforeTree: string
  afterTree: string
  deltaRef: ArtifactRef
  tests: EvidenceRef[]
}

type VerificationResult = {
  findingId: string
  verdict: "resolved" | "still_open" | "regressed" | "inconclusive"
  verifier: ActorRef
  evidence: EvidenceRef[]
}
```

每个结果都经过 schema 校验后才能 commit。自由文本 summary 可以保留，但不能
替代控制字段。

### 4.4 Loop 状态

建议的最小持久状态：

```json
{
  "loopId": "review-loop",
  "round": 2,
  "phase": "re-review",
  "outcome": null,
  "openFindingIds": ["F-7"],
  "acceptedKnownFindingIds": ["F-3"],
  "roundFingerprint": "sha256:...",
  "stallStreak": 0,
  "blockedStreak": 0,
  "strategyAttempts": 1,
  "activeInvocationId": "review-loop/r2/re-review#a1",
  "lastCommittedEvent": 48
}
```

稳定的 invocation identity 很重要，例如：

```text
review-loop/r2/review#a1
review-loop/r2/fix:F-7#a1
review-loop/r2/re-review:F-7#a1
```

它把“同一轮的重试”和“进入下一轮”区分开，也为幂等检查和恢复提供锚点。

### 4.5 退出语义必须声明完整

`maxRounds` 不是唯一逃生出口。至少需要：

| 退出 | 触发条件 | review-cycle 的下游语义 |
| --- | --- | --- |
| `clean` | Blocker/Major 均由非作者确认关闭 | stage 成功，允许 ship |
| `exhausted` | 达到 `maxRounds` 仍有高等级 finding | escalated，禁止 ship |
| `stalled` | 连续 N 轮 finding fingerprint 无实质变化 | 执行显式策略或 escalated |
| `blocked` | 同一 blocker 连续达到阈值 | 等待 guidance 或 escalated |
| `human_required` | 需要授权、产品或设计决策 | suspend，记录等待谁和什么 |
| `failed` | schema、runtime 或必需 Gate 失败 | fail closed，可按策略重试 |
| `cancelled` | 用户或系统取消 | terminal cancelled |

当前提示词在普通轮次 cap 后还有 strategy ladder。内核化时不能让它变成隐含的
“其实超过 3 轮”。应把它单独声明为：

```yaml
maxRounds: 3
onExhausted:
  strategyBudget: 2
  requireMaterialChange: true
  then: escalate
```

这样“3 个 review rounds”和“最多 2 次策略改道”是两个不同计数器，用户和
Operations 都能解释实际消耗。

不同 loop 的终止策略也不能被硬编码成一个规则：

- review-cycle 未清洁时必须阻止 ship；
- research goal-loop 达到轮次上限后可以进入 report tail，但必须标记
  `maxRounds-exhausted`；
- 能否交付由具体 Change Pipeline 的 exit policy 决定，不能把
  “循环结束”误当成“目标成功”。

## 5. 提示词与执行内核的职责重分配

当前 orchestration prompt 同时承担了业务判断、机械状态机、资源控制、恢复协议
和证据格式。成熟方向不是删除 prompt，而是把不变量移出 prompt。

| 当前提示词中的规则 | 未来归属 | 原因 |
| --- | --- | --- |
| 下一步执行 review、fix 还是 re-review | Reconciler | 机械推进必须可复现 |
| `maxRounds`、stall、blocked streak | Reconciler | 预算和逃生出口不能靠记忆 |
| author != verifier | Runtime identity constraint | 质量不变量必须可检查 |
| open Blocker/Major 时禁止 clean/ship | Exit policy / Gate | 必须 fail closed |
| round 与 relay 是不同计数器 | Run model | 必须持久、可解释 |
| worker 失败、重试、恢复 | Project Runtime / Agent Backend | 基础设施职责 |
| 输出是否满足 schema | Backend / result validator | 不接受自由文本猜状态 |
| finding 是否真实、严重度是什么 | Reviewer Agent | 需要语义判断 |
| 修复属于 trivial、non-trivial 或 design-level | Triage Agent | 需要上下文判断 |
| 怎样修改代码 | Implementer/Fixer Agent | 创造性与工程判断 |
| 修复是否真的关闭 finding | 独立 Verifier Agent | 独立语义评估 |
| 工具使用、审查 rubric、证据要求 | Leaf capability prompt | 提示词的核心价值 |

未来的 leaf prompt 仍应很强，至少包括：

- 自包含上下文；
- 明确 tool/evidence 要求；
- capability mode；
- 输入 artifact refs；
- 输出 schema；
- 空结果必须满足的证据；
- 不确定性如何表达；
- 禁止越界的范围。

但 prompt 不再决定：

- Pipeline 下一 stage；
- 是否进入下一轮；
- 预算是否耗尽；
- 是否允许 ship；
- resume 从哪里开始；
- 某个 stage 是否已经完成。

## 6. GrokBuild 研究

### 6.1 GrokBuild 已证明什么

`GrokBuild.SKILL.md` 展示了一个很有价值的中间形态：

```text
确定性脚本
  + agent()/parallel()/phase()/complete()
  + 结构化 agent output
  + budget
  + pause/await_user
  + journal resume
  + fingerprint
```

它最重要的设计判断不是 Rhai，而是：

> Agents don't enforce your invariants — scripts do.

这正好击中了 Rasen 当前“大提示词 orchestration”的薄弱点。Prompt 可以要求
Agent 只审查某个目录、最多运行三轮、不得由作者自证，但只有执行程序过滤范围、
计数、检查 actor identity 并控制出口，这些约束才真正成立。

GrokBuild 还有几项值得直接吸收的语义：

1. `agent()` 的失败是结构化数据，基础设施失败才抛异常；
2. `output_schema` 把 Agent 判断变成可验证输入；
3. `parallel()` 返回稳定输入顺序并充当 barrier；
4. panel 在预算不足时原子拒绝，不出现“只启动一半”；
5. `fingerprint()` 支持确定性的 stall 检测；
6. 证明型 verification 缺证据时不计为通过；
7. resume 使用原始不可变 script 与 args；
8. journal 只记录已经返回的 host-call result。

### 6.2 不应照搬的部分

GrokBuild 自己也明确暴露了边界：

- `validate_only` 只执行 canned result 选中的单一路径，不覆盖所有分支；
- journal 只支持 same-process paused run 的有效 resume；
- 进程退出时 active run 变成 `Interrupted`；
- 外部 effect 不是 exactly-once；
- workflow 不能调用 workflow；
- `parallel()` 没有较低的并发 throttle；
- 不能 race、stream 或为单次调用设置 timeout；
- imperative Rhai 不适合 Canvas 的静态解释和可视化；
- `phase()` 的元数据与实际调用甚至可能拼写不一致而无人阻止。

这些限制说明 Rasen 不应把 Rhai 当作最终 Pipeline 语言。Canvas/YAML 需要：

- 静态可检查的结构；
- 稳定 ID；
- 明确数据与控制依赖；
- 可展示的嵌套作用域；
- 可枚举的终态；
- durable cross-process recovery；
- Project Runtime 与 Agent Backend seam；
- 与 Change evidence 的一致身份链。

### 6.3 Adopt / Adapt / Reject

| GrokBuild 能力 | Rasen 决策 |
| --- | --- |
| 结构化 Agent result | Adopt |
| immutable run definition/args | Adopt，但记录来源 revision/hash |
| host-call journal | Adopt，升级为跨进程 durable Run Record |
| deterministic control from inputs/results | Adopt |
| budget 原子 admission | Adopt |
| barrier parallelism | Adopt，增加 throttle/timeout/cancel |
| fingerprint stall detection | Adopt |
| capability mode | Adopt，由 Project Runtime 强制 |
| fail-open advisory / fail-closed proof | Adopt |
| Rhai imperative script | Reject as primary definition |
| arbitrary scripting for control flow | Reject for v1 |
| same-process-only resume | Replace |
| workflow nesting | Replace with scoped Composite Stage |
| exactly-once 外部 effect 假设 | Reject；使用幂等身份与 reconcile |

## 7. Executable Composite Pipeline：auto、goal 与 review-cycle 的重新定位

### 7.1 当前代码已经隐含了统一模型

`auto`、`goal` 和 `review-cycle` 表面上是三个用户入口，实际上已经从同一个
`_orchestration.ts` canonical source 生成。当前 feature set 是：

```ts
AUTO_FEATURES = {
  persistentPlanner: true,
  stageMetadata: true,
  reviewLoop: true,
  goalLoop: true,
  portfolio: true
}

GOAL_FEATURES = {
  persistentPlanner: false,
  stageMetadata: true,
  reviewLoop: false,
  goalLoop: true,
  portfolio: false
}

REVIEW_CYCLE_FEATURES = {
  persistentPlanner: false,
  stageMetadata: false,
  reviewLoop: true,
  goalLoop: false,
  portfolio: false
}
```

见 `src/core/templates/workflows/_orchestration.ts:967-995`。

这说明它们并不是三套真正独立的 runtime，而是同一份提示词执行系统的三个
feature projections。

`goal-command.ts` 也明确说明：

```text
classify task
  -> select ONE goal-loop pipeline
  -> drive it via the SAME orchestration playbook
```

`auto.ts` 则明确说 Pipeline DAG 来自 registry，playbook 是 registry-agnostic。
因此，把它们收敛到同一个程序化 Reconciler 不是推翻当前方向，而是把已经存在的
概念统一从 prompt 层下沉到 runtime 层。

### 7.2 唯一的一等执行对象

目标模型应是：

```text
PipelineDefinition = Graph<Node>

Node =
  AtomicStage
  CompositeRef
  BoundedLoop
  Choice
  FanOut
  Join
  Gate
  Finish
```

含义：

| Node | 作用 |
| --- | --- |
| `AtomicStage` | 调用一个 Agent、command、tool 或 adapter |
| `CompositeRef` | 调用一个有类型输入、输出和 outcome 的子 Pipeline |
| `BoundedLoop` | 在 limits 内重复运行一个 Composite |
| `Choice` | 根据结构化结果选择一个分支 |
| `FanOut/Join` | 受预算和并发约束的并行与 barrier |
| `Gate` | 确定性验证或显式人工等待 |
| `Finish` | success、exhausted、escalated、failed、cancelled |

`ReviewCycle` 不是一种特殊 stage kind，而是：

```text
BoundedLoop {
  body: CompositeRef("review-cycle-body")
  until: no_open_major_findings
  limits: ...
  exits: ...
}
```

`GoalLoop` 同样是：

```text
BoundedLoop {
  body: CompositeRef("goal-iteration-body")
  until: measure_passed | evaluation_satisfied
  limits: ...
  exits: ...
}
```

两者共享 loop lifecycle、round identity、journal、stall/blocked、resume 和 budget，
只在输入契约、判断能力与 exit policy 上不同。

### 7.3 Auto 不再是执行器

当前 `rasen-auto` 混合了：

- 任务分类；
- Pipeline 选择或在线组合；
- gate/autonomy policy；
- Agent runtime/profile；
- Pipeline stage 推进；
- worker lifecycle；
- resume/retry/handoff；
- portfolio/decompose。

目标上应拆成：

```text
Dispatch / Launch Policy
  选择 root Pipeline，必要时提出组合方案

Run Policy
  gates、Agent profiles、预算、权限、并发

Pipeline Definition
  真正的业务执行图

Execution Reconciler
  stage、Composite、Loop、恢复和终态

Evidence Projection
  report、timeline、Canvas/Operations 运行视图
```

因此未来可以只有一个执行入口：

```text
run(rootPipeline, inputs, runPolicy)
```

`rasen-auto` 可以保留为：

```text
selectionPolicy = classify | compose | manual
```

的 UX alias。它选择并冻结 root Pipeline 后，不再拥有一套独立执行协议。

### 7.4 Goal 不再是执行器

`goal` 的真正差异是 work product 与 completion contract：

| Variant | Work product | Completion contract | Tail |
| --- | --- | --- | --- |
| measure | code/artifact | command score/threshold | ship/archive |
| evaluate | code/artifact | independent rubric evaluation | ship/archive |
| research | document | independent rubric evaluation | report |

这些都可以由 Pipeline 数据表达。`rasen-goal` 可以继续作为选择
`goal-loop-measure/evaluate/research` 模板的快捷入口，但不再拥有另一套 runner。

不能删除 goal 的完成语义；应该删除的是“goal 需要另一类执行器”的假设。

### 7.5 三层图不能被压扁成一个巨型 Pipeline

统一图语言不等于统一领域层级。north-star 仍要求：

```text
Issue Execution Plan
  ├─ Change A
  │    └─ Change Pipeline Run
  │         └─ ReviewCycle Composite
  └─ Change B
       └─ Change Pipeline Run
            └─ GoalLoop Composite
```

三个层级分别是：

1. **Issue Execution Plan graph**：节点是 Changes，处理跨项目依赖；
2. **Change Pipeline graph**：节点是 stage/Composite，处理一个 Change 的执行；
3. **Composite internal graph**：处理 review、goal 等局部有界流程。

它们可以复用 Graph、Reconciler 和 projection 基础设施，但：

- 身份不同；
- 事务与恢复边界不同；
- evidence 归属不同；
- 完成语义不同；
- 不能通过一个万能 workflow 模糊领域边界。

特别是当前 `auto-decompose`：

- 当前实现把它放在 Change Pipeline 的前置 `decompose` stage；
- north-star 目标模型中，它产生多个 Changes 和依赖，应逐步上移到
  Dispatch/Execution Plan；
- 每个 child Change 仍拥有自己独立的 Pipeline Run；
- 这项上移依赖 Issue/Execution Plan，不属于最初的 Change-level Composite
  runner 切片。

### 7.6 哪些内容不应出现在 Canvas 中

Canvas 应表达业务控制流，而不是把所有 runtime 机制都画成节点。以下内容属于
cross-cutting Run Policy 或 adapter：

- keepalive；
- context handoff；
- transcript/thread resume；
- Agent backend 选择；
- sandbox；
- retry/idempotency；
- timeout；
- budget admission；
- concurrency throttle；
- journal commit。

它们可以在 Pipeline/Stage policy panel 中配置或在 Operations 中观察，但不应
成为要求用户手工连线的业务节点。

### 7.7 层级组合必须受约束

为了避免从 DAG-only 跳到任意工作流语言，建议锁定：

- root Pipeline 的控制依赖仍是 DAG；
- Composite call graph 无递归；
- 只有 `BoundedLoop` 可以重复执行；
- v1 不允许 nested loop；
- 每个 Loop 必须声明 limits、stall/blocked policy 和所有 exits；
- Composite 必须声明 typed inputs、outputs、outcomes；
- parent 必须显式映射 child outcomes；
- root 与每个 Composite reference 都冻结 revision/digest；
- node identity 是层级化的，例如
  `root/review-cycle/r2/fix:F-7#a1`；
- 旧 `stage.loop.kind` 通过兼容 compiler 归一化为新的 Composite Run Plan，
  不要求已有用户 Pipeline 立即重写。

### 7.8 设计通用，实施垂直

方向修订后，应把“review-cycle 先行”更准确地表述为：

```text
错误做法：
  先实现 review-cycle 专用 runtime
  再推翻它设计通用 Composite

同样错误：
  先实现无限制 IR、全部 Loop、远程 runtime 与 Issue 调度
  最后才跑一次真实 review

推荐做法：
  先锁定完整但最小的 Executable Composite Pipeline 产品闭环
  每增加一种原语，同时交付 Definition、Canvas、Runtime 与 Operations
  用 bug-fix 证明 root DAG/Gate/resume 与 adaptive Choice
  用 small-feature 证明 ReviewCycle Composite
  用 GoalLoop 证明共同 BoundedLoop 语义
  用 full-feature 证明 condition/FanOut/Join
```

也就是：

> 产品闭环从第一天完整统一，能力由一组端到端垂直切片生长；不是先写完 runtime
> 再补 Canvas/Operations，也不是先交付局部 runner 再更换状态所有权。

`ReviewCycle` 与 `GoalLoop` 是同级 Composite，但 `auto` 不是第三种 Composite：

```text
rasen-auto          -> selection / launch policy ┐
rasen-goal          -> completion preset         ├─> frozen root Pipeline
rasen-review-cycle  -> wrapper/compat adapter    ┘
                                                    │
                                                    ▼
                                      Compiler -> Reconciler
```

因此 `0.1.6` 的统一目标是三种入口汇入同一个执行模型，而不是把三者强行建模成
同一种节点。

## 8. 目标执行架构

### 8.1 小型确定性内核的位置

按 north-star 的领域边界，这个内核属于 **Execution Domain**，第一阶段服务于
单个 Change 的 Pipeline Run。它不是 Planning Kernel，不负责把 Issue 分解成
Changes，也不负责 Issue Acceptance。

```text
Planning Domain
  Issue + accepted Execution Plan
                 │ revision/hash
                 ▼
Definition / Authoring Plane
  Pipeline Definition v2 <──> Canvas + Custom Composite
                  │ validate / compile
                  ▼
Execution Domain
  Change ──> Change Run Plan ──> Execution Reconciler
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
        Project Runtime       Agent Backend        Gate/Evidence
              │                     │                     │
              └─────────────────────┴─────────────────────┘
                                    │
                                    ▼
                         committed Run Record
                                    │
                    ┌───────────────┴────────────────┐
                    ▼                                ▼
             Change-run Operations           Evidence projection
       observe / resume / cancel / decide      reports / timeline
                    │                                │
                    └───────────────┬────────────────┘
                                    ▼
Acceptance Domain
  Evidence And Acceptance ──> Issue Rollup
```

north-star 已经为它给出概念接口：

```text
reconcile(plan, observedState) -> NextActions
```

并要求它隐藏：

- DAG 拓扑推进；
- required/optional/cancelled/superseded；
- 并行安全性；
- 重试和循环上限；
- Gate 与人工 checkpoint；
- 恢复时下一可运行节点；
- 失败链和未完成前沿。

本研究提出的“小型确定性内核”本质上就是先在 Change Pipeline 范围内实现这个
Execution Reconciler，而不是另起一个竞争概念。

但 `0.1.6` 的产品交付对象不是孤立内核，而是完整的 Executable Composite
Pipeline：

- Definition v2 是声明真相；
- Canvas 编辑 Definition，而不是维护第二份图状态；
- compiler 冻结不可变 ChangeRunPlan；
- Reconciler 推进 committed Run Record；
- Operations 只投影和控制该 Record，不生成另一份运行真相。

因此 Canvas、受约束的 Custom Composite 和 Change-run Operations 都属于
Execution Domain 的产品边界，不能被当成内核完成后的装饰性 UI。

### 8.2 “确定性”的严格定义

Agent 输出本身不会确定。这里的确定性应定义为：

```text
相同的不可变 Run Plan
+ 相同的来源 revision/hash
+ 相同的已提交 Run Record
= 相同的 ready frontier、等待原因和终态
```

即：

```ts
reconcile(plan, record): NextAction[]
```

应是纯函数。外部调用返回后：

```ts
commit(invocationId, validatedResult): RunRecordVersion
```

只有成功 commit 的结果才能影响下一次 reconcile。

### 8.3 最小执行原语

长期 IR 可以收敛到五类原语：

1. `invoke`：Agent、command、tool 或外部 adapter；
2. `compute`：纯 filter、assert、fingerprint、predicate；
3. `scope`：sequence、parallel、bounded loop；
4. `suspend`：等待人类、approval 或外部条件；
5. `finish`：complete、fail、cancel、escalate。

但是 north-star 校准后的第一版不应实现任意递归、任意脚本化控制流的完整通用
IR。`0.1.6` 实现 built-in Pipelines 与受约束 Custom Composite 共同需要的最小
公开闭包：

- structured Agent/command invoke；
- root DAG ready frontier；
- Gate/suspend；
- `CompositeRef` 与 `BoundedLoop`；
- pure choice/outcome routing；
- condition 与受限 FanOut/Join；
- finish/escalate/cancel；
- durable commit/resume。

`bug-fix`、`small-feature`、goal pipelines 与 `full-feature` 必须依次消费这些原语。
ReviewCycle 和 GoalLoop 共同验证通用 loop lifecycle；各自仍保留独立的 typed
body result 与业务 reducer，不能为了“统一”把 finding closure 和 goal
completion 压成一份领域 schema。

Pipeline Definition v2 与 Canvas 必须公开这些原语的受限 authoring contract：

- Custom Composite call graph 无递归；
- Composite 声明 typed inputs、artifact outputs 与 outcomes；
- `BoundedLoop` 声明 limits、stall/blocked policy 与完整 exits；
- Canvas 支持 Composite 折叠/展开、单轮 body、outcome ports 和静态诊断；
- Operations 支持 root/composite frontier、round/phase、wait/escalation、
  evidence 和 resume/cancel/decision。

第一版仍不实现：

- nested loop；
- arbitrary scripting；
- 递归 Composite call；
- 无限制动态 node/plugin 执行；
- Issue/portfolio 调度；
- 分布式调度。

### 8.4 Run Plan 不是第二份可变真相

north-star 明确禁止复制一份会与 Issue 独立演化的“Context Snapshot”。因此
`PlanSnapshot` 这个名字容易误导，更建议叫 `ChangeRunPlan`，并遵守：

- Issue 和 accepted Execution Plan 仍以 Git 中的规划制品为真相；
- Run 启动时记录实际读取的 Issue/Execution Plan/Pipeline revision、hash 和来源；
- 只冻结本次执行所需的标准化结构与 policy；
- 这个计划在该 Run 内不可变，是历史证据，不是新的可编辑产品真相；
- 新 guidance 通过 Decision/新 revision 显式进入；
- 新 revision 不重写已经发生的 Run history；
- 若需要改变结构，生成新的 plan revision/attempt，而不是静默修改旧计划。

当前 `RunStateSchema` 只要求保存 Pipeline 名称
（`src/core/pipeline-registry/run-state.ts:152-154`），resume 会按名称重新加载当前
定义（`src/commands/pipeline.ts:764`）。如果定义在 Run 期间被修改，恢复行为可能
漂移。第一条垂直切片至少应记录：

```json
{
  "pipeline": {
    "name": "small-feature",
    "source": "pipelines/small-feature/pipeline.yaml",
    "revision": "git:...",
    "digest": "sha256:..."
  },
  "runPlanRef": "run-plan.json",
  "runPlanDigest": "sha256:..."
}
```

### 8.5 Run Record、event 与 snapshot

north-star 同时要求可恢复和“Event 不是独立真相”。因此不能让：

- `auto-run.json`；
- event log；
- UI websocket state；
- Markdown report

都成为可独立写入的状态源。

推荐的约束是：

```text
一个 canonical Run Record
  ├─ committed transitions
  ├─ invocation results
  ├─ evidence refs
  └─ source revisions

derived snapshot / auto-run compatibility view
derived review-cycle-report.md
derived UI timeline
```

event 必须对应已提交的状态转换或 evidence。UI 收到 event 但 Run Record 中没有
相同提交，不能显示完成。

可考虑的事件词汇：

```text
RunStarted
PlanFrozen
NodeAdmitted
NodeStarted
NodeResultReceived
NodeResultCommitted
LoopAdvanced
GateAwaiting
GateResumed
NodeCompleted
RunEscalated
RunCancelled
RunCompleted
```

存储最终使用 append-only JSONL、JSON + write-ahead log 或 SQLite 仍可开放；
不开放的是“一次状态转换有多个可冲突的真相”。

### 8.6 外部副作用

不能承诺笼统的 exactly-once。更现实的语义是：

```text
稳定 invocation identity
+ at-least-once 调用可能性
+ 幂等 effect 或执行前 reconcile
+ result commit
```

不同调用需要不同恢复策略：

- read-only review 重跑通常安全；
- test command 可按相同 tree identity 重跑；
- code-edit Agent 在 crash 时可能已写文件但未返回，恢复前必须检查 worktree、
  tree hash 和 delta；
- commit、push、PR 等外部 effect 必须用稳定请求身份或先查询外部状态；
- 无法判定时 suspend/escalate，不能假装未执行或已成功。

## 9. 一个声明式 review-loop 草案

以下只是用于说明语义的草案，不是最终 schema：

```yaml
- id: review-loop
  kind: loop
  mode: review-cycle
  requires: [verify]

  limits:
    maxRounds: 3
    stallRounds: 2
    blockedThreshold: 3
    maxStrategyAttempts: 2

  identity:
    distinct:
      - [fix.actor, re-review.actor]

  body:
    - id: review
      kind: agent
      capability: review
      output: ReviewResultV1

    - id: triage
      kind: agent
      capability: review-triage
      input: review.findings
      output: TriageResultV1

    - id: fix
      kind: agent
      capability: apply-review-fixes
      input: triage.fixPlan
      output: FixResultV1

    - id: re-review
      kind: agent
      capability: verify-fix-delta
      input: fix.delta
      output: VerificationResultV1

    - id: decide
      kind: compute
      policy: close-major-findings

  exits:
    clean:
      when: no_open_findings_at_or_above_major
      downstream: success
    exhausted:
      when: max_rounds_reached
      downstream: escalate
    stalled:
      when: fingerprint_unchanged_for_stall_rounds
      downstream: strategy_or_escalate
    blocked:
      when: same_blocker_reaches_threshold
      downstream: suspend_or_escalate
```

有三点比具体字段名更重要：

1. 内部 body 在单轮内仍是无环的；
2. 下一轮由 Loop scope 重建实例，不是把旧 node 从 completed set 中删除；
3. 所有退出都映射成外层 stage 的明确 outcome。

Canvas 可以把它显示成一个带 `3 max rounds` 标记的折叠节点。展开时显示内部
单轮 body，并用专门的 loop affordance 表达“下一轮”，而不是允许用户创建任意
依赖回边。

## 10. 按 north-star 的再次校准

### 10.1 强一致的部分

| 研究结论 | north-star 对应约束 | 判断 |
| --- | --- | --- |
| 顶层 DAG + 有界反馈作用域 | Pipeline 要有有界反馈循环、失败升级 | 强一致 |
| 纯 `reconcile(plan, state)` | Execution Reconciler，相同输入产生相同下一步 | 强一致 |
| LLM 只做 judgment | “LLM 负责判断，程序负责机械推进” | 强一致 |
| author != verifier | 角色隔离、独立评估 | 强一致 |
| 结构化结果与 evidence | Agent 自述不是证据、完成需外部证据 | 强一致 |
| durable resume/cancel/stall | Horizon 0 的 Change 自动化内核 | 强一致 |
| 狭窄 Agent Backend | north-star 的 Agent Backend deep module | 强一致 |
| Canvas 是 plan 的投影/编辑面 | UI 不成为新状态真相 | 强一致 |

### 10.2 必须限制的部分

| 方案 | 风险 | north-star 校准 |
| --- | --- | --- |
| 一开始建设开放式通用 IR/compiler/event platform | 重走 Harness 横向平台路线 | 只实现 built-ins 与受约束 Custom Composite 的最小公开闭包，并逐条 dogfood |
| 复制完整 Issue context 到 PlanSnapshot | 产生第二份可变真相 | 记录 revision/hash，只冻结执行结构 |
| 把 event log 与 run-state 都当权威 | 两个运行真相 | 一个 canonical Run Record，其他派生 |
| runtime 先做、Canvas/Operations 后补 | 定义面无法表达真实执行，运行事实也不可观察 | 每种原语同时贯穿 Definition、Canvas、Runtime 与 Operations |
| 允许任意 graph cycle | 无法证明有界、恢复和完成 | 只允许有明确 limits/exits 的 Loop scope |
| review-loop clean 后关闭 Issue | 混淆执行与验收 | 只完成 Change quality stage |
| 用 Pipeline 做 Issue 分解 | 混淆规划域与执行域 | Dispatch/Execution Plan 决定 Changes |

### 10.3 对此前建议的路线修正

此前可以提出如下通用化顺序：

```text
PlanSnapshot
-> journal
-> 全 DAG reducer
-> Agent envelope
-> loop
-> typed ports
-> Canvas
```

这条顺序从软件架构角度整齐，但它把真实接入推迟到框架之后。另一方面，只接管
`review-loop` 又会让外层 DAG 和内层 loop 拥有不同 runtime owner。north-star
的“闭环先于平台、路线按能力证明排序”要求把它改成：

```text
Pipeline Definition v2 + Canvas/Operations skeleton
  -> bug-fix：
       schema + canvas + compiler + root runtime + run detail
  -> small-feature / ReviewCycle：
       composite authoring + bounded loop + finding/round operations
  -> goal-loop-measure/evaluate/research：
       typed completion contract + loop runtime + goal progress operations
  -> full-feature：
       condition/FanOut/Join authoring + barrier runtime + parallel frontier
  -> Custom Composite dogfood + auto/goal/review-cycle 入口收敛
```

每一步都扩展同一份 Definition v2、Canvas vocabulary、Run Plan、Reconciler、
Run Record 和 Operations projection。不允许把内核全部写完后才补产品面，也不
允许在同一个 Run 中混用 legacy 外层 ownership 和 Reconciler ownership。这是本次
north-star 复盘最重要的结论。

### 10.4 它属于 Horizon 0，不应提前冒充 Issue 自动化

这项工作直接加强：

- 单个 Change 的 Pipeline；
- 持久 run-state；
- Gate；
- 角色隔离；
- 有界反馈；
- resume/cancel/stall；
- 证据记录。

因此它是 north-star `Horizon 0：Change 自动化内核` 的核心工作，而不是
Horizon 2/3 的 Issue 执行图或多项目调度。

未来 Issue Execution Plan 的 Reconciler 可以复用相同思想，但层级不同：

```text
Issue-level Reconciler
  决定哪个 Change Run 可启动

Change-level Reconciler
  决定该 Change Pipeline 的哪个 stage/loop action 可执行
```

不能把两个层级塞进同一个万能 workflow。

### 10.5 完成语义必须停在正确层

一个 clean review-loop 只证明：

- 当前 Change 的独立评估阶段满足其出口；
- 高等级 finding 已闭合；
- 有相应 tree identity 和验证 evidence；
- ship stage 可以进入 ready frontier。

它不证明：

- PR 已合并；
- release 已发生；
- 跨 Change 契约成立；
- Issue acceptance 满足；
- Issue 可以关闭。

这符合 north-star 的三层质量：

```text
Change Gate
Independent Evaluation
Issue Acceptance
```

## 11. 推荐实施路线

### Slice 0：Pipeline 格式与兼容边界

这是已经在 `0.1.5` 完成的架构准备；`0.1.6` 以此为基线，不再重复建设：

1. 给 `pipeline.yaml` 声明内容格式版本；历史无版本定义归一化为 v1；
2. 明确 v1 是 flat DAG，`stage.loop` 是兼容声明；
3. 承诺未来 compiler 可把 v1 `review-cycle`/`goal` loop 归一化为
   Composite Run Plan；
4. Pipeline detail/save/export 的 round-trip contract 携带并保留格式版本；
5. 未识别的未来版本 fail closed，并给出 `minRasenVersion`/升级提示；
6. 文档明确当前 Canvas 的 Loop 仍由 LEAD prompt 执行，不宣称已有 Composite
   runtime。

这不是为了先建设平台，而是因为 `0.1.5` 正在首次公开 Pipeline library、
definition/save API 和 Canvas round-trip；如果现在不声明版本边界，之后每个
用户 Pipeline 都只能靠形状猜版本。

### Slice A：统一 Change Run spine

先建立最小的 Definition -> Canvas -> Compiler/Reconciler -> Operations 纵向
骨架，并用真实 `bug-fix` Pipeline 证明。`bug-fix` 并非严格线性：当前
`verifyPolicy: adaptive` 的 prompt 语义会在复杂 diff 时隐式进入 review-cycle，
即使 YAML 没有显式 `review-loop`。新 compiler 必须把这条行为归一化成显式
`Choice` outcome；在 Slice B 接入 ReviewCycle 前，只能 dogfood simple path，
complex path 必须明确报告 `preview-unsupported`/suspend，不能在同一个 Run 内
偷跑 legacy loop。

交付物：

1. Pipeline Definition v2 的公开 envelope、node identity 与 typed outcome 基础；
2. v1 flat Pipeline -> v2 normalized model -> immutable `ChangeRunPlan` compiler；
3. Pipeline/Composite source revision/digest 与 Run Plan digest；
4. Canvas 读取、保存、校验 v2 root graph，并继续以 Definition 为单一 draft 真相；
5. Canvas 显示 AtomicStage、Gate、Choice 与明确的 outcome routing；
6. canonical durable Run Record；
7. 纯 `reconcile(plan, record) -> NextActions`；
8. 稳定 root node/invocation/attempt identity；
9. structured Agent/command action 与 result envelope；
10. Gate/suspend、finish/escalate/cancel；
11. `verifyPolicy: adaptive` -> explicit Choice/outcome normalization；
12. result schema validation 与原子 commit；
13. Pipeline 定义漂移检测；
14. CLI/JSON run/status/resume/cancel surface；
15. Operations Run 列表/详情、root frontier、active invocation、wait reason 与
    resume/cancel 基础；
16. 每个 Run 冻结 `engine: legacy | reconciler`，禁止同一次 Run 混合所有权。

`bug-fix` 验收证据：

- root DAG ready frontier 可确定重算；
- Gate 前后中断均能恢复；
- 未 commit 的 invocation result 不推进状态；
- completed invocation 不被重复 admission；
- ship/archive 等 effect 使用稳定 identity 并在恢复前 reconcile；
- 同一 plan + record 总是得到同一 next action；
- early preview 遇到 complex adaptive outcome 时明确 suspend/fail closed，不调用
  prompt-owned review loop；
- v2 Definition 经 Canvas save/detail round-trip 后编译结果不漂移；
- Operations 与 CLI 对同一 Run Record 展示相同 frontier/wait reason；
- reconciler engine 关闭时 legacy 行为不变。

### Slice B：small-feature 与 ReviewCycle Composite

在 Slice A 的同一个 Change Run spine 上接入 `small-feature`，让 root DAG 和
ReviewCycle 由同一个 Reconciler、同一个 Run Record 推进。

交付物：

1. 通用 `CompositeRef`/`BoundedLoop` contract 的最小子集；
2. 编译出的 `ReviewCycle` body plan 与 hierarchical identity；
3. v2 Custom Composite definition/reference、typed inputs/artifact outputs/outcomes；
4. Canvas 创建/引用 Custom Composite、折叠/展开、编辑单轮 body、limits/exits
   与 outcome ports；
5. Canvas/服务端共同拒绝递归 call、nested loop、缺失出口与普通 cyclic edge；
6. Review/Triage/Fix/Re-review 的结构化 result schemas；
7. pure review outcome reducer；
8. author != verifier 的程序检查；
9. maxRounds/stall/blocked/strategy 的显式计数；
10. `clean` 与 `escalated` 的 fail-closed ship guard；
11. Operations 展示 composite path、round/phase、open findings、actor、evidence、
    wait/escalation，并提供允许的 decision/resume/cancel；
12. 从 Run Record 派生现有 `review-cycle-report.md`；
13. `rasen-review-cycle` 作为 standalone wrapper/compatibility adapter。

Slice B 同时关闭 `bug-fix` 的 adaptive complex 分支：把其显式 Choice outcome
路由到同一个 built-in ReviewCycle Composite。此时 `bug-fix` 才算完整迁移，而
不是只证明过一个恰好落在 simple path 的样例。

验收证据：

- 在 review、fix、re-review 各原子边界模拟中断并成功恢复；
- 达到 cap 且仍有 Major 时，外层 ship 永远不 ready；
- verifier 与 fix actor 相同时运行被拒绝；
- schema 不合格结果不能 commit；
- accepted Minor/Trivial 被显式记录，不静默丢弃；
- test evidence 绑定实际 tree hash；
- 至少一个真实 Rasen Change 经历 finding -> fix -> independent re-review；
- 至少一个受约束 Custom Composite 经 Canvas authoring 后完成真实 Run；
- Canvas round/phase 与 Operations/Run Record 一致；
- 生成用户可理解的 clean/escalated 原因。

### Slice C：GoalLoop 与入口收敛

在同一个 `0.1.6` 中接入：

- `goal-loop-measure`：证明 command gate、threshold/target 和 bounded iteration；
- `goal-loop-evaluate`：证明 independent judgment gate；
- `goal-loop-research`：证明 prose work product 和 report-only tail；
- Canvas：完整编辑 goal measure/evaluate contract、limits、tail outcome mapping；
- Operations：展示 score/evaluation、gaps、stall/blocked、round cap 与 report tail；
- `rasen-goal`：退化为 completion preset/launcher；
- `rasen-auto`：退化为 root Pipeline selection/launch policy。

ReviewCycle 与 GoalLoop 共享：

- round/attempt identity；
- limit admission；
- stall/blocked lifecycle；
- suspend/resume/cancel；
- generic `continue | complete | escalate` outcome mapping；
- journal event vocabulary 与 evidence refs。

它们不共享 review finding、triage、goal measure/evaluate 等领域 result schema。
第二个真实消费者的作用是验证公共 loop lifecycle，而不是把两个业务 reducer
合并成一个万能 reducer。

### Slice D：full-feature 与 Change-level built-in 迁移完成

接入 `full-feature`，补齐：

- condition evaluation；
- 受预算约束的 FanOut/Join；
- collect-all barrier；
- 并发上限、timeout 与 cancel；
- 多 reviewer evidence 汇合；
- Canvas condition/FanOut/Join authoring 与 barrier validation；
- Operations 并行 frontier、成员状态、budget admission 与 join outcome；
- 统一 open frontier 报告。

`0.1.6` 退出前，所有 Change-level built-in Pipelines 应能由同一 Reconciler
执行。`auto-decompose` 明确排除：它产生多个 Changes 和 portfolio，属于
`0.2.0` Issue Execution Plan/Dispatch，而不是 Change Pipeline runner。

兼容层必须有退出计划：

- 已启动 legacy Run 永远按 legacy 恢复；
- 新 Run 在启动时冻结 engine owner；
- reconciler-owned Run 只把旧 `auto-run.json`、`goal-run.json` 和 Markdown
  报告作为 compatibility projection，不允许它们反向成为第二份状态真相；
- preview/fallback 可显式关闭，不锁死用户。

### Slice E：`0.1.6` 产品闭环与发布收口

`0.1.6` 退出前完成：

- v1 read/compile compatibility 与 v2 save/export/round-trip；
- built-in Composite 与 Custom Composite 使用完全相同的 compiler/runtime contract；
- Canvas 覆盖全部首版 node、Composite、BoundedLoop、limits/exits/outcome ports；
- Operations 覆盖 Run timeline、frontier、round/phase、evidence、wait/escalation
  与安全控制；
- `rasen-auto`、`rasen-goal`、`rasen-review-cycle` 完成薄入口收敛；
- 用户文档、迁移说明、preview/fallback/engine ownership 说明；
- built-in 与 Custom Composite 的端到端 dogfood；
- legacy engine 的清退条件被记录，但是否立即默认关闭由 dogfood 证据决定。

Canvas draft 可以是编辑时单一来源，但保存后仍由服务端静态校验和编译结果决定
能否执行；Operations 只消费 canonical Run Record 及其事件/evidence projection，
不能维护独立运行状态。

`0.1.7` 不预留任何使 Executable Composite Pipeline 成立所必需的能力。未来版本
只能基于真实需求增加更深 typed dataflow、Composite library/分享、run compare/
replay、性能 hardening 或 legacy 最终移除。

### Slice F：`0.2.0` Issue evidence 回流

把 Change Run 的结果交给 north-star 的 Evidence And Acceptance：

- Change outcome；
- open findings；
- escalation reason；
- Gate 与 independent review evidence；
- PR/delivery evidence；
- open frontier。

Issue Rollup 消费这些事实，但不把“review clean”直接映射成 Issue Done。

## 12. 静态校验与测试策略

### 12.1 定义期校验

至少检查：

- stage 和内部 node ID 唯一；
- 顶层依赖仍是 DAG；
- Loop body 单轮结构是 DAG；
- `maxRounds` 为正且不超过系统安全上限；
- 所有非成功出口都有明确 downstream policy；
- proof Gate 明确 fail closed；
- input/output schema 引用存在；
- Composite reference 可解析且 call graph 无递归；
- parent 对每个 child outcome 都有显式映射；
- distinct actor constraint 可满足；
- effectful parallel nodes 的隔离策略明确；
- budget 足以执行最低必需路径；
- v2 首版不允许 nested loop。

### 12.2 Reducer 测试

应使用 transition table、property test 或等价方式证明：

- committed result 之前不会推进；
- 同一 record 重算不会多开新 invocation；
- 已完成 invocation 不会被重新 admission；
- round 只在 `needs_fix` 后增加；
- `round <= maxRounds`；
- terminal outcome 之后不会再产生 action；
- open Major 不可能进入 `clean`；
- cancelled run 不可能恢复成 running，除非产生显式新 attempt；
- 缺失 proof evidence 不可能被当成 pass。

### 12.3 故障注入

至少覆盖：

- Agent 写入代码后、返回前 crash；
- result 返回后、commit 前 crash；
- commit 后、projection 更新前 crash；
- schema validation 失败；
- verifier 不可用；
- test timeout；
- 用户 cancel；
- Pipeline source 在 Run 中途变化；
- resume 时 source revision 不可访问；
- 同一外部 push/PR effect 被重试。

### 12.4 Definition / Canvas / Operations 一致性测试

至少覆盖：

- v1 definition 兼容编译后语义不变；
- v2 Canvas draft -> save -> detail -> export round-trip 不丢失 Composite、limits、
  outcomes 或 ancillary fields；
- 相同 v2 Definition 始终编译出相同 Run Plan digest；
- Canvas 与服务端对递归 call、nested loop、缺失 outcome mapping、普通 graph
  cycle 给出一致的 fail-closed 结果；
- built-in Composite 与等价 Custom Composite 产生同构 plan/identity/outcome；
- 每次 committed transition 后 Operations 的 frontier、round/phase、wait reason
  与 Run Record 一致；
- commit 后、Operations projection 前 crash 不会显示伪完成；
- Operations 的 resume/cancel/decision 只提交受版本检查的 command/event，不直接
  改写客户端状态；
- `bug-fix`、`small-feature`、goal pipelines、`full-feature` 与至少一个 Custom
  Composite 完成 Definition -> Canvas -> Run -> Operations 端到端测试。

## 13. 衡量成熟度

不要用新增 node type、schema 字段或 Canvas 页面数量衡量成果。对这项能力更有效的
指标是：

| 指标 | 含义 |
| --- | --- |
| Review-loop clean correctness | clean 后是否真的没有未处理高等级 finding |
| False clean rate | 被报 clean 但独立复核仍发现 Blocker/Major 的比例 |
| Recovery rate | 中断后能从正确原子边界继续的比例 |
| Escalation quality | 升级是否说明 finding、轮次、已试策略和所需决策 |
| Evidence completeness | 每个完成判断是否绑定 result、actor、delta、tree、Gate |
| Duplicate effect rate | 恢复时重复产生不可逆 effect 的比例 |
| Prompt-control leakage | 仍依赖 LEAD 临场决定的机械规则数量 |
| Definition/runtime parity | Canvas/Definition 声明与实际 Run Plan/行为是否等价 |
| Operations freshness | Operations 是否只展示已 commit 且与 Record 一致的状态 |
| Custom Composite success | 用户定义 Composite 能否通过同一 contract 完成真实 Run |
| Dogfood frequency | 真实 Rasen Changes 使用 Executable Composite Pipeline 的频率 |

这些指标最终应服务 north-star 的两个总指标：

```text
真实 Issue 闭环成功率
False Done rate
```

## 14. 建议锁定与保持开放的决策

### 建议现在锁定

1. 新范式正式称为 **Executable Composite Pipeline**；`Composite` 是层级复用
   单元，`BoundedLoop` 是有界反馈原语，`Pipeline Reconciler` 是执行内核。
2. `0.1.6` 同时交付 Definition v2、Canvas、受约束 Custom Composite、Compiler/
   Reconciler、canonical Run Record 与 Change-run Operations；这些不是可拆版本。
3. root Pipeline、Composite body 和 Composite call graph 保持 DAG；call graph
   无递归，循环只能通过有界 `BoundedLoop` 表达。
4. 所有 BoundedLoop 必须声明上限、stall/blocked 策略、typed outcomes 和完整
   终态映射；首版不允许 nested loop。
5. Pipeline Definition v2 是公开声明真相；Canvas 编辑该 Definition，服务端校验
   与 compiler 决定能否执行。
6. built-in Composite 与 Custom Composite 使用相同 definition/compiler/runtime
   contract；Custom 只受 capability、结构、budget 与安全 policy 限制。
7. 机械推进归 Reconciler，语义判断归 Agent；Agent 结果必须结构化并经过 schema
   校验。
8. review-cycle 未清洁时 fail closed，不允许 ship；author != verifier 由程序检查。
9. Run 记录实际 Pipeline、Composite 与规划来源 revision/hash。
10. 一个 Run 只有一个 canonical state/record；Operations、Markdown、timeline
    和缓存均为派生，不能独立改写运行事实。
11. `auto` 是 Dispatch/Launch Policy，`goal` 是 completion contract/preset；
    两者不拥有独立 runner。
12. root Pipeline 与嵌套 Composite 从第一次 reconciler-engine Run 起就由同一个
    Reconciler 和 Run Record 所有；不发布 review-loop-only runtime。
13. Reconciler 只产生 typed actions；Agent/command/host adapter 执行副作用，
    validated result 原子 commit 后才能推进。
14. 每个 Run 启动时冻结 `engine: legacy | reconciler`；同一次 Run 不允许混合
    runtime ownership。
15. `0.1.6` 在同一版本内依次接入 `bug-fix`、`small-feature`、goal pipelines
    与 `full-feature`，并至少 dogfood 一个 Canvas-authored Custom Composite。
16. `auto-decompose`/portfolio 属于 `0.2.0` Issue Execution Plan，不进入
    `0.1.6` Change-level Executable Composite Pipeline 或 Change-run Operations。

### 暂时保持开放

- canonical Run Record 使用 JSONL、WAL + JSON 还是 SQLite；
- Triage 中哪些判断由规则完成、哪些由 Agent 完成；
- accepted Minor/Trivial 的默认 policy；
- strategy ladder 是 loop 的标准能力还是 review-cycle 专用策略；
- Definition v2 的最终 YAML 字段布局和 typed ports 语法，但 typed inputs、
  artifact outputs 与 outcomes 本身不是开放项；
- 未来何时允许 nested loop 或更深 Composite nesting；
- Custom Composite library/分享/包分发的产品形态；
- Operations 的具体导航、布局、筛选和高级 run comparison/replay；
- 第一版 Claude adapter 由宿主 LEAD 执行 typed action，还是由独立 CLI/daemon
  直接启动进程；无论选择哪种，不能改变 Reconciler/commit contract；
- 旧 `auto-run.json` 的具体兼容期限。

## 15. 发布切片建议

### 15.1 当前发布事实

截至 2026-07-26：

- CLI 与 UI manifest 已经是 `0.1.5`；
- changelog 已经形成完整的 `0.1.5` “management-platform release”章节；
- 最新正式 tag 仍是 `rasen-v0.1.4`，所以 `0.1.5` 尚未正式发布；
- `0.1.5` 已同时承载 Web 管理面、daemon Session、Pipeline Canvas、Pipeline
  library、Store config scope、keepalive 和 audit；
- `current-capabilities-0.1.5.md` 明确记录：当前没有独立的
  `rasen pipeline run` 程序化执行引擎，实际推进仍由 LEAD Agent 完成；
- `pipeline-definition-api` 已把当前 `PipelineYaml` 的 flat DAG 形状公开成
  可保存、可导出、可 round-trip 的定义 contract；
- PR [#79](https://github.com/DumoeDss/rasen/pull/79) 已给
  `PipelineYamlSchema` 增加显式内容格式 `version: 1`：历史无版本定义在读取边界
  归一化为 v1，任何显式非 v1 或畸形版本 fail closed，并在 draft validation 中
  定位到 `/version`；
- detail/show/save/scaffold/export、全部 built-in Pipeline、管理 API 与 Canvas
  wire/draft 已保留或显式输出 v1；`.rasenpkg` 的 `formatVersion` 仍是独立的包
  容器版本，不替代其中 `pipeline.yaml` 的内容格式身份；
- `.rasenpkg` export 会在包副本中规范化 `pipeline.yaml`，不重写源文件并保留
  ancillary files；两轮独立评审进一步锁定了路径安全顺序：必须在 registry
  enumeration 或任何内容读取前先验证 Pipeline root 与 manifest 的物理类型；
- 英文/中文 Pipeline、CLI、Canvas 文档已明确：v1 flat DAG 与现有 loop declaration
  仍由 LEAD playbook 执行，Canvas 是定义编辑器，不是 programmatic runner；
- PR [#80](https://github.com/DumoeDss/rasen/pull/80) 已把 delta specs 同步到
  main specs，并将 Change 归档到
  `rasen/changes/archive/2026-07-26-pipeline-definition-api/`。

实施前存在两个相反风险：

```text
把 runner 全塞进 0.1.5
  -> 临近发布更换执行架构，版本失控

0.1.5 什么兼容边界都不留
  -> 首次公开 round-trip definition 时固化无版本 flat schema
```

实际结果选择了中间的兼容切片：0.1.5 没有引入 runner，却也没有把无版本定义合同
固化成长期包袱。

### 15.2 原始选项与方向修订

| 选项 | 优点 | 主要问题 | 结论 |
| --- | --- | --- | --- |
| 完整改造全部进入 0.1.5 | 一次得到最终模型 | scope 巨大；替换执行器、格式、Canvas 和入口；无法在发布前充分 dogfood | 不建议 |
| review-cycle runner 进入 0.1.5 | 有一条垂直切片 | 当前尚无程序化 runner；会把管理平台 release 变成双中心 release | 仍不建议 |
| `0.1.6` 只接管 review-loop，`0.1.7` 再统一 goal/auto | scope 最小、首个闭环快 | 外层 DAG 与内层 loop 出现两个 owner；只有一个 Composite 消费者；`0.1.7` 很可能重构 `0.1.6` contract | 不再推荐 |
| `0.1.6` 只建 runtime，Canvas/Custom/Operations 放到 `0.1.7` | 后端 scope 看似较小 | 公开定义无法表达真实语义，运行事实不可观察；再次形成产品面与 runtime 分裂 | 不再推荐 |
| `0.1.6` 同时建设任意脚本、递归/nested loop、portfolio 与 Issue 调度 | 一次得到通用平台 | 把 Change runtime、workflow language 和 Issue planning 混成 big bang | 不建议 |
| `0.1.6` 交付完整 ECP 四平面闭环，并按原语垂直接入 | Definition/Canvas/Runtime/Operations 从第一天等价；built-in 与 Custom 共同证明抽象 | 需要多个连续 Change/PR、严格约束的 Custom contract 与 compatibility 边界 | **推荐** |

修订后的推荐：

> `0.1.5` 只留下已经完成的格式兼容边界；`0.1.6` 发布 Executable Composite
> Pipelines，同时交付 Definition v2、Canvas、受约束 Custom Composite、
> Compiler/Reconciler、canonical Run Record、Change-run Operations、built-in
> Composite 与统一入口；`0.1.7` 不预留任何核心闭环能力；Issue/portfolio 仍进入
> `0.2.0`。

### 15.3 `0.1.5`：格式兼容边界已完成

实际纳入：

1. 在已交付的 management platform 与 `pipeline-definition-api` 上完成兼容
   hardening；
2. 给 Pipeline 内容格式建立显式 v1 边界：
   - 历史无版本定义读取为 v1；
   - save/detail/show/scaffold/export 保留并显示版本；
   - 未知未来版本和畸形显式版本 fail closed；
3. 明确兼容承诺：
   - v1 flat DAG 长期可读；
   - v1 `stage.loop.kind: review-cycle|goal` 未来可编译为 Composite；
   - 不要求用户立即重写；
4. 在 Pipeline/Canvas 文档中说明：当前 loop 仍由 LEAD playbook 执行，Canvas
   不是新的 programmatic runner；
5. 保持 `.rasenpkg` 内容版本与包 `formatVersion` 分离，并让 legacy source 只在
   对外输出/包副本中规范化，不因读取而改写；
6. 把本研究和已落地的 v1 contract 作为 `0.1.6` Change 的输入。

以下内容按计划没有纳入：

- 新 `pipeline run` engine；
- durable event journal 重构；
- nested Composite Canvas；
- review/goal 的 runtime ownership 切换；
- 移除或改变 `rasen-auto`/`rasen-goal` 行为；
- 把 auto-decompose 上移到尚不存在的 Issue Execution Plan。

这一范围没有让 `0.1.5` 多背一个新的产品中心，同时保护了它首次公开的 Pipeline
definition contract。

实施与验证证据：

- 产品提交 `bd2c2938` 经 PR #79 合并，merge commit 为 `42dd6c91`；
- 归档提交 `3cdceedc` 经 PR #80 合并，merge commit 为 `3e8d1d3`；
- Change task ledger 为 `32/32`，strict Change validation 通过；
- registry/library、management API、CLI v1、Canvas focused tests、UI full suite、
  ESLint、typecheck、build 与 diff check 通过；
- Windows root suite 记录为 4,594 passed、31 skipped、6 failed；6 个失败在 5 个
  未修改的 baseline 区域中可单 worker 复现，因此没有被伪报为全绿，也没有为本
  Change 越界修复；
- 首轮独立评审发现 export fallback 的 linked-root 读取边界问题；两轮
  review→fix→non-author re-review 后，root/manifest 检查被移动到 enumeration 和
  content read 之前，并用 zero-read regression 锁定，最终 open
  Blocker/Major 为 0；
- 归档时 main specs strict validation 为 `180/180`。

### 15.4 `0.1.6`：Executable Composite Pipelines

`0.1.6` 应以完整但受约束的产品范式命名：

> 用户可以在 Canvas 中声明或复用 built-in/Custom Composite，服务端把
> Pipeline Definition v2 编译成 immutable ChangeRunPlan，Reconciler 推进 root
> DAG、BoundedLoop、Gate、Choice 与 FanOut/Join，canonical Run Record 保存唯一
> 运行事实，Operations 提供观察、恢复与安全控制；auto 只负责选择，goal 只负责
> 完成契约，review-cycle standalone 入口只负责包装和兼容。

核心范围：

- Pipeline Definition v2：AtomicStage、CompositeRef、BoundedLoop、Choice、
  FanOut/Join、Gate、Finish 与 typed outcomes；
- v1 flat definition/stage.loop -> v2 normalized model -> immutable
  `ChangeRunPlan` compiler；
- source revision/digest 与 Run Plan digest；
- Canvas v2 round-trip、Composite 折叠/展开、body、limits/exits、outcome ports、
  condition 与 FanOut/Join authoring；
- 受约束 Custom Composite：无递归 call、无 nested loop、typed contract、
  capability/budget/safety validation；
- pure `reconcile(plan, record) -> NextActions`；
- canonical durable Run Record 与原子 result commit；
- structured Review/Triage/Fix/Re-review、Goal Measure/Evaluate results；
- stable root/composite/round/invocation identity；
- Agent/command/host adapter contract；
- author != verifier、round/strategy/budget/concurrency 约束；
- fail-closed ship 与显式 exhausted/stalled/blocked/cancelled outcomes；
- `rasen-auto`、`rasen-goal`、`rasen-review-cycle` 薄入口；
- CLI/JSON run/status/resume/cancel 与 compatibility projections；
- Change-run Operations：timeline、frontier、round/phase、active invocation、
  evidence、wait/escalation 与 resume/cancel/decision；
- Change-level built-in Pipelines 与 Canvas-authored Custom Composite 的真实
  dogfood。

版本内接入顺序：

```text
Definition v2 + Canvas/Operations skeleton
  -> bug-fix end-to-end（root spine + adaptive Choice）
  -> small-feature / ReviewCycle end-to-end
     -> 关闭 bug-fix adaptive complex -> ReviewCycle 路由
  -> goal-loop-measure/evaluate/research end-to-end
  -> full-feature condition/FanOut/Join end-to-end
  -> Custom Composite dogfood
  -> launcher/preset/adapter 收敛与全量 Change-level dogfood
```

这个顺序不是把版本重新拆成 Definition/UI/backend 阶段。每个切片都同时扩展
Definition、Canvas、Compiler/Reconciler、Run Record 和 Operations；任何切片都
不得引入自己的 definition、runtime 或 observation truth。

`0.1.6` 明确 non-goals：

- `auto-decompose`、portfolio 和 Issue Execution Plan；
- nested loop；
- 递归 Composite call；
- arbitrary control-flow scripting；
- 无限制动态 node/plugin execution；
- 分布式调度；
- Issue-level/跨项目 Operations；
- 笼统的 exactly-once 外部副作用承诺。

`0.1.6` 退出条件：

- v1 定义兼容读取/编译，v2 definition 经 Canvas save/detail/export round-trip
  后语义不变；
- Canvas 可以创建、引用、展开和校验受约束 Custom Composite；
- `bug-fix`、`small-feature`、三个 goal pipelines、`full-feature` 与至少一个
  Canvas-authored Custom Composite 均可完成真实 Run；
- 同一 immutable plan + committed record 始终得到同一 next action；
- root stage 与 Composite invocation 的 crash-before/after-commit 故障注入均可恢复；
- ReviewCycle 至少真实经历一次 finding -> fix -> independent re-review；
- GoalLoopMeasure 与 GoalLoopEvaluate 都完成真实迭代并证明公共 loop lifecycle；
- open Major 永远不能进入 ship；
- 所有完成判断绑定 actor、tree、delta/result 和 evidence；
- `rasen-auto`、`rasen-goal`、`rasen-review-cycle` 不再拥有独立机械推进规则；
- 一个 Run 只存在一个 engine owner 和一个 canonical state；
- Canvas declaration、compiled plan、runtime behavior 与 Operations projection
  通过端到端 parity 验证；
- Operations 能准确显示和安全控制 root/composite frontier、round/phase、
  wait/escalation 与 evidence；
- legacy Run 可继续恢复，reconciler engine 可显式关闭，兼容投影不会成为第二份真相。

### 15.5 `0.1.7`：不预留核心范式能力

`0.1.7` 不再承担任何使 Executable Composite Pipeline 成立所必需的能力。
Definition、Canvas、Custom Composite、Runtime 与 Operations 缺一项，`0.1.6`
都不算完成。

未来 `0.1.7` 是否存在、承载什么，由 `0.1.6` dogfood 证据决定。候选增强仅包括：

- 更深 typed dataflow；
- Composite library、分享与包分发；
- run compare/replay 与高级 analytics；
- 性能、并发和长时间运行 hardening；
- legacy prompt-owned engine 的最终移除；
- 若真实消费者证明安全且必要，再评估 nested loop。

如果 `0.1.6` 的 Canvas、Custom Composite、第二类 loop、full-feature 或
Operations dogfood 证明公共抽象不稳定，应在 `0.1.6` 内修正 contract，而不是
把完整性债务推给 `0.1.7`。

### 15.6 `0.2.0`：Issue Execution Plan 与 auto-decompose 上移

以下内容不属于 Change-level Executable Composite Pipeline：

- Issue contract；
- 多 Change Execution Plan；
- target project；
- 跨项目 dependency；
- Issue acceptance；
- 将 auto-decompose 从 Change 前置 stage 上移到 Dispatch。

它们与 north-star 的 Issue 平台阶段一致，应进入 `0.2.0` 或对应的 Issue
版本线，而不是因为“图模型相似”提前塞入 `0.1.6`。

### 15.7 下一步如何开始

第一步“先解决正在发布的 contract”已经完成。接下来不是继续往 `0.1.5` 追加
runner，而是以已合并的 v1 contract 为输入启动独立的 `0.1.6` Change：

1. **已完成：修订并归档 `pipeline-definition-api` Change。**  
   `WirePipelineDefinition = PipelineYaml` 的 round-trip 现在拥有 v1、未知版本
   fail-closed 与 legacy normalization contract；主 specs 已同步。

2. **为 `0.1.6` 锁定 ECP 四平面最小闭包。**  
   定义 Pipeline Definition v2、Canvas authoring、受约束 Custom Composite、
   `ChangeRunPlan`、Reconciler、canonical Run Record、effect adapter/commit
   与 Change-run Operations 的共同 contract；不设计任意 workflow language。

3. **先决定唯一状态所有权和兼容方式。**  
   新 Run 启动时冻结 `engine: legacy | reconciler`；旧 Run 永不跨 engine
   resume；新 Run 的 `auto-run.json`、`goal-run.json` 和 Markdown 只允许作为
   projection。

4. **创建一个 umbrella `0.1.6` Change 与多个可独立评审的端到端 Change。**  
   umbrella proposal/spec/design 锁定统一 contract；实施按 Definition/Canvas/
   Operations skeleton、`bug-fix` spine、ReviewCycle、GoalLoop、full-feature、
   Custom Composite/launcher 收敛拆分，避免一个 big-bang PR；每个 Change 都必须
   同时覆盖受影响的 authoring、runtime 和 observation surface。

5. **先锁定 contract/reducer 与跨平面 parity 测试矩阵。**  
   覆盖 v1/v2 round-trip、Canvas/server validation、plan digest、root ready
   frontier、Gate、parallel barrier、clean、next-round、exhausted、stalled、
   blocked、cancelled、crash-before/after-commit 与 Operations projection，再接
   真实 Agent/command adapter。

6. **从 `bug-fix` 开始立即端到端 dogfood，再逐层增加原语。**  
   每条接入都必须同时留下可 round-trip 的 Definition/Canvas 证据、compiled
   plan、真实 Run Record、恢复证据和 Operations 投影；`small-feature` 证明
   ReviewCycle，goal pipelines 证明第二类 BoundedLoop，`full-feature` 证明
   condition/FanOut/Join，最后用 Custom Composite 证明公开抽象不是 built-in
   特例。

7. **最后收敛入口并完成产品闭环，不最后才补产品面。**  
   当底层 Pipeline 已被证明后，把 `rasen-auto`、`rasen-goal` 和 standalone
   `rasen-review-cycle` 收缩成薄 launcher/preset/adapter；`0.1.6` 发布前完成
   Canvas/Operations/Custom Composite 的全量退出条件。compatibility fallback
   的最终移除按 dogfood 证据决定，不预设为某个版本的核心能力。

这个顺序同时满足：

- 0.1.5 不被新架构拖住；
- 公开定义不会成为无版本死胡同；
- 0.1.6 从第一次 Run 起只有一个状态所有者；
- ReviewCycle 与 GoalLoop 在同一版本共同验证抽象；
- 0.1.6 拥有 Definition -> Canvas -> Runtime -> Operations 的完整用户闭环；
- built-in 与 Custom Composite 共同证明公开范式；
- 统一模型从开始就存在，但不会扩张成任意 workflow/Issue 平台。

## 16. 最终判断

这条演进路线是可行的，而且与 north-star 高度一致，但它的正确名字既不是“给
Canvas 加循环边”，也不是“为 review-cycle 写一个专用 runner”，更不是“先写完
一个通用 workflow platform 再找消费者”，而是：

> 建立一个可层级组合但受约束的 Executable Composite Pipeline 模型，让
> Pipeline Reconciler
> 接管机械推进；auto 负责选择，goal 负责完成契约，review-cycle/goal-loop
> 成为可展开的 Composite。

方向修订后的关键判断是：

> 统一语义应在 `0.1.6` 内一次完成，交付过程则由多个真实 Pipeline 垂直推进。
> Definition v2、Canvas、Custom Composite、root DAG、嵌套 Composite、
> Reconciler、canonical Run Record 和 Operations 是一个不可拆的产品闭环；
> 不能先发布其中一部分，再用下一个版本补齐范式成立所必需的其余平面。

GrokBuild 提供了非常好的语义参照：强提示词仍然重要，但不变量必须由程序执行。
Rasen 已经拥有 DAG、loop declaration、run-state、结构化 Codex result、角色化
skills 和 evidence artifact，这意味着不需要推倒重来。

真正需要完成的跨越是：

```text
今天：
auto / goal / review-cycle 是不同入口和提示词投影
Pipeline 声明“这里有 loop”
LEAD prompt 实际扮演统一 runtime

目标：
Pipeline Definition v2 与 Canvas 可以声明 built-in/Custom Composite
一个 root Pipeline 可以组合 Atomic Stage 与 Composite
ReviewCycle / GoalLoop 是有类型的 bounded Composite
Reconciler 推进和恢复
Agent 只在 judgment seam 工作
Evidence 决定是否允许进入下一阶段
Operations 投影同一 canonical Run Record 并提供安全控制
auto / goal / review-cycle 入口只负责选择、preset 与兼容
```

发布上，`0.1.5` 应守住已经形成的管理平台边界，只补 Pipeline 格式版本和兼容
承诺——这一步已经由 PR #79/#80 完成。`0.1.6` 应发布 Executable Composite
Pipelines：Definition v2、Canvas、受约束 Custom Composite、Compiler/
Reconciler、canonical Run Record 与 Change-run Operations 同步建设；再以
`bug-fix`、`small-feature`/ReviewCycle、goal pipelines、`full-feature` 和
Canvas-authored Custom Composite 逐条证明完整闭环，最终让 auto/goal/
review-cycle 入口汇入同一个运行模型。`0.1.7` 不预留任何核心范式能力；
`0.2.0` 再进入 Issue Execution Plan、portfolio 和 auto-decompose 上移。这样既
避免 runtime/产品面的双重真相，也不会重走 Harness “架构接近完成、真实闭环
仍未发生”的路线。
