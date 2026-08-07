# ECP-7 分级执行后端（Direction 候选草案）

> 状态：**已于 2026-08-07 经 `/rasen-direction` 落地，本文降级为历史输入。**
> 权威现在是 Direction 制品本身：`target-state.md`「锁定决策 10」、ECP
> `roadmap.md` 的 2026-08-07 replan 节、Slice `spec.md` 验收 2/4/6/7 与开放决定节、
> Slice `plan.md`「Architecture Replan 4」、Slice `result.md` 的 2026-08-07 reconcile、
> 父级 `roadmap.md` §13。两者冲突时以 Direction 制品为准。
>
> 落地时的偏离：第 6 节清单中「`rasen/changes/ecp-macos-process-authority-provider/`
> 建立 decision record」**未执行**——那属于 Change 生命周期，Direction worker 不创建
> Change 制品；macOS 的决定已完整记录在上述 Direction 制品中。第 9 节四个开放问题
> 均**未拍板**，已原样转记进 Slice `spec.md` 的「开放决定」节。run-state 未触碰。
>
> 记录日期：2026-08-07
>
> 关联 Direction：`rasen/work/issue-centered-automation-platform/executable-composite-pipelines`
>
> 关联 Slice：`slices/session-execution-and-self-hosting`（ECP-7）

## 1. 用户决定（待经 Direction 落地）

2026-08-07，用户在设计讨论中明确：

1. ECP 必须**同时**支持外部 daemon 控制的执行流程，与从 Claude Code / Codex
   等宿主工具内部驱动的执行流程（即 0.1.x 既有形态）。
2. macOS 的 durable 进程权威（sandbox / Endpoint Security / VM 方向均未选）
   **移出 0.2.0**，作为下一个版本（如 0.3.0）的研究与处理事项。
3. **0.2.0 收尾时，macOS 的执行形态就是 in-tool 执行。**

本文把该决定转写为可落地的架构形状与文档同步清单，供用户过目后再落地。

## 2. 先更正一处事实：两条轴此前被混为一谈

早前讨论中曾把「closure 要删除 PGID claim/fallback」当作与「保留 in-tool 执行」
冲突。核对代码与原文后，这个判断不成立。

### 2.1 原文作用域

`plan.md:297` 与 `rasen/changes/ecp-native-process-capsule-closure/tasks.md:122`
（task 12.1）的原句主语始终是 ProcessScope：

> integrate their frozen contracts into **ProcessScope/host**, rev the private
> protocol/manifest atomically, delete or hard-disable POSIX PGID
> authority/fallback

它删除的是**进程围栏机制**，不是任何一条执行拓扑。

### 2.2 代码上两条轴是分开的

| 轴 | 取值 | 定义处 | 消费者 |
| --- | --- | --- | --- |
| 派发拓扑（谁运行 agent） | `native` / `exec-bridge` / `legacy-fallback` | `src/core/pipeline-registry/run-state.ts:73` | `src/core/templates/workflows/_orchestration.ts` 的 LEAD |
| 进程权威（谁围住进程树） | `ProcessScope` + `ProcessAuthorityProvider` | `src/core/session-host/` | 仅 `src/core/management-api/router.ts` |

核实结论：`createSessionHost` 与 `createNativeProcessScope` 在整个 `src/` 中
**只在 `src/core/management-api/router.ts:642` / `:639` 被构造**。
`_orchestration.ts` 的 Tier A native dispatch（宿主自己的 Task tool /
`spawn_agent` 起 worker，rasen 不拥有任何进程）**从不进入 ProcessScope**。

因此：删除 PGID 权威与保留 in-tool 执行**互不冲突**，task 12.1 无需修订。

### 2.3 两个撞名概念必须区分

- run-state 的 `legacy-fallback`：宿主未知时的**派发路由**兼容值。
- ProcessCapsule 的 "PGID fallback"：已被否证的**进程权威**退路。

二者无关。Direction 反复禁止的是后者的**静默降级**，与前者无涉。

### 2.4 Slice spec 本就预留了口子

`slices/session-execution-and-self-hosting/spec.md` 验收 6 原文：

> Claude/Codex 交互 launcher、裸 CLI、Management API、Canvas 和 daemon
> **在能力允许时**都能 start/resume/cancel/inspect 同一 Run

「在能力允许时」已经预设按能力分级的 driver。本草案是把这句话从隐含扩展为
显式、可验证的能力矩阵。

## 3. 提议的架构形状：分级执行后端

ECP-7 的 executor 消费冻结 Action 后，通过一个**声明能力的执行后端**实际执行。
首版两个后端：

### 3.1 `in-tool` 后端（宿主原生子代理）

