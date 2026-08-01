# Executable Composite Pipelines Roadmap

> Direction：`executable-composite-pipelines`
>
> 权威目标：[`target-state.md`](./target-state.md)
>
> 当前状态：**active / partial**。ECP-1..5 的实现组合已合入，但 2026-08-01
> 校准确认完整 Target State 仍有真实缺口。ECP-6 已被选择为唯一 activeSlice，
> 其验收契约见 `slices/v2-authoring-loop-contract-closure/`。
>
> 版本边界：**0.2.0 完成 ECP；0.3.0 承接 Issue、Execution Plan、Dispatch、
> `auto-decompose` 上移与跨项目编排。** 0.3.0 不接收使 ECP 成立所必需的债务。

## 路线原则

路线按“最早产生真实用户能力并消除最大架构不确定性”排序，而不是按模块目录或
技术层横向拆分。

每个 Slice 都必须：

- 产生一个可独立验收的 Change-level 用户结果；
- 贯穿 Definition、Canvas、Runtime、Operations 和真实 E2E；
- 复用同一 immutable plan、canonical Record 和 projector；
- 明确成功、失败、耗尽、升级、取消和恢复证据；
- 不以 tasks checkbox、文件存在、mock 或局部单元测试代替验收。

## 当前位置

| 层面 | 当前证据 | 分类 |
| --- | --- | --- |
| Reconciler、Record、恢复、Operations | root/composite/loop/parallel 主路径与故障矩阵已落地 | 已交付基础 |
| Change-level built-in | 6/6 在 `auto` 策略下选择 reconciler；`auto-decompose` 属于 0.3.0 | 已交付基础 |
| Definition v2 | 可校验、lower、执行、round-trip | 已交付基础 |
| v2 默认创作 | built-in、`pipeline init`、空白 Canvas 仍默认 v1 | **未完成** |
| Canvas 原语对称 | FanOut/Join 只读；GoalLoop 与完整 loop policy 无 v2 创作面 | **未完成** |
| 通用 loop contract | limits/exits 已有，stall/blocked/escalation 的公共生命周期不完整 | **未完成** |
| Agent action 执行 | 内核 grant/defer；没有独立 Session executor | **未完成** |
| 自宿主与发布 | 无后续真实 Change 自宿主；当前 HEAD 完成度审查与 release truth 未闭合 | **未完成** |

ECP-1..4 的历史实现与 dogfood 证据继续有效，但不能覆盖上表缺口；ECP-5
终态维持 `partial`。当前依据详见
[`0.2.0 gap calibration`](../../../../docs/audits/0.2.0-ecp-gap-calibration-2026-08-01.md)。

```text
NOW（唯一 activeSlice）
  ECP-6 v2 Authoring and Loop Contract Closure

LATER（严格顺序）
  ECP-7 Session Execution and Self-hosting
    -> ECP-8 Completion Audit and Release Truth
      -> 0.3.0 Issue / Dispatch

NOT NOW（0.3.0 及以后）
  auto-decompose / Issue Dispatch / cross-project execution
  remote runtime / team platform / notifications / Forge
```

## ECP-6：v2 Authoring and Loop Contract Closure（ACTIVE）

### 用户结果

用户新建 Pipeline 时得到 v2 定义，并能在 Canvas 中完整创作首版受支持原语；
保存后的 definition、compiled plan、runtime behavior 与 Operations projection
保持同一语义。v1 只作为兼容输入，不再是新建默认或误导性的执行说明。

### 收口范围

- `pipeline init`、空白 Canvas 与其他公开新建入口默认 v2；
- package built-in 要么迁移为 authored v2，要么被显式标记为兼容 fixture，正常
  产品视图不再对它们发出误导性的 legacy/prompt-owned warning；
- Canvas 可创作和编辑 CompositeRef、BoundedLoop、Choice、FanOut/Join、Gate、
  Finish，以及 declaration body、typed outcomes、limits、exits 与 capability；
- ReviewCycle 与 GoalLoop 共享公共 bounded lifecycle：max iterations/actions/budget、
  progress fingerprint、stall、blocked、strategy exhaustion、human escalation 和
  类型化终态；领域 reducer 继续分离；
