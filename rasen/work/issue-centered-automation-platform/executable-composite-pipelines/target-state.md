# Executable Composite Pipelines Target State

> Direction：`executable-composite-pipelines`
>
> 状态：active。**2026-08-07 起 Target State 本身已被材料性修订**：执行后端
> 按能力分级，macOS durable 进程权威经显式 scope decision 移交 0.3.0
> （见「锁定决策 10」）。此前各次校准只改「当前观察基线」，本次不同。
> **同日操作者最终决定（锁定决策 13）：0.2.0 的 `hosted` 后端三 OS 统一收敛为
> 显式声明的 best-effort 档；Linux/Windows 内核强制权威（两个已冻结 crate 及其
> 全部机器与 evidence）整体保留为升级路线资产，与 macOS durable 权威同列。**
>
> 上位 North Star：[`../north-star.md`](../north-star.md)
>
> 当前事实基线：**2026-08-04，Git revision
> `050fc84332b26a75a07f441efd6b235842f89e1e`，分支
> `wip/ecp-shared-bounded-loop-lifecycle-resume` 的已验证累计 worktree**
>
> 发布线：完整 ECP 属于 **`0.2.0`**；Issue、Execution Plan、Dispatch 和
> `auto-decompose` 上移属于 **`0.3.0`**。研究与历史 Result 中的旧里程碑标签
> 保留为当时证据，不作为当前版本真相。

## 目标结果

Rasen 的每个 Change-level Pipeline 都能被准备为一份冻结、可审计的
Executable Composite Pipeline Definition，由确定性 Reconciler 推进同一份
canonical Run Record；用户能够从 CLI、API、Canvas 和 Operations 看到并控制
同一个运行事实。

“完整 ECP”在本 Direction 中具有严格含义：

- v2 Definition 是公开创作真相和所有新建入口的默认；v1 Pipeline 只作为兼容
  输入归一化到同一语义并可继续恢复；
- built-in 与 Custom Composite 使用同一套 validate、lower、reconcile、persist
  和 project contract；
- root DAG、Composite、BoundedLoop、Choice、FanOut、Join、Gate 和 Finish
  都具有明确、有限、可恢复的机械语义；
- ReviewCycle 与 GoalLoop 只是同一 Composite/BoundedLoop 内核上的领域消费者，
  不再由 prompt、skill 或命令维护第二套推进状态；
- 一个 Run 只有一个 engine owner、一份 canonical state 和一个投影视图来源；
- 冻结 Action 的实际执行由**声明能力的执行后端**承担：`in-tool`（宿主工具拥有
  worker 进程、不做任何进程权威声明）与 `hosted`（rasen 拥有 daemon-lifetime
  进程；0.2.0 为显式声明的 best-effort 档，内核强制的
  `ProcessAuthorityProvider` 围栏属升级路线——锁定决策 13）。后端能力由声明
  计算成矩阵，用户在启动前即可看到差异；请求当前平台不具备的能力档时返回
  类型化 `authority-unavailable`，**绝不静默改路由到 `in-tool`**；
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
- 让已授予 action 通过可恢复、可审计的 adapter/session boundary 实际执行，而
  不是依赖 launcher 对 worker lifecycle 的隐藏解释。被禁止的是**隐藏解释**，
  不是 launcher 参与执行本身：由宿主工具运行 worker 的 `in-tool` 后端是合法
  执行后端，前提是它的边界、能力与限制被显式声明，且结果仍提交到同一
  canonical Run。

## 当前观察基线

当前代码、CLI 探针、ECP dogfood ledger、
[`0.2.0 gap calibration`](../../../../docs/audits/0.2.0-ecp-gap-calibration-2026-08-01.md)
与 ECP-6 四个 child 的独立 review evidence 共同证明：

- Definition v2、v1→v2 normalization、immutable plan、canonical Record 与
  deterministic reconciler 已存在；CompositeRef、BoundedLoop、ReviewCycle、
  GoalLoop、Choice、FanOut/Join 可执行；
- `pipeline init`、空白 Canvas、Change-level built-in 与其他公开新建入口已经以
  authored v2 为默认；v1 保留为兼容输入，冻结的 v1 `auto-decompose` source 未变；
- Canvas 已能创作首版支持的 CompositeRef、BoundedLoop、Choice、FanOut/Join、
  Gate、Finish、declaration、typed outcomes、limits、exits 与 capability，并有
  preparation/save/reload/digest 对称证据；
- ReviewCycle 与 GoalLoop 已共享程序化 bounded lifecycle，包括 limit、progress、
  stall、blocked、strategy exhaustion、human escalation、cancel/recovery 与类型化终态；
