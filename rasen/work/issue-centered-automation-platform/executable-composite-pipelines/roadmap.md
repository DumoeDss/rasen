# Executable Composite Pipelines Roadmap

> Direction：`executable-composite-pipelines`
>
> 权威目标：[`target-state.md`](./target-state.md)
>
> 当前状态：**active / partial；执行后端已分级，macOS durable 权威移交 0.3.0**。
> ECP-6 已于 2026-08-04 依据四个 child 的独立 CLEAN review、真实 vertical、fresh
> root/UI gates 标记 `passed`。ECP-7 是唯一 activeSlice；native ProcessCapsule closure
> 的 review round 1 已证明 POSIX process-group authority 可被 `setsid()`/`setpgid()` 逃逸。
>
> **2026-08-07 用户 scope decision（取代此前的「macOS decision deferred」执行前沿）：**
> 0.2.0 的执行后端按能力分级为 `in-tool` 与 `hosted`；macOS 的 durable 进程权威整体
> 移出 0.2.0，作为 0.3.0 研究事项。**Endpoint Security、VM、macOS 最低版本、Apple
> entitlement/签名/公证分发仍然一项都未获批准。** closure 不再依赖 macOS
> provider，因而在 Linux 与 Windows provider terminal 后即可恢复。
>
> **2026-08-07 Step 1 决定（同日稍晚，修订上一条中 macOS 与 durable 的两处表述）：**
> 作用域生命周期收敛为守护进程生命周期——守护进程死亡即作用域死亡，在飞 action 记
> 类型化 `execution-lost`，不重新附着。判据 4 的既有实现全部保留为**升级路线**。
> macOS 除 `in-tool` 外另提供**显式声明的 best-effort `hosted`**（POSIX 进程组，
> `exactCancel: false`/`scopeEmptyProof: false`，取消终态 `cancelled / emptiness-unproven`）。
> 详见 Target State 锁定决策 11 与
> [`Step 1 replan 输入`](../../../explorations/direction-replan-input-step1-daemon-lifetime-scope.md)。
>
> 版本边界：**0.2.0 完成 ECP；0.3.0 承接 Issue、Execution Plan、Dispatch、
> `auto-decompose` 上移与跨项目编排。** 0.3.0 不接收使 ECP 成立所必需的债务；
> macOS durable 权威的移交是本 Roadmap「版本边界」出口条款下的**显式 scope
> decision**，其代价是 Target State、Roadmap、Slice、父级 Roadmap 与发布说明
> 必须同步收窄能力声明（已于 2026-08-07 执行）。

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
| Reconciler、Record、恢复、Operations | root/composite/loop/parallel 主路径、故障矩阵与同一 projector 已落地 | 已交付基础 |
| Change-level built-in | authored v2 默认路径与 6 个 Change-level built-in 已闭合；`auto-decompose` 属于 0.3.0 | **ECP-6 passed** |
| Definition/Canvas v2 | 默认新建、八类首版节点、declaration/limits/exits/capability、round-trip 已闭合 | **ECP-6 passed** |
| 通用 loop contract | ReviewCycle/GoalLoop 共享 progress/stall/blocked/strategy/escalation/recovery | **ECP-6 passed** |
| Custom vertical | loop + parallel success/failure/recovery、73 processes/transitions、跨平面对称 | **ECP-6 passed** |
| Trusted producer | plan-bound public authority 与签名/持久证据已验证，但 producer 仍是测试宿主 | **ECP-7 NOW** |
| Agent Session 执行 | durable host/opaque ProcessScope 已有累计实现；PGID authority 已被真实审查否证，仍有 RC-001..005、SEC-001..003；common foundation 已 terminal，Linux provider 实现波进行中，Windows 待起；macOS durable 权威移交 0.3.0；真实 Action executor 尚未开始 | **ECP-7 NOW / graded backends** |
| 执行后端分级 | `in-tool`、`hosted`（内核强制）、`hosted`（macOS best-effort）三档尚未在 executor 中成型；能力矩阵与「不静默改路由」证据未取 | **ECP-7 NOW** |
| 判据 4（替换安全身份） | opaque ref、三态协议、registry v2、replacement recovery 已有累计实现；Step 1 决定将其整体转为**升级路线**，0.2.0 改为守护进程死亡即作用域死亡 | **移交升级路线（保留全部实现与 evidence）** |
| 自宿主与发布 | 无非 ECP 玩具 Change 自宿主；统一 PR/CI/release truth 未闭合 | **ECP-7 / ECP-8** |

