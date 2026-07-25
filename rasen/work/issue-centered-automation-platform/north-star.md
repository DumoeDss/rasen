# Rasen 终极目标：以 Issue 为契约的多项目自动化开发系统

> 状态：长期产品北极星与开发戒律。
>
> 本文不是当前版本规格，也不是承诺一次性实现的功能清单。它保存 Harness
> 多轮设计、外部项目调研和失败实践中真正有效的思想，并把它们翻译成适合
> Rasen 自下而上演进的最终方向。

## 0. 本目录中文档的关系

本目录有五个不同层级的文档：

```text
north-star.md
  终极目标、长期架构、不变原则、Harness 经验和永久开发戒律

goal.md
  当前已经收敛的 Issue / Execution Plan / Change 目标模型

roadmap.md
  从现有 Rasen 出发，一个真实闭环一个真实闭环地向目标推进

current-capabilities-0.1.5.md
  当前版本实际能够完成的工作和明确边界

store-session-execution-context.md
  0.1.5 Store Session 修复范围，以及与下一版 Execution Plan 的衔接
```

如果三份文档发生冲突：

1. `north-star.md` 决定长期方向和不可违反的原则；
2. `goal.md` 决定当前阶段采用的领域模型；
3. `roadmap.md` 可以随实施发现持续调整顺序。

## 1. 一句话目标

Rasen 的终极目标是：

> 用户把一个经过确认的 Issue 交给系统，系统把它转化为跨成员项目的可审查
> 执行图，在正确的项目目录中驱动多个独立 Agent 完成 Changes，使用确定性
> 质量门和独立审查守住质量，把运行、失败、PR 和验收证据持续回流到同一个
> Issue，直到完成或明确升级给人类。

它不是另一个 Issue Tracker，也不是一个展示 Agent 日志的 Dashboard。

它是连接以下两端的自动化系统：

```text
产品意图                                               可验证的软件结果
Issue  ───────────────────────────────────────────────────────>  Delivery
       分解、路由、执行、验证、审查、修复、交付、验收、恢复
```

## 2. 最终用户体验

一个跨客户端、服务端和官网的真实 Issue 应经历以下旅程：

```text
1. 人类或外部 Tracker 提交 Issue
   - 说明问题、目标和验收标准
   - 不需要先决定在哪些仓库修改

2. Rasen 生成 Proposed Execution Plan
   - 分成多个可独立交付的 Changes
   - 为每个 Change 选择目标成员项目
   - 建立依赖 DAG
   - 标记不确定性、风险和需要确认的决策

3. 人类按自治策略检查、修正或直接放行
   - 简单、低风险工作可以自动放行
   - 跨项目、高风险和不可逆动作可以要求确认

4. 每个 Change 从自己的目标项目执行
   - Agent cwd 是实际项目或隔离 worktree
   - Store 提供 Issue、Execution Plan 和共享规划上下文
   - 不同项目的 Changes 可以按依赖串行或安全并行

5. 每个 Change 运行自己的 Pipeline
   - 规划、实现、验证、审查、修复和交付按需要组合
   - Agent 角色可以独立，Session 可以中断和恢复
   - 确定性 Gate 决定确定性事实，LLM 处理需要判断的工作

6. 结果回流到 Issue
   - 进度、阻塞、成本、运行证据、Commit、PR、Review 和失败原因
   - Issue 在全局看板中始终只出现一次

7. Issue 级验收
   - 所有必需 Changes 完成不等于自动验收
   - 验收标准满足后，Issue 才能进入 Done
   - 无法自动完成时，系统给出明确的未完成前沿和人类下一步
```

最终用户不需要理解调度进程、状态表、WebSocket、Agent CLI 参数或工作树
实现，仍然可以回答：

```text
现在在做什么？
为什么卡住？
谁或哪个 Agent 正在处理？
在哪个项目中修改？
已经产生了什么证据？
系统接下来会做什么？
什么时候需要我？
为什么它认为 Issue 已完成？
```

## 3. Harness 留下的两类遗产

Harness 不是“设计完全错误的项目”。它留下了两种性质完全不同的遗产：

### 3.1 值得继承的设计思想

Harness 的产品设计经历了对 Linear、Multica、Ralph、Ralph Orchestrator、
Mission Control、Veritas Kanban 以及多种 Agent CLI 模式的调研。多轮设计
中收敛出的以下判断仍然有效：

