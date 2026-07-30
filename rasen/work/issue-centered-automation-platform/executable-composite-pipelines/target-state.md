# Executable Composite Pipelines Target State

> Direction：`executable-composite-pipelines`
>
> 状态：draft
>
> 上位 North Star：[`../north-star.md`](../north-star.md)
>
> 当前事实基线：2026-07-29，Git revision
> `8270941ae1fa9368221b4d3ef67f2b1c961d5956`

## 目标结果

Rasen 的每个 Change-level Pipeline 都能被准备为一份冻结、可审计的
Executable Composite Pipeline Definition，由确定性 Reconciler 推进同一份
canonical Run Record；用户能够从 CLI、API、Canvas 和 Operations 看到并控制
同一个运行事实。

“完整 ECP”在本 Direction 中具有严格含义：

- v1 Pipeline 可作为兼容输入归一化到统一语义，v2 Definition 可直接执行；
- built-in 与 Custom Composite 使用同一套 validate、lower、reconcile、persist
  和 project contract；
- root DAG、Composite、BoundedLoop、Choice、FanOut、Join、Gate 和 Finish
  都具有明确、有限、可恢复的机械语义；
- ReviewCycle 与 GoalLoop 只是同一 Composite/BoundedLoop 内核上的领域消费者，
  不再由 prompt、skill 或命令维护第二套推进状态；
- 一个 Run 只有一个 engine owner、一份 canonical state 和一个投影视图来源；
- 故障、重启、预算耗尽、人工介入和部分失败都 fail closed，不会重复已提交工作，
  也不会错误进入 ship 或 Done；
- 只有真实运行、恢复、dogfood 和发布证据齐备时，才允许声明 ECP 完成。

## 用户体验

人类用户不需要理解 reducer、journal 或 adapter。用户应当能够：

1. 选择 built-in Pipeline，或在 Canvas 中声明一个受约束 Custom Composite；
2. 在启动前看到它是否可执行、使用哪个 engine、有哪些能力或安全限制；
3. 启动后看到 root、composite、round、phase、并行成员、等待原因和开放前沿；
4. 安全地 resume、cancel、提供 decision，或在需要时接管；
5. 在崩溃或进程重启后继续同一个 Run，而不是重新猜测进度；
6. 理解为什么运行通过、失败、耗尽、升级或仍被阻塞；
7. 将终态追溯到 actor、workspace revision、结果、证据和外部交付事实。

Agent 用户应当能够：

- 从冻结 Definition/Plan 和 committed Record 唯一计算下一动作；
- 获得明确的 capability、输入、输出、权限、预算和证据契约；
- 在不依赖聊天历史的情况下恢复；
- 在无法安全推进时返回类型化 wait/escalation，而不是临场发明控制流。

## 当前观察基线

以下事实来自
[`0.1.6 ECP 完成度审查`](../../../../docs/audits/0.1.6-executable-composite-pipelines-completion-review-2026-07-29.md)、
相关 Change ledger、现有架构文档和研究文档：

- `ecp-definition-v2` 为 47/47；公开 Definition v2、归一化和静态校验基础已存在；
- `ecp-run-spine` 为 131/137；root-DAG canonical Run spine 已有较强测试，
  但正式验证、scope audit 和 dogfood gate 尚未全部关闭；
- authored v2 当前仍报告 `ecp_v2_runtime_unavailable`；
- runtime lowerer/reconciler 只覆盖受限 root-DAG 路径，不执行
  CompositeRef、BoundedLoop、GoalLoop、FanOut 或 Join；
- Canvas 对 CompositeRef、BoundedLoop、FanOut 和 Join 仍是只读保留，
  不能完成 Custom Composite authoring；
- Operations 只投影 root-DAG，不展示 composite、round、finding、goal 或
  parallel barrier 语义；
- `ecp-review-cycle`、`ecp-custom-composite`、`ecp-goal-loop`、
  `ecp-full-feature`、`ecp-product-closure` 都只有 Change shell；
- 当前 7 个 built-in 在一般产品视图中都仍显示 legacy engine；只有特定
  `bug-fix` simple path 能在补全启动 profile 后进入 reconciler；
- `rasen-auto`、`rasen-goal`、`rasen-review-cycle` 仍拥有 prompt-owned
  机械推进规则；
- 当前版本、changelog、tag 与“0.1.6 ECP 完整发布”尚未形成一致事实。

因此，当前交付应称为：

> deterministic root-DAG Change Run spine

而不是：

> complete Executable Composite Pipelines

## 成功与健康证据

Target State 只有在以下证据同时成立时才满足。

### 1. Definition 与编译

- v1 read/normalize/compile compatibility 和 v2 authored execution 均可用；
- Canvas save/detail/export round-trip 后语义 digest 不漂移；
- built-in 与 custom definition 生成相同类别的 immutable plan；
- recursion、nested loop、普通 cyclic edge、缺失出口、非法 port、能力和预算
  越界在启动前 fail closed。

### 2. Runtime 与恢复

- 同一 immutable plan + committed Record 总是产生同一 next action；
- root、composite、round、invocation、attempt 和 effect identity 稳定；
- ReviewCycle、GoalLoop 和 FanOut/Join 都由同一个 reconciler lifecycle 推进；
- crash-before-commit、crash-after-commit、ack loss、resume、cancel、timeout、
  cap exhaustion 和 partial failure 均有故障注入证据；
