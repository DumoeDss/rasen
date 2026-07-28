# 可执行组合管线 — 架构（0.1.6）

> 状态：0.1.6 `ecp-run-spine` + 后续工作（`ecp-settle-completeness` A+B；association-registry
> 接线 E）。这是已准备好的 Pipeline 计划的确定性 Run owner。本文档是权威架构参考。
>
> 0.1.6 范围：**root-DAG** 执行内核 + 其 CLI / 管理 API / Operations-UI 面，端到端内部
> dogfooding 简单的 `bug-fix` 路由。Composite/BoundedLoop/GoalLoop/FanOut/Join 的
> **执行**、Issue 调度、Board 生命周期映射明确**不在范围内**（在 Run 创建前被拒绝，或
> 暂留至后续能力）。

---

## 1. 这是什么

在 0.1.6 之前，Rasen 可以*准备*一个不可变的 Pipeline Definition v2 计划，但没有程序
**拥有**该计划的持久执行 —— 新的运行依赖 prompt 托管的 `auto-run.json`，管理 UI 只能
观察这些遗留文件。可执行组合管线（Executable Composite Pipelines，ECP）引入**唯一一个
确定性的 Run owner**：给定一个冻结的计划，reconciler 引擎驱动一份规范、不可变的 Run Record
穿过每一次阶段转换，并带有闭合的 action/result/control 契约、崩溃可恢复、双向引擎所有权
与漂移上报。

后续所有 Composite / loop / parallel 能力都意图从这一个 Run owner 生长出来，而不是另起炉灶
再发明一套状态机。

### 设计原则

- **唯一真相，永不重算。** 规范的 Run Record 是唯一的可变 Run 状态。每个读平面（CLI 状态、
  管理 API、UI）通过单一只读 projector 把*同一个* `ChangeRunView/1` 从 Record 投影出来。
  plan/profile/capability 的语义在**启动时冻结**，resume 期间永不重新编译 —— 漂移作为观察
  上报，绝不被当作输入消费。
- **纯内核，效应在边缘。** reconciler + reducer 是 `(frozen plan, Record)` 的纯函数。所有
  I/O（文件系统、git、IPC 锁、证据）都活在 facade 背后的 adapter 中。
- **闭合契约。** Wire 类型（`change-run-view/1`、receipts、control、completion、Action、
  Actor、EvidenceRef、WorkspaceRevision）是带版本号的编解码器，对未知 major 版本严格拒绝，
  对未知 section 仅作加法容错。
- **失败即闭合（Fail closed）。** 损坏、超大（Oversize）、冲突、陈旧状态以及写一半崩溃，
  永远不会产生错误答案 —— 它们拒绝推进并留下一个有类型的错误。

---

## 2. 架构一览