- **进程归属**：宿主工具（Claude Code / Codex）。rasen 不拥有任何进程。
- **所需进程权威**：无。不做任何 authority claim。
- **durability**：受 launcher 生命周期约束。launcher 消失时在飞 Action 返回
  类型化 `execution-lost`；未提交前沿保持未提交，Run 可由其他 driver 恢复。
- **cancel**：委派给宿主设施。rasen 记录取消意图与观察到的结果，**不声称**
  对孙代进程的精确递归终止或精确 scope-empty。
- **headless driver**：不提供。
- 平台：Linux / Windows / macOS 均可用。

### 3.2 `hosted` 后端（rasen 拥有的 durable session）

- **进程归属**：rasen daemon/host，以 `claude -p` / `codex exec` 起子进程。
- **所需进程权威**：内核强制的 `ProcessAuthorityProvider`
  （Linux user+PID namespace / broker+cgroup-v2；Windows Job Object）。
- **durability**：跨 launcher 退出存活；headless driver 可用。
- **cancel**：精确递归终止 + 精确 scope-empty。
- 平台：Linux / Windows（0.2.0）；macOS 无 provider。

### 3.3 能力声明与「绝不静默降级」

后端各自声明布尔能力：`durable`、`headlessDriver`、`exactCancel`、
`scopeEmptyProof`、`usageAttribution`、`producerIsolation`。
平台 × 后端矩阵由声明**计算得出**，不由文档口头断言。

关键红线不变：请求 `hosted` 而当前平台无 provider 时，必须返回已存在的类型化
`authority-unavailable`（`src/core/session-host/process-authority/registry.ts:204`，
以及已归档的 `process-authority-prepare-unavailability-outcome`），
**绝不自动改路由到 `in-tool`**。选用 `in-tool` 只能来自显式请求，或来自一个
在启动前就把能力差异展示给用户的显式默认。

### 3.4 一个必须在设计阶段回答的开放问题

ECP-6 的 trusted producer 契约要求 private signing capability 只存在于可信 host
内存。在 `hosted` 后端下这自然成立。在 `in-tool` 后端下，实际提交由 LEAD 调用的
`rasen` CLI 进程完成，因而 producer 是提交时的 CLI 进程，agent 的产出是**经 LEAD
转述**而非由隔离 host 直接签名。这是一处真实的信任强度差异，必须写进能力声明
（建议字段 `producerIsolation`），不能含糊带过。本草案不预设结论。

## 4. 依赖图变更（这才是真正解锁下游的动作）

### 4.1 当前（macOS 卡住全线）

```text
foundation -> { linux, windows, macos } -> closure -> host -> executor -> parity -> self-hosting
```

`ecp-native-process-capsule-closure` 依赖全部三个 provider，macOS 未决即 closure
永不 terminal，下游 5 个 Change（closure / host / executor / policy-parity /
self-hosting）全部不可运行。

### 4.2 提议

```text
foundation -> { linux, windows } -> closure(hosted 后端，2 OS) -> host
  -> executor（同时拥有 in-tool 与 hosted 两个后端；in-tool 无权威依赖）
       -> parity -> self-hosting

macOS durable 进程权威  ->  移出 ECP-7，作为 0.3.0 研究事项，无边进入 0.2.0
```

**唯一需要切断的边**：`ecp-macos-process-authority-provider -> ecp-native-process-capsule-closure`。

closure 的验收随之收窄为：在两个具备内核强制权威的 OS 上关闭 hosted 后端；
macOS 的 hosted 请求产生类型化 `authority-unavailable`，且 in-tool 能力被显式声明。

## 5. 与锁定决策 9 的关系（必须正面处理，不能绕）

`target-state.md` 锁定决策 9：

> **0.3.0 不承接 ECP 成立所需能力。** 0.2.0 若仍缺少本 Target State 的必要
> 部分，就不能声明完整 ECP，也不能把完整性债务静默推给 Issue 版本线。

本草案的立场是：**macOS 的 durable hosted 执行不是 Target State 的必要部分——
前提是 0.2.0 的能力声明本身被显式分级。** 这正是
`roadmap.md:366-371` 预留的出口：

> 若版本策略改变，必须形成显式 scope decision，并同步 Target State、Roadmap、
> 架构、Change 组合与发布说明；不能用兼容编译或局部 dogfood 替代完整产品验收。

因此这**不是**静默推债，而是一次显式 scope decision。代价是第 6 节的同步清单
必须全部完成，一条都不能省。

## 6. 落地时必须同步的文档清单