- 产品规划与代码组织必须分离；
- 人类过去承担的 Issue 到 Repository 路由必须显式建模；
- Agent 应被视为真实执行者，而不是 UI 上的装饰；
- Agent Session 应隔离，跨 Session 依靠持久制品交接；
- 调度机械部分应确定性运行；
- LLM 应用于真正需要判断的节点；
- 质量不能仅由执行 Agent 自我声明；
- 运行必须可观察、可中止、可恢复、可审计；
- 人类需要在运行中介入，而不只是启动前批准；
- Repository、worktree、Git 身份、PR 和 CI 属于执行域；
- Issue、产品 Project、Comment 和 Roadmap 属于规划域；
- CLI Agent 差异应封装在一个稳定、狭窄的执行接口之后；
- UI、CLI、外部 Tracker 应看到同一份状态，而不是各自维护真相。

### 3.2 必须永久记录的失败模式

Harness 的失败不是因为目标过大本身，而是因为目标被拆成了横向平台层，
核心价值闭环被放在最后才集成。

全量迁移计划的实际顺序是：

```text
Phase 1  前端骨架
Phase 2  认证与多租户
Phase 3  Issue、Comment、Timeline
Phase 4  Agent 与 AgentTask 实体
Phase 4.5 Repository、Worktree、Dispatch
Phase 5  Inbox 与实时通知
Phase 6  Project、Skill、Runtime
Phase 7  Pipeline 桥接
Phase 8  E2E、PR 闭环与稳定化
```

也就是说：

- UI 在第一阶段建设；
- 认证、多租户、评论和通知早于核心 Pipeline 闭环；
- 真实 Pipeline 到第七阶段才接入新模型；
- 完整 E2E 到最后一个阶段才成为工作项。

后来完成度审计给出了“约 95% 完成”的结论，其主要证据是：

- 数据表存在；
- 模块目录存在；
- REST 端点注册；
- Dashboard 和 packages 已建立；
- schema 和 hook 已落地；
- smoke 脚本文件存在。

但该审计在附录中明确说明：

> 核对方法不依赖运行时验证。

同一审计又把 Pipeline 全链、Dispatch 默认流和 E2E 标为仍需运行确认。
这解释了为什么：

```text
架构完成度约 95%
产品核心闭环实际完成度约 0%
```

这不是审计措辞问题，而是完成定义错误。

## 4. 从 Harness 提取后的设计决策

下表区分“继承思想”和“照搬实现”。Rasen 只继承前者。

| Harness / 调研结论 | Rasen 的处理 | 最终翻译 |
| --- | --- | --- |
| Planning / Execution 二分 | 继承 | Issue repo-blind；Execution Plan 和 Change repo-aware |
| Dispatch Agent 显式替代人类路由器 | 继承并收窄 | 只在 Issue 到执行图的判断节点使用，不负责持续微观调度 |
| 一个跨仓库功能仍是一个 Issue | 继承 | 一个 Issue 对应多个项目中的多个 Changes |
| 一个 Issue 一个 Pipeline | 改写 | 一个 Issue 一个 Execution Plan；每个 Change 有自己的 Pipeline Run |
| 每个 Agent 是独立 Session | 继承 | 角色隔离、失败隔离、可替换 Agent backend |
| 文件作为 Agent 间通信协议 | 继承并强化 | Git 制品与 run-state 是跨 Session 黑板，不依赖聊天上下文 |
| Planner 是唯一大脑 | 改写 | 反馈回到拥有相应决策责任的阶段；必要时触发 Issue 重新规划 |
| 确定性 Gate + LLM QA | 继承 | 编译、lint、测试等由命令裁决；行为与设计由独立评估者判断 |
| 程序化编排层不含 LLM | 继承 | 依赖、状态推进、重试上限和资源限制由确定性模块计算 |
| No Context Snapshot | 改写 | 不复制第二份可变真相；每次 Run 同时记录实际读取的 revision/hash |
| Polymorphic Assignee | 提炼 | 人类和 Agent 共享 Actor / Timeline 模型；执行分派属于节点而非 Issue 单字段 |
| Comment / Timeline / Inbox | 延后继承 | 先有真实事件和人工介入，再建设协作体验 |
| 本地/远程 Daemon | 延后继承 | Local Runtime 先成立；Remote Runtime 是同一接口的后续 adapter |
| API -> TUI -> Web | 改写 | 先文件/CLI 和真实闭环，再提供 Management interface 与 UI projection |
| Platform Bridge + 单向前端依赖 | 条件继承 | UI 规模和多平台需求真实出现时采用 |
| PostgreSQL、多租户、富文本 | 不作为前提 | 由规模与部署需求触发，不进入核心闭环依赖 |
| branch 命名反向关联 | 辅助继承 | 显式稳定引用是主真相，branch/PR 标记作为对账和外部恢复手段 |
| 大迁移后统一 E2E | 永久拒绝 | 每个垂直切片必须完成真实 E2E |