- Definition、Canvas、lowerer、reconciler、Record、Operations 与 E2E fixture
  同时覆盖成功、耗尽、阻塞、升级、取消与恢复。

### 退出证据

- 从空白 Canvas 创建一个含 loop + parallel 的 v2 Custom Composite，导出/导入
  digest 不变，并完成成功、恢复和失败关闭 Run；
- v1 fixture 与等价 v2 fixture lower 成等价 plan，但新建产品路径只输出 v2；
- FanOut/Join 和 loop policy 不再只读；所有可表达字段都有 runtime/Operations
  对称证据；
- 当前高优先级定义/Canvas/loop finding 为零。

## ECP-7：Session Execution and Self-hosting（LATER）

### 用户结果

Reconciler 授予的 agent action 由独立、可恢复、可审计的 Session executor 实际
执行，不再要求 launcher 会话充当隐藏 worker manager；ECP 使用自身完成一个
后续真实 Change。

### 退出证据

- executor 消费冻结 action contract，记录 session identity、cwd、actor、usage、
  result 与 evidence，并安全处理 cancel/restart/ack loss；
- session reuse/handoff policy 有真实实现和配置来源，不再是占位字段；
- 一个非 ECP 玩具 Change 从 start 到 verify、review、ship/archive 由 ECP 自宿主，
  保存 RunId、ActionId、Session、revision 与最终交付证据。

## ECP-8：Completion Audit and Release Truth（LATER）

### 用户结果

0.2.0 的实现、文档、版本、changelog、包、tag 和迁移/回退说明给出同一能力边界，
完成度审查不再发现高优先级缺口。

### 退出证据

- 在干净依赖和 fresh build 上串行运行 root/UI tests、typecheck、lint、package 与
  release contract；环境性例外逐项归因；
- 重跑完整 ECP support/dogfood/recovery matrix；
- 明确 legacy engine 的保留或退休决定及存量 run-state 处理；
- 完成审查为 `passed` 后才更新 Direction `completed` 并进入 0.3.0。

## 历史实现 Slice（ECP-1..5）

以下内容保留原始用户结果与验收意图，用于追溯已交付实现。它们不是当前 NOW
列表；当前缺口已经合并进 ECP-6..8。

## ECP-1：ReviewCycle Vertical Closure

### 用户结果

用户对真实 Change 启动带独立复审的 ReviewCycle。一个 finding 能在同一
canonical Run 中经历 review、triage、fix 和 independent re-review，最终
clean、exhausted、escalated 或 cancelled；重启不会丢失 finding，也不会重复
已提交工作。

### 需要证明的新复杂度

- `CompositeRef + BoundedLoop` 的第一条可执行 v2 路径；
- hierarchical identity、round/phase 和领域 result；
- actor separation、open-Major ship guard 和 loop cap；
- composite 恢复与跨平面投影；
- `bug-fix` complex 和 `small-feature` 复用同一 ReviewCycle；
- `rasen-review-cycle` 不再拥有第二套机械状态。

### 退出证据

真实 finding 完成 fix 与独立复审；正常通过、达到上限、非法 result、
same-actor、open Major 和三个恢复边界均有可追溯证据。CLI、Management 与
Operations 对同一 Run 投影一致。

历史 Slice：
[`review-cycle-vertical-closure`](./slices/review-cycle-vertical-closure/spec.md)。

## ECP-2：Custom Composite Authoring and Runtime Parity

### 用户结果

用户在 Canvas 中声明一个受约束 Custom Composite，定义输入、输出、outcome、
limits 和 body，将其作为 `CompositeRef` 嵌入 Pipeline，保存后直接运行。

### 需要证明的新复杂度

- declaration/body 和 port mapping；
- create/reference/fold/expand/edit/delete；
- recursion、nested loop、cycle、capability 和 budget validation；
- built-in 与 custom composite 使用相同 compiler/runtime contract；
- root summary 与 composite drill-down 来自同一 projector。

### 退出证据