```
        ┌──────────────────────────────────────────────────────────┐
        │  手写的 pipeline (YAML)  +  生产 capability catalog          │
        │  src/core/pipeline-registry/   (Definition v2 · prepare)    │
        └───────────────────────────────┬───────────────────────────┘
                                        │  freeze + seal (lowerer)
                                        ▼
        ┌──────────────────────────────────────────────────────────┐
        │  不可变的 RuntimePlan                                       │
        │  冻结的 plan/profile/capability/policy/source 摘要           │
        │  仅 v1 root-DAG（拒绝 Composite/Loop/FanOut/Join）           │
        └───────────────────────────────┬───────────────────────────┘
                                        │  launch  (prepareRuntimeContext)
                                        ▼
   ╔══════════════════════════════════════════════════════════════════╗
   ║   ChangePipelineRuntime facade  （唯一的 mutation chokepoint）    ║
   ║   start · resume · complete · control · inspect                  ║
   ║                                                                  ║
   ║    reconcile(plan, record)  ──►  candidate batch                  ║
   ║      admit · await-gate · await-workspace · suspend-unsupported  ║
   ║      finish · escalate · cancel                                  ║
   ║             │                                                    ║
   ║             ▼  settleCandidates                                  ║
   ║    reduceCandidateBatch  ──►  ONE new Record revision             ║
   ║    (start / resume / complete / control 都 settle 至静止)         ║
   ╚══════════════════════════╤═══════════════════════════════════════╝
                                        ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │  规范的 Run Record  （不可变 · append-only 的 record-v<N>.json）   │
   │  RunStore        publishAtomic: stage → fsync → atomic rename      │
   │  Association     identity lease · archive aliases                  │
   │   Registry       recreate 即产生不同 ChangeInstance · mutation     │
   │                  guard（instance 维度）                            │
   │  Workspace       跨 Run 的 reader/writer 串行化                    │
   │   Reservations                                                      │
   │  Evidence        content-addressed · bounded · no-follow · verified│
   │  IPC locks      token challenge · hard-link-to-absent claim        │
   └───────────────────────────────┬───────────────────────────────────┘
                                   │  projectRunView  （只读 · 唯一的投影）
                                   ▼
   ┌────────────────────┬─────────────────────────┬─────────────────────┐
   │  CLI               │  管理 HTTP API          │  Operations UI       │
   │  pipeline          │  GET  /api/v1/runs      │  Task-detail         │
   │   start/status/    │  GET  /runs/<c>/<r>     │   OperationsSection  │
   │   resume/complete/ │  POST /runs/<c>/<r>     │  Canvas              │
   │   control/cancel   │   (CLI-backed bridge,   │   EngineSupportPanel │
   │   show             │    sealed defer)        │   + control submit   │
   └────────────────────┴─────────────────────────┴─────────────────────┘
        change-run-view/1 —— 四个平面共享同一套规范字段
```

纵向主轴是**写路径**（plan → facade → Record）。底部四个方框是**读/控制平面**，全都消费同一
份投影后的 view。

---

## 3. 核心概念

| 概念 | 职责 |
|---|---|
| **RuntimePlan** | Pipeline Definition v2 冻结、lower 后、可执行的形态。携带 plan / execution-profile / capability / policy / source-revision 的不可变摘要。v1 仅支持 root DAG。 |
| **Run Record** | 单个 Run 的规范、深度只读状态：identity、冻结的摘要/revision、前驱链、transitions/actions/effects/waits、计数器、terminal。Append-only 的 `record-v<N>.json`。 |
| **Reconciler** | 纯函数 `reconcile(plan, record) → candidate batch`。在打乱插入顺序、毒化的时钟、replay 下均确定性。按层级化 NodeId 排序就绪节点。仅 root-DAG 语义。 |
| **Reducer** | 纯函数 `reduceCandidateBatch`（多刺激，一次 revision）+ `reduceCanonicalRunRecord`（单刺激）。校验每一次转换；返回有类型的失败，绝不修改输入。 |
| **Facade** | `ChangePipelineRuntime`：唯一的 mutation 面（`start/resume/complete/control/inspect`）。拥有 store、association registry、reservations、projector。永不暴露 plan/Record/path。 |
| **Projector** | `projectRunView(record) → ChangeRunView/1`。被 receipts、CLI、management、UI 复用的唯一只读投影。 |
| **Association Registry** | 机器 home 的 identity 账本：`(PlanningSpaceId, changeId)` lease、archive 别名。在 archive + 同名 recreate 时铸造一个**不同的 ChangeInstance**；对已归档 Run 的 mutation 做门控。 |
| **引擎所有权（Engine ownership）** | 双向守卫：`engine: legacy | reconciler` 在启动时冻结。当另一个引擎活动时（包括 reconciler 启动后才出现的遗留文件），每一次 mutation 都拒绝。 |

### 3.1 Identity（全部确定性，由冻结的语义 + 已提交的序号派生）

```
PlanningSpaceId   = H("planning-space", registry-home)
ChangeInstanceId  = H("change-instance", PlanningSpace, change-name, physical-identity, archive-generation)
WorkspaceInstanceId = H("workspace", PlanningSpace, physical-identity)
RunId             = H("run", PlanningSpace, ChangeInstance, changeId, launchRequestId)
NodeId            = H("node", RunId, hierarchical-path)
InvocationId      = H("invocation", RunId, NodeId, occurrence)
AttemptId · ActionId · EffectId · WaitId   （全部派生、稳定）
```