### 4.1 Harness 与 Rasen 词汇映射

Harness 和当前 Rasen 对 `Project`、`Task`、`Workspace` 的用法并不相同。只
继承领域思想时，必须先完成词汇翻译：

| Harness 概念 | Rasen 目标概念 | 说明 |
| --- | --- | --- |
| Issue | Issue | 产品意图和验收契约，保持 repo-blind |
| Project（规划域） | 未来的产品分组 / Initiative | 不能携带本地路径、分支或 Repository 字段 |
| Repository（执行域） | member project / target project | 当前 Rasen 中可实际作为 cwd 的代码项目 |
| Workspace（团队根） | 无直接一对一映射 | Store 是规划根；workset 是个人本地视图，不能重新混成一个 Workspace 真相 |
| Dispatch Task | Dispatch Run / Proposed Execution Plan | 纯判断过程，不需要代码项目 cwd |
| AgentTask（repo-bound） | Execution Plan node + Change Run | 绑定目标项目并产生真实执行 |
| Pipeline sub-task | Stage / Session | 不能与 `tasks.md` 中的实施检查项混用 |
| Issue Pipeline | Change Pipeline | 一个 Issue 可以拥有多个 Change Pipelines |
| Runtime / Daemon | Project Runtime adapter | Local 先成立，Remote 后演进 |
| Timeline | Decision / Event / Evidence projection | 展示记录，不替代底层状态真相 |

尤其要避免重新引入以下语义混淆：

```text
当前 Rasen 的 registered project
  = 可执行代码根
  ≠ Harness / Linear 的产品 Project
```

## 5. 两种平台组织方式

### 5.1 方案 A：项目优先

```text
Store
  ├─ Client Board
  ├─ Server Board
  └─ Website Board
```

该方案对单项目工作直观，但跨项目 Issue 必须：

- 复制到多个项目；
- 任意选择一个“主项目”；
- 或拆成多个失去产品整体语义的 Issue。

它把代码组织提升成产品组织，重复了 Harness 已经识别出的假耦合。因此不作为
最终模型。

### 5.2 方案 B：Issue 优先，项目作为执行维度

```text
Issue Board
  └─ Issue
       └─ Execution Plan
            ├─ Client / Change A
            ├─ Server / Change B
            └─ Website / Change C
```

该方案保持：

- Issue 只有一个；
- 项目可以增加、删除或重组而不污染 Issue；
- 每个 Change 有明确执行目录；
- 项目级队列和全局 Issue 视图可以同时存在；
- 跨项目依赖有自然归属。

最终选择方案 B。

## 6. 终极领域结构

```text
Planning Domain
  Store / Planning Root
    Issue
      product intent
      acceptance
      priority
      dependencies
      discussion / decisions

                 Dispatch seam
                       │
                       ▼

Execution Domain
  Execution Plan
    Node = Change + Target Project + Pipeline + Dependencies
      Run
        Stage
          Agent Session
          Gate Result
        Delivery Evidence

                 Evidence seam
                       │
                       ▼

Acceptance Domain
  Issue Rollup
    phase
    health
    progress
    open frontier
    acceptance result

                 Projection seam
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
        Issue Board          Operations
```

### 6.1 Planning Domain

规划域只回答：

- 为什么做；
- 什么算完成；
- 哪些产品工作彼此依赖；
- 哪些决定由人类做出；
- 当前 Issue 是否仍然值得继续。

规划域不回答：

- 本地路径；
- 默认分支；
- Agent CLI；
- worktree；
- Git credential；
- PR template；
- 测试命令。

### 6.2 Execution Domain

执行域只回答：

- 需要在哪个项目修改；
- 每个 Change 如何运行；
- 依赖和并行关系；
- 使用哪个 Pipeline 和 Agent profile；
- 运行目录、工作树和权限；
- 验证、Commit、PR 和恢复。

### 6.3 Acceptance Domain

验收域把“执行完成”翻译成“用户目标满足”。

它不能只检查所有 Changes 是否 archived，而应综合：

- Issue acceptance；
- 必需与可选执行节点；
- 自动 Gate；
- 独立 Review；
- PR/merge/release 状态；
- 人工接受或例外决定。

### 6.4 Projection