一个非内置 Canvas-authored Composite 完成成功、失败和恢复路径；导出再导入后
语义 digest 不变，运行计划与同构 built-in fixture 等价。

## ECP-3：GoalLoop and Thin Entrypoints

### 用户结果

用户运行 measure、evaluate 或 research 目标循环；系统能解释基线、当前结果、
门槛、剩余预算，以及为什么继续、完成、无进展或耗尽。

### 需要证明的新复杂度

- 第二个真实 BoundedLoop 消费者，验证通用 loop lifecycle；
- Measure/Evaluate/Research 的独立领域 reducer；
- goal score/evaluation/gaps/stall/blocked/report tail 投影；
- 三个 goal built-in 迁移；
- `rasen-goal` 收缩为 completion preset/launcher；
- `rasen-auto` 收缩为选择和启动策略。

### 退出证据

至少一个 measure/evaluate 和一个 research 真实运行经历多轮推进、恢复和
终止；旧 `goal-run.json` 仅是兼容投影，不能反向驱动新 Run。

## ECP-4：Choice / FanOut / Join and Full Feature

### 用户结果

用户运行 `full-feature`：条件分支选择唯一合法路径，可并行工作受并发与预算
限制，Join 根据 required/optional/failed/cancelled 语义决定推进。

### 需要证明的新复杂度

- Choice condition 与选中分支持久化；
- FanOut ready-set、concurrency/budget admission；
- Join barrier、partial failure、timeout、cancel 和 suppression；
- Canvas 并行 authoring 与合法性反馈；
- Operations 并行 frontier 和关键阻塞；
- `full-feature` 迁移。

### 退出证据

真实运行覆盖并行成功、部分失败后恢复、取消或超时；重启后 ready-set 不漂移，
Join 不重复消费结果。

## ECP-5：Product Closure and Release Truth

### 用户结果

用户从 CLI、API 或 Canvas 选择任一 Change-level built-in 或 Custom
Composite，看到一致的可执行性、engine、启动、运行、控制和终态证据。

### 收口范围

- `bug-fix`、`small-feature`、`full-feature` 和三个 GoalLoop built-in
  全部可由 reconciler 真实运行；
- Custom Composite 与 built-in contract parity；
- root/composite/loop/parallel 的恢复与故障矩阵；
- CLI/API/Canvas/Operations parity；
- compatibility owner、fallback 和退场门槛；
- 架构、用户文档、migration guide、manifest、changelog 和 tag 一致；
- 用 ECP 自身完成至少一个后续真实 Change 的 dogfood；
- 重跑 0.2.0 完成度审查并关闭所有高优先级 finding。

### 退出证据与当前分类

support matrix 不再包含 Change-level built-in 的 legacy-only 项；不存在
Definition 可表达但 Runtime 不可执行、Canvas 只读或 Operations 无法解释的
目标节点；发布事实与实际能力一致。2026-08-01 校准时这些条件尚未全部满足，
因此 ECP-5 保持 **partial**，剩余工作由 ECP-6..8 接管。

## 证据如何调整路线

- 若 ECP-1 证明 ReviewCycle 需要另一套 runtime truth，停止并修正 Target State
  实施方法，不能继续堆叠 Custom/Goal 能力；
- 若 ECP-2 证明 custom 与 built-in 无法同构，先修复 compiler/runtime contract，
  不提前进入 GoalLoop；
- 若 ECP-3 暴露通用 loop lifecycle 不足，修复公共 mechanics，但不把 review 与
  goal 领域 reducer 合并；
- 若并行预算和恢复无法 fail closed，ECP-4 保持未通过，不进入发布收口；
- 任一 Slice 缺少真实 dogfood 或恢复证据时，Result 只能是 `partial` 或 `failed`。

## 版本边界

本 Roadmap 保留研究文档锁定的产品定义：完整 ECP 所需能力必须在 0.2.0
关闭，不得静默推迟到 0.3.0 Issue 版本线。若版本策略改变，必须形成显式 scope
decision，并同步 Target State、Roadmap、架构、Change 组合与发布说明；不能用
兼容编译或局部 dogfood 替代完整产品验收。