Identity 排除了时钟、随机性、路径、PID、mtime 与 Record 版本号 —— 从冻结的 plan + Record
进行 replay 可以逐字节复现它们。association registry（Gap E）让 `ChangeInstanceId`
**对 recreate 感知**：在同一处归档再以同名重建同一个 change，会产生不同的 instance（以及不同
的 RunId），而旧 Run 依然可精确 inspect 并拒绝 mutation。

### 3.2 Candidate 种类（reconciler 输出）

reconciler 发出 candidate **descriptor**；facade 从冻结的 capability bindings 构建真正的
`RunAction` / `CanonicalWait`：

| Candidate | 含义 | Facade 动作 |
|---|---|---|
| `admit` | 某节点已就绪可运行（依赖满足、gate 通过） | 构建 action → `admit-action`（授予或延迟） |
| `await-gate` | 一个人工 gate 是前沿 | 提交一个 `gate` wait → 提供 `decision` 控制 |
| `await-workspace` | workspace lease 争用阻塞了某次 admit | 提交一个 `workspace-reservation` wait（串行化写者） |
| `suspend-unsupported` | 自适应 verify 选择了一条其 capability 未安装的路由（例如 ReviewCycle） | 提交一个 `capability-unavailable` wait（持久挂起） |
| `finish` | root DAG 完成 | terminal `completed` |
| `escalate` / `cancel` | 在非 terminal 的 Run 上恒可用 | terminal `escalated` / `cancelled` |

---

## 4. Run 生命周期（写路径）

```
 launch ──► start ──► [gate?] ──► decide/resume ──► admit (grant) ──► complete ──► ... ──► finish
   │          │           │             │                  │               │
   │          ▼           ▼             ▼                  ▼               ▼
   │     reconcile   await-gate    resume-run         admit-action    commit-action-result
   │     settle      committed      grants the          (granted)      + settle next candidates
   │     (1 rev)     (1 rev)        ready action        (1 rev)        (1 rev — complete settles)
   │
   └─── 每次 mutation: facade.settleCandidates → reduceCandidateBatch → 一次 Record revision
        每次 revision: publishAtomic (stage → fsync → atomic rename) —— 崩溃可恢复
```

### 为什么每次 mutation 都要 settle（ship-blocker 教训）

`start` / `resume` / `complete` / `control` 每一个都会在得到的 Record 上运行 reconciler，
并通过 `reduceCandidateBatch` 把**完整的 candidate batch** settle 成**一**次新的 Record
revision。这是强制要求：

- store 强制 `next.recordVersion === head.recordVersion + 1`。分两步 settle 会把版本号 bump
  两次从而被拒绝。
- 如果某次 mutation 只提交了它的直接刺激（例如 `complete` 只提交 `commit-action-result`），
  而丢弃了作为结果变得可 admit 的 candidate（例如下一阶段的 gate），Run 就无法在没有额外
  `resume-run` 的情况下推进。因此每次 mutation 都在一次提交内 settle 到下一个静止点
  （设计 §5.6）。

> 历史注记：最初的 facade 只提交 `admit` candidate，丢弃了 `await-gate` 与 `suspend` ——
> 所以真实 CLI 无法让一个 Run 穿过 gate。288 个内核测试通过，是因为它们是在隔离状态下
> 测试 reducer/reconciler/projector 的。修复（`settleCandidates`）是由**一个新进程 CLI Run
> 穿过 gate** 来证明的，而非靠内存中的测试。教训：永远通过真实产品面验证集成后的推进。

---

## 5. 四个读/控制平面

四个平面都消费**同一**份投影。规范的 `ChangeRunView/1` 字段（`format`、`runId`、`change`、
`engine`、`recordVersion`、`status`、`sourceState`、`workspace`、`drift`，以及完整有序的
`root-dag/1` section）在各平面之间**深度相等**；只有传输封装不同。

```
                       projectRunView(record)
                               │
   ┌─────────────┬─────────────┼─────────────┬─────────────┐
   ▼             ▼             ▼             ▼
 projector   CLI status     mgmt detail    UI render
 (kernel)     --json         GET /runs/..   OperationsSection
                              POST /runs/..  control submit
```