ECP-1..4 的历史实现与 dogfood 证据继续有效，但不能覆盖上表缺口；ECP-5
终态维持 `partial`。当前依据详见
[`0.2.0 gap calibration`](../../../../docs/audits/0.2.0-ecp-gap-calibration-2026-08-01.md)。

```text
PASSED
  ECP-6 v2 Authoring and Loop Contract Closure

NOW（唯一 activeSlice）
  ECP-7 Session Execution and Self-hosting
    -> ecp-platform-process-authority-foundation（common contract；已 terminal）
         -> ecp-linux-process-authority-provider ────┐
         -> ecp-windows-process-authority-provider ──┴─> ecp-native-process-capsule-closure
    -> 恢复 ecp-durable-agent-session-host 的 fresh independent review
    -> 原 child 2–4 严格串行；executor 同时拥有 in-tool 与 hosted 两个后端

MOVED OUT（0.2.0 不再包含）
  macOS durable 进程权威（sandbox / Endpoint Security / VM 方向均未选）
    -> 登记为 0.3.0 研究事项，见父级 roadmap.md §13
    -> 不再有边指向 ecp-native-process-capsule-closure

LATER（严格顺序）
  ECP-8 Completion Audit and Release Truth
    -> 0.3.0 Issue / Dispatch

NOT NOW（0.3.0 及以后）
  auto-decompose / Issue Dispatch / cross-project execution
  remote runtime / team platform / notifications / Forge
```

## ECP-6：v2 Authoring and Loop Contract Closure（PASSED）

### 当前结果

2026-08-04 Reconcile 判定 `passed`。四个严格串行 child 最终独立 review 均为
`CLEAN` 0/0/0/0；Canvas-authored loop + parallel vertical 通过 73 个 fresh CLI
processes / 73 transitions；最终 fresh root 为 6,911 tests（0 failed），fresh UI 为
651/651。parent PR/CI task 按用户锁定的整个 0.2.0 单一 PR 约束保留到 ECP-8，
不否定本 Slice 的本地功能验收。

完整验收与边界见
[`slices/v2-authoring-loop-contract-closure/result.md`](./slices/v2-authoring-loop-contract-closure/result.md)。

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

## ECP-7：Session Execution and Self-hosting（ACTIVE）

### 当前恢复位置

初次 portfolio 已投影为 durable Session host、frozen Action executor、policy/control parity、
self-hosting proof 四个严格串行 child。首个 host child 完成 proposal/apply/verify 后经历三轮
review/fix 与一次 material strategy attempt；opaque ProcessScope、native ProcessCapsule、
Windows Job-at-create、registry v2 等累计实现已存在，真实 Windows controller-death escape
已关闭，但 fresh non-author review 仍确认 macOS ABI、scope-close classification、POSIX
replacement cleanup、PREPARED control timeout 四个 Major 与 helper reproducibility 一个 Minor。

用户已批准新增 `ecp-native-process-capsule-closure` 作为独立 prerequisite。它是当前唯一
runnable frontier；完成 S1–S5 并独立 review-clean/local terminal 后，原 host child 才能在
保留旧 `strategy-exhausted` history 的新 bounded review budget 中恢复。原 child 2 同时依赖
closure 与 host，之后 child 3–4 仍严格串行。该调整只改变 ECP-7 的当前执行顺序，不改变
Target State、Slice acceptance、0.2.0/0.3.0 边界或 ECP-8 release-truth 责任。

### 2026-08-04 architecture replan

