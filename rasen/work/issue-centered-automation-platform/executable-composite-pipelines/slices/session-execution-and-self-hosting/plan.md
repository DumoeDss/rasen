# ECP-7 Projection Plan

## Direction source

- Workstream：`rasen/work/issue-centered-automation-platform/executable-composite-pipelines`
- Slice：`slices/session-execution-and-self-hosting`
- 选择基线：`wip/ecp-shared-bounded-loop-lifecycle-resume` @
  `050fc84332b26a75a07f441efd6b235842f89e1e` 的 ECP-6 verified cumulative worktree
- 权威顺序：North Star > Target State > Roadmap > Slice Spec > 本 Plan > Changes
- 前置结果：ECP-6 `passed`；四个 child 最终独立 review 均 `CLEAN`

## 投影边界判断

本 Slice 同时包含真实 executor/trust boundary、Session lifecycle/control parity 与自宿主
验收，涉及不同故障域和独立 review seam；把它们塞进一个超大 Change 会让安全边界与 dogfood
缺陷无法独立归因。因此初次 Project 已交给 `auto-decompose` 生成一个**单 Slice portfolio**，
而不是由 Direction 预先手写最终 Change 名称或 tasks。

初次 decomposer 以四个严格串行 child 落实以下三个语义交付边界：

1. frozen Action → real Session → trusted completion 的 executor/registry 最小纵向链；
2. reuse/handoff、restart/cancel/ack-loss 与 CLI/API/Canvas/daemon control parity；
3. 非 ECP 玩具 Change 自宿主、缺口修复与最终 delivery-ready evidence。

当前实际投影是 `ecp-durable-agent-session-host ->
ecp-frozen-action-session-executor -> ecp-session-policy-and-control-parity ->
ecp-session-self-hosting-vertical-proof`。2026-08-04 的 child 1 review/strategy
escalation 暴露出一个不能在旧 budget 内安全关闭的 native ProcessCapsule fault domain，
因此下方 Recovery Replan 在不改变 Slice acceptance 的前提下增加一个 remediation node。

## 依赖与并行安全

- 默认严格串行：executor/trust root 必须先独立 review-clean，control/reuse 层才能消费；
  self-hosting proof 必须最后运行并只针对冻结的前两项 contract。
- Action/Profile/Adapter authority、EvidenceStore、Run/Record、Session registry、supervisor/
  daemon、Management control 与 shared fixtures 是高冲突文件和高耦合契约；修改这些区域的
  child 不得并行。
- 只有 decomposer 能证明文件 ownership 不相交、公共 contract 已冻结、测试 TEMP/daemon/
  backend 资源隔离且不存在共享 registry/port/credential 时，才允许并行纯文档、protocol
  replay fixture 或 read-only projection 工作；任何信任、进程 lifecycle、Run mutation 与
  self-hosting gate 都保持串行。
- 每个 child 使用独立 author/fixer/reviewer 身份；实现者不能签发自己的 clean verdict，真实
  worker producer 也不能绕过独立 review。

## Recovery Replan：native ProcessCapsule closure prerequisite

### 触发证据与 ownership

`ecp-durable-agent-session-host` 已完成 proposal/apply/verify，并在三轮 review/fix 与一次
material strategy attempt 后合法 `strategy-exhausted`。Strategy 已在 shared cumulative
tree 中落地 opaque ProcessScope、native ProcessCapsule 与 registry v2，并真实关闭 Windows
controller-death escape；fresh non-author review 仍留下 S1–S4 四个 Major 与 S5 一个 Minor。

新增 `ecp-native-process-capsule-closure` 是该 material strategy 的独立 remediation/
closure owner，不是重写历史的替代 child。其实现起点明确来自 escalated child 1；它只拥有
native ProcessCapsule seam、S1–S5 discriminators、必要 host integration 修复，以及对应独立
security/code/spec evidence。它不拥有 frozen Action executor、policy/control parity、
self-hosting proof、ECP-8 release truth 或 0.3.0 Issue/Dispatch 产品能力。

### 当前 DAG 与唯一 runnable frontier

```text
ecp-native-process-capsule-closure              [pending; dependsOn: []]
  -> ecp-durable-agent-session-host             [escalated history retained]
       -> ecp-frozen-action-session-executor    [also depends on closure]
            -> ecp-session-policy-and-control-parity
                 -> ecp-session-self-hosting-vertical-proof
```