Issue Board、Operations、项目队列和外部 Tracker 同步都是 projection。

它们可以有缓存和索引，但不能成为新的状态真相。删除 projection 后，系统
应能从规划制品、执行状态和证据恢复。

## 7. 深模块与稳定接口

最终系统应围绕少量深模块建设。模块内部可以复杂，但调用者只需理解狭窄、
稳定的接口。

### 7.1 Planning Kernel

概念接口：

```text
loadIssue(issueRef) -> IssueSnapshot
recordDecision(issueRef, decision) -> IssueRevision
```

它隐藏：

- Issue 文件布局；
- Store 或项目内 OpenSpec root；
- 外部 Tracker 映射；
- revision 和并发修改；
- acceptance artifact 解析。

不应让 UI、CLI 和 Pipeline 各自解析 Issue 文件。

### 7.2 Dispatch Module

概念接口：

```text
proposeExecution(issue, projectCatalog) -> ProposedExecutionPlan
validateExecutionPlan(plan) -> Diagnostics
```

它隐藏：

- auto-decompose；
- 项目能力描述；
- 路由规则；
- LLM prompt；
- 手工 override；
- 目标项目和 Pipeline 校验；
- 分解不确定性。

该接口可以有多个真实 adapter：

- 人工指定；
- 确定性规则；
- LLM Dispatch；
- 外部模板。

Dispatch 输出执行建议，不直接静默改变 Issue 产品语义。

### 7.3 Execution Reconciler

概念接口：

```text
reconcile(plan, observedState) -> NextActions
```

它应尽量是确定性的，隐藏：

- DAG 拓扑推进；
- required/optional/cancelled/superseded；
- 并行安全性；
- 重试和循环上限；
- Gate 与人工 checkpoint；
- 恢复时下一可运行节点；
- 失败链和未完成前沿。

相同输入必须产生相同的下一步。LLM 不参与机械状态推进。

### 7.4 Project Runtime

概念接口：

```text
launch(changeNode, projectContext) -> RunHandle
```

它隐藏：

- cwd 与 worktree；
- 环境变量和权限；
- 进程锁；
- Session 生命周期；
- 中止、恢复和 stall 检测；
- Local 与 Remote Runtime 差异。

Local Runtime 和未来 Remote Runtime 是这个 seam 上的两个真实 adapter。

### 7.5 Agent Backend

概念接口：

```text
execute(request) -> EventStream + Result
```

它隐藏：

- Codex、Claude Code 和其他 CLI 参数差异；
- NDJSON、JSON-RPC、app-server 等协议；
- resume 和 cancel；
- stream parser；
- token usage；
- tool call 与 result 的关联；
- 版本探测和平台差异。

Harness 对 Multica `pkg/agent` 的调研已经验证：一个只有少量入口、返回结构化
事件和终态的 backend 模块，比 `create/run/stop/parseCost/onOutput` 等分散
接口更深、更容易测试。

Agent Backend 必须：

- 保留原始事件用于诊断；
- 输出统一的结构化事件；
- 明确终态恰好产生一次；
- 支持取消；
- 记录 model 和 usage；
- 使用真实 CLI fixture 回放守住协议变化。

### 7.6 Evidence And Acceptance

概念接口：

```text
evaluate(issue, plan, evidence) -> IssueRollup
```

它隐藏：

- Change 状态聚合；
- Gate、Review、PR 和验收结果；
- phase、health、progress；
- 关键阻塞；
- 是否允许关闭；
- 关闭理由与证据链。

Issue Board 只消费该模块的结果，不自行发明聚合规则。

### 7.7 Projection Module

概念接口：

```text
project(snapshot) -> BoardView + OperationsView + ProjectViews
```

它隐藏：

- UI 查询模型；
- 索引和缓存；
- 实时 invalidation；
- 分页和筛选；
- Timeline 展示；
- Store member lens。

Board 和 Operations 是两个 projection，不是一个页面里的两组卡片。

## 8. 状态真相与持久制品

最终系统允许多种存储实现，但必须维持以下真相层级：

```text
1. Issue 与接受的 Execution Plan
   -> Git 中的规划制品

2. Change 计划与交付物
   -> Git 中的 Change 制品和代码历史

3. Run / Session 活跃状态
   -> machine-local runtime state

4. Gate、Review、PR、Usage、诊断
   -> 可归档的 evidence / event records

5. Board、Operations、搜索索引
   -> 可重建 projection
```

### 8.1 不复制第二份可变真相

