# ECP-7 Result

Status: partial

## Selection baseline

- Selected at：2026-08-04T06:26:58+08:00
- Observed Git revision：`050fc84332b26a75a07f441efd6b235842f89e1e`
- Predecessor：ECP-6 `passed`，四个 child 独立 review 均 `CLEAN`
- Projection：尚未执行；没有 ECP-7 Change、portfolio、Run 或 delivery claim

## Current evidence

- ECP-6 已冻结并验证 Action/profile/adapter public authority、Ed25519 signed evidence、
  HostEvidenceWriter complete-set publication、durable EvidenceStore 与 Facade re-verification。
- ECP-6 的 73-process vertical 证明 caller/driver 能围绕 canonical Run 执行真实 CLI 状态转换，
  但可信 producer 仍由测试宿主人工提供；这正是 ECP-7 需要替换的产品缺口。
- `docs/session-execution-layer-design.md` 的探针支持 stream-json live host、resume recovery、
  cwd binding、single-flight、registry/touch/tier/audit 方向；它仍是设计输入，必须在 Change
  设计中与 ECP-6 的现行 trust/Run contract 重新对表。

## Acceptance accounting

- frozen Action consumption：未验证。
- real Session identity/cwd/actor/usage/result/evidence：未验证。
- production plan-bound trusted producer and private-key custody：未验证。
- cancel/restart/ack-loss and exactly-once recovery：未验证。
- authoritative session reuse/handoff configuration：未验证。
- CLI/API/Canvas/daemon same-Run driving：未验证。
- non-ECP toy Change self-hosting through delivery-ready：未验证。
- Blocker/Major clean and complete gates：未验证。

## Known boundaries

- ECP-8 release truth 与唯一 0.2.0 PR 尚未开始。
- Issue/Execution Plan/portfolio/`auto-decompose` migration 属于 0.3.0，不是本 Slice 验收。

在所有可观察验收都有真实、独立证据前，本 Result 保持 `partial`。

## Reconcile：2026-08-04 child 1 strategy escalation 与批准重规划

### 已观察的投影与执行事实

- ECP-7 已由 `rasen-auto auto-decompose` 投影为严格串行 portfolio：
  `ecp-durable-agent-session-host -> ecp-frozen-action-session-executor ->
  ecp-session-policy-and-control-parity ->
  ecp-session-self-hosting-vertical-proof`。这取代了 Selection baseline 中
  “尚未执行 projection”在当时成立、现在已过期的事实；原文保留用于追溯。
- 第一个 child `ecp-durable-agent-session-host` 已完成 proposal/apply/verify，
  当前任务事实为 80/88；其 review-loop 经三轮独立 review/fix 后仍有两个 process
  authority Major，于是使用了唯一一次 material strategy attempt。
- strategy attempt 落地了 opaque `ProcessScope`、source-built native
  ProcessCapsule、Windows suspended Job-at-create/unique-controller-handle、Linux
  pidfd/boot/start/pgid、macOS native birth identity、registry v2 以及
  prepare -> CAS -> activate。Fresh author 与 non-author focused/static/package gates
  均通过，真实 Windows controller-death escape `R3-V5-A` 已关闭。
- Fresh non-author strategy review 仍确认 **Blocker:0 / Major:4 / Minor:1 /
  Trivial:0**。原 child 的 review-loop 与 strategy budget 已合法耗尽；child 与
  parent portfolio 均处于 `escalated`，后续原始 child 因依赖链而不可运行。

### 当前开放前沿

1. **S1 / Major — macOS birth-identity ABI：** 实现将
   `proc_uniqidentifierinfo` 声明为 40 bytes，而 XNU contract 是 56 bytes；交叉
   编译不能证明真实 macOS capability。
2. **S2 / Major — backend root EXIT 误报 scope close：** root 退出时 controller、
   supervisor 或 detached descendant 仍可存活，但 Node host 已清除 durable authority。
3. **S3 / Major — POSIX replacement cleanup：** replacement terminate 只验证并
   signal controller，无法保证 reaping exact supervisor/process group。
4. **S4 / Major — PREPARED control timeout：** activate 与 abort 没有 bounded
   deadline；wedged controller/pipe 可无限阻塞且无法产生 typed uncertainty。
5. **S5 / Minor — helper reproducibility：** source-identical clean builds 的 binary
   digest 不稳定；manifest 内部完整性成立，但当前 provenance claim 不能成立。

### 已批准的恢复决定

用户已批准把 `ecp-native-process-capsule-closure` 加为 ECP-7 的独立 remediation
prerequisite。它在当前 shared cumulative tree 上拥有且只拥有 S1–S5 的 native
ProcessCapsule seam 修复与独立 closure evidence；它必须如实引用实现最初来自已升级
的 `ecp-durable-agent-session-host`，不能把既有策略成果重写成新 child 的原创历史。