上述“closure 是唯一 runnable frontier”是 review round 1 前的历史状态，现已被本节取代。
独立 review 证明 POSIX process group 不是 containment boundary：workload 可用
`setsid()`/`setpgid()` 逃逸。Windows Job 继续成立；Linux 的最小可靠方案是 user+PID
namespace guardian，并在平台策略禁用时使用经认证安装 broker 所拥有的同等 namespace/
cgroup-v2 authority；macOS 的最小 native 方案依赖 macOS 27 Beta
`es_new_descendants_client`/`es_sync_client`、Endpoint Security entitlement、签名/notarization
和真实 macOS 27 runner。macOS VM 是完整但显著更大的替代方案。

当前产品/release pipeline 既没有上述 macOS 27 支持承诺，也没有 entitlement、签名安装或
VM 分发。因此必须先由产品 owner 显式选择：授权 macOS 27 native ES 方案，或选择 VM/改变
macOS support promise；不得静默标记 unsupported。决策后在同一 ECP-7 Slice 创建
`ecp-platform-process-authority-foundation`，再恢复现有 closure：

```text
ecp-platform-process-authority-foundation
  -> ecp-native-process-capsule-closure
       -> ecp-durable-agent-session-host
            -> ecp-frozen-action-session-executor
                 -> ecp-session-policy-and-control-parity
                      -> ecp-session-self-hosting-vertical-proof
```

新 foundation 拥有跨平台 authority provider、Linux namespace/broker、macOS ES/签名安装、
Windows adapter 和真实 escape/death/recovery oracles；closure 拥有 ProcessScope/host 集成、
删除 PGID claim/fallback、SEC-001..003、RC-002..005 与最终 review。旧 tasks/evidence/counters
全部保留为 provenance，不计作新 authority 已完成。ECP-8 继续拥有三 OS 干净分支真实验收。

### 2026-08-04 macOS decision defer 与可运行平台拆分

上节把全部平台实现合并进一个 decision-gated foundation，因而把 macOS 产品选择错误地变成了
Windows、Linux 与 common contract 的全局起跑门。用户现已明确：**记录 macOS authority
选择，方案延后决定；先继续其他可独立工作。** 这个决定的含义严格限定为：

- 没有批准 Endpoint Security、VM、silent unsupported、最低 macOS 版本或任何 macOS
  runtime/support/release claim；
- macOS provider 保持 decision-gated，在新的人类决定进入 Direction 前不得 proposal/apply；
- final ProcessCapsule closure 必须等待 Linux、Windows 与未来选定的 macOS provider 全部 terminal；
- ECP-8 仍必须在干净交付分支运行真实 Windows/Linux/macOS acceptance，缺失或失败的 macOS
  receipt 继续阻止 0.2.0 release；
- 该 gate 不再阻止 common `ProcessAuthorityProvider`/opaque-ref/dispatch contract，也不阻止
  Linux 和 Windows provider 在 common contract 冻结后推进。

当前安全 DAG 因而拆分为：

```text
ecp-platform-process-authority-foundation       [pending; dependsOn: []; common only]
  ├─> ecp-linux-process-authority-provider      [pending after foundation]
  ├─> ecp-windows-process-authority-provider    [pending after foundation]
  └─> ecp-macos-process-authority-provider      [escalated/decision-deferred; not runnable]

linux + windows + macos providers
  -> ecp-native-process-capsule-closure         [prior review retained; explicit resume only]
       -> ecp-durable-agent-session-host        [prior escalation retained]
            -> ecp-frozen-action-session-executor [explicit closure + host dependency]
                 -> ecp-session-policy-and-control-parity
                      -> ecp-session-self-hosting-vertical-proof
```