- 一个 Canvas-authored loop + parallel Custom Composite 已经通过真实 success、
  required-member failure、fresh-process recovery、catalog rotation、tamper/replay/
  conflict rejection，以及 CLI/Management/Operations parity；完成证据使用 plan-bound
  Ed25519 authority 和可恢复的 filesystem EvidenceStore；
- 以上 ECP-6 累计树已经通过独立 CLEAN review、fresh root 6,911 tests（6,877 passed、
  34 pending、0 failed）与 UI 651/651，Definition/Canvas/loop 范围没有开放
  Blocker/Major finding；
- 内核仍只 grant/defer action；ECP-6 的可信完成生产者是测试宿主，真实 agent
  Session/worker、reuse/handoff、usage 与自动 observation 尚未由独立 executor 承担；
- 2026-08-07 用户显式 scope decision：0.2.0 的执行后端按能力分级，`hosted` 后端
  在 Linux/Windows 由内核强制权威支撑，macOS 的 durable 进程权威（sandbox /
  Endpoint Security / VM 方向均未选）整体移交 0.3.0 研究；**macOS 在 0.2.0 的
  执行形态是 `in-tool`**。这不是静默推债，见「锁定决策 10」；
- 2026-08-07 全面审查（经代码核实）：生产 hosted 路径从未接入两个已冻结的
  authority crate——构造点 `router.ts:639` 上 darwin 走 best-effort scope，其余
  平台走**遗留 ProcessCapsule**（其 POSIX exact-scope-empty 主张已被审查证伪）；
  两 crate 的取消路径均被测量证实端到端不可用（Linux `open-runtime` 2 s 死桥、
  Windows 缺 frame 保真 verb）。同日操作者据此决定锁定决策 13：0.2.0 hosted
  三 OS 统一 best-effort，内核强制权威移交升级路线；
- 尚未由 ECP 自身从 start 到 delivery-ready 完成一个后续非 ECP 玩具 Change；最终
  干净分支、统一 PR/远端 CI、版本/changelog/tag 一致性与 legacy retirement 决策也
  尚未闭合。

因此当前结果是：**组合执行内核已成形，但完整 ECP 产品仍为 partial。**

## 成功与健康证据

Target State 只有在以下证据同时成立时才满足。

### 1. Definition 与编译

- v1 read/normalize/compile compatibility 和 v2 authored execution 均可用；
- `pipeline init`、空白 Canvas 与其他新建入口默认输出 v2；
- Canvas save/detail/export round-trip 后语义 digest 不漂移；
- built-in 与 custom definition 生成相同类别的 immutable plan；
- recursion、nested loop、普通 cyclic edge、缺失出口、非法 port、能力和预算
  越界在启动前 fail closed。

### 2. Runtime 与恢复

- 同一 immutable plan + committed Record 总是产生同一 next action；
- root、composite、round、invocation、attempt 和 effect identity 稳定；
- ReviewCycle、GoalLoop 和 FanOut/Join 都由同一个 reconciler lifecycle 推进；
- 公共 BoundedLoop lifecycle 统一约束 progress/stall、blocked、strategy、budget、
  human escalation 与 typed terminal outcomes；
- crash-before-commit、crash-after-commit、ack loss、resume、cancel、timeout、
  cap exhaustion 和 partial failure 均有故障注入证据；
- completed invocation 不会重复 admission，未提交结果不会推进状态。
- agent action 的实际 Session 执行、取消、恢复、usage 与 evidence 可追溯到同一
  canonical Run，而不是只存在于 launcher 会话。该要求按后端分级验收：
  - `hosted`：headless driver、跨 launcher 退出存活（`durable: daemon-lifetime`）
    均须有真实证据；**三 OS 统一为显式声明的 best-effort 档（锁定决策 13）**：
    `exactCancel: false`/`scopeEmptyProof: false` 在启动前对用户可见，取消终态
    为 `cancelled / emptiness-unproven`；Windows 的 Job `KILL_ON_JOB_CLOSE`
    守护进程死亡拆除保证保留并须有 receipt；内核强制的精确递归终止与精确
    scope-empty 属升级路线，不再是 0.2.0 验收；
  - `in-tool`：须证明 launcher 消失时返回类型化 `execution-lost`、未提交前沿
    保持未提交、Run 可由其他 driver 恢复、已提交 invocation 不重复执行；
    它**不声称** durable、headless 或精确递归终止，且该限制必须是声明出来的，
    不是事后解释的。

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
Run。`auto-decompose` 属于 0.3.0 Issue Dispatch/Execution Plan，不计入
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
- 完整 dogfood matrix、恢复 matrix 和 support matrix 可追溯；support matrix 的
  维度是 **OS × 执行后端**，不是单一的 OS 维度：每格要么有真实运行 receipt，
  要么有真实运行证明的类型化 `authority-unavailable`；