当前唯一安全 runnable frontier 是新 prerequisite。它 review-clean 并完成自己的
local ship/archive 后，LEAD 必须执行一次显式、可审计的 run-state replan：把原 child
的三轮 review、strategy attempt 与 `strategy-exhausted` 迁入不可变的
`priorEscalation`/replan history，再授予一个新的 bounded post-remediation review
budget。原 child 必须在累计树上重新通过 fresh verify、独立 review-clean、最终 gates、
local ship/archive，之后才允许原 child 2–4 继续。该恢复不能删除旧 finding/counter、
不能形成循环依赖，也不能把 closure child 的成功等同于原 child 已交付。

### Reconcile 分类

ECP-7 已产生有价值的 host/ProcessCapsule 实现与强故障证据，但 Session executor、
control parity、自宿主和本 Slice 全部退出证据仍未满足，因此本 Result 继续为
`partial`。ECP-8 release truth 与 0.3.0 Issue/Dispatch/`auto-decompose` 产品能力的
边界不变，也不吸收这项 ECP-7 完整性修复。

## Reconcile：2026-08-04 ProcessCapsule authority architecture failure

Closure review round 1 证明 POSIX reserved process group 可由 workload 使用
`setsid()`/`setpgid()` 逃逸。现有 birth identity、PID/PGID revalidation 与 group signal
不能提供 recursive containment、exact empty 或 exact kill；这不是可通过 fixer 局部修改关闭的
finding。`RC-001..005` 与 `SEC-001..003` 全部保持 open，fix round 1 的 no-code pause 是正确
结果。旧 56 个 checked tasks 是有效历史 evidence，但不再构成 authority acceptance。

已完成的架构重规划比较了两套完整设计。选择的 contingent 方向保留 Windows Job，在 Linux
使用 user+PID namespace guardian 与 installed broker/cgroup-v2 fallback，在 macOS 27 使用
signed/entitled dual Endpoint Security descendants clients 与 bounded stop/sync termination
barrier。macOS VM boundary 是更强但大幅扩张 runtime/distribution 的替代方案，当前未选择。

当前仓库与发布流程没有 Apple entitlement/signing/install、macOS 27 minimum promise 或真实
macOS 27 runner。因此 implementation 暂停在显式产品决策：授权 native macOS 27 Beta ES
方案，或选择 VM/修改 support promise。没有 silent unsupported 路径。决策后应在本 Slice
新建 `ecp-platform-process-authority-foundation`，其 terminal 后才恢复现有 closure；再恢复
原 host 和后续三个 child。任务 ledger 当前为 **58/94**，本 Result 保持 `partial` 且
decision-gated；ECP-8 的三 OS actual acceptance/release 责任不变。

## Reconcile：2026-08-04 macOS 方案延后、common/Linux/Windows 继续

### 已记录的人类决定

用户明确要求先记录 macOS authority 缺口，macOS 方案留待后续决定，同时继续推进 ECP。
这项决定**没有**批准 Endpoint Security、VM、silent unsupported、最低 macOS 版本、Apple
entitlement/signing/notarization 或任何 macOS runtime/support claim。Architecture replan 中的
两个 macOS 方向继续是研究候选，不是产品决定。

macOS provider 因而保持 decision-gated，并继续阻止最终 ProcessCapsule closure 与 ECP-8
真实三 OS release。与此同时，独立 review 已提供足够证据把平台无关 contract 与 OS adapter
拆开：common `ProcessAuthorityProvider`/opaque-ref/dispatch 可以先冻结；Linux namespace/
broker provider 与 Windows Job provider 可以在 common terminal 后推进，不必等待 macOS 选择。

### 当前安全前沿

Direction 已把单一全平台 foundation 拆为一个 common foundation 与三个 provider：

```text
ecp-platform-process-authority-foundation       [当前唯一 runnable frontier]
  ├─> ecp-linux-process-authority-provider      [foundation 后可运行]
  ├─> ecp-windows-process-authority-provider    [foundation 后可并行运行]
  └─> ecp-macos-process-authority-provider      [decision-deferred；不可运行]

all three providers
  -> ecp-native-process-capsule-closure
       -> ecp-durable-agent-session-host
            -> executor -> policy/control -> self-hosting
```

macOS child 在现有 portfolio schema 中必须使用 `escalated` 加明确 `decision-deferred` note，
不能使用会变成 runnable 的 `pending`，也不能自造 `decision-gated` status。Closure 的 review
round 1、fixer no-op、`RC-001..005`、`SEC-001..003`、tasks 与 counters 全部继续保留；三个
provider terminal 后才允许显式恢复。Executor 仍必须同时依赖 closure 与原 host。