Multica 的 No Context Snapshot 思想是正确的警告：不要在任务入队时复制一份
Issue 内容，并让它与原 Issue 独立变化。

Rasen 的最终规则应是：

- Run 启动时读取当前已接受的 Issue 和 Execution Plan；
- 运行中允许通过明确 decision/guidance 产生新 revision；
- Run 记录实际读取的 revision、hash 和来源；
- 历史 Run 可以复现“当时看到了什么”；
- 新 revision 不静默改写已经发生的运行历史。

这是“单一实时真相”和“可审计执行”之间的平衡。

### 8.2 Event 不是独立真相

事件用于：

- UI 实时更新；
- Timeline；
- 通知；
- 诊断；
- 恢复索引。

但事件必须对应已记录的状态转换或证据，不能出现“WebSocket 说完成，但磁盘
和 Run 状态中没有完成证据”的情况。

## 9. 调度与 LLM 的职责边界

Harness 的多轮设计曾在“全 LLM 调度”和“纯事件驱动”之间摇摆。最终应固定
一个更严格的原则：

> LLM 负责判断，程序负责机械推进。

### LLM 适合负责

- 分解 Issue；
- 选择候选成员项目；
- 制定或修订方案；
- 理解模糊需求；
- 实现代码；
- 解释失败；
- 设计、行为和安全 Review；
- 判断是否需要人类。

### 程序适合负责

- DAG 拓扑顺序；
- 并发上限；
- cwd 与 worktree；
- 状态机；
- 进程启动和终止；
- 超时；
- token/cost 上限；
- 命令 Gate；
- 重试次数；
- required 节点完成判断；
- 事件写入；
- projection 重建。

### 禁止的模式

```text
while not done:
  把所有状态发给 LLM
  让 LLM 决定下一个机械步骤
```

该模式成本高、延迟高、不可复现，也难以诊断。

## 10. Pipeline 的最终位置

Pipeline 是 Rasen 的执行优势，但它属于 Change，而不是直接属于 Issue。

```text
Issue
  └─ Execution Plan
       ├─ Change A
       │    └─ Pipeline Run
       ├─ Change B
       │    └─ Pipeline Run
       └─ Change C
            └─ Pipeline Run
```

Pipeline 不必固定为 Harness 的五阶段：

```text
Planner -> Coder -> QA -> Reviewer -> Shipper
```

应保留的不是固定阶段名称，而是以下性质：

- 角色隔离；
- author 与 verifier 不同；
- 持久制品交接；
- 确定性 Gate；
- 有界反馈循环；
- 失败升级而不是静默通过；
- 可恢复 run-state；
- 每次运行记录实际 Pipeline；
- 不同 Change 可以选择不同 Pipeline。

反馈也不必永远回到一个中心 Planner：

- 编译失败可回到 implementer；
- 设计冲突可回到 planner；
- Review 发现范围错误可触发 Change 或 Issue 重新规划；
- 跨项目契约错误可回到 Execution Plan。

## 11. 人类与 Agent 的协作模型

Harness/Multica 的“Agent 是一等成员”思想值得保留，但最终不应简化为
`Issue.assignee = one agent`。

一个跨项目 Issue 可能同时包含：

- 产品 owner；
- 人类 approver；
- Dispatch Agent；
- 多个 Change implementer；
- 独立 verifier；
- Runtime；
- 外部 reviewer。

因此应区分：

```text
Issue ownership       -> 谁对产品结果负责
Execution assignment  -> 谁执行某个 Change / Stage
Runtime placement     -> 在哪里运行
Actor identity        -> 谁写了 Decision / Comment / Evidence
```

人类介入也不只是一组固定 checkpoint。最终系统应支持：

- Agent 主动提出阻塞问题；
- 人类在不终止整条运行的情况下追加 guidance；
- 高风险动作等待批准；
- 系统清晰报告正在等待谁、等待什么；
- 人类输入写入持久 Decision/Timeline，而不是只留在聊天窗口。

## 12. 质量与完成定义

### 12.1 三层质量

```text
Change Gate
  编译、lint、测试、静态分析、文件完整性

Independent Evaluation
  代码 Review、安全 Review、行为 QA、设计一致性

Issue Acceptance
  产品验收、跨项目契约、交付与发布条件
```

三层不能互相代替。

### 12.2 Agent 自我报告不是证据

以下内容不能独立证明完成：

- Agent 说“已完成”；
- 文件存在；
- endpoint 注册；
- schema 已迁移；
- UI 能展示 mock；
- 单元测试只覆盖内部 helper；
- smoke 脚本文件存在但没有执行记录；
- 审计通过 grep 确认模块存在。