Portfolio schema 没有 `decision-gated` child status；因此 LEAD 投影时必须给 macOS child 使用
schema-valid `escalated`，并在 note/replan evidence 中写明 `decision-deferred`。不得写一个会被
解析为 `unknown` 的自造 status，也不得把它设为 `pending`。Foundation 是当前唯一 pending 且
无依赖的 child；foundation terminal 后只有 Linux 与 Windows 进入同一 parallel cohort。Closure
保留现有 review/open-finding history 并处于非 runnable 状态；三 provider 全部 terminal 后再由
LEAD 显式授予 fresh bounded integration/re-review budget。该拆分只改变执行前沿，不改变
Slice acceptance、Target State、ECP-8 release truth 或 0.2.0/0.3.0 边界。

### 2026-08-07 分级执行后端与 macOS 移交 0.3.0

本节取代上两节所描述的执行前沿，但保留其历史。上两节把 macOS 产品选择作为
closure 的前置 gate；用户已明确把 macOS durable 权威整体移出 0.2.0，因此该 gate
不再存在于本版本线。

**事实更正（经代码核实）**：此前讨论曾把「closure 删除 PGID claim/fallback」与
「保留从 Claude Code/Codex 内部驱动的执行流程」当作冲突项，该判断不成立。二者
分属不同的轴：

- 派发拓扑 `native | exec-bridge | legacy-fallback` 定义于
  `src/core/pipeline-registry/run-state.ts`，由 `_orchestration.ts` 的 LEAD 消费；
- 进程权威 `ProcessScope`/`ProcessAuthorityProvider` 定义于
  `src/core/session-host/`，其构造点在整个 `src/` 中只有
  `src/core/management-api/router.ts`。

宿主原生派发（Tier A）从不进入 ProcessScope，因此删除 PGID 权威不影响 in-tool
执行路径。closure 的 PGID 删除义务**不变**。另注意 run-state 的 `legacy-fallback`
是宿主未知时的派发路由兼容值，与 ProcessCapsule 的 "PGID fallback" 只是撞名。

**分级执行后端**：executor 通过声明能力的后端执行冻结 Action。

| 后端 | 进程归属 | 所需权威 | durable | headless driver | 精确递归终止 | 平台 |
| --- | --- | --- | --- | --- | --- | --- |
| `in-tool` | 宿主工具 | 无（不做 authority claim） | 否 | 否 | 否 | Linux / Windows / macOS |
| `hosted`（内核强制） | rasen daemon/host | 内核强制 provider | daemon-lifetime | 是 | 是 | Linux / Windows |
| `hosted`（best-effort） | rasen daemon/host | 无（显式非权威） | daemon-lifetime | 是 | **否**，终态 `emptiness-unproven` | macOS |

`durable: daemon-lifetime` 的含义：跨 launcher 退出存活，**不跨守护进程自身重启**。
守护进程死亡即作用域死亡（Linux/Windows 零孤儿、内核保证；macOS best-effort），
在飞 action 记类型化 `execution-lost`。见 Target State 锁定决策 11。

红线：请求 `hosted` 而当前平台无 provider 时返回类型化 `authority-unavailable`
（`src/core/session-host/process-authority/registry.ts` 已实现），**绝不自动改
路由到 `in-tool`**；选用 `in-tool` 只能来自显式请求，或来自启动前即展示能力差异
的显式默认。

**依赖图变更**：切断 `ecp-macos-process-authority-provider ->
ecp-native-process-capsule-closure` 这一条边。closure 验收随之收窄为「在两个具备
内核强制权威的 OS 上关闭 hosted 后端」。closure 的其余 ownership（ProcessScope/host
集成、PGID 删除、`SEC-001..003`、`RC-002..005`、fresh independent review 与 local
lifecycle）不变。

**未获批准的事项**：Endpoint Security 方案、VM 方案、silent unsupported、macOS
最低版本、Apple entitlement/签名/公证分发——一项都没有。它们整体移交 0.3.0 研究，
登记在父级 `roadmap.md` §13。

### 用户结果

Reconciler 授予的 agent action 由独立、可恢复、可审计的 Session executor 实际
执行，不再要求 launcher 会话充当隐藏 worker manager；ECP 使用自身完成一个
后续非 ECP 玩具 Change。CLI、API、Canvas、daemon 或新的交互 launcher 可以接替
驱动同一 canonical Run，而不复制 worker/run truth。