Run-state 中只有 `status: pending` 且全部 dependencies 为 `done | skipped` 的 child 可运行。
因此 LEAD 必须把新 closure child 作为 `dependsOn: []` 的唯一 pending/runnable frontier；原
host child 保持 `escalated`，不能通过改回 `pending`、删除 counters 或覆盖旧报告来绕过 budget。
为防止后来错误地只满足 host 状态，`ecp-frozen-action-session-executor` 必须同时依赖
`ecp-native-process-capsule-closure` 与 `ecp-durable-agent-session-host`。其余原始依赖保持串行。
该图无循环：closure 消费 shared tree 中的代码与历史 evidence，不把 escalated child 的
run-state completion 作为自己的 prerequisite。

### Closure acceptance（S1–S5）

1. S1：使用完整且尺寸受断言保护的 56-byte macOS native ABI（优先 system/generated
   binding），并在真实 macOS 上证明 unique-birth collision、foreign identity zero-signal 与
   unavailable-source fail-closed。
2. S2：把 backend-root exit 与 whole-scope empty/controller-terminal 分开；root 退出而 detached
   descendant 存活时保持 scope live、durable authority 与可终止性，直至 exact empty/terminate。
3. S3：replacement control 同时验证 controller 与 supervisor 的 exact native birth identity，
   并在真实 Linux/macOS daemon/controller death + resistant descendant + PID-reuse oracle 中关闭
   exact reserved group；不回退到 PID-only 或 controller-only signalling。
4. S4：PREPARED -> ACTIVATE 与 prepared abort 都有 bounded control deadline；hung controller/
   pipe 返回 typed uncertainty 且保留未观察关闭的 authority。
5. S5：两个 source-identical clean helper build 要么 byte-identical，要么 proposal/spec/design/
   package provenance claim 被显式收窄并有可验证契约；manifest-to-adjacent-binary integrity 仍是
   必需但不是单独充分证据。

Closure 必须重新运行 native/package/migration subset、完整 focused host/daemon/CLI suites、
Rust/TypeScript/static/strict/package gates，以及 fresh non-author security + code/spec review；
实际 OS 断言只能由实际 OS 运行证明，不可把 cross-target compile 或 injected branch 写成真实
Linux/macOS evidence。

### 原 child 的可审计恢复规则

新 closure child 必须先达到 review-clean，并按本 Plan 的 child lifecycle 完成 local ship 与
archive。随后不是自动把 `ecp-durable-agent-session-host` 标记 clean，而是由 LEAD 执行一次
显式 Direction-backed run-state replan：

1. 将旧三轮 review、strategy attempt、开放 S1–S5 与 `strategy-exhausted` 完整保存在
   `priorEscalation`/replan history；任何既有 evidence 文件保持可追溯。
2. 授予一个新的、显式有界的 post-remediation review-loop budget；新 budget 只评估 closure
   之后的累计 host child，不把旧 counter 冒充从未发生。具体 counter/schema 写入由 LEAD
   单写者按实际 pipeline contract 完成。
3. 重新执行 original child 的 fresh verify 与独立 review/security；只有 0 Blocker/Major、
   tasks 9.8–9.10/final gates 完成后，才能执行该 child 的 local ship/archive。
4. original child `done | skipped` 且 closure `done | skipped` 后，child 2 才成为 runnable；
   然后按原 child 2 -> 3 -> 4 严格串行推进。

任何步骤都不得把 closure 的 review-clean 当作 original child 的交付完成、不得丢弃旧失败
历史、不得提前启动依赖 child，也不得将这次修复推迟给 ECP-8。

## 实现与验证约束

- ~~复用 ECP-6 的 plan-bound Ed25519 contract，不得把测试 host、测试 private key 或任意
  caller-signed completion 提升为生产 authority。~~ **2026-08-07 按锁定决策 12 退场**：
  完成证据的完整性由**事务**承担（完整集合发布 + 重读复验 + 声明绑定 Action/invocation/
  workspace revision/actor），不再要求生产 producer 签名或私钥托管。ECP-6 已归档的
  Ed25519 实现不回退，只是 ECP-7 不再有将其延伸进生产 executor 的义务。
- `docs/session-execution-layer-design.md` 是经过探针支持的设计输入，不是高于当前 Action/Run
  contract 的规格。Project/Design 必须先把其 Claude-specific host、stale P2 prerequisites、
  registry ownership 与当前代码重新对表。
- 真实 backend 测试必须有 bounded timeout、single-flight、process-tree cleanup、isolated
  TEMP/TMP 和可重复 fixture/protocol replay；不得以网络/账号偶发成功作为唯一 Gate。