### 12.3 完成证据

一个能力只有在真实垂直旅程中被使用并记录，才进入“已实现”：

```text
真实输入
  -> 真实执行
  -> 真实状态转换
  -> 真实失败或成功处理
  -> 真实验证
  -> 用户可理解的结果
```

## 13. 可观测性是核心能力，不是 Dashboard 功能

Harness 的可观测性调研应被继承，但实现顺序必须从运行证据开始：

### 最低运行记录

- Issue、Change、Run、Stage、Session 标识；
- 实际 cwd 和项目；
- Agent backend、model 和版本；
- 开始、结束和持续时间；
- 结构化流事件；
- 原始 stdout/stderr 或等价诊断；
- tool call/result 关联；
- token、cache 和 cost；
- Gate 输入、命令、退出码和输出摘要；
- retry、resume、cancel 和 stall；
- 最终结果与未完成前沿。

### 后续 projection

- 结构化终端输出；
- Operations；
- Session 回放；
- 费用视图；
- Timeline；
- 报警和通知。

先记录事实，再建设展示事实的 UI。

## 14. 外部系统的位置

### 14.1 Tracker

GitHub Issues、Linear 或其他 Tracker 是 Planning Kernel 的 adapter，不是核心
领域模型本身。

系统应能够：

- 从外部 Issue 导入或关联；
- 把关键状态和链接同步回去；
- 在外部服务不可用时保留本地工作；
- 避免双向同步产生两个冲突真相。

### 14.2 Forge

GitHub/GitLab 等 Forge 属于执行与交付 adapter：

- push；
- PR；
- CI；
- review comments；
- merge；
- webhook。

PR URL 不是 Issue Done 的唯一判断，也不应反向污染 Issue 的 repo-blind 模型。

### 14.3 Remote Runtime

远程 Daemon 只有在 Local Runtime 的接口和恢复语义被真实验证后才进入路线。

远程化增加：

- 任务认领；
- 心跳；
- 认证；
- 网络分区；
- 幂等；
- 租约；
- 远程日志；
- secret 分发。

这些复杂度不能在本地闭环仍不稳定时提前引入。

## 15. 永久开发戒律

以下规则直接来自 Harness 的失败，应视为终极路线的开发宪法。

### 戒律 1：闭环先于平台

在第一个真实闭环成功前，不建设该闭环不需要的完整平台层。

### 戒律 2：每个切片必须纵向穿透

一个切片应从用户输入穿过真实执行到可验证结果，而不是只完成 UI、数据库、
接口或调度中的一层。

### 戒律 3：最迟在切片结束前 dogfood

不能把 E2E 留到总路线最后。每个切片必须由一个真实 Rasen 工作项使用。

### 戒律 4：没有真实状态，就不建设其 Dashboard

UI 只能投影已经存在、可以解释和恢复的状态。

### 戒律 5：手工路径先于智能自动化

先证明用户手工选择项目、Change 和 Pipeline 能跑通，再让 Dispatch Agent
自动选择。

### 戒律 6：单项目先于跨项目

先证明单 Issue、单 Change、单项目，再逐步增加多 Change 和多项目。

### 戒律 7：LLM 只进入判断 seam

状态机、DAG、资源控制、Gate 和 cwd 不交给 LLM 猜测。

### 戒律 8：一个概念只有一个真相

文件、运行时、数据库、UI 和外部 Tracker 之间必须有明确主从关系。

### 戒律 9：完成必须有外部证据

Agent 自述、文件数量和代码覆盖面不能替代真实 Gate、独立 Review 和 Issue
验收。

### 戒律 10：兼容层必须有退出计划

不长期维持两个 Runtime、两个 IssueStore 或两条主流程。兼容层必须明确：

- 为什么存在；
- 谁仍在使用；
- 何时删除；
- 删除前需要什么证据。

### 戒律 11：不为假想规模提前付费

多租户、PostgreSQL、远程集群、完整 Inbox 和复杂权限由真实规模触发。

### 戒律 12：路线以能力证明排序，不以模块依赖排序

“数据库要先于 API，API 要先于 UI”是实现依赖，不是产品路线。产品路线必须
按用户可以完成的真实旅程排序。

## 16. 终极目标路线

下面的路线描述能力成熟度，不绑定版本号和工期。当前可执行的细化步骤见
`roadmap.md`。

### Horizon 0：Change 自动化内核

目标：