- 架构、用户文档、migration/fallback 说明、manifest、changelog 和 tag 对
  同一版本给出一致能力边界；
- 重跑完成度审查时，不再出现“Definition 可表达但 Runtime 不可执行”、
  “Canvas 只读”、“built-in legacy-only”或版本事实漂移。

## 边界

### 本 Direction 包含

- Change-level Pipeline Definition、Canvas authoring、compiler/lowerer；
- deterministic reconciler、canonical Run Record、adapter/effect recovery；
- agent/command adapter 与可恢复 Session execution boundary；
- ReviewCycle、GoalLoop、Choice、FanOut/Join、Gate 和 Finish；
- CLI、Management API、Operations 的执行与控制平面；
- Change-level built-in migration、Custom Composite dogfood；
- legacy compatibility、thin launcher 收敛和 ECP 发布门。

### 本 Direction 不包含

- 0.3.0 的 `auto-decompose`、Issue Dispatch、Issue Execution Plan 和 Issue Board；
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
9. **0.3.0 不承接 ECP 成立所需能力。** 0.2.0 若仍缺少本 Target State 的必要
   部分，就不能声明完整 ECP，也不能把完整性债务静默推给 Issue 版本线。
11. **作用域生命周期 = 守护进程生命周期（2026-08-07 Step 1 用户决定）。**
    执行作用域不再要求跨守护进程自身重启存活：

    - **守护进程死亡 ⇒ 作用域死亡 ⇒ 在飞 action 记类型化 `execution-lost`，
      Run 只能从最后一个已提交前沿恢复。** 不重新附着、不复验身份。
    - 这落在既有验收「恢复只继续未提交前沿」的字面含义内，因此**是换实现而非
      缩范围**；`hosted` 的能力声明相应收窄为 `durable: daemon-lifetime`
      （跨 launcher 退出存活，不跨守护进程重启）。
    - Linux/Windows 上守护进程死亡必须**零孤儿**：Linux 由 guardian 持有的
      继承管道 EOF 触发 namespace 拆除，Windows 由 `KILL_ON_JOB_CLOSE` 触发，
      两者均为内核保证。
    - 判据 4（替换安全身份）的既有实现——opaque reference envelope、
      boot id/出生时刻/PID-ns inode 绑定、pidfd 重开复验、
      prepared→published→activate 三态协议、registry v2——**全部保留为升级
      路线，不删除、不改写历史**，比照 macOS durable 权威与 Linux broker 两次
      移交的既定规矩。
    - 该决定不放宽任何 Blocker/Major gate、真实 OS 证据、child archive 证据
      规则或 ECP-8 单一干净分支 PR 边界。
12. **威胁模型是「我们自己搞错」，不是「有人攻击我们」（2026-08-07 用户决定）。**
    Agent 运行在**用户自己的机器上、以用户身份、用用户凭据、在用户自己的仓库里**，
    本就拥有完整的文件系统与网络权限。**进程权威是清洁工，不是沙盒**——它存在的
    唯一目的是让「取消」真的取消、「完成」真的意味着我们自己的 worker 停了，
    不泄漏还在烧 token 的 agent 进程。由此：

    **保留（防我们自己出错，天天发生）：**
    - fail-closed 与类型化不确定性——防 Record 说谎，这是 ECP 存在的理由；
    - 能力诚实：`authority-unavailable` 不静默改路由、能力声明启动前可见；
    - actor separation（fixer ≠ verifier）程序强制——本仓反复证明其必要；
    - 对**我们自己 worker** 的包含与递归终止（janitor 职能）；
    - 证据**完整集合发布 + 写入 Record 前重读校验**——这是**事务性**要求，
      防的是崩溃在发布中途留下半写集合。

    **不再作为验收（防本地攻击者，而该攻击者在我们的部署形态里若存在，
    早已能直接改本地 Run Record，绕过所有这些机制）：**
    - 生产 Session producer 的**签名与私钥托管纪律**；完整性由事务/校验和承担；
    - helper 的**跨构建根逐字节可复现**作为 provenance 主张（manifest ↔ 相邻
      二进制的哈希/长度完整性校验**保留**，它防的是安装损坏，是真实故障）；
    - 路径解析的 **TOCTOU 竞态加固**（符号链接/junction 重定向、校验与 spawn
      之间的 cwd 重定向）。

    **边界：不回退 ECP-6 已交付并归档的实现。** 本决定改变的是 ECP-7 及之后
    必须**新建立**哪些证据，不是拆除既有代码。既有相关 finding 由 review 波
    按本威胁模型**重新定级**，Direction 不代为关闭任何 finding。