- self-hosting Change 必须小、非 ECP、可逆且有明确确定性验收，但必须修改真实产品代码；
  不接受只新增文档、空 fixture 或专为通过测试构造的假 Change。
- 所有失败都返回类型化未完成前沿；不允许 launcher 在 prompt 中补写机械 retry、round、
  completion 或 Session ownership。

## Dogfood path

1. 从当前 v2 built-in 或 Canvas-authored pipeline 启动玩具 Change 的 canonical Run；
2. executor 消费冻结 Action，真实 Session 在准确 cwd 实现代码并发布 signed evidence；
3. 切换 driver 或重启 host/daemon，恢复同一 Run；注入 cancel、ack-loss 或 worker loss，证明
   已提交工作不重复、未提交前沿可解释；
4. 由独立 Session 执行 deterministic verify 与 non-author review；若有 finding，由有界
   review/fix loop 修复并重新复审；
5. 达到 local delivery-ready，保留 Run/Action/Session/revision/gate/review/evidence 关联；
   对应 child 在 review-clean 后执行 `small-feature` 的 local ship，形成仅存在于当前隔离
   worktree/分支的本地 commit，不 push、不单独开 PR；随后正常 dispatch
   `rasen-archive-change` 并用真实 archive evidence 将 archive 记为 `done`。
   `archive.timing=on-merge` 对 `Mode: local` 的 ship log 不增加 PR merge gate；只有 ship
   evidence 已明确写出 `Archived in ship` 时才可记 `skipped`，已归档 no-op 也必须有证据才可
   记 `done`。child archive 不延后给 ECP-8。最终远端交付仍由 0.2.0 统一 PR 完成。

## 返回 Direction 的证据

- 每个 child 的 proposal/design/spec/tasks、实现报告、独立 review-cycle 与终态；
- frozen Action/profile/adapter public authority、Session registry 与 producer key custody 审计；
- real backend create/wake/reuse/handoff/cancel/restart/ack-loss 的结构化运行记录；
- CLI/API/Canvas/daemon 对同一 RunId/ActionId/Session/revision 的 parity capture；
- 自宿主玩具 Change 的 start→implement→verify→review/fix→delivery-ready 完整 evidence graph；
- focused fault matrix、protocol replay、root/UI gates、typecheck、lint、strict validation；
- 未解决 finding、环境性例外、缓存/成本观测与所有接受的限制。

## 本地终态与最终统一 PR 约束

- 每个 ECP-7 child 都完整执行自己的 decompose-free `small-feature` 生命周期：propose、apply、
  verify、review-loop review-clean 后进入 local ship，提交该 child 的本地 commit（commit only，
  不 push、不单独开 PR），然后正常 dispatch `rasen-archive-change`。真实归档成功或有证据的
  已归档 no-op 将 archive 记为 `done`；只有 ship log 明确报告 `Archived in ship` 时 archive
  stage 才可记为 `skipped`。不得以 `archive.timing=on-merge` 为由延后到 ECP-8，不得永久
  `pending`，也不得把 child stage 写成 parent-only 的 `delegated`。
- 四个 child 均达到终态后，parent portfolio delivery 从 `pending` 进入 `in_progress`，完成一次
  `mode: local` 的累计本地交付并写成 `done`。这里的 `done/local` 只证明 ECP-7 cumulative
  worktree/commits 已本地 delivery-ready，不代表已 push、已建 PR、已通过远端 CI 或已发布。
- ECP-7 `passed` 后继续 ECP-8；ECP-8 才从 `origin/dev/0.2.0` 建立干净交付分支，转移并验证
  整个 0.2.0 ECP intended delta，创建唯一 PR，等待 Windows/Linux/macOS CI，再完成最终
  ECP-7 parent/ECP-8 的 remote merge/archive bookkeeping；各 ECP-7 child 已在本 Slice 内归档。
- 该约束不允许用“最终还没有 PR”否定 Slice 的本地功能验收，也不允许在 ECP-8 前把
  delivery-ready 误报为 released。

## 当前下一步

原始 Project 已完成，portfolio/child run-state 已存在。Direction worker 只记录上述恢复计划，
不创建新 Change、不实现代码、不写 machine run-state。LEAD 的下一步是以单写者身份把
`ecp-native-process-capsule-closure` 加入 parent portfolio run-state 为唯一 runnable child，
随后交给独立 proposal stage 创建该 Change；原 child 1 的 replan budget 只能在 closure
review-clean/local terminal 后按上述保留历史规则开启。