### Reconcile 分类与计数

Closure task ledger 现为 **59/96**：原 58 项完成事实不变，task 10.3 只记录此次 explicit
defer（不是 macOS architecture approval），并新增两个未完成 LEAD projection/re-entry guard
任务。ECP-7 继续为 `partial`，但已从“整个实现无安全前沿”变成“common foundation 可安全
推进、Linux/Windows 可在其后推进、macOS/closure/release 仍 decision-gated”。ECP-8 与
0.3.0 边界不变。

## Reconcile：2026-08-07 分级执行后端与 macOS 移交 0.3.0

### 观察基线

- Git revision：`140115ced9df814f6adf3190b47171202d964a5e`，分支
  `wip/ecp-shared-bounded-loop-lifecycle-resume`。
- Portfolio 观察事实（来自 LEAD handoff #1 与各 child `auto-run.json`）：
  `ecp-platform-process-authority-foundation` 与
  `process-authority-prepare-unavailability-outcome` 已 done/shipped/archived；
  `ecp-linux-process-authority-provider` 处于 apply 实现波（72/93 tasks，11 个开放
  finding：1 Blocker、9 Major、1 Minor）；`ecp-windows-process-authority-provider`
  pending；closure 与 host 保持 escalated。
- 代码核实：`createSessionHost` / `createNativeProcessScope` 在 `src/` 中只在
  `src/core/management-api/router.ts` 被构造；`_orchestration.ts` 的 Tier A 宿主原生派发
  不进入 ProcessScope。

### 人类决定

用户于 2026-08-07 明确：ECP 必须同时支持外部 daemon 控制与从 Claude Code / Codex 内部
驱动两种执行流程；macOS 的 sandbox / durable 进程权威作为下一个版本（0.3.0）的研究事项；
**0.2.0 收尾时 macOS 的执行形态就是 in-tool 执行**。

该决定**没有**批准 Endpoint Security、VM、silent unsupported、macOS 最低版本或任何
签名/entitlement 分发方案。

### 已纠正的事实错误

此前把「closure 删除 PGID claim/fallback」与「保留 in-tool 执行」当作冲突项，判断不成立：
派发拓扑与进程权威是两条独立的轴，且 in-tool 路径从不进入 ProcessScope。closure task 12.1
的 PGID 删除义务不变，无需修订。

### 已同步的 Direction 制品

`target-state.md`（新增锁定决策 10、按后端分级重写目标结果/Agent 用户结果/成功证据
§2 与 §6、状态头标注材料性修订）、`roadmap.md`（头部状态、当前位置表新增分级后端行、
DAG、ECP-7 新增 2026-08-07 replan 节、ECP-8 改为 OS × 后端 receipt、版本边界记录已行使
的出口条款）、Slice `spec.md`（验收 2/4/6/7 分级、新增 macOS 排除项与开放决定节）、
Slice `plan.md`（Architecture Replan 4）、父级 `roadmap.md` §13、`work.yaml` 的
`lastReconciled`。

### Reconcile 分类

ECP-7 保持 **`partial`**。本次同步只改变能力声明的形状与执行前沿，没有新增任何已验证
的退出证据：验收 1–8 全部仍未取证，Linux provider 的 11 个开放 finding 与 Section 9 的
cgroup-v2 环境 gate 一律未放宽。变化在于 closure 不再被 macOS 决定 gate，因而在 Linux 与
Windows provider terminal 后即可恢复，下游 5 个 child 的依赖阻塞解除。

ECP-8 的三 OS 取证义务转为 OS × 后端取证义务，**未被免除**：macOS 侧仍需真实 macOS 运行
证明 `in-tool` 可用与 `hosted` 返回类型化 `authority-unavailable`。若届时无 macOS runner，
必须显式记为 0.2.0 已知缺口。

（macOS `hosted` 那格的期望结果已被下方 Step 1 reconcile 修订：从「返回
`authority-unavailable`」改为「best-effort 语义与 `emptiness-unproven` 终态如实上报」。）

## Reconcile：2026-08-07 Step 1 —— 作用域生命周期收敛到守护进程

### 触发

用户质疑「设计是不是太复杂了、为什么 Claude Code 起 shell 命令就能管住生死」。调查定位出
复杂度的真实来源不在包含机制（Linux/Windows 的内核原语都极简），而在**判据 4：替换安全
身份**——它只为「守护进程要能死而作用域不死」而存在。对照产品 `Reference/multica`
在判据 4 上花费为零（守护进程死后判任务失败、服务端重派），其 POSIX 包含实现约 60 行。