- completed invocation 不会重复 admission，未提交结果不会推进状态。

### 3. 产品平面对称

- Definition、Canvas、compiled plan、runtime behavior 和 Operations projection
  对同一 fixture 端到端一致；
- CLI、Management API 和 Operations 消费同一 canonical projector；
- UI 不维护第二份运行状态，也不把不可执行节点伪装成可执行；
- 用户能从显示信息回答“现在在哪、为何等待、下一步是什么、为何能完成”。

### 4. Built-in 与 Custom Composite

以下 Change-level built-in 均能由 reconciler 完成真实 Run：

- `bug-fix`，包括 adaptive complex 分支；
- `small-feature`；
- `goal-loop-measure`；
- `goal-loop-evaluate`；
- `goal-loop-research`；
- `full-feature`。

至少一个 Canvas-authored Custom Composite 也必须使用相同 contract 完成真实
Run。`auto-decompose` 属于未来 Issue Dispatch/Execution Plan，不计入
Change-level ECP 迁移。

### 5. 领域安全

- ReviewCycle 的 malformed result 不能 commit；
- fixer 与独立 verifier 的 actor 约束由程序验证；
- open Blocker/Major 时 ship 永远不 ready；
- GoalLoop 能解释为什么继续、完成、无进展或耗尽；
- parallel join 能解释 required/optional/failed/cancelled member 对终态的影响；
- 所有完成判断绑定 actor、workspace revision、result 和 evidence。

### 6. 交付与发布

- 所有关联 Change 的验证和归档状态与代码事实一致；
- 完整 dogfood matrix、恢复 matrix 和 support matrix 可追溯；
- 架构、用户文档、migration/fallback 说明、manifest、changelog 和 tag 对
  同一版本给出一致能力边界；
- 重跑完成度审查时，不再出现“Definition 可表达但 Runtime 不可执行”、
  “Canvas 只读”、“built-in legacy-only”或版本事实漂移。

## 边界

### 本 Direction 包含

- Change-level Pipeline Definition、Canvas authoring、compiler/lowerer；
- deterministic reconciler、canonical Run Record、adapter/effect recovery；
- ReviewCycle、GoalLoop、Choice、FanOut/Join、Gate 和 Finish；
- CLI、Management API、Operations 的执行与控制平面；
- Change-level built-in migration、Custom Composite dogfood；
- legacy compatibility、thin launcher 收敛和 ECP 发布门。

### 本 Direction 不包含

- `auto-decompose`、Issue Dispatch、Issue Execution Plan 和 Issue Board；
- 跨项目执行图与 portfolio 调度；
- recursive Composite、nested loop、任意控制流脚本；
- 无限制动态 node/plugin execution；
- Remote/Distributed Runtime；
- 团队权限、通知、Forge 托管和多租户平台能力；
- Issue-level acceptance 或跨项目 Operations。

## 锁定决策

1. **机械推进归 Reconciler。** Prompt/Agent 负责判断或产出，不能拥有隐藏循环、
   retry、round、barrier 或 finish 规则。
2. **一个 Run 一份真相。** canonical Run Record 是唯一可变运行事实；legacy
   artifacts 和 UI 状态只能是投影。
3. **计划冻结。** Run 启动后使用 immutable plan/profile/capability snapshot；
   定义漂移只上报，不在 resume 时偷偷重编译。
4. **顶层 DAG + 受约束 Composite。** 反馈只通过有界结构表达；拒绝普通循环、
   recursive call 和 nested loop。
5. **内置与自定义同构。** Built-in 不能使用隐藏特权 Runtime；Custom Composite
   不能绕过相同安全校验。
6. **领域 reducer 与通用 loop lifecycle 分离。** Review finding、Goal evaluation
   和 parallel barrier 保留各自领域契约，但共享 identity、limits、recovery 和
   terminal mechanics。
7. **能力必须纵向证明。** 每个 Slice 同时覆盖 Definition、Canvas、Runtime、
   Operations 和真实 E2E；文件、schema、mock 或单元测试不单独证明完成。
8. **兼容输入不是永久双轨。** v1 和旧 run artifacts 有明确的 owner、fallback
   与退场条件，不反向成为第二套状态机。
9. **0.1.7 不承接 ECP 成立所需能力。** 若发布仍缺少本 Target State 的必要部分，
   必须明确称为局部 run-spine，而不是完整 ECP。

## 开放选择

这些选择可由后续 Slice 证据决定，不阻塞当前 Direction：

- Canvas 对 composite fold/expand、body navigation 和 inline editing 的具体交互；
- Custom capability 的打包、版本和可信 catalog 分发方式；
- parallel budget 的默认值与面向用户的配置层级；
- legacy engine 默认关闭的时点；
- Operations 对大型 composite tree 的压缩和分页策略；
- 性能预算的最终数值；
- Remote Runtime 和 Issue-level Execution Plan 的后续接口形状。

## 与上位 Direction 的关系

本 Direction 继承 `issue-centered-automation-platform/north-star.md` 中
Horizon 0 的原则：先证明一个真实 Change 自动化闭环，再进入 Issue、跨项目和
平台层能力。

父级 `goal.md` 是 legacy Target State input，保持原样。本 Direction 只负责把
Change-level ECP 做成可依赖的执行底座；ECP 通过前，父级 Issue Phase 0–8
继续保持 Later。