## Implementation-first batch policy (user decision, 2026-08-06)

The user explicitly changed the execution order to reduce context churn across the ECP-7
portfolio:

1. For each runnable Change, execute only `planner -> implementer` in the first wave. The
   implementer may run focused tests, builds, and local contract checks, but no independent
   `verify` or `review-loop` is dispatched at this point.
2. After a Change reaches an implementation-frozen state, record that state separately from
   Change terminal status and move to the next Change in the Direction DAG. A frozen Change is
   not review-clean, shipped, archived, or complete; its existing findings, counters, and
   evidence remain intact.
3. The first wave is serial even where the portfolio previously allowed a parallel cohort:
   Linux provider first, then Windows provider. macOS remains `escalated` with
   `decision-deferred`; it receives no proposal or implementation until a later Direction
   decision. Closure and downstream children remain dependency-blocked by the provider/decision
   boundary.
4. After every non-deferred Change in the implementation wave is frozen, the LEAD starts a
   second wave of independent `verify/review-cycle` work, preserving author != verifier. Only
   after that batch is clean may the normal local ship/archive lifecycle begin.
5. This policy is an execution-order override only. It does not waive open Blocker/Major gates,
   real-OS evidence, Section 9 privilege requirements, child archive evidence, or the ECP-8
   single clean-branch PR boundary.
6. Automatic context compaction is not a handoff trigger. A worker hands off only when its
   stated budget is reached, it genuinely cannot recall required context and self-assesses that
   work quality is degraded, or an equivalent explicit runtime failure requires relay. The
   compacted context itself must be preserved and used to continue the same implementation turn.

The LEAD records this policy in the parent portfolio run-state and each affected Change's
ephemera. The implementation-wave marker is observability metadata; it must never be interpreted
by `rasen pipeline resume` as `done`, `review-clean`, `ship`, or `archive`.

## Architecture Replan 2：process-group authority failure（2026-08-04）

### 覆盖关系与当前 gate

本节取代上方“closure 是唯一 runnable frontier”的执行建议，但不删除其历史。Closure 的
review round 1 与 CSO review 留下 `RC-001..005`、`SEC-001..003`；其中 `RC-001` 证明
`setsid()`/`setpgid()` 可逃逸 POSIX PGID，原方案无法通过继续加 birth/PGID check 修复。
Fixer round 1 因此正确地没有修改产品代码。原 review、fix、task 和 evidence 全部保留。

完整 API/OS 依据、两套设计比较与来源记录在
`rasen/changes/ecp-native-process-capsule-closure/evidence/architecture-replan.md`。选择方向是
contingent native-authority design：Windows Job；Linux user+PID namespace guardian，必要时
由 installed authenticated broker 提供同等 namespace 与 non-migratable cgroup-v2 leaf；
macOS 27 signed/entitled dual descendants-client guardian/controller 与 bounded no-gap stop/sync
termination barrier。macOS VM 是完整但未选的替代设计。

当前没有可安全运行的 implementation frontier。产品 owner 必须先明确选择：

1. macOS 27 为 native durable ProcessCapsule 最低版本，允许 Beta descendants/sync ES API，
   并提供 Apple entitlement、Developer ID signing/notarization 与真实 macOS 27 runner；或
2. 维持现有 macOS 支持/无安装分发约束，此时必须显式选择 VM program 或修改 support
   promise。不得用 silent unsupported、cross-compile 或 injected events 越过这个 gate。

### Revised DAG（决策后由 LEAD 单写者投影）

```text
ecp-platform-process-authority-foundation       [new; decision-gated]
  -> ecp-native-process-capsule-closure         [existing; paused]
       -> ecp-durable-agent-session-host        [prior escalation retained]
            -> ecp-frozen-action-session-executor
                 -> ecp-session-policy-and-control-parity
                      -> ecp-session-self-hosting-vertical-proof
```

`ecp-frozen-action-session-executor` 仍显式同时依赖 closure 与 host。新 foundation 不增加
新 Slice：它是 ECP-7 内的新 prerequisite Change，拥有 `ProcessAuthorityProvider`、protocol/
manifest rev、Linux namespace/broker/cgroup、macOS ES/signing/install、Windows Job adapter 和
real escape/owner-death/recovery/empty/kill/unavailable gates。现有 closure 在 foundation terminal
后恢复，只拥有 ProcessScope/host integration、PGID removal、SEC-001..003、RC-002..005、
final review/local lifecycle。ECP-8 拥有 actual Win/Linux/macOS clean-branch acceptance。