- **CLI** —— `rasen pipeline start | status | resume | complete | control | cancel | show`。
  `status --json` 输出 `change-run-view/1`；mutation 的 receipt 额外带 `actions` +
  `disposition`。
- **管理 API** —— `GET /api/v1/runs`（联合发现 + 稳定游标分页，按 `WorkspaceInstanceId`
  过滤）；`GET /api/v1/runs/<changeId>/<runId>`（详情）；`POST .../runs/<...>`（控制桥接，
  以 `deliveryMode: defer` 封装地 spawn CLI —— HTTP 永不返回可执行 payload，只返回已提交的
  view + 空 actions）。
- **Operations UI** —— `OperationsSection`（Runs 列表/详情，root-dag 前沿/waits/drift，完整
  ID，对其他 worktree 的 Run 只读）+ `EngineSupportPanel`（Canvas 引擎支持）+ 可提交的控制
  （decision/resume/escalate/cancel），带 `recordVersion` + `WaitId` 提交 + 冲突时重新拉取
  （绝不乐观 mutation）。
- **其他 worktree 的 Runs** 投影为 `workspace.scope: "other"` —— 控制项被清空，已授予的
  action 降级为 `admitted_undelivered`（`change-run-view/1` 不变量禁止在其他 worktree 的 view
  中出现控制项或已授予的 action）。

---

## 6. 内核模块图（`src/core/change-run/internal/`）

```
runtime-plan.ts        冻结的 RuntimePlan（拓扑序；拒绝 Composite/Loop/FanOut/Join）
lowerer.ts             Definition v2 + Profile → RuntimePlan
reconciler.ts          纯 reconcile() → candidate batch · suspend-unsupported
reducer.ts             reduceCandidateBatch (1 rev) · reduceCanonicalRunRecord · 有类型失败
record.ts              规范的只读 Record · transition/action/wait/terminal 编解码器
actions.ts             从冻结的 capability bindings 构建的 Agent/Command/Host action
actors.ts              可信的 Adapter 证明的 ActorRef · identity 摘要 · 防伪造
completion.ts          completion 解码/校验 · 每 (Action,Effect slot) 的 receipt 幂等
ownership.ts           外部效应 ownership 标记（commit/push/PR/archive）
workspace.ts           WorkspaceRevision 校验/更新 · 有类型 drift
workspace-git.ts       git-plumbing 观察者（HEAD tree/index/blob/untracked/submodule）
reservations.ts        跨 Run 的 workspace reservation 注册表 · reservation-delta 恢复
scope.ts               selected-root/workspace/Change-instance 不匹配保护
run-store.ts           不可变的 RunStore 接口（内存中）
run-store-fs.ts        文件系统 RunStore · publishAtomic (stage→fsync→rename) · O_EXCL
safe-path.ts           SafeRunPath（symlink/junction/reparse/hardlink 收容）
budgets.ts             每文件/结构/计数/累计预算
publish-atomic.ts      staging → fsync → atomic rename · PublishFaultPoint（可测的契约）
coordination.ts        IPC lease · token challenge · hard-link-to-absent claim
association-registry.ts identity lease · archive aliases · recreate 即产生不同 instance
engine-ownership.ts    双向 legacy|reconciler 守卫
projector.ts           projectRunView → ChangeRunView/1（唯一的读投影）
facade-runtime.ts      ChangePipelineRuntime · settleCandidates · assertMutationAllowed
runtime-context.ts     launch 组装（prepareRuntimeContext）
identity.ts            所有确定性 identity · readPhysicalIdentity
input-reader.ts        有界 no-follow 的 file/stdin 读取器
waits.ts               WaitId 分配 · variant 编解码器 · workspace-reservation intent
```

公共 barrel `src/core/change-run/index.ts` 只导出闭合契约 + facade 类型 +
`prepareRuntimeContext`；plan/Record/reducer/store/filesystem 的内部实现**不**导出。

---

## 7. 关键保证

- **不可变性（Immutability）** —— Record 是 append-only；已发布的 revision 无法被覆盖
  （`O_EXCL`）。加载的 plan/profile 被深度冻结。