10. **执行后端按能力分级，macOS durable 权威显式移交 0.3.0（2026-08-07 用户
    scope decision）。** 依据 Roadmap「版本边界」预留的出口条款，本次以显式
    scope decision 收窄 0.2.0 的能力声明，而非静默推债：
    - 0.2.0 交付两个执行后端。`in-tool` 三 OS 可用；`hosted` 仅在具备内核强制
      `ProcessAuthorityProvider` 的 Linux 与 Windows 可用。
    - macOS 的 durable 进程权威整体移出 0.2.0。**Endpoint Security 方案、VM
      方案、macOS 最低版本、Apple entitlement/签名/公证分发，一项都未获批准**，
      它们作为 0.3.0 研究事项，登记在父级 Roadmap。
    - macOS 在 0.2.0 既不是 silent unsupported，也不是全量支持。**2026-08-07
      Step 1 决定修订此项**：macOS 除 `in-tool` 外，另提供**显式声明的
      best-effort `hosted`**（POSIX 进程组），其能力声明为 `exactCancel: false`、
      `scopeEmptyProof: false`，取消终态必须是 `cancelled / emptiness-unproven`
      而非「已干净取消」。该档次**不是** durable 权威的替代实现，macOS durable
      进程权威仍整体在 0.3.0。两侧都必须有真实 macOS 运行证据（见成功证据 §6
      与 ECP-8）。
    - 该决定不放宽任何 Blocker/Major gate、不豁免真实 OS 证据、不修改 closure
      对 PGID 权威的删除义务，也不改变 0.2.0/0.3.0 在其他方面的边界。
13. **0.2.0 `hosted` 后端三 OS 统一收敛为 best-effort，内核强制权威整体移交
    升级路线（2026-08-07 操作者决定）。** Roadmap「版本边界」出口条款的第二次
    显式行使。操作者约束是交付时限与成本：把难以落地的实现先拆分出来（不丢弃
    既有工作），干净利落地切到可以落地的方案，之后再慢慢探索更难的方案。

    - 0.2.0 的 `hosted` 后端在 **Linux、Windows、macOS 三 OS 统一为显式声明的
      best-effort 档**：POSIX 进程组 / Windows Job object 承担 janitor 职能，
      能力声明 `exactCancel: false`、`scopeEmptyProof: false` 启动前可见，取消
      终态 `cancelled / emptiness-unproven`，daemon 死亡语义仍按锁定决策 11 的
      `execution-lost` 路径。锁定决策 10 中「`hosted` 仅在具备内核强制
      `ProcessAuthorityProvider` 的 Linux 与 Windows 可用」的能力面陈述由本条
      修订；其 macOS durable 权威在 0.3.0 的部分不变，并扩展为**三 OS 的内核
      强制权威都在升级路线**。
    - **决定依据（2026-08-07 全面审查，经代码核实）**：生产 hosted 路径从未接
      入两个冻结 crate（`router.ts:639`：darwin → best-effort scope，其余 →
      遗留 ProcessCapsule）；两 crate 的取消路径均被测量证实端到端不可用。因此
      本决定不放弃任何当前可工作的能力，反而以诚实声明取代遗留 capsule 在
      POSIX 上已被证伪的 exact-scope-empty 虚报。
    - **不丢弃既有工作**：Linux `89f6c1d5` 与 Windows `fc49a7c2`/helper
      `367666f6` 两个冻结 crate、guardian/attestation/receipt 全部机器与
      evidence 保留在 git 作为升级路线资产，比照判据 4 与 macOS durable 权威的
      既定规矩；已知缺陷（Linux D4/D2、Windows frame 保真 verb 缺失）随资产
      记录在案，不在 0.2.0 修复。
    - 锁定决策 11 中「Linux/Windows 守护进程死亡必须零孤儿（内核保证）」按本条
      修订：Windows 侧 Job `KILL_ON_JOB_CLOSE` 保证保留；Linux/macOS 侧收敛为
      best-effort 声明语义，孤儿风险是**声明的已知限制**。「Record 不说谎」的
      不变量不变。
    - 本决定不放宽 fail-closed 类型化不确定性、能力诚实（`authority-unavailable`
      不静默改路由）、actor separation 程序强制、完成证据的事务完整性，也不
      改变 ECP-8 真实 OS receipt 与单一干净分支 PR 边界。closure 的验收随之
      改写为「以 best-effort 档取代遗留 capsule 的虚报并完成 ProcessScope/host
      集成」；其 PGID 删除义务转化为 **PGID exact 主张删除**（进程组机制本身
      以声明 best-effort 的形态保留）。细节见 plan.md Architecture Replan 6。

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
Change-level ECP 做成可依赖的执行底座；ECP 通过前，父级 0.3.0 Issue Phase 0–8
继续保持 Later。