### Revised task accounting

Closure task ledger 由 56/63 调整为 **58/94**：新增 2 个已完成 architecture-replan evidence
task 与 29 个未完成 decision/foundation/integration task。原 56 个 checked task 继续表示旧
实现和测试实际发生过，但不证明新 authority 完成。当前 gate 为 tasks 10.3–10.4；foundation
RED→GREEN projection 为 11.1–11.17；foundation terminal 后的 closure repair 为 12.1–12.10。

必须保留的真实 Gate 包括：Linux `setsid()`/`setpgid()` escape、authority unavailable、
daemon/broker/guardian death/recovery、exact natural empty/recursive kill；macOS nested fork storm、
guardian/controller 任一死亡、sequence gap、stop/sync convergence、entitlement/signing absent；
Windows breakaway/last-handle；以及 ECP-8 每个 claimed OS 的 actual runtime receipt。

## Architecture Replan 3：macOS decision defer 与独立 provider DAG（2026-08-04）

### 用户决定与不授权边界

用户明确决定：**先记录 macOS authority 问题，macOS 方案延后决定；先继续推进其他工作。**
这不是对 Architecture Replan 2 中 Endpoint Security 候选、VM 候选、silent unsupported、
最低 macOS 版本、签名/entitlement 分发或 macOS support claim 的批准。上述候选继续作为研究
evidence，不是已接受架构。

这个决定继续阻止 macOS provider 的 proposal/apply、最终 ProcessCapsule closure，以及 ECP-8
三 OS release truth；但不再阻止能在平台选择前冻结的 common contract，也不阻止 Linux 与
Windows provider 在该 common contract 之后独立实现和验证。

### Revised provider ownership

- `ecp-platform-process-authority-foundation` 只拥有 common
  `ProcessAuthorityProvider`、versioned opaque reference envelope、provider dispatch/registry、
  bounded lifecycle/typed availability and uncertainty、closed capability negotiation 与
  deterministic contract mutations。它不得实现任一 OS adapter、broker、entitlement、installer，
  也不得产生 OS support claim。
- `ecp-linux-process-authority-provider` 拥有 user+PID namespace guardian、availability probe、
  authenticated installed broker/non-migratable cgroup-v2 fallback、replacement recovery 与真实
  Linux escape/death/empty/kill/unavailable oracles；不得回退到 PGID/PID tree。
- `ecp-windows-process-authority-provider` 拥有 common provider 后的 Job Object adapter、
  suspended assign-before-run、breakaway-disabled/last-handle invariants 与真实 Windows mutations。
- `ecp-macos-process-authority-provider` 只先占有 macOS authority fault domain 与 decision record；
  在未来 Direction 决定 Endpoint Security、VM 或 support-matrix 方案前不得选择架构、创建实现
  acceptance、开始 proposal/apply 或声称 unsupported/supported。
- 现有 `ecp-native-process-capsule-closure` 只在三个 platform provider 全部 terminal 后恢复，
  集成 provider 与 ProcessScope/host，删除/硬禁用 PGID claim/fallback，并关闭
  `SEC-001..003`、`RC-002..005` 与 fresh independent review/local lifecycle。

### Safe runnable DAG 与 schema-valid 状态

```text
ecp-platform-process-authority-foundation       [pending; dependsOn: []; serial]
  ├─> ecp-linux-process-authority-provider      [pending; parallel cohort authority-platforms]
  ├─> ecp-windows-process-authority-provider    [pending; parallel cohort authority-platforms]
  └─> ecp-macos-process-authority-provider      [escalated; decision-deferred; not runnable]

ecp-linux-process-authority-provider ──────┐
ecp-windows-process-authority-provider ────┼─> ecp-native-process-capsule-closure
ecp-macos-process-authority-provider ──────┘       [escalated history retained]
  -> ecp-durable-agent-session-host                [prior escalation retained]

ecp-native-process-capsule-closure ─────────┐
ecp-durable-agent-session-host ─────────────┴─> ecp-frozen-action-session-executor
  -> ecp-session-policy-and-control-parity
    -> ecp-session-self-hosting-vertical-proof
```

`PortfolioChildStatusSchema` 没有 `decision-gated`。LEAD 必须把 macOS child 投影为 schema-valid
`escalated`，并在 child note 与 parent `replans[]` 写明 `decision-deferred`；不得自造会 normalize
为 `unknown` 的 status，也不得使用 `pending`。Foundation 是初始唯一 runnable child。
Foundation `done | skipped` 后，Linux 与 Windows 才能同时成为 runnable；macOS 仍不可运行。