### 已记录的人类决定

用户于 2026-08-07 决定：

1. **分两步走。** Step 1 采用轻量方案让 ECP 快速收敛验收；判据 4 的既有成果**不作废**，
   转为后续升级路线。
2. **macOS 在 Step 1 使用 Multica 方案**（POSIX 进程组 best-effort `hosted`），
   不再限定为 `in-tool`-only。
3. 保留三条不可退让项：Windows 必须 Job Object、Linux 必须保 PID namespace、
   类型化 `authority-unavailable` 不静默改路由。

### 关键事实：这是换实现而非缩范围

验收 4 主句与 ECP-7 退出证据写的都是「恢复只继续未提交前沿」与「fail-closed 证据」，
**没有一处要求重新夺回权威**。Step 1 语义完全落在其字面含义内。因此实质性文本修改只有
`hosted` 的 `durable` 一词收窄为 `durable: daemon-lifetime`。

### 已核实的 finding 影响（逐条读原文，非摘要）

Linux provider 11 个开放 finding 中 **7 条离开，含唯一的 Blocker**（`BRK-R2-B06`）；
`WSL-R4-M00`/`M01` 部分存留；`WSL-R4-M05`、`PKG-P5` 存留。依据与边界见
`plan.md` Architecture Replan 5。

### 已同步的 Direction 制品

`target-state.md`（新增锁定决策 11、修订锁定决策 10 的 macOS 条款、成功证据 §2 按新语义
分级）、`roadmap.md`（头部新增 Step 1 决定节、当前位置表新增判据 4 移交行、后端能力表
改三档、ECP-8 receipt 改按新语义）、Slice `spec.md`（验收 2 后端定义、验收 4 分级条款、
排除项新增判据 4 移交并修订 macOS 交付面）、Slice `plan.md`（Architecture Replan 5）、
本 `result.md`、`work.yaml` 的 `lastReconciled`。

### Reconcile 分类

ECP-7 保持 **`partial`**。本次未新增任何已验证的退出证据：Windows provider 尚未 propose，
executor / policy-parity / self-hosting 三个 child 未开始，Linux 的真实 WSL 取证义务不变。
变化在于**收敛路径显著缩短**且唯一的 Blocker 随范围移出。判据 4 的既有实现与 evidence
全部保留为升级路线，不删除、不改写历史。

## Reconcile：2026-08-07 威胁模型校正（锁定决策 12）

### 触发

用户判断「不少设计是为安全而安全，脱离了实际工作」。起点是 `F-L2-17`——它被记为
`workload-non-escape` 逃逸，但演示的其实是 agent 请宿主 `systemd --user` 起一个服务，
**那是用户要它做的事**。由此确立框定：**进程权威是清洁工不是沙盒**；agent 本就以用户
身份在用户机器上拥有完整权限，namespace 改变不了这一点。

### 已记录的人类决定

威胁模型是「我们自己搞错」，不是「有人攻击我们」。分界线：防前者的留，防后者的退——
因为后者若存在，早已能直接改本地 Run Record，绕过所有这些机制。

### 四处处置

1. **Ed25519 生产签名 + 私钥托管纪律 → 退场**，改为事务完整性（完整集合发布、重读复验、
   声明绑定 Action/invocation/workspace revision/actor）。
2. **`producerIsolation` 字段 → 退场**（该字段由 Direction 自己于同日早些时候加入）。
3. **helper 逐字节可复现 → 降级为非验收**；manifest ↔ 二进制完整性校验保留。
4. **路径 TOCTOU 加固 → 不再作为验收**；`SEC-002`/`SEC-003` 交 review 波重新定级。

`F-L2-17` 本身：**不是缺陷，不做屏蔽，不建最小挂载树**。唯一真实剩余是把
`workload-non-escape` 的措辞收窄为「workload 自己 fork 的后代不可逃逸」——
无行为改动。屏蔽 session bus 的方案被显式否决（会破坏 `systemd-run` 等正常用法）。

### 明确保留

fail-closed 与类型化不确定性、能力诚实、actor separation 程序强制、对我们自己 worker
的包含与递归终止、证据完整集合发布 + 重读复验。

### 边界与分类

**不回退 ECP-6 已交付并归档的实现**；本次改变的是 ECP-7 及之后必须新建立哪些证据。
**Direction 不代为关闭任何 finding**——既有相关 finding 由 review 波按本威胁模型重新
定级。ECP-7 继续为 `partial`；本次同样未新增任何已验证退出证据，但 executor 与 host
两个尚未开始的 Change 的预期工作量因①显著下降。