### 退出证据

- executor 只消费冻结 Action/plan/profile/adapter authority，记录真实 session identity、
  cwd、actor、usage、result 与 evidence；stale/duplicate/错误 workspace fail closed；
- 完成证据具备**事务完整性**：完整集合发布、Record mutation 前从 durable store 重读复验、
  完成声明绑定 Action/invocation/workspace revision/actor 使错配与陈旧 fail closed。
  **按锁定决策 12，不再要求生产 producer 签名或私钥托管纪律**；ECP-6 已归档的 Ed25519
  实现不回退；
- cancel-before-start/in-flight、host/daemon restart、worker loss、ack loss、重复 completion
  与 driver replacement 有 exactly-once/fail-closed 证据；
- session reuse/handoff/touch/retire policy 有真实实现、配置来源、provenance 与边界；
- CLI、API、Canvas、daemon 能 start/resume/cancel/inspect 同一个 Run；
- 一个非 ECP 玩具 Change 从 start 经 implement、verify、independent review/fix 到本地
  delivery-ready 由 ECP 自宿主，保存 RunId、ActionId、Session、revision 与完整证据；
- Session/executor/trust/control 相关 Blocker/Major 为零，root/UI 与静态 Gate 通过。

完整选择契约见
[`slices/session-execution-and-self-hosting/`](./slices/session-execution-and-self-hosting/spec.md)。

## ECP-8：Completion Audit and Release Truth（LATER）

### 用户结果

0.2.0 的实现、文档、版本、changelog、包、tag 和迁移/回退说明给出同一能力边界，
完成度审查不再发现高优先级缺口。

### 退出证据

- 在干净依赖和 fresh build 上串行运行 root/UI tests、typecheck、lint、package 与
  release contract；环境性例外逐项归因；
- 重跑完整 ECP support/dogfood/recovery matrix；support matrix 的维度是
  **OS × 执行后端**：
  - Linux：`in-tool` receipt + `hosted` receipt；
  - Windows：`in-tool` receipt + `hosted` receipt；
  - macOS：`in-tool` receipt（**必须是真实 macOS 运行**），外加一次真实 macOS
    运行证明 best-effort `hosted` 的语义如实上报——取消终态为
    `cancelled / emptiness-unproven`（不得写成已干净取消），且
    `exactCancel: false`/`scopeEmptyProof: false` 的能力声明在启动前对用户可见。
  - Linux/Windows 另须 receipt：守护进程死亡时**零孤儿**拆除（Linux 管道 EOF →
    namespace 拆除；Windows 最后句柄关闭 → `KILL_ON_JOB_CLOSE`），以及在飞
    action 被记为类型化 `execution-lost`。

  移出 macOS durable 权威**不免除 macOS runner**：上述两条 macOS 断言只能由真实
  macOS 运行证明，不接受 cross-compile、注入事件或文档声明代替。若届时仍无
  macOS runner，必须把它显式记为 0.2.0 的已知缺口，不得默认写成通过；
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

**已行使的出口条款（2026-08-07）**：macOS durable 进程权威移交 0.3.0 是上述条款
下的一次显式 scope decision，不是静默推债。其代价已按条款支付：

- Target State 新增「锁定决策 10」并按后端分级重写成功证据 §2/§6；
- 本 Roadmap 头部、当前位置表、DAG、ECP-7 与 ECP-8 段同步收窄；
- Slice `spec.md` 验收 2/4/6/7 与排除项、`plan.md` Architecture Replan 4、
  `result.md` reconcile 同步；
- 父级 `roadmap.md` §13 登记 0.3.0 研究事项；
- 发布说明须在 ECP-8 按 OS × 后端矩阵陈述能力边界。

该出口条款不可用于放宽 Blocker/Major gate、真实 OS 证据、Section 9 权限要求、
child archive 证据或 ECP-8 单一干净分支 PR 边界。