现有 closure 在 parent 中从 `in_progress` 转为 `escalated` 时，必须把 apply/verify、review round 1、
fixer no-op、8 个 open findings 与当前 counters 写入 append-only replan/prior-escalation evidence；
不得清空其 child `auto-run.json`。未来 macOS decision 只把 macOS node 经显式 Direction replan
转为 `pending` 并生成对应 planning artifacts。三个 provider 全部 `done | skipped` 后，LEAD 再给
closure 一个 fresh bounded integration/re-review budget并恢复现有 review-loop，而不是把它当作
新 Change 从零开始。

### Verification and release truth

Common foundation 的 terminal 只证明平台无关 contract；每个 provider 的 terminal 只证明该
平台 Change 的实现与其真实/明确记录 gate。它们不能互相替代。Closure 必须显式依赖全部三个
provider。ECP-8 仍重跑干净分支真实三 OS matrix；任何 macOS 方案未决定、provider 未 terminal、
实际 receipt 缺失或失败，都阻止 closure/ECP-8 release，不得用 cross-target 或 injected evidence
转写为通过。

Direction worker 不创建 Change、不写 `.rasen/**`。LEAD 下一步是按上述顺序创建并投影四个
prerequisite Change，使 common foundation 成为唯一 runnable frontier；macOS node 在未来人类
决定前保持 decision-deferred。

## Architecture Replan 4：分级执行后端与 macOS 移交 0.3.0（2026-08-07）

### 覆盖关系

本节取代 Architecture Replan 2 与 3 所建立的执行前沿与依赖图，但不删除其历史。Replan 2/3
把 macOS 产品选择作为 closure 的前置 gate；用户已明确把 macOS durable 权威整体移出 0.2.0，
该 gate 因而不再存在于本版本线。Replan 2/3 中的 API/OS 依据、两套设计比较与来源记录继续
作为 0.3.0 的研究输入有效。

### 事实更正：两条轴此前被混为一谈

此前把「closure 删除 PGID claim/fallback」与「保留从 Claude Code/Codex 内部驱动的执行流程」
当作冲突项。经代码核实，该判断不成立：

| 轴 | 取值 | 定义处 | 消费者 |
| --- | --- | --- | --- |
| 派发拓扑 | `native` / `exec-bridge` / `legacy-fallback` | `src/core/pipeline-registry/run-state.ts` | `src/core/templates/workflows/_orchestration.ts` 的 LEAD |
| 进程权威 | `ProcessScope` + `ProcessAuthorityProvider` | `src/core/session-host/` | 仅 `src/core/management-api/router.ts` |

`createSessionHost` 与 `createNativeProcessScope` 在整个 `src/` 中只在
`src/core/management-api/router.ts` 被构造；`_orchestration.ts` 的 Tier A 宿主原生派发
（宿主自己的 Task tool / `spawn_agent` 起 worker，rasen 不拥有任何进程）从不进入
ProcessScope。因此**删除 PGID 权威不影响 in-tool 执行路径，closure task 12.1 无需修订，
其 PGID 删除义务不变**。

另需区分两个撞名概念：run-state 的 `legacy-fallback` 是宿主未知时的**派发路由**兼容值；
ProcessCapsule 的 "PGID fallback" 是已被否证的**进程权威**退路。Direction 禁止的静默降级
针对后者，与前者无涉。

### 分级执行后端 ownership

executor 通过声明能力的后端执行冻结 Action。`in-tool` 后端不依赖任何进程权威，因此
executor 不再整体依赖平台权威链。能力矩阵与 `authority-unavailable` 不静默改路由归
`ecp-frozen-action-session-executor` 的 design/apply 拥有（`producerIsolation` 已按
锁定决策 12 退场，不在其中）；provider 与 closure 仍只拥有 `hosted` 后端所需的内核
强制权威。

### Revised DAG

```text
ecp-platform-process-authority-foundation       [terminal]
  ├─> ecp-linux-process-authority-provider      [implementation wave, in progress]
  └─> ecp-windows-process-authority-provider    [pending，Linux frozen 后]

linux + windows providers
  -> ecp-native-process-capsule-closure         [prior review/findings retained; explicit resume only]
       -> ecp-durable-agent-session-host        [prior escalation retained]
            -> ecp-frozen-action-session-executor  [in-tool + hosted 两个后端]
                 -> ecp-session-policy-and-control-parity
                      -> ecp-session-self-hosting-vertical-proof

macOS durable 进程权威  ->  移出本 Slice，登记为 0.3.0 研究事项
                            （父级 roadmap.md §13）；无边指向 closure
```