- 单个 Change 的 Pipeline 持续参与 Rasen 自身开发；
- 持久 run-state、Gate、角色隔离、反馈和交付可靠；
- Agent backend、resume、cancel 和证据记录稳定。

退出条件：

- 多种真实 Change 类型长期 dogfood；
- 失败可以恢复或明确升级；
- 不是靠某个熟悉代码库的人手工修补每次运行。

### Horizon 1：Issue 契约

目标：

- Issue 成为产品意图和验收的稳定实体；
- 一个 Issue 可以显式关联一个现有 Change；
- Issue phase、health、progress 和 acceptance 有可解释来源；
- Issue Board 只显示真实 Issue。

退出条件：

- 一个真实 Issue 从创建到验收完整跑通；
- 删除 UI projection 后可以恢复；
- Change 完成但验收未通过时不会误报 Done。

### Horizon 2：单项目执行图

目标：

- 一个 Issue 关联同一项目中的多个 Changes；
- 复用 auto-decompose、DAG、并行和组合 run-state；
- 每个 Change 运行自己的 Pipeline；
- Issue 能显示未完成前沿。

退出条件：

- 真实 Issue 发生过部分成功、依赖等待或失败恢复；
- 重启后可以继续推进；
- 组合交付不丢失已完成证据。

### Horizon 3：多项目执行图

目标：

- Store 承载 Issue 和 Execution Plan；
- 每个 Change 显式绑定目标成员项目；
- Agent 从成员项目 cwd 或 worktree 启动；
- Issue 详情按项目分组，主看板保持单卡；
- 项目级队列可以反向看到关联 Issue。

退出条件：

- 一个真实跨项目 Issue 完成；
- 每个项目独立验证和交付；
- 跨项目依赖被真实执行；
- Store 与 cwd 不再混淆。

### Horizon 4：智能 Dispatch

目标：

- auto-decompose 生成 Change、目标项目、Pipeline 和依赖；
- 用户可以检查和修正；
- 支持规则、手工与 LLM 多种 Dispatch adapter；
- 重新规划保留历史。

退出条件：

- 自动路由在真实 Issue 中被修正过并继续成功；
- 错误项目不会静默执行；
- Dispatch 失败能够解释；
- 手工 override 始终可用。

### Horizon 5：Issue 级反馈与交付闭环

目标：

- PR、CI、Review comments 和 release evidence 回流；
- Change 级反馈触发局部修复；
- 跨项目契约问题触发 Execution Plan 修订；
- Issue acceptance 决定最终关闭。

退出条件：

- 至少一个 Issue 经历外部 Review 反馈后自动或半自动恢复；
- 不完整的跨项目组合不会被错误交付；
- 关闭理由可审计。

### Horizon 6：Operations 与治理

目标：

- Session 监督、成本、并发、锁、stall、cancel、resume 和回放；
- Needs Attention 队列；
- 人类 guidance 和 approval；
- 项目、Issue 和运行三个视角一致。

退出条件：

- 用户可以在不了解内部文件布局的情况下处理异常；
- 每次失控运行都有明确停止机制；
- 运行成本和未完成前沿可见。

### Horizon 7：团队与远程执行

目标：

- Actor、Comment、Timeline 和通知；
- 外部 Tracker adapter；
- Local / Remote Runtime；
- 团队权限和 secret；
- 多机器任务认领与恢复。

进入条件：

- 本地 Issue 闭环稳定；
- 真实团队协作需求已经出现；
- 远程执行解决的是实际资源或协作问题，而不是架构想象。

### Horizon 8：自治软件开发平台

目标：

- Issue 按风险和策略进入不同自治级别；
- 系统能同时协调多个 Issue 和多个成员项目；
- 自动发现阻塞、依赖和资源冲突；
- 从历史 evidence 提炼可审查的项目知识；
- 人类主要处理目标、例外、风险和最终产品判断。

完成不是“零人工”，而是：

```text
系统能够独立推进可确定的部分，
在需要判断或授权的地方准确找到人，
并携带足够证据让人快速决策。
```

## 17. 路线健康指标

未来不再使用模块数量、endpoint 数量、表数量或 UI 页面数量衡量接近目标的
程度。

应优先记录：