- **崩溃可恢复（Crash-durability）** —— 文件系统 store 通过 `publishAtomic` 发布（写
  staging → fsync → atomic rename）。在任何边界崩溃都不会留下**损坏的目标**；重试会成功。
  （已知残留：没有父目录 fsync —— 这是已批准的 `publishAtomic` 契约范围本身的属性。）
- **幂等性（Idempotency）** —— launch 以 `(PlanningSpace, ChangeInstance, launchRequestId)`
  为键；相同的 replay 返回原始 Run，不会重新投递 action。completion 按
  `(ActionId, kind, EffectId-or-domain)` 幂等。
- **引擎隔离（Engine isolation）** —— `engine: legacy | reconciler` 在启动时冻结；reconciler
  启动后才出现的遗留文件无法劫持 Run。
- **归档安全（Archive safety）** —— 对已归档 Run 的 mutation 被拒绝
  （`change_instance_inactive`）；读取仍然可用。recreate 即产生不同 instance，意味着旧 Run
  不会与同名下新建的 Run 混淆。
- **工作区串行化（Workspace serialization）** —— 跨 Run 的 reader/writer 争用通过 reservation
  注册表支撑的持久 `workspace-reservation` wait 串行化；access-`none` 的 action 永不阻塞。
- **证据完整性（Evidence integrity）** —— content-addressed、有界、no-follow 的物理读取；
  篡改/重贴标签/TOCTOU/缺失全部 fail closed。
- **确定性（Determinism）** —— reconciler 在打乱插入顺序、毒化的时钟/随机/env/文件系统以及
  replay 下均确定性。稳定的 identity/顺序。

---

## 8. 产品面的交付平面

```
CLI            src/commands/pipeline.ts          start/status/resume/complete/control/cancel/show
                                                 + assertChangeNotArchived（archive mutation 守卫）
               src/cli/index.ts                  命令注册
HTTP API       src/core/management-api/
                 runs.ts                         handleRuns（发现 + 分页 + 过滤）
                 run-control.ts                  POST 桥接（RunControlSpawner 接缝，封装 defer）
                 router.ts                       路由表 + path/space 解析
UI             packages/ui/src/
                 api/{client,types}.ts           wire-type 镜像 + 消费接缝
                 components/OperationsSection.tsx 列表/详情/渲染 + control 提交
                 canvas/EngineSupportPanel.tsx   引擎支持（availableEngines/reconcilerSupport）
```

---

## 9. 范围（0.1.6）

**在范围内**
- root-DAG 执行内核（AtomicStage、Gate、自适应 simple/complex verify、隐式 root Finish）+
  其闭合契约、确定性 reconciliation、规范的 Record、可恢复、引擎所有权、drift 上报。
- 引擎感知的 CLI、space 范围的管理 API（读取 + CLI 支撑的控制桥接）、Operations UI。
- 跨平面对齐、新进程 bug-fix E2E、故障路径、archive/recreate 隔离。
- Dogfood：简单的 `bug-fix` 路由端到端通过真实 CLI。

**不在范围内（在 Run 创建前被拒绝，或暂留）**
- ReviewCycle body 执行，Composite / BoundedLoop / GoalLoop / FanOut / Join 执行 —— 被
  `createRuntimePlan` 拒绝；自适应的 complex 路由**挂起**
  （`capability-unavailable`）而不是落回遗留推进。
- Issue 级调度与 Board 生命周期映射（0.2.0 领域；Run 的 terminal 状态永不修改
  Board/Issue 生命周期）。
- Launcher 收敛、通过 reconciler 引擎进行的 portfolio 编排。

---

## 10. 参考

- Change artifacts：`rasen/changes/ecp-run-spine/`（proposal、design、specs、tasks）
- 长期方向：`rasen/work/issue-centered-automation-platform/{goal,north-star,roadmap}.md`
- 内核研究：`rasen/work/issue-centered-automation-platform/executable-composite-pipelines/deterministic-pipeline-kernel-research.md`
- PR：#92（`ecp-run-spine`，0.1.6）· #93（`ecp-settle-completeness`，A+B）· #94（association-registry 接线，E）