**唯一被切断的边**是 `ecp-macos-process-authority-provider -> ecp-native-process-capsule-closure`。
closure 的验收随之收窄为「在两个具备内核强制权威的 OS 上关闭 hosted 后端」；其余 ownership
（ProcessScope/host 集成、PGID 删除、`SEC-001..003`、`RC-002..005`、fresh independent review、
local ship/archive lifecycle）与既有 review/finding/counter 历史全部不变。

### 对现有实现波与 run-state 的影响

- Linux provider 的 implementation-first 政策、11 个开放 finding、任务账本与 Section 9
  cgroup-v2 环境 gate **一律不变**；本 Replan 不放宽任何 gate。
- Windows provider 仍在 Linux implementation-frozen 之后串行启动。
- closure、host 及下游 child 的既有 escalation 历史继续保留；恢复仍须由 LEAD 显式授予
  fresh bounded budget，不得当作新 Change 从零开始。
- macOS child 的 portfolio 终态（`skipped` + 0.3.0 指针，或保留 `escalated` 并在 parent
  `replans[]` 记为已移出 Slice）属于 run-state，由 LEAD 单写者决定并落盘。Direction worker
  不写 `.rasen/**`，本次同步未触碰任何 run-state。

### 未获批准的事项

Endpoint Security 方案、VM 方案、silent unsupported、macOS 最低版本、Apple entitlement/
签名/公证分发——一项都没有获批。它们整体移交 0.3.0 研究。ECP-8 的取证义务不因移交而免除。

（本节关于「macOS 是 `in-tool` 支持 + `hosted` 不可用」的表述已被下方
Architecture Replan 5 修订：macOS 另提供显式声明的 best-effort `hosted`。）

## 威胁模型校正（2026-08-07，锁定决策 12）—— 四处「为安全而安全」的处置

用户判断：不少设计是为安全而安全，脱离实际工作。审查确认四处，处置如下。分界线是
**防「我们自己搞错」的留（天天发生），防「有人攻击我们」的退（该攻击者在我们的部署
形态里若存在，早已能直接改本地 Run Record）**。

| # | 设计 | 原本在防谁 | 处置 |
| --- | --- | --- | --- |
| ① | 生产 producer 的 Ed25519 签名 + 私钥托管纪律 | 伪造完成声明的攻击者 | **退场**，改为事务完整性。真正的内核是「别把半写证据集当完整」，那是事务问题不是密码学问题 |
| ② | `producerIsolation` 能力字段 | 「LEAD 伪造转述」 | **退场**。LEAD 就是我们自己，真实风险是 bug；该字段是 2026-08-07 早些时候由 Direction 自己加入的，同日移除 |
| ③ | helper 跨构建根**逐字节可复现**作为 provenance 主张 | 供应链投毒 | **降级为非验收**。npm 分发的真实供应链面是 tarball，不是本地构建。**manifest ↔ 相邻二进制的哈希/长度完整性校验保留**——它防的是安装损坏，是真实故障。F-L2-15 已修不回退；Windows 侧同病按「够用即止」处理，不再加码 |
| ④ | 路径解析 TOCTOU 加固（junction 重定向、校验与 spawn 间 cwd 重定向） | 与我们赛跑的本地攻击者 | **不再作为验收**。单用户开发机上该攻击者已拥有全部文件，不需要赢竞态。`SEC-002`/`SEC-003` 由 review 波按本威胁模型**重新定级**，Direction 不代为关闭 |

**明确保留、不受本节影响**：fail-closed 与类型化不确定性、能力诚实
（`authority-unavailable` 不静默改路由）、actor separation 程序强制、对我们自己
worker 的包含与递归终止、证据完整集合发布 + 重读复验。

**不回退 ECP-6 已交付并归档的实现。** 本节改变的是 ECP-7 及之后必须**新建立**哪些证据。

## Architecture Replan 5：Step 1 —— 作用域生命周期收敛到守护进程（2026-08-07）

### 触发与定位

用户质疑设计过重、难以收敛。调查定位出复杂度的真实来源：**不在「包含」，在「持久」。**
包含机制本身极简（Linux `unshare(CLONE_NEWUSER|CLONE_NEWPID)` + guardian；Windows 不具名
Job + `KILL_ON_JOB_CLOSE`），而 opaque reference、boot id/出生时刻/PID-ns inode 绑定、
pidfd 重开复验、prepared→published→activate 三态协议、registry v2 几乎全部服务于判据 4
（替换安全身份），而判据 4 只为「守护进程要能死而作用域不死」存在。