| 文件 | 需要的修改 |
| --- | --- |
| `target-state.md` §「目标结果」 | 「完整 ECP」严格含义中加入按后端分级的能力声明；明确 0.2.0 的 hosted 后端覆盖 Linux/Windows |
| `target-state.md` Agent 用户结果末条 | 现文强调「而不是依赖 launcher 对 worker lifecycle 的**隐藏**解释」——须补明：显式声明边界的 in-tool 执行是合法后端，被禁止的是隐藏解释 |
| `target-state.md` §2 Runtime 与恢复 | 「agent action 的实际 Session 执行、取消、恢复、usage 与 evidence」按后端分级表述 |
| `target-state.md` §6 交付与发布 | support matrix 改为 OS × 后端 |
| `target-state.md` 锁定决策 | 新增或修订一条，记录本次显式 scope decision 与其边界 |
| `roadmap.md` ECP-7 段 | 替换「macOS decision defer」叙述为「macOS durable authority 移出 0.2.0」；更新 DAG |
| `roadmap.md` ECP-8 段 | 三 OS receipt 要求改为 OS × 后端 receipt（见第 7 节） |
| `roadmap.md` 版本边界段 | 记录这是符合出口条款的显式 scope decision |
| Slice `spec.md` 验收 2 / 4 / 6 / 7 | 按后端分级；验收 4 明确 in-tool 能证明什么、不能证明什么 |
| Slice `plan.md` | 新增「Architecture Replan 4」；修订 DAG 与 closure ownership |
| Slice `result.md` | 追加本次 reconcile 记录 |
| 父级 `rasen/work/issue-centered-automation-platform/roadmap.md` | 登记 macOS durable 进程权威为 0.3.0 研究事项 |
| `docs/session-execution-layer-design.md` | 与分级后端对表 |
| `rasen/changes/ecp-macos-process-authority-provider/` | 建立 decision record（此时已是结论而非候选）；portfolio child 状态由 LEAD 决定，建议 `skipped` + 0.3.0 指针 |

## 7. ECP-8 release truth 的相应修订

现要求：三 OS 真实 receipt。提议改为 **OS × 后端 receipt**：

- Linux：in-tool receipt + hosted receipt。
- Windows：in-tool receipt + hosted receipt。
- macOS：**in-tool receipt（必须是真实 macOS 运行）**，外加一次真实 macOS 运行
  证明 hosted 请求返回类型化 `authority-unavailable` 且**没有发生静默改路由**。

注意这一条并没有免除 macOS runner：macOS 上的 in-tool 声明与 unavailable 断言
仍然只能由真实 macOS 运行证明，不能用 cross-compile 或注入事件替代。

## 8. 本草案明确不批准的事项

- 不批准 Endpoint Security 方案、VM 方案、macOS 最低版本、Apple entitlement /
  签名 / 公证分发中的任何一项——它们整体移交 0.3.0 研究。
- 不批准把 macOS 写成 silent unsupported。macOS 在 0.2.0 是**声明的 in-tool
  支持 + 声明的 hosted 不可用**，两者都要有真实证据。
- 不批准 `hosted` 请求在任何平台上静默降级为 `in-tool`。
- 不修改 task 12.1（删除 PGID 权威）——该任务本就正确且与本草案无冲突。
- 不改变 Linux / Windows provider 当前的实现波状态、开放 finding 或环境 gate
  （Linux 9.1–9.7 的 cgroup-v2 runner 仍是真实环境 gate）。

## 9. 需要用户拍板的开放问题

1. **是否有真实 macOS runner？** 若当前没有，第 7 节的 macOS in-tool receipt 与
   unavailable 断言无法取证，ECP-8 会带着这个缺口。需要决定：采购/借用 runner，
   还是把 macOS receipt 也显式记为 0.2.0 的已知缺口。
2. **自宿主玩具 Change（Slice 验收 7）用哪个后端？** 建议在 Windows 上用
   `hosted` 后端跑（本机可验证、声明最强），并另取一份 in-tool receipt。
3. **`in-tool` 后端的 `producerIsolation` 声明取值**（第 3.4 节的信任强度差异）
   如何表述才算诚实且可验证。
4. **macOS portfolio child 的终态**：`skipped` + 0.3.0 指针，还是保留
   `escalated` 并在 parent replan 中记为已移出 Slice。

## 10. 落地路径

用户确认本草案后：

1. 由 LEAD 以单写者身份运行 `/rasen-direction`，按第 6 节清单同步全部文档，
   并在 parent portfolio 记录 replan（保留全部既有 finding、counter 与历史）。
2. 切断第 4.2 节那条依赖边，使 closure 在 Linux/Windows provider terminal 后即可恢复。
3. 实现波不受本草案影响：Linux provider 继续按 implementation-first 政策推进，
   随后 Windows provider。executor 的分级后端在其自身 Change 的 propose 阶段展开。
