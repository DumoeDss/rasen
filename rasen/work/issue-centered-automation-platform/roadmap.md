# 以 Issue 为中心的自动化平台路线

本文是 `goal.md` 的自下而上实施路线。它不是一次性平台建设清单，而是一组
必须依次通过真实日常开发验证的垂直切片。

终极产品方向、Harness 可继承思想和失败经验见
[`north-star.md`](./north-star.md)。本路线允许随 dogfood 结果调整，但不得
违反其中“闭环先于平台”和“完成必须有运行证据”等开发戒律。

> **版本边界决策（2026-08-01）：0.2.0 只收口完整 ECP；本文件 Phase 0–8 的
> Issue、Execution Plan、Dispatch、`auto-decompose` 上移与跨项目能力统一属于
> 0.3.0。** 在子 Direction
> [`executable-composite-pipelines/`](./executable-composite-pipelines/README.md)
> 通过前，Phase 0–8 全部保持 Later。
>
> **补充（2026-08-07）：0.3.0 另接收一项非 Issue 层的研究事项——macOS durable
> 进程权威。** 它由 0.2.0 经显式 scope decision 移交，不属于 Phase 0–8，也不构成
> Phase 0–8 的前置条件。详见 [§13](#13-从-020-移交的非-issue-研究事项2026-08-07)。

## 0. 2026-07-29 ECP 校准快照（已由子 Direction 接管）

> 本节保留首次校准时的事实与路线推理，但不再拥有 ECP Target State、Roadmap
> 或 active Slice。ECP 的当前权威入口是
> [`executable-composite-pipelines/`](./executable-composite-pipelines/README.md)。
>
> **发布线修订（2026-07-30，用户拍板）：本节及其链接文件名里的 `0.1.6`
> 里程碑标签，现在指 `0.2.0`。** `0.1.6` 已改定位为 `0.1.5` 的 bug 修复线，ECP
> 范式落在 `dev/0.2.0`。快照文本与既有审查文件名一律保持原样（它们是历史事实），
> 权威重命名说明见
> [`deterministic-pipeline-kernel-research.md`](./executable-composite-pipelines/deterministic-pipeline-kernel-research.md)
> 头部的「发布线修订」条。
> 父路线只保留“ECP 通过后再进入 Issue 层”的依赖关系。

### 0.1 校准结论

当前工作位置是 North Star 的 **Horizon 0：Change 自动化内核**。现有
Phase 0–8 描述的是 ECP 闭环之后的 Issue 层路线；在 ECP 产品闭环通过前，
它们全部属于 Later，不应与 ECP 并行铺开。

ECP 拆分后的 authority chain：

```text
north-star.md
  ├─> goal.md（父级 legacy Target State input，保持原样）
  │    -> roadmap.md（本文件：ECP 通过后的 Issue 路线）
  └─> executable-composite-pipelines/target-state.md
       -> executable-composite-pipelines/roadmap.md
            -> executable-composite-pipelines/slices/<selected-slice>
```

没有把父级 `goal.md` 擅自迁移为 `target-state.md`。ECP 的详细方向与证据来自：

- [`ECP 当前聚焦区`](./executable-composite-pipelines/README.md)；
- [`deterministic-pipeline-kernel-research.md`](./executable-composite-pipelines/deterministic-pipeline-kernel-research.md)；
- [`docs/architecture/executable-composite-pipelines.md`](../../../docs/architecture/executable-composite-pipelines.md)；
- [`0.1.6 ECP 完成度审查`](../../../docs/audits/0.1.6-executable-composite-pipelines-completion-review-2026-07-29.md)。

### 0.2 当前真实基线

截至 2026-07-29，0.1.6 不是“所有 Pipeline 已经迁移到 executable
composite pipeline”的状态：

- 7 个内置 Pipeline YAML 均能通过静态校验，但当前 `pipeline show` 对
  7/7 都只报告 legacy；
- 只有形状严格匹配 root DAG 的 `bug-fix`，在启动时补充 execution profile
  后，能够进入现有 reconciler；
- authored v2 定义具有完整节点词汇，但会被明确标记
  `executable: false`，原因为 `ecp_v2_runtime_unavailable`；
- Runtime lowerer 只接受 authored v1 的特定 `bug-fix` root-DAG 形状，
  RuntimePlan 只执行 `atomic | finish`；
- `CompositeRef`、`BoundedLoop`、`GoalLoop`、`FanOut`、`Join` 尚未进入
  reconciler 解释边界；
- Canvas 只可编辑 `AtomicStage`、`Gate`、`Choice`、`Finish`，组合、循环、
  扇出和汇合仍是只读 later-slice 节点；
- root-DAG spine 已有较强自动化测试证据，但真实复杂 Pipeline 的
  Definition → Canvas → Runtime → Operations → E2E 闭环尚未成立；
- 现有 Change 制品的“artifact complete”不能替代实现任务、验证、归档和
  发布证据；0.1.6 的版本清单、changelog 和 tag 也尚未形成一致发布事实。

因此，当前已得到的是 **root-DAG execution spine**，不是完整 ECP 产品。

### 0.3 ECP 完成状态

只有以下结果同时可观察，才允许宣称 “ECP 真实完整实现”：

1. **一个定义真相**
   v2 authored definition 成为组合语义的 canonical truth；v1 只作为有明确
   退场条件的兼容输入，不再形成第二套执行主线。

2. **内置与自定义同构**
   除属于 Issue/Dispatch 层的 `auto-decompose` 外，所有 Change-level
   内置 Pipeline 与 Canvas 创建的 Custom Composite 都经过同一套
   validate → lower → reconcile → persist 路径。

3. **完整节点语义可执行**
   `AtomicStage`、`Gate`、`Choice`、`Finish`、`CompositeRef`、
   `BoundedLoop`、`FanOut`、`Join` 均有确定的状态转移、失败传播、预算和
   恢复语义；GoalLoop 是有领域投影的 bounded composite，而不是另一套
   Runtime。

4. **一个 canonical Run**
   CLI、API、Canvas 和 Operations 观察并控制同一个 Run 与同一份持久状态；
   `rasen-auto`、`rasen-goal`、`rasen-review-cycle` 等入口只负责选择和启动，
   不在 prompt 或命令层私自推进机械状态。

5. **创作与运行对称**
   Canvas 能创建、引用、折叠、展开和校验 composite/loop/parallel 结构；
   保存后的定义可直接运行，运行结果可回投到相同图结构。

6. **故障下仍然正确**
   重启、resume、cancel、timeout、预算耗尽、部分并行失败、loop 达到上限和
   人工 Gate 等场景均不会重复执行已完成节点，也不会静默误报 Done。

7. **真实闭环证据**
   至少覆盖 ReviewCycle、Custom Composite、GoalLoop 和 parallel
   full-feature 四种真实 Rasen dogfood；每种都保存 definition revision、
   lowering 结果、Run/Stage/Session 记录、外部验证和用户可理解的终态。

8. **发布事实一致**
   相关 Change 验证并归档，文档、manifest、changelog 和 tag 对同一版本
   给出一致结论；任何 remaining limitation 都被明确列为非完成项。

### 0.4 路线排序

以下内容是拆分前的路线快照。当前顺序、Slice 边界和验收以
[`executable-composite-pipelines/roadmap.md`](./executable-composite-pipelines/roadmap.md)
为准。

```text
NOW
  ECP-1 ReviewCycle 纵向闭环

LATER（严格按顺序）
  ECP-2 Custom Composite 同构闭环
    -> ECP-3 GoalLoop 领域闭环
      -> ECP-4 Choice / FanOut / Join 并行闭环
        -> ECP-5 ECP 产品与发布闭环
          -> Issue Phase 0–8

NOT NOW
  auto-decompose 的 ECP 化、Issue Dispatch、跨项目执行图、
  Remote Runtime、团队权限、通知和 Forge 平台增强
```

#### ECP-1：ReviewCycle 纵向闭环

**用户能力**

用户运行一个带独立复审的真实 Change；review finding 能生成有界修复轮次，
修复后由独立 reviewer 重审，直至通过、达到上限或显式升级。

**最小完整范围**

- v2 `CompositeRef + BoundedLoop` 的校验、lowering 和 reconciler 语义；
- ReviewCycle domain reducer，以及 round、finding、fix、re-review 的持久投影；
- `bug-fix` 和 `small-feature` 的复杂反馈路径迁移到该 composite；
- Canvas 可创建、配置和检查 ReviewCycle/BoundedLoop；
- Operations 展示当前轮次、finding、预算、阻塞原因和下一可执行节点；
- crash/restart 后从持久状态恢复，不重跑已完成的 review/fix；
- `rasen-review-cycle` 变成 thin launcher，不再拥有第二套循环。

**退出证据**

一个真实 finding 从独立 review 产生，触发真实修复和再次独立 review；正常
通过路径、轮次耗尽路径和中途重启路径都有可审计记录。仅有 schema、fixture、
单元测试或 UI mock 均不算退出。

#### ECP-2：Custom Composite 同构闭环

**用户能力**

用户在 Canvas 声明一个带命名输入、输出、退出结果和局部预算的 composite，
把它作为 `CompositeRef` 嵌入 Pipeline，保存后直接运行。

**最小完整范围**

- declaration/body、输入输出映射、outcome ports 和局部配置；
- 创建、引用、折叠、展开、复制和删除的 Canvas 交互；
- nested composite、递归、嵌套循环、能力和预算边界的静态验证；
- built-in composite 与 custom composite 使用相同的 compiler/runtime contract；
- 运行投影能从 composite 汇总到 root，又能下钻到内部节点。

**退出证据**

一个非内置、由 Canvas 创建的 composite 在真实 Change 中完成成功、失败和
恢复路径；导出再导入后语义保持一致。

#### ECP-3：GoalLoop 领域闭环

**用户能力**

用户选择 measure、evaluate 或 research 目标循环；系统通过同一个
BoundedLoop 内核迭代，并用领域投影展示基线、当前结果、门槛、剩余预算和
停止原因。

**最小完整范围**

- Measure、Evaluate、Research 共用 ECP loop mechanics；
- 三类目标使用独立 domain reducer，不污染通用 reconciler；
- `goal-loop-measure`、`goal-loop-evaluate`、`goal-loop-research` 迁移；
- `rasen-goal` 只负责意图分类、定义选择和启动；
- 人工停止、门槛达成、预算耗尽、无进展和恢复语义明确。

**退出证据**

至少一个 measure/evaluate 和一个 research 真实运行经历多轮推进，并对
“为什么继续/为什么停止”给出可重放的机械证据。

#### ECP-4：Choice / FanOut / Join 并行闭环

**用户能力**

用户运行 `full-feature`：条件分支选择唯一合法路径，可并行工作受并发和预算
约束，Join 根据 required/optional/cancelled/superseded 语义确定推进结果。

**最小完整范围**

- Choice 条件求值和已选分支持久化；
- FanOut/Join lowering、ready-set、并发上限和确定性汇合；
- 部分失败、取消、超时、重试和 downstream suppression；
- Canvas 并行结构的创建与合法性反馈；
- Operations 的并行泳道、关键阻塞和未完成前沿；
- `full-feature` 迁移到 canonical reconciler。

**退出证据**

真实运行至少覆盖一次并行成功、一次部分失败后恢复、一次取消或超时；重启
后 ready-set 不漂移，Join 不重复消费结果。

#### ECP-5：ECP 产品与发布闭环

**用户能力**

用户从 CLI、API 或 Canvas 选择任一 Change-level 内置 Pipeline 或 Custom
Composite，看到一致的可执行性、启动方式、运行状态、控制动作和最终证据。

**最小完整范围**

- `bug-fix`、`small-feature`、`full-feature` 和三个 GoalLoop 内置定义全部
  报告 reconciler；`auto-decompose` 明确归到后续 Issue/Dispatch 路线；
- compatibility projection 只服务迁移，并写明 owner、调用者、退场门槛；
- root/composite/loop/parallel 的恢复与故障矩阵全部通过；
- `pipeline validate/show/run`、API、Canvas 和 Operations 结果一致；
- 用 ECP 路线自身完成至少一个后续真实 Change，证明 dogfood；
- 清理相互矛盾的文档和完成声明，完成验证、归档和发布事实收敛。

**退出证据**

重复执行 0.1.6 完成度审查时不再出现 Definition 可表达但 Runtime 不可执行、
Canvas 只读、内置 Pipeline legacy-only 或发布版本漂移；所有完成结论均可
追溯到真实运行记录。

### 0.5 当前 Active Slice

父 Direction 不再设置 ECP active Slice。原
[`ecp-review-cycle-vertical-closure`](./slices/ecp-review-cycle-vertical-closure/spec.md)
已作为规划位置被子 Direction 取代。

ECP 当前为 draft，候选首个 Slice 是
[`review-cycle-vertical-closure`](./executable-composite-pipelines/slices/review-cycle-vertical-closure/spec.md)；
只有用户确认后，子 Direction 的 `work.yaml` 才会设置唯一 `activeSlice`。

## 1. 路线原则

### 1.1 每个切片必须跑通真实工作

每个阶段至少选择一个 Rasen 自身的真实 Issue 进行 dogfood。以下证据不能
单独作为完成标准：

- 新目录或 schema 已创建；
- API endpoint 已存在；
- UI 页面可以打开；
- 单元测试通过；
- smoke 脚本存在；
- Agent 进程能够启动。

每个切片的最低证据应包括：

- Issue 和 Execution Plan 的真实制品；
- 实际使用的成员项目和 cwd；
- Run 与 Session 记录；
- Pipeline 输出和验证结果；
- Change 的完成或失败状态；
- Issue 汇总状态；
- 人工验收或自动验收结果。

### 1.2 CLI 和现有 Pipeline 先行

- 现有 Change、Run 和 Session 继续作为执行基础；现有 Pipeline 只有在完成
  上述 ECP canonical runtime 迁移后，才可被视为稳定执行基础。
- 新 UI 先做真实文件和运行状态的读模型。
- UI 不创建一套与 CLI、Git 文件并行的状态真相。
- 在核心闭环稳定前，不优先建设评论、通知、权限和 Forge 平台能力。

### 1.3 一次只提高一个复杂度维度

推荐顺序：

```text
单 Issue / 单 Change / 单项目
  -> 单 Issue / 多 Change / 单项目
      -> 单 Issue / 多 Change / 多项目
          -> 自动项目路由
              -> Issue 级验收和交付
```

## 2. Phase 0：锁定语义与真实基线

> 进入条件：ECP-5 产品与发布闭环已通过。未通过时，本阶段保持 Later。

### 用户能够做什么

用户可以清楚区分：

- Issue：为什么做、什么算完成；
- Change：在哪个项目执行的工程切片；
- Run：一次真实执行；
- Session：一个真实 Agent 进程。

### 系统需要明确什么

- Store 是规划根。
- Change 有唯一主成员项目。
- Agent 从成员项目 cwd 启动。
- Store 作为附加规划上下文。
- 当前 portfolio 被视为 Execution Plan 候选，而不是最终 Issue。
- 当前 UI `Task` 不是稳定领域实体。

### 完成证据

- 选定一个即将真实实施的单项目 Issue。
- 记录它的 Issue 信息、目标项目、Change 和验收条件。
- 从目标项目启动一次现有 Pipeline，确认 cwd、Store 上下文和写入边界。

## 3. Phase 1：单 Issue、单项目、单 Change

### 用户体验

用户创建或登记一个 Issue，将它关联到一个现有 Change，然后启动执行。
看板显示一张 Issue 卡片，状态来自真实 Change Run。

### 最小实现

- 一个稳定的 Issue 身份和最小制品；
- Issue 到单个 Change 的显式引用；
- Change 到成员项目的显式绑定；
- 从绑定项目 cwd 启动 Agent；
- Issue 详情显示该 Change 的 Run 和 Session；
- Issue 的 phase、health 和 progress 从真实状态计算；
- Issue 只有在验收通过后才进入 Done。

### 暂不实现

- auto-decompose；
- 跨项目依赖；
- 评论和通知；
- PR 自动化；
- 复杂看板筛选；
- 完整 DAG 可视化。

### 完成证据

一个 Rasen 自身的真实 Issue 完成：

```text
Issue
  -> 单 Change
  -> 正确项目 cwd
  -> Pipeline
  -> 验证
  -> Issue 验收
```

## 4. Phase 2：单 Issue、单项目、多 Change

### 用户体验

一个较大的 Issue 被拆成同一成员项目中的多个 Changes。用户能看到：

- Changes 的依赖顺序；
- 哪些可以并行；
- 每个 Change 的独立运行和验证；
- Issue 的总体进度和关键阻塞。

### 最小实现

- 复用现有 auto-decompose、portfolio 和依赖 DAG；
- 将分解结果保存为 Issue 的 Execution Plan；
- 使用显式 Change 引用，不依赖名称前缀推断；
- 每个 Change 独立运行、重试和验证；
- Issue 状态尊重 required、optional、cancelled 和 superseded 节点；
- 失败和阻塞进入 health，而不是破坏 phase。

### 完成证据

一个真实 Issue 至少产生两个 Changes，其中：

- 存在一个依赖关系或一次并行执行；
- 至少一个 Change 独立完成并回流；
- Issue 在部分完成时不误报 Done；
- 全部必需 Change 完成后仍需 Issue 验收。

## 5. Phase 3：单 Issue、多个成员项目

### 用户体验

一个 Issue 同时涉及客户端、服务端或官网等多个成员项目。主看板中只显示
一张 Issue 卡片，详情按成员项目分组。

### 最小实现

- Execution Plan 节点增加稳定的 `target project`；
- 一个 Change 只绑定一个主项目；
- 每个项目可以拥有多个 Changes；
- Agent 从每个 Change 的目标项目 cwd 启动；
- 跨项目依赖可以阻止下游 Change 过早运行；
- Issue 卡片显示项目徽标和各项目进度；
- Issue 详情显示项目泳道或项目分组；
- 项目 chips 作为筛选器，不作为顶层所有权分区。

### 初期允许人工操作

本阶段允许用户手工选择和修正目标项目。不要为了自动路由而延迟跨项目
闭环的首次验证。

### 完成证据

一个真实 Issue 至少涉及两个成员项目，并满足：

- 两个项目中的 Agent 都从正确 cwd 启动；
- Store 规划上下文对两边均可用；
- 任一项目的失败或阻塞会正确回流到同一个 Issue；
- Issue 不会在全局看板中被复制；
- 每个 Change 的 Git 和验证边界保持独立。

## 6. Phase 4：auto-decompose 生成目标项目绑定

### 用户体验

用户提交 Issue 后，系统给出一份可审查的执行计划：

```text
客户端：Change A、Change B
服务端：Change C
官网：Change D
依赖：C -> A；C -> D
```

用户可以：

- 接受计划；
- 修改目标项目；
- 调整依赖；
- 合并或继续拆分 Change；
- 标记 required 或 optional；
- 确认后启动执行。

### 最小实现

auto-decompose 输出至少包含：

- Change 标识和目标；
- target project；
- dependency edges；
- required/optional；
- 建议 Pipeline；
- 分解理由或不确定性。

自动分解是一次可修订的 Dispatch，不是持续由 LLM 决定每一个运行步骤。
计划确认后，后续调度尽量由确定性的 Pipeline 和依赖规则推进。

### 完成证据

- 对一个真实跨项目 Issue 生成执行图；
- 人工至少修正一次目标或依赖，以验证纠正路径；
- 修正后的计划被真实执行；
- 历史计划和实际执行的对应关系可以追踪。

## 7. Phase 5：跨项目依赖、并行和重规划

### 用户体验

用户能看到跨项目关键路径，并能处理：

- 上游 Change 失败；
- 某个 Change 被取消；
- 新发现工作需要增加 Change；
- Change 目标项目需要调整；
- 某些 Change 可以并行；
- 某个节点被新的节点替代。

### 最小实现

- 跨项目 dependency gate；
- ready 节点的确定性计算；
- required、optional、cancelled、superseded 语义；
- Execution Plan 修订或版本；
- 重规划后保留已运行历史；
- “Needs Attention” 聚合入口；
- 防止一个失败节点被其他运行节点掩盖。

### 完成证据

在真实 Issue 中制造并处理一次可恢复失败或重规划，确认：

- Issue phase 和 health 分离；
- 下游节点不会错误启动；
- 已完成节点不被重复执行；
- 计划修订没有改写历史证据；
- Issue 最终仍可通过验收关闭。

## 8. Phase 6：Issue 级 Review、Delivery 与 Acceptance

### 用户体验

多个项目的 Changes 完成后，Issue 进入统一 Review，而不是各自结束后失去
整体上下文。

用户可以检查：

- 每个项目的验证报告；
- Commit 或 PR；
- 跨项目契约是否一致；
- 是否满足 Issue 验收标准；
- 是否允许部分可选节点延期；
- 是否可以关闭 Issue。

### 最小实现

- Change 级交付证据回流到 Issue；
- Issue acceptance checklist 或可执行 gate；
- 所有必需节点完成的判断；
- 可选节点延期或取消的明确记录；
- Review 和 Waiting Human 状态；
- 显式 Issue close/accept 动作；
- Done 不再由“所有 Changes archived”直接推导。

### 完成证据

一个真实跨项目 Issue 从 Planning 完整推进到 Done，且关闭证据包含：

- Execution Plan；
- 所有必需 Changes；
- 每个 Change 的运行和验证结果；
- 交付证据；
- Issue 验收结果；
- 最终状态推导说明。

## 9. Phase 7：界面收敛

本阶段只在前述闭环已经真实运行后进行。

### 9.1 Issue Board

- 一张卡对应一个 Issue；
- Planning、Ready、Active、Review、Done；
- phase、health、progress 分离；
- 项目 chips 作为筛选；
- 卡片只显示摘要和最重要的注意事项。

### 9.2 Issue Detail

- Issue 背景和验收；
- Execution Plan；
- 按成员项目分组的 Changes；
- 跨项目依赖；
- Run、Session、报告和交付证据；
- 人工决策和 Needs Attention。

### 9.3 Operations

- 活跃和异常 Sessions；
- 实际 cwd；
- Issue/Change/Run 归属；
- resume、retry、stop；
- 项目级执行筛选。

### 9.4 Unlinked Changes

- 没有关联 Issue 的历史或临时 Changes；
- 允许挂接到已有 Issue；
- 允许创建新的单 Change Issue；
- 不把裸 Change 静默伪装成稳定 Issue。

### 完成证据

界面所显示的每项状态都能追溯到 Git 制品或真实运行证据。删除或重建 UI
缓存后，仍能恢复一致视图。

## 10. Phase 8：平台增强能力

只有核心闭环稳定后，才按真实需求选择以下能力：

- GitHub/GitLab Issue 同步；
- PR 自动创建、合并和关联；
- 评论与决策线程；
- 通知和订阅；
- 团队权限；
- 远程 daemon；
- 发布协调；
- 审计与统计；
- 更丰富的移动端或 Web 操作。

每一项仍需以真实 Issue 旅程为切片，不建立独立于核心领域模型的第二套
状态系统。

## 11. 当前看板的处理边界

当前看板的发布策略与本路线分开决定。可选方案包括：

- 保持 experimental 标识；
- 从默认导航隐藏；
- 继续作为只读 Change/Session 诊断页；
- 在新 Issue Board 可用后替换。

无论 0.1.5 如何处理，都不应：

- 为保留当前 `Task` 抽象而把它直接定义成 Issue；
- 将成员项目 chips 固化为顶层所有权分区；
- 把 Session cwd 变成项目绑定真相；
- 为美化当前卡片而提前承诺错误的信息架构。

## 12. 第一条推荐的真实黄金路径

> 这条 0.3.0 Issue 级黄金路径只在完整 ECP 0.2.0 通过后启动；ECP 的当前
> NOW 候选以子 Direction Roadmap 为准。

下一步最值得验证的不是完整平台，而是：

```text
1. 选择一个真实的 Rasen 单项目 Issue。
2. 创建最小 Issue 制品和验收条件。
3. 显式绑定一个已有 Change 和目标项目。
4. 从目标项目 cwd 启动现有 Pipeline。
5. Store 作为附加规划上下文。
6. 将 Run、Session 和验证结果回流到 Issue。
7. 在验收通过前保持 Review。
8. 显式接受后进入 Done。
```

这条黄金路径通过后，再进入“单项目多 Change”；不要同时建设跨项目路由、
复杂看板和 Forge 集成。

## 13. 从 0.2.0 移交的非 Issue 研究事项（2026-08-07）

本节登记由 0.2.0 经显式 scope decision 移交给 0.3.0 的事项。它们不属于 Phase 0–8
的 Issue 层路线，也**不是** Phase 0–8 的前置条件；单独排期，单独取证。

### 13.1 macOS durable 进程权威

**背景。** ECP-7 的独立审查实证否证了 POSIX process group 作为递归进程权威的假设：
workload 调用 `setsid()` / `setpgid()` 即可逃出保留的进程组，逃逸后既杀不掉也看不见。
Linux 与 Windows 各有内核强制的替代方案（user+PID namespace guardian / 经认证安装
broker 的不可迁移 cgroup-v2 leaf；Job Object 的 suspended assign-before-run +
breakaway-disabled + last-handle 不变量），macOS 则没有等价的非特权原语——XNU 既无
PID namespace 也无 cgroup，Mach task 不是层级化终止单位，`kqueue`/`NOTE_TRACK` 只
观察不强制且会丢事件，`proc_listchildpids` 属于被明令禁止的 PID-tree 采样。

**0.2.0 的处理（已生效；2026-08-07 同日两次修订）。** 执行后端按能力分级：macOS 交付
`in-tool` 后端；同日 Step 1 决定另交付**显式声明的 best-effort `hosted`**（POSIX
进程组，`exactCancel: false`/`scopeEmptyProof: false`）；同日锁定决策 13 进一步把
该 best-effort 档统一为三 OS 的 0.2.0 `hosted` 形态（见 §13.2）。请求当前平台不具备
的能力档时返回类型化 `authority-unavailable`，绝不静默改路由。这是**声明的能力
边界**，不是 silent unsupported。

**0.3.0 需要研究并拍板的。** 候选方向已有研究记录但**均未获批准**：

1. macOS 27 signed/entitled dual Endpoint Security descendants clients，配套
   Apple entitlement、Developer ID 签名/公证、最低版本承诺与真实 macOS 27 runner；
2. Virtualization.framework VM 边界——完整但显著扩张 runtime 与分发；
3. 修改 macOS support promise 本身。

研究输入见
[`ecp-native-process-capsule-closure/evidence/architecture-replan.md`](../../changes/ecp-native-process-capsule-closure/evidence/architecture-replan.md)
与子 Direction 的 Architecture Replan 2/3。

**不因移交而免除的义务。** ECP-8 仍须在真实 macOS 上取得两条 receipt：`in-tool`
后端可用，以及 best-effort `hosted` 的语义如实上报（取消终态
`cancelled / emptiness-unproven`、能力声明启动前可见）。缺失时必须显式记为 0.2.0
已知缺口，不得默认写成通过。

### 13.2 Linux/Windows 内核强制进程权威（2026-08-07 锁定决策 13）

**背景。** ECP-7 为 Linux（user+PID namespace guardian）与 Windows（Job guardian +
attestation）各建成一个内核强制权威 crate 并两度冻结（Linux `89f6c1d5`、Windows
`fc49a7c2`/helper `367666f6`），guardian/attestation/receipt 机器完整、receipt 齐备。
但 2026-08-07 全面审查证实：生产 hosted 路径从未接入这两个 crate（构造点
`router.ts:639` 上非 darwin 平台走遗留 ProcessCapsule），且两 crate 的取消路径均被
测量证实端到端不可用——Linux `open-runtime --deadline-ms` 被丢弃致 2 s 死桥（D4）、
activate 失败一律误标 `reference-invalid`（D2）；Windows 缺 frame 保真 `open-runtime`
verb，stdout 复用构成 receipt 伪造面。修复需要 Windows 侧全新协议设计与两 crate 各
一轮 break/re-freeze/全仓 re-bind，且历次波中新 Blocker 发现率未收敛。

**0.2.0 的处理（已生效）。** 操作者决定（锁定决策 13）：0.2.0 `hosted` 三 OS 统一为
显式声明的 best-effort 档（POSIX 进程组 / Windows Job object，
`exactCancel: false`/`scopeEmptyProof: false`、终态 `cancelled / emptiness-unproven`）；
两个 crate 及全部机器、receipt、evidence、handoff **保留在 git 作为升级路线资产**，
已知缺陷（D4/D2/verb，修法与拒绝理由均有 evidence 文件）随资产记录在案，0.2.0 不
修复、不取新 receipt。

**0.3.0+ 重启时的入口。** 按 D4/D2/verb 三缺陷起修（一次 break、一次 re-freeze、
一次全仓 re-bind per crate），不必重做既有审查；资产清单见子 Direction
`slices/session-execution-and-self-hosting/plan.md` Architecture Replan 6。

## 14. Issue 层提前启动的 scope decision（2026-08-17）

操作者拍板：ECP-7 尾段（`ecp-session-self-hosting-vertical-proof`）与 ECP-8 收尾延后
（见子 Direction result.md 的 2026-08-17 reconcile），0.3.0 Issue 层即刻启动。首个
portfolio 为 `issue-layer-phase1`（worktree `feat/issue-layer`，自 dev/0.2.0 `2fc92079`
切出；三 child 串行：issue-status-projection → issue-execution-binding →
issue-acceptance-close，各走 `small-feature`）。按「版本边界」条款显式登记：

- 本文件 §2 Phase 0 的进入条件（ECP-5 产品与发布闭环已通过）被本决定实质放宽为
  「ECP-6 passed、ECP-7 五个 child 已交付归档、ECP-8 未收尾」的已知基线；
- Issue 层不吸收 ECP-8 的任何发布义务；ECP-8 恢复时其 OS × 后端 receipt 矩阵、
  legacy engine 退休决定与发布事实责任全部不变；
- Issue 层首竖切走 §12 黄金路径（单 Issue / 单项目 / 单 Change，CLI-first），
  不提前铺开跨项目路由、auto-decompose 上移与 Phase 7 界面收敛；
- 与并行会话的协调：canvas gesture→IR compiler 工作流位于
  `.claude/worktrees/canvas-ir-compiler`（`feat/canvas-gesture-ir-compiler`，基线
  `74568906`），触面为 `packages/ui/src/canvas/*`、`pipelines-ui` spec 与冻结的
  `src/core/pipeline-registry/`，与 Issue 首竖切零文件交集；若后续 Issue 切片
  需触碰上述区域，须先核查对方 worktree 的完成状态。

### §14 结果回写（2026-08-17，portfolio 闭环）

`issue-layer-phase1` 已全量交付并归档：PR #168 合并（merge `57b1b1c1`，CI 一次全绿，
三 OS 分片 + lint/typecheck + UI build 零 flake），parent 归档 `a717ae01` 已推
dev/0.2.0。三个 child（issue-status-projection / issue-execution-binding /
issue-acceptance-close）各经 1 轮 review-loop CLEAN 后 ship+archive，7 份 spec delta
同步（3 新能力 + 4 MODIFIED）。黄金路径证据：三轴投影的真实转移 receipt（C1×3）、
四条启动路线 + 从无关目录经 workspace-index 的归属读（C2×5）、验收门的 HOLD（exit 1
具名拒绝）与 CLOSE 全链（C3×4）——其中 C3 的 CLOSE 直接以本 portfolio 已归档的
children 为 plan 节点完成，即 meta-dogfood。Phase 0–1 的竖切据此成立；Phase 2
（单 Issue 多 Change 的正式推进）与后续阶段保持 Later，按本路线继续。

### §14.1 Phase 2 激活（2026-08-20，campaign 启动）

操作者授权 campaign：Issue 层剩余切片（Phase 2–7）由 LEAD 逐片 direction 激活并
auto 推进；每片一个 portfolio，循 PR #168 模式（PR → CI 监控 → 绿即合并）。
Phase 2（单 Issue / 单项目 / 多 Change）现为 activeSlice，portfolio
`issue-multi-change-execution`，分支 `feat/issue-phase2`（自 dev/0.2.0 `71b64a16`）。
ECP-7 尾段与 ECP-8 维持延后（§14 与子 Direction 2026-08-17 reconcile 不变）。

### §14.2 Phase 2 结果回写（2026-08-20，portfolio 闭环）

`issue-multi-change-execution` 全量交付：PR #171 合并（merge `30b25dd6`，CI 全绿——
一次 Windows shard 超时类 flake 重跑后过），parent 归档 `24d7f58e` 推 dev/0.2.0。
三 child：issue-plan-publication（portfolio→Execution Plan 修订发布通道）/
issue-node-lifecycle（required/optional/cancelled/superseded 四态全栈语义）/
issue-persistent-baseline（`store setup --layout 2` + 本机第一个持久 store
`issue-registry`）。**黄金路径多 Change 格真实闭环**：Issue #1 即本 portfolio——
从真实 run-state 发布 plan、随 children 完成活体观察（2/3 门持→3/3 review）、
显式 accept、终态 **done · healthy · 3/3**，验收记录 commit 于 store
（证据：archive/2026-08-20-issue-multi-change-execution/evidence/）。
Phase 3 follow-ups 已记账：claimant-alias keying 归属、openFindings schema 容差、
seeding 产品面。Phase 2 完成；Phase 3（多成员项目）激活。

### §14.3 Phase 3 结果回写（2026-08-21，portfolio 闭环）

`issue-cross-project-execution` 全量交付：PR #172 合并（merge `4bac13d7`，CI 首轮全绿）。
三 child 全部首轮 review CLEAN（零修复轮）：issue-target-project-binding（plan 节点
target project + membership 双路径校验，Phase-2 修订字节稳定）/ issue-cross-project-gating
（跨项目依赖门 + WORK-basis 阻塞显示，结构性保证）/ issue-project-grouped-views（项目
泳道 + progressOver 单谓词）。**Issue #2 双真实成员项目（rasen + rasen-site）活体运行**：
两泳道投影、跨项目门具名拒绝、site 节点真实 terminal（rasen-site main `2dc9e31` 真实
docs 工作与构建验证）。

**Leg 4 完成于 2026-08-21（推迟→解锁→关闭）**：先因 workspace-pair 机器自相矛盾
（side-planner 祝福 main-checkout 执行、containment 层判等 veto——`isContainedIn` 把
equality 当 inside）诚实推迟；随后 pair 经**设计好的默认目的地路线**落地（MAX_PATH 环境
坎由 `--planning-worktree` 短根参数化解），worktree 聚合 4/4、site 节点经 workspace-index
定位——C2 设计路线原样走通；conditions 0001 发布、门 4/4/waiting-human/0 problems、
显式 accept、终态 **done · healthy · 4/4**（store commits 2f61fbe/2446e14）。等式矛盾
仍为真（main-checkout 路线被 veto），降级为 Phase 4 应修项而非阻塞项。Phase 4 候选
清单另含：membership hint 翻转宿主规划根解析（legacy-flat 无法归档接缝）、add-project
拒绝文案过诺 + `--planning` 旗标、partial store planning 缺口、claimant-alias keying 归属
（本机镜像已三份）。Phase 3 完成；Phase 4（auto-decompose 上移）激活。

### §14.4 Phase 4 结果回写（2026-08-21，portfolio 闭环）

`issue-autodecompose-uplift` 全量交付：PR #173 合并（merge `23513cd2`；CI 第四轮全绿——
两处预算修复随 PR：Windows shard 30→40m（套件增长越过 job 预算）、archive fault-matrix
60s（三成员越过单测预算），均零断言失败类）。三 child：issue-workspace-containment-fix
（等式缝一刀修，main-checkout pair 路线解锁）/ issue-autodecompose-graph（**0.3.0 边界
诚实跨越**：registry 恰一文件 +30/−0 的 truthful verdict；第三发布源 --from-decomposition；
建议字段；Issue #3 staging）/ issue-autodecompose-review-flow（intent 节点 lifecycle、
suggestion 感知发射链、未知字段具名拒绝、修订 delta 可见性、**confirm 读-组-报动词**）。

**Issue #3 黄金关闭**（LEAD 亲手）：seed（经 deriveChangeInstanceId 正确推导——朴素
ci_<seed> 形状被当场抓正）→ 修订 0004 晋升 → 第三次镜像（openFindings 规范化）→
conditions 0001 → 门 2/2 → accept → **done · healthy · 2/2**（store commits
8c65d14/e982cda/a478d37）。Phase 5 移交：legacy-seed-reads-fresh（确定性调度器须裁决：
outcome-bearing seed vs archived-legacy-as-complete）、pinned-confirmation anchor
（拒绝理由即设计输入）、claimant-alias keying 归属（镜像已三份）、foreign-repo keying +
cleanup 不对称、本机全量套件分箱配方（≤25 文件/次）。Phase 4 完成；Phase 5（跨项目
重规划）激活。

### §14.5 Phase 5 结果回写（2026-08-22，portfolio 闭环）

`issue-cross-project-replanning` 全量交付：PR #174 合并（merge `e488d95a`，CI 首轮全绿
——P4 预算修复持续生效）。三 child：issue-ready-set-scheduling（**单一 ready-set 推导**
三面共享 + 读侧 legacy 裁决：真 legacy 读完成、损坏 v2 fail-closed——Issue #3 的镜像之痛
除根）/ issue-revision-history-preservation（验收记录携带排除账，字节同一；连续性 +
retarget 谱系钉死）/ issue-needs-attention（`store attention` 五词汇聚合入口：failure
永不被运行掩盖、blocked-behind 单跳爆炸半径、缺失即真相、零缓存零第二真相）。

**Issue #4 黄金关闭**（LEAD 亲手，含两处诚实处置：冗余归档种子撤回避 M-1 形状、被
cleaner 清掉的 ephemera 依归档事实重建）：3/3 → accept → **done · healthy**（store
`3af7041`）。**注册表现状：四个 Issue 全部 done，attention 扫描零项**。

Phase 5 §8 退出判据全部落地（p5-exit-criteria.md 六 receipts 在 g-003 归档）。
Phase 6 移交：attention 直钉 invalid-archive-record（直接性缺口）、--issue 拒绝的
unsearched-refs 语义务、常驻开放账（claimant-alias keying、pinned-anchor、
foreign-repo workspace）。Phase 5 完成；Phase 6（Issue 级 Review、Delivery 与
Acceptance 收口）激活。

### §14.6 Phase 6 结果回写（2026-08-23，portfolio 闭环）

`issue-level-review-delivery` 全量交付：PR #175 合并（merge `ef8daad8`，CI 首轮全绿
16 pass/1 skip）。三 child：issue-delivery-evidence-rollup（per-node 交付事实纯后置
聚合入 Issue 读面：零新 blob 读、散文永不解析、missing[] 具名不发明、五态 counts）/
issue-unified-review-gate（review 视图 = 验收门全量 1:1 映射：单一 blocking 基 + 穷尽
钉、七 kind 封闭线程词汇、验证摘要按引用不复制、list 紧凑围栏 CLI 钉住）/
issue-deferral-record（第五 lifecycle `deferred`：reason 必填、与 cancelled/superseded
全同构、canonical 只省 required；门排除账 + accepted.yaml 冻结 exclusion + 具名 ready
exit + `issue_start_node_deferred` 拒绝——延期不阻 Done 但三面记录在案；正向检查零逻辑
改动由测试钉住，独立负向枚举清扫 9 点无漏）。

**Issue #5 黄金关闭**（LEAD 亲手）：三归档 child 以 v2 identity 种入 store（派生先自
校验——用先例实例逐字节复现 ci_ 后才写；M-1 守卫拒双实例；store `f1c35bb`）→ plan
0001 三节点串行链 + conditions 0001 四条 → pre-accept 收据读 **review-ready**（g-002
能力读自建 portfolio 的金环）→ gate 3/3 waiting-human 零 problems → accept（store
`f295abc`）→ **done · healthy · 3/3，review.determination = accepted**。**注册表现状：
五个 Issue 全部 done，attention 扫描零项。**

本机全量门 687 文件/28 箱零未知红（仅已知 6 文件本机簇，裁决入 parent evidence）；
归档新教训：MODIFIED 合并的引擎 EOF 缺陷与 ADDED 反向（删段间空行 + 加尾空行），两向
都要查。Phase 6 完成；**Phase 7（界面收敛，campaign 最后一片，`packages/ui` 解冻）
激活**——预分析（P6 交接档）：约四成可前置（设计/IA、Unlinked Changes、Operations
收敛、Issue 只读骨架），派生状态显示等 Phase 1 投影器（已在位），旧板退休放最后。

### §14.7 Phase 7 结果回写（2026-08-24 闭环，2026-08-26 补记）

`issue-ui-convergence` 全量交付：PR #176 合并（merge `d2f59f85`，2026-08-24，CI run
32711980305 全绿 13 成功 / 1 路径跳过 / 0 失败），portfolio head `0d725873`。三 child
依序独立 verify + review CLEAN 后归档：issue-read-surface（`274c766c`，只读投影面——
Issue Board/Detail 读模型直接来自 store 真相，缓存可重建）/ issue-operations-and-unlinked
（`4a692691`，Operations 收敛 + Unlinked Changes 挂接面）/ issue-board-cutover
（`e7426278`，Store 首页切换为 Issue Board，旧板退休）。parent 归档 `cdbea4a3`，关闭
证据 `744cf756`；tip 另有一次归档 Purpose 占位符手工修补（`2a283646`——该引擎缺陷已知，
待根治 change）。

**Issue #6 黄金关闭**（LEAD 亲手）：三归档 child 以 v2 identity 种入 store `line-0.2`
分区（`2bcbae0f`）→ plan 0001 绑定真实身份 → conditions 0001（合并交付 / UI 收敛 /
payload 支撑状态 / 只读缓存可重建四条）→ pre-accept 读 review-ready、零 standing
problems → accept（2026-08-24，store `eb397300`）→ 终态 **resolved · done · healthy ·
3/3，review.determination = accepted**。**注册表现状：六个 Issue 全部 done，attention
六 Issue 扫描零项。** Phase 7 完成——campaign 授权范围（Phase 2–7）全部交付。

### §14.8 Campaign 终局 reconcile（2026-08-26，操作者拍板）

campaign（§14.1 授权）至此整体关闭：七个 portfolio（PR #168、#171–#176）全部合并
dev/0.2.0，Phase 0–7 均以真实 Issue 黄金关闭取证（Issue #1–#6 + Phase 1 的
meta-dogfood）。本次 reconcile 同步登记：

- **操作者决定（2026-08-26）**：ECP 收尾（`ecp-session-self-hosting-vertical-proof`
  与 ECP-8）**继续延后**——当前处于测试期，暂不启动；子 Direction 维持
  active/partial，其 2026-08-17 reconcile 的义务保留条款（OS × 后端 receipt 矩阵、
  真实 macOS 取证或显式记缺口、legacy engine 退休决定、发布事实一致性）全部不变；
- 父 Direction 撤销 activeSlice，进入 holding：Phase 8（平台增强）按 §10 设计保持
  Later、按真实需求逐项启动；下一前沿（恢复 ECP 收尾 / Phase 8 / 0.2.0 发布事实）
  待操作者拍板后再登记；
- 常驻开放账随 campaign 结束失去承接 Phase，落点待安排：claimant-alias keying 归属、
  pinned-confirmation anchor、foreign-repo keying + cleanup 不对称、attention 直钉
  invalid-archive-record、`--issue` 拒绝的 unsearched-refs 语义。完整清单与两线完成度
  审查见
  [`docs/audits/0.2.0-ecp-and-0.3.0-issue-layer-completion-review-2026-08-26.md`](../../../docs/audits/0.2.0-ecp-and-0.3.0-issue-layer-completion-review-2026-08-26.md)；
- 本次同时把 §14–§14.7 全部 scope decision 与结果回写、父 `work.yaml`、ECP-7 的
  2026-08-17 reconcile **首次提交上远端**（此前仅存于单机未提交工作树，见审查文档
  P1）。