对照证据：`Reference/multica`（Go 编写的同型本地 agent daemon 产品）在判据 4 上花费为零
——守护进程死亡后由服务端把任务判失败并重派（`RecoverOrphans`），遗留目录 72h GC。
其 POSIX 包含实现整文件约 60 行；Windows 侧 `configureProcessGroup` 是空操作、
`waitProcessGroupGone` 恒返回 `false`，并因此**主动关闭**了一个依赖后代终止确认的功能
（`codexInitializeRetrySupported` 恒 false）——与本 Direction 的「按能力声明、绝不静默
降级」独立收敛到同一形状。

### 关键事实：现有验收本就是 fail-closed

Slice `spec.md` 验收 4 主句与 Roadmap ECP-7 退出证据写的都是「恢复只继续未提交前沿」与
「exactly-once/**fail-closed** 证据」，**没有任何一处要求重新夺回权威**。因此本次改动的
性质是**换实现而非缩范围**，实质性文本修改只有 `hosted` 的 `durable` 一词收窄。

### Step 1 目标设计

统一语义：**守护进程死亡 ⇒ 作用域死亡 ⇒ 在飞 action 记类型化 `execution-lost`，
Run 只能从最后已提交前沿恢复。**

- **Linux**：guardian 作 namespace PID 1，持有从守护进程继承的管道；守护进程死 →
  管道 EOF → guardian 退出 → 内核 SIGKILL 整个 namespace。**零孤儿。**
  ⚠️ 用继承管道 EOF，**不用 `PR_SET_PDEATHSIG`**——后者由线程死亡触发且 setuid/exec
  会清除，在多线程宿主中是已知陷阱。判空由对 guardian 阻塞 `waitpid()` 提供
  （内核保证 namespace init 最后回收）。建议同时带 `CLONE_NEWCGROUP` 堵同 UID cgroup 迁移。
- **Windows**：不具名 Job + breakaway 禁用 + 单个不可继承 `KILL_ON_JOB_CLOSE` 句柄；
  建议用 `PROC_THREAD_ATTRIBUTE_JOB_LIST` 原子指派。判空**不得只信 IOCP 通知**
  （文档明写送达不保证），须 `QueryInformationJobObject` 同步确认 + 定时轮询兜底。
- **macOS**：`setpgid` + 组 SIGTERM→SIGKILL，升级条件以整组是否空为准。
  **显式声明的 best-effort**，`exactCancel: false`/`scopeEmptyProof: false`，
  取消终态 `cancelled / emptiness-unproven`。

### 三条不可退让项

1. Windows 必须上 Job Object，不退到 Multica 的空实现。
2. Linux 必须保 PID namespace，不退回 PGID（`setsid()` 逃逸非对抗场景）。
3. 类型化 `authority-unavailable` + 绝不静默改路由，保持不变。

### 对开放 finding 的实际影响（已逐条读原文核实）

Linux provider 现有 11 个开放 finding 中，**7 条离开（含唯一的 Blocker）**：
`BRK-R2-B06`/`B01`/`B02-M03` 随 broker 移交；`NATIVE-SEAM-R1-M01`/`M02`
（ready-hook seam 同时依附 broker hook 与 same-boot process-recovery state，两者皆不在
Step 1 内，无消费者）；`WSL-R4-M04`（published-inert abort）与 `WSL-R4-M06`
（controller replacement 双窗口）随 publish/replacement 机器消失。
`WSL-R4-M00`/`M01` 部分存留，`WSL-R4-M05`（unavailable 矩阵）与 `PKG-P5` 存留。

⚠️ **边界**：`BRK-R2-B06` 曾被判「定义过窄」——primary 路径 helper CLI 有同款缺陷但措辞
未覆盖。broker 实例随 broker 走，**primary 兄弟条必须留在 0.2.0**，不得随之抹掉。

### Linux 已冻结实现的处置

判据 4 相关实现按升级路线保留不删；包含与判空相关实现继续有效且继续需要真实 WSL 取证；
**任务账本重新分档必须由实现者逐条对照 `tasks.md` 完成，不得按摘要分档。**

完整输入见
[`Step 1 replan 输入`](../../../../explorations/direction-replan-input-step1-daemon-lifetime-scope.md)。