| 指标 | 说明 |
| --- | --- |
| End-to-end Issue success rate | 进入执行的真实 Issue 中，完整验收关闭的比例 |
| Human intervention quality | 人类介入是否发生在真正需要判断的节点 |
| Recovery rate | 失败后可自动或有指导恢复的比例 |
| False Done rate | 被标记 Done 但验收或交付不完整的比例 |
| Routing correction rate | Dispatch 目标或依赖被人工修正的比例及原因 |
| Blocked time | Issue 在等待依赖、人类或 Runtime 上的时间 |
| Evidence completeness | 每个完成判断是否能追溯到运行和验收证据 |
| Cross-project success rate | 跨项目 Issue 的完整闭环成功率 |
| Cost per accepted Issue | 以验收后的 Issue 为单位计算成本，而非只统计 Session |
| Dogfood frequency | 新能力被 Rasen 自身真实开发使用的频率 |

其中最重要的两个指标是：

```text
真实 Issue 闭环成功率
False Done rate
```

## 18. 当前看板和版本决策

当前只读 Change/Task 看板属于过渡 projection，不是终极架构的一部分。

0.1.5 是否隐藏它、标记 experimental 或继续保留，应单独按发布体验决定。
该决定不能反向改变以下长期结论：

- 主看板最终以 Issue 为单位；
- 一个跨项目 Issue 只显示一次；
- 当前 portfolio 更接近 Execution Plan；
- 当前裸 Change 不是天然 Issue；
- Store member attribution 不能只依赖 Session cwd；
- Operations 与 Issue Board 最终分离。

## 19. 尚未锁定的长期选择

以下选择保持开放，直到真实切片提供证据：

- Issue 制品的最终目录和 schema；
- Change 长期放在 Store 还是目标成员项目；
- Execution Plan 是否独立版本化；
- 本地运行索引使用 JSON、SQLite 还是其他实现；
- Issue 与外部 Tracker 的同步所有权；
- PR/merge/release 的自动化边界；
- 何时需要 Remote Runtime；
- 何时需要认证和团队权限；
- 是否需要专用 Event Store；
- Web、TUI、IDE 和桌面端的最终组合。

开放实现选择不等于开放领域原则。无论最终选择什么技术，都不能破坏：

```text
Issue repo-blind
Execution Plan target-aware
Change single-primary-project
Agent starts from execution root
deterministic mechanics
evidence-backed completion
one Issue shown once
```

## 20. Harness 原始资料索引

本文件提炼自以下历史文档。它们是设计证据和失败档案，不是 Rasen 当前规格。

### 核心领域设计

- `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\harness\docs\linear-harness-design.md`
  - Linear 产品哲学；
  - Planning / Execution 二分；
  - Dispatch Agent 显式替代人类中间件；
  - Issue / Project repo-blind；
  - Task / Repository / Worktree repo-aware。

### 产品与 Pipeline 设计

- `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\harness\docs\office-hours-design-harness-product.md`
  - 管理、编排、执行三层；
  - 独立 Agent Session；
  - 文件交接；
  - Planner、Coder、QA、Reviewer、Shipper；
  - 背压门与反馈循环；
  - API、TUI、Web 的控制面设想。

### Ralph / Orchestrator 评审

- `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\harness\docs\office-hours-design-review.md`
  - 确定性调度与 LLM 判断；
  - Gate；
  - Memory；
  - 成本；
  - Human Channel；
  - 锁、录制、诊断、归档；
  - Driver 流式输出。

### Multica 产品与平台调研

- `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\harness\docs\research\multica-research-and-improvement-plan.md`
  - Agent 作为一等 Actor；
  - No Context Snapshot；
  - Event-driven invalidation；
  - Platform Bridge；
  - 单向前端依赖；
  - Runtime / Daemon；
  - 不应照搬 PostgreSQL、富文本和多租户。

### Agent backend 调研

- `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\harness\docs\research\multica-pkg-agent-research.md`
  - 狭窄 Backend 接口；
  - CLI spawn；
  - 结构化流事件；
  - session result；
  - cancel/resume；
  - per-model usage；
  - 真实 fixture 回放。

### 失败路线与证据

- `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\harness\docs\research\multica-full-migration-plan.md`
  - 16.5 周横向全量迁移；
  - 前端、认证、协作先于 Pipeline 闭环；
  - Pipeline 在 Phase 7 才桥接；
  - E2E 在 Phase 8 才执行。

- `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\harness\docs\migration-completion-review.md`
  - 以模块、表、端点和文件存在为主的约 95% 完成审计；
  - 明确不依赖运行时验证；
  - Pipeline、Dispatch 和完整 E2E 仍需实际确认。

这些文档最重要的共同遗产可以压缩成两句话：

> 规划域与执行域分离，是正确的终极结构。
>
> 从真实闭环向外生长，是到达这个结构的唯一可信路线。
