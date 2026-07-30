# Executable Composite Pipelines Roadmap

> Direction：`executable-composite-pipelines`
>
> 权威目标：[`target-state.md`](./target-state.md)
>
> 当前状态：**active**，ECP-1..5 全部交付并合入 `dev/0.2.0`（回写于
> 2026-07-30，revision `be124057`）。无 activeSlice —— 下一个 Slice 归用户
> 决定。**不是 `completed`**：ECP-5 收口范围有两条仍 OPEN，见「当前位置」。
>
> 发布线修订（2026-07-30，用户拍板，本 Roadmap「版本边界」条款要求同步）：
> 本文与 Target State 中的 `0.1.6` 里程碑标签现在指 **`0.2.0`**。`0.1.6` 已改
> 定位为 `0.1.5` 的 bug 修复线（`dev/0.1.6` 另有 8 个 commit 不在 `0.2.0`，
> 含两个 breaking）。这是显式 scope decision，不是改标题把 spine 重命名为完整
> ECP —— 能力边界一字未动，只有版本号换了。

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

```text
已交付（真实证据，非 checkbox；全部在 dev/0.2.0 @ be124057）
  ECP-1 ReviewCycle Vertical Closure            DONE
  ECP-2 Custom Composite Authoring/Runtime      DONE
  ECP-3 GoalLoop and Thin Entrypoints           DONE
  ECP-4 Choice / FanOut / Join and Full Feature DONE
  ECP-5 Product Closure and Release Truth       DONE, 带 2 条 OPEN（见下）

  可执行面：6/7 内置 Pipeline 由 reconciler 真实运行；authored v2 +
  CompositeRef + BoundedLoop + GoalLoop + FanOut/Join 全部跑通 Definition ->
  Canvas -> Runtime -> Operations -> 真实 E2E；12 格 dogfood 矩阵锚在一个 revision

ECP-5 仍 OPEN 的收口项（有意记录，不当它不存在）
  O1 用 ECP 自身完成至少一个后续真实 Change 的 dogfood（自宿主）
     —— 本 portfolio 自己是被 legacy prompt 路径驱动交付的，不是被 reconciler
  O2 重跑完成度审查并关闭所有高优先级 finding
     —— 仓库内只有 docs/audits/0.1.6-...-2026-07-29.md 这一份旧的
  两条都不影响已交付能力，但按本 Roadmap 的规则，ECP-5 的 Result 只能记 partial

NOW（用户 2026-07-30 确认的推进线）
  Session 执行层（缓存重建线）—— 不是 ECP 的能力 Slice，而是 ECP 经
  deliveryMode grant/defer 显式外包出去的那块执行基座：内核授予 agent
  action，谁真的开 session、跑 agent、管 worker 生命周期，至今没有实现。
  设计与探针档案：docs/session-execution-layer-design.md（PR #112），
  P0 已闭环、上游前置已清零、P1 可直接开工。
  未设 activeSlice：本层尚无 slices/<id>/{spec,plan}，若要按 Slice 追踪，
  形式化它本身就是 P1 的第一步

  ECP 侧的测试与审查由用户自己处理（2026-07-30）；O1（用 ECP 自身跑下一个
  真实 Change）因此排在用户审查完 0.2.0 之后 —— 它必须用最新构建才有意义

NOT NOW（边界未变）
  auto-decompose / Issue Dispatch / cross-project execution
  remote runtime / team platform / notifications / Forge

  `auto-decompose` 的 fail-closed 是这条边界的正确表现，不是缺陷：它的
  decompose stage 无 skill、子项运行时才产生，frozen plan 无法预先成形，因此
  报 execution_profile_unavailable 并回落 legacy。portfolio 级的活因此仍不享有
  kernel 保证 —— 这是已知且刻意的
```

## 进入 ECP-1 前的事实门

`ecp-run-spine` 当前为 131/137，且 association follow-up 仍有 deferred 项。
这些不是新的产品 Slice，但必须作为 ECP-1 的前置事实核对：

- 补齐或明确移交 `ecp-run-spine` 16.1–16.6 的验证、scope audit 和 dogfood；
- 对 association runtime archive Action path 给出完成或明确 defer 的 disposition；
- 保证 root-DAG seam 的缺陷在原 canonical runtime 中修复，不创建临时第二 Runtime；
- 修正“root-DAG slice = 完整 ECP 0.1.6”的架构文档口径。

这些门只证明地基可信，不单独构成 ECP Target State 的通过证据。

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

候选 Slice：
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
- 重跑 0.1.6 完成度审查并关闭所有高优先级 finding。

### 退出证据

support matrix 不再包含 Change-level built-in 的 legacy-only 项；不存在
Definition 可表达但 Runtime 不可执行、Canvas 只读或 Operations 无法解释的
目标节点；发布事实与实际能力一致。

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

本 Roadmap 保留研究文档锁定的产品定义：完整 ECP 所需能力不得静默推迟到
0.1.7。若版本策略改变，必须形成显式 scope decision，并同步 Target State、
Roadmap、架构、Change 组合与发布说明；不能通过改标题把 root-DAG spine
重新命名为完整 ECP。
