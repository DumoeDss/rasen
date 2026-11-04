<!-- architecture-index skill · on-demand · 仅在 skill 触发且需要该域时按需 Read，勿整文件预载。 -->
# 模块索引：Spec / Store / Artifact 引擎

> 这是 rasen 的 spec-driven 基石：Store（git-backed 持久身份）、artifact-graph（工作流 schema DAG）、Zod schemas、validator、durable Run Record、parsers/converters。所有路径前缀 `src/core/`。

## `store/` — Store 抽象（git-backed、registry-tracked、永久身份）

rasen 的 specs/changes 的 canonical 归宿。一个 Store = 一个 git 仓库 + 永久 `uid` + 显示别名 `id`。

- **关键文件**：`foundation.ts`（store 元数据 + registry I/O）、`operations.ts`（setup/register/clone 生命周期）、`identity.ts`（**唯一**身份解析器 `resolveStoreBinding()`）、`registry.ts`（注册 CRUD）、`inspection.ts`（元数据/根健康检查）。
- **核心类型**：`StoreMetadataState`（V1/V2，落 `.rasen-store/store.yaml`，含 `uid`）、`StoreRegistryState`（全局 `registry.yaml`）、`StoreGitBackendConfig`（`{type:'git',local_path,remote?,branch?}`）。
- **`resolveStoreBinding()`** = 穷举三态：`ResolvedStoreBinding | UnavailableStoreBinding | AbsentStoreBinding`，零写入。
- **连接**：被 CLI `store` 命令、`effective-config.ts`/`project-config.ts` 消费，解析当前项目背后是哪个 Store。

## `artifact-graph/` — 工作流 schema DAG（artifact 依赖解析）

定义并解析一个 change 要产出哪些 artifact（proposal/design/specs/tasks）及其依赖序。

- **关键文件**：`graph.ts`（`ArtifactGraph` 类，Kahn 拓扑排序 + readiness 查询）、`resolver.ts`（schema 名→YAML，**三层优先级** project-local > user-override > package built-in）、`instruction-loader.ts`（change 上下文构建 + 指令生成）、`schema.ts`（YAML 加载/校验 + 环检测）、`types.ts`（Zod + TS 类型）。
- **核心类型**：`ArtifactSchema`/`Artifact`（DAG 一个节点：`{id,generates,template,requires,...}`）、`SchemaYaml`、`ArtifactGraph.fromYaml()`/`getBuildOrder()`/`getNextArtifacts(completed)`、`ChangeContext`、`ArtifactInstructions`。
- **`detectCompleted()`/`resolveArtifactOutputs()`**：按文件系统判断 artifact 是否已产出（检查 `generates` 文件/glob 是否存在）。
- **连接**：被 CLI `new`/`continue`/`propose`/`apply` 消费，决定下一步产出哪个 artifact。依赖 `change-metadata/`。schema YAML 文件在仓库 `schemas/`（如 `schemas/spec-driven/schema.yaml`）。

## `schemas/` — Zod 校验 schema（三大领域对象）

Spec、Requirement/Scenario、Change/Delta 的 canonical 校验定义。

- **关键文件**：`base.schema.ts`（`RequirementSchema`/`ScenarioSchema`）、`spec.schema.ts`（`SpecSchema`）、`change.schema.ts`（`ChangeSchema`/`DeltaSchema`）。
- **核心类型**：`Spec = {name,overview,requirements[],metadata?}`、`DeltaOperationType = 'ADDED'|'MODIFIED'|'REMOVED'|'RENAMED'`、`Delta`、`Change = {name,why,whatChanges,deltas[],metadata?}`。
- **连接**：`parsers/`（产对象）、`validation/`（校验）、`converters/`（序列化）三者的共享契约。

## `validation/` — 校验引擎（结构规则 + SHALL/MUST + delta 合法性）

- **关键文件**：`validator.ts`（`Validator` 类，核心 API）、`types.ts`（`ValidationIssue`/`ValidationReport`/`ValidationLevel`）、`constants.ts`。
- **核心方法**（async）：`validateSpec()`/`validateChange()`/`validateChangeDeltaSpecs(changeDir)`（递归校验 change 下 delta `spec.md`：ADDED/MODIFIED 须 text+scenarios，REMOVED 仅 name，RENAMED 成对，无跨节冲突）。
- **`ValidationReport = {valid, issues[], summary:{errors,warnings,info}}`**。
- **连接**：消费 `schemas/` + `parsers/`。被 CLI `validate`/`new`/`continue`/`archive` 在产出或同步 artifact 前强制质量。

## `issue-status/` — Issue 三轴状态投影（读时推导，不持久化）

回答"这个 Issue 现在在哪"：`phase`(`planning|ready|active|review|done`) × `health`(`healthy|blocked|failed|waiting-human|stale`，后两者为保留值) × `progress`(完成必需节点/总数)。g-002 起四态 lifecycle 贯穿：progress/评审条件只数 required、active/health 信号来自 wanted(required|optional)、cancelled/superseded 在执行图外（节点行仍带 lifecycle+reason）。每次读取从四个输入现推——最新 Execution Plan 修订、committed Store evidence、机器本地 run-state、Issue 的已记录验收（acceptance 内容，C3 起为第四输入）——不写任何地方（source guard + byte-identical 行为测试双保险）。

- **关键文件**：`projection.ts`（`projectIssueStatus(input)`：per-node run-state 定位 + D4 观察映射 + phase/health/progress 推导 + acceptance 块组装）、`ready-set.ts`（Phase 5 g-001 起：`deriveIssueReadySet(status)` = ready-set 后置 pass，membership = change ∧ wanted(required|optional) ∧ not-started ∧ blockedBy 空；非成员闭词汇 exit 理由 cancelled/superseded（带 reason）/pending-change-creation/running/failed/complete（basis 带legacy 诊断）/blocked（逐 blocker `issueBlockerState`）/unknown；不可读修订→null 非空集）、`types.ts`（闭词汇表 + `ProjectIssueStatusInput`，显式路径输入零 ambient read；`invalid-archive-record` problem kind）、`delivery.ts`（Phase 6 g-001 起：`deriveIssueDeliveryEvidence(revisionId, status)` = delivery rollup 后置 pass——每个 change 节点一条 entry（规范节点序，intent 不入列）+ 五态 counts（record/no-record/not-archived/unreadable/unattributed）；counts 只汇总、entries 全列；不可读修订→null（同 progress:null 理由）；驱动零轴）、`attention.ts`（Phase 5 g-003 起：`deriveIssueAttention(issueId, status)` = attention 后置 pass——五类闭词汇 failure / blocked-behind（一跳，直接 blocker 观察 failed/waiting-human/unknown 才入列，逐 blocker 经 `issueBlockerState` 命名）/ waiting-human / acceptance-awaiting（review 相位，gate 评估随行）/ problem（全部 standing problems）；缺席纪律（in-flight/advanced/terminal/ready/串行等待不入列）是 spec REQUIREMENT；fail-first kind 序 + 组内 (issueId, nodeId) 稳定序，每项带 issue 的 phase+health（防掩盖的结构保证）；CLI 缝 = `src/commands/store.ts` 的 store 级 `attention` 子命令，per-Issue 组合逐字复用 show 的组合缝，写零字节）、`review.ts`（Phase 6 g-002 起：`deriveIssueReview(issueId, revisionId, status)` = 统一 review 视图后置 pass，determination=gate 一一映射七值闭词汇（无第二 blocking basis）、threads=attention 映射 + 节点扫描闭词汇、verification 按引用；详见下方"统一 review 视图"条）、`index.ts`（barrel）。
- **显示用依赖事实（issue-cross-project-gating 起）**：`IssueNodeStatus.blockedBy` 为结构条目 `{nodeId, projectId, observation}`，基准 = **work-complete**（`start` 闸的同一条规则），由 `withBlockerFacts` 后处理单点派生（观察分支不再复制 query 的 archive 列表）；query 自己的 `blockedBy`/`readiness` 保持 archive-based（`readyToResolve` 的验收真相——两条真相并存是有意的，勿互"修"）。`issueBlockerState(status)` 导出 blocker 状态标签词汇（`not-started, no local run-state` / `unknown (<diag>)`），节点行渲染与 start 拒收共用。
- **按项目分组 lanes（issue-project-grouped-views 起）**：`IssueStatus.projects: IssueProjectLane[]`（`{projectId, alias, nodeIds, progress}`），`deriveProjectLanes` 后处理从已建节点状态派生——每个被修订节点点名的项目一条 lane（projectId 码点序、nodeIds 按修订规范序、只列 id 不复制节点事实）。lane progress 与 Issue progress **共一个完成谓词**（`progressOver` 一条规则两个作用域：required change 节点 + work-complete 基准；optional/cancelled/intent 列而不计；零 required 报 0/0）。lanes 驱动零轴；修订读不回 → 无 lanes（区别于"没有项目"）。alias 是 **CLI 组合的 display 输入**（`ProjectIssueStatusInput.projectAliases`，identity 永远是 projectId；缺失降级裸 id，grouping/gating/progress 不受影响）。
- **修订 delta（Phase 4 g-003 起）**：`IssueStatus.delta: IssueRevisionDelta | null` = 最新修订对 `supersedes` 前任的节点级 diff（added/removed/retargeted/edgeChanges/lifecycleChanges/suggestionChanges，`deriveRevisionDelta` 纯函数）——读时从两份修订现推、零持久化、驱动零轴（先定轴后派生；前置修订由 `ProjectIssueStatusInput.predecessorPlan` 显式输入，CLI 的 show 用 `resolveExecutionPlan({revisionId: supersedes})` 取，supersedes 为 null 或前任读不回 → 无 delta 节）。g-003 起 intent 节点与 change 节点同载 `required|optional`（absent 读 required，`IssueNodeStatus.lifecycle` 永非 null），节点行命名非 required lifecycle 不分 kind。
- **归档记录 basis 裁决（Phase 5 g-001 起读面）**：`observeNode` 的 finalized 分支读 `readArchiveEntry` 线传的 `outcomeBasis`——`legacy`（无 v2 outcome 记录：无记录/非 v2 形状）→ finalized + diagnostic 命名 legacy basis（**archived-legacy = complete-for-scheduling**，delivered-legacy 依赖不再需要 run-state 镜像即释放下游；不铸 outcome——no-inference 立场只管 outcome 列）；`invalid`（v2 形状但不解析/不过校验）→ fail-closed `unknown` + `invalid-archive-record` problem（点名文件+理由、降 complete、门保持）。v2 outcome 分支与 basis 缺席（旧 fixture/降级读）行为不变。query 自身 readiness/blockedBy 刻意保持 archive-outcome 基（`readyToResolve` 验收真相——两 basis 并存是设计）。
- **交付证据（Phase 6 g-001 起）**：per-Change 交付事实走 outcomeBasis 同一条线——`readArchiveEntry` 的 additive `delivery` 块（v1 ledger 防御式逐字段读（absent/wrong-typed→named absence null，never repaired）、v2 映射 `codeMerge.commit`/`planning.sourceRef`（全 ref 原拼写）/outcome/evidence/missing/archivedAt；text===null 或 bytes 不解析/不过校验→null），`deriveReadiness` 穿进 `PlanNodeResolution.delivery`。投影侧 `deliveryFor` 在 `withLifecycle` 单点加宽成 `IssueNodeStatus.delivery` 五态闭词汇（record 带 facts；no-record（archived+legacy+null delivery，带 foundAtRef/blobPath）/not-archived/unreadable（invalid basis，standing problem 权威）/unattributed（未解析/歧义）；intent=null）——驱动零轴（no-drift 测试钉死）。rollup = `delivery.ts` 纯后置 pass；CLI 面 = show 的 `delivery evidence:` 段（record 行 facts + ship-log 按 inventory 事实（path+digest 或 `none in inventory`）、named absence 各按名渲染、counts 收尾）+ `--json` 的 `delivery` 键与 `status.nodes[].delivery`；list 不带 rollup。诚实边界：两种 record 形态都无结构化 PR 事实（不呈现）、ship-log 散文永不解析。
- **统一 review 视图（Phase 6 g-002 起）**：`review.ts` 的 `deriveIssueReview(issueId, revisionId, status)` = 纯后置 pass（同一 status 内组合 `deriveIssueDeliveryEvidence` + `deriveIssueAttention`——一次读取出一致的 node facts / delivery rollup / review view 三元组；never-null（no-plan 也是答案））。determination 七值闭词汇 **一一映射**自 `status.acceptance.gate`（eligible→review-ready 带条件修订；already_accepted→accepted 带 record 日期+修订（record 不验证时字段诚实 null）；blocked→not-ready 只带 blocker 计数（清单留在 gate 不复制）；conditions_required→conditions-missing 带 gate 自己的 message；requires_plan→no-plan；dropped→dropped；acceptance===null→acceptance-unknown 命名缺省）——refusal union 上 switch 由编译器钉 exhaustiveness，**无第二 blocking basis**（delivery/lifecycle/thread/counts 不翻判定，变异测试钉死）。threads = 门刻意排除但 reviewer 必须看见的事实，永不 block：attention 映射 failure/blocked-behind/waiting-human（fail-first 序在前；**排除** acceptance-awaiting=判定本身、problem=已是 gate blocker）+ 节点扫描 optional-open（optional 非终态，带 observation；failed/waiting 的 optional 节点与 attention thread 并存=诚实重叠）/ archive-pending（**终态** ∧ not-archived——expected progress 非 damage；非终态 not-archived 不入列）/ record-absent / evidence-missing（missing[] 记录名，null 无名则无 thread），后四者按列出 kind 序 + nodeId 码点序。CLI 面 = show 末段 `review:`（delivery 段之后的 concluding section：determination 行 + threads 逐行 + verification 按**引用**（progress + delivery counts，不复制 entries/blockers）+ 结尾 "review derives; accepting remains the operator's act"）+ `--json` 的 `review` 键；list 不带 review 事实。g-003 的 deferred 词汇落地后 optional-open thread 将消失（其 delta 属 g-003）。
- **定位配方 = `pipeline resume` 原样复用**：`stateFileSearchChain` + `runStatePath`/`portfolioStatePath` + `readRunStateDetailed`/`readPortfolioStateDetailed`（`ephemera → workDir → planning change dir` 三段 sticky-legacy 链）；portfolio-run.json 存在即权威；escalated child/delivery = failed、escalated stage = waiting-human。C2 加宽：当前根链未命中后，逐个匹配的 workspace index 条目以其 execution root 自有链再探（ephemera → 条目 planning 侧 active-change 地址；index 根无 work-dir 腿），节点带 `locatedBy`（execution-root|workspace-index|null）与 attribution（pipeline/sessions/evidenceLocator——sessions 只含 durable 指针，agentId 构造上排除）。
- **done 规则（C3 起）**：`resolved` ∧ 验证过的 accepted 记录 → `done`；仅 resolved（含历史 close）→ `review`+`waiting-human`；archived 计数与裸状态翻转永不推导 done。验收内容读不回（篡改/无效）→ status problem（`unreadable-acceptance`）。`IssueStatus.acceptance` 块 = 最新条件修订 + 本次读取上求值的闸门（来自 `issue-acceptance/gate.ts` 的唯一 runtime 边）+ 已验证记录；省略 acceptance 输入时块为 null 且其余推导与 C2 逐字节一致。
- **边界**：只 import 不改 `src/core/pipeline-registry/`（冻结）与 `src/core/store/query/`（store-pure 契约不含 run-state——这就是它独立成顶层模块的原因）。CLI 缝在 `src/commands/store-issue.ts`：best-effort 解析 execution root（失败降级 visibility-none），list 行加 `phase/health n/m [<alias|id> a/b · …]`（per-project 摘要段，无 lanes 时整体省略），show 加 status 块 + 每项目泳道头（`project <alias|id> (<id>): x/y`，其下节点行格式不变）+ 每节点 attribution 行 + acceptance 节，两命令 `--json` 增生 `status` 对象（含 `status.projects` lanes 与 `status.acceptance`）；index 条目每命令收集一次（`listAllWorkspaceIndexEntries` 按 store uid 过滤）；alias 由 `resolveStoreWideningContext` 读 Store 项目 catalogs（`listProjectEntries` → catalog display `id`）作投影输入；list/show 每命令额外经 `readIssueAcceptanceFacts` 读一次验收内容。
- **连接**：被 `src/commands/store-issue.ts` 与 `src/core/issue-acceptance/orchestration.ts` 消费（一条状态缝）。

## `issue-read/` — Issue 读面组合与 Change 关联读（Phase 7 起）

一句话：**Issue 的三条读（list / show / attention）只有一份组装代码**，CLI 与 management API 调同一个函数，所以两面 parity 是构造出来的，不是两条路径互相追平出来的。

- **为什么单独成模块**：`issue-status/` 按章程 I/O-free（纯派生 + 一个成文的 run-state 探针），而这里要读 Store（`listIssues`/`showIssue`/`resolveExecutionPlan` + 验收内容 + workspace index + 项目 catalogs）——`issue-execution/confirm.ts` 的 read-compose-report 先例。
- **关键文件**：`composition.ts`（三个 Issue projection compose 函数 + 具名 payload 类型 + 下沉自 CLI 的缝 `statusInputFor`/`resolveStoreWideningContext`/`resolvePredecessorPlan`/`detailForList`/`attentionCounts`）、`run-context.ts`（`resolveRunStateContext(startPath)`）、`change-links.ts`（`composeChangeIssueLinks` + Change association/eligibility/link payload 闭类型）、`index.ts`（barrel）。
- **payload 键序是承载语义的**：`printJson` 按插入序序列化，所以三个 compose 函数按 CLI 历来打印的字面量顺序建对象。既有 store-issue / store-attention CLI 套件即这次抽取的字节守卫。
- **谁注入什么**：`query` 是参数（CLI 传 `StoreAggregateQuery`，daemon 传 `createStoreQueryByUid()` 的 uid 严格实例）；`runState` 是参数（CLI 传 `resolveRunStateContext(process.cwd())`，daemon 传 `resolveRunStateContext(context.launchProjectRoot)`）。解不出执行根 = `runStateVisibility:'none'` + 仅 committed evidence，**诚实降级且必须被呈现方披露**（永不伪造 live 事实）。
- **拒收 vs 不可读是两条互不转换的通道**：attention 的未知 `--issue`/`issueId` 抛 `issue_attention_unknown_issue`（空扫描是关于"扫过哪些 Issue"的断言，必须为真）；而计划读不回 / 引用未检索 / 记录分叉是 **200 载荷内**的 `problems`/`complete:false`/`unsearchedRefs`。
- **Change↔Issue association（g-002）**：`composeChangeIssueLinks(query, scope)` 一次读取 grouped active/archive Changes、一次读取 Issues、每个有 latest revision 的 Issue 最多读一次 plan；按稳定 Change instance 收集 Issue/revision/node links。单一 identity + 零 link + 完整扫描才是 `unlinked/attachable`；identity 缺失/重复 claimant/不可读证据均为 `unknown`，已证明的 link 即使旁路证据不完整仍保留 `linked`。条目、link、node、completeness 通道稳定排序/去重；模块不写入、不加锁、不缓存、不持久化反向索引。
- **连接**：`src/commands/store-issue.ts`（list/show）、`src/commands/store.ts`（attention）、`src/core/management-api/stores.ts`（三条投影 handler + `handleStoreChangeIssueLinks`）。CLI 侧只剩 renderer 与 `resolveProjectionContext()` 这个 cwd 薄包装；attention 的失败哨兵（省略 `unsearchedRefs`/`complete`）仍属命令而非扫描。Change association 目前只由 flat management GET 消费，供 Operations attribution 与 Unlinked inventory 共用。

## `issue-execution/` — Issue 节点启动绑定（resolve + verify + emit，不 spawn）

回答"这个 Issue 的下一个节点从哪里启动"：从 plan 修订 + 投影 observations 推导 runnable frontier（observation 规则，非 query 的 archive-based `blockedBy`），经固定路由序解析绑定的执行上下文（D4：workspace pair index 条目 → L6 `resolveSessionLaunchContext` 成员 checkout → unprepared 拒绝并给出确切 `store workspace plan --existing-change` 准备命令），输出 launch contract（cwd/attached/pipeline/mode）。读时推导、零写入；refusal 闭集九码（g-002 起 `--node` 命中 cancelled/superseded 节点有独立码并点名 lifecycle+reason，frontier 只含 wanted 节点 required|optional），每条拒结名名候选/阻塞/准备命令/L6 诊断。issue-cross-project-gating 起阻塞命名跨项目化：`--node` fresh-launch 拒收与 frontier "awaits" 理由逐 blocker 渲染 `<id>@<project> (<state>)`（经共享 `issueBlockerState`——`not-started, no local run-state` 与 `unknown (<diag>)` 两项诚实细化），gate 规则本身零改动。**Phase 5 g-001 起三面共一谓词**：frontier 候选 = `deriveIssueReadySet`（issue-status）members——旧私有 `isRunnable` 已删，start frontier / confirm launchable / `ready` 读面同一推导，等价测试双向钉死（`issue-ready-set-equivalence.test.ts`）；confirm 的 begun 节点（running/complete/unknown）仍走逐节点 `resolveIssueLaunchBinding`（resume/report 契约不变）。

- **关键文件**：`binding.ts`（`resolveIssueLaunchBinding` + `refusalFix`）、`confirm.ts`（Phase 4 g-003 起：`composeIssueConfirm` = 确认报告组装——逐 change 节点对 committed 证据验证（plan read 的 readiness resolutions，非通过即整体拒 `issue_confirm_reference_unresolved`）、wanted+deps 完成的节点经同一 `resolveIssueLaunchBinding` 逐节点解析契约（含 suggestion 链）、intent 节点报 pending Change、waiting/unprepared 各自点名；**写零字节**，拒绝码 `issue_confirm_requires_plan`/`issue_confirm_reference_unresolved`）、`types.ts`（`IssueLaunchBinding`（含 `pipelineSource: operator|run-state|suggestion`）/confirm 报告与拒绝契约/refusal taxonomy/injectable `launchContextFor`/`pipelineKnown`）、`index.ts`（barrel）。
- **pipeline 三源链（g-003 起）**：fresh 节点 `--pipeline` > run-state 记录 > 修订 `suggestedPipeline`，契约经 `pipelineSource` 命名来源（flag 压 suggestion 不拒绝——manual selection 围栏）；already-running 链字节不变（recorded 领先，分歧仍拒）。
- **组合而非重建**：import L6 `management-api/session-launch-context.ts`（经可注入 seam，生产默认 `store:<uid>` + `project:<id>`）、`store/workspace/registry.ts` 的 index 读取、`issue-status` 的投影（attribution.pipeline 即 D5 的 recorded pipeline 来源）、`pipeline-registry/resolver.ts` 的 catalog（`--pipeline` 校验）。只 import 不改 `src/core/pipeline-registry/`。
- **边界**：CLI 缝在 `src/commands/store-issue.ts` 的 `start` 子命令（`--node/--pipeline/--store/--json`；索引条目每命令收集一次，按 resolved store 的 uid 过滤）+ Phase 5 g-001 起的 `ready` 子命令（`--store/--json`，只读、仅最新修订、无 `--revision`；planning 拒绝码 `issue_ready_requires_plan`；locale 三文件 + completions 同步）。
- **连接**：被 `src/commands/store-issue.ts` 消费；g-003 的验收/close 若需复用 frontier 规则，应 import 此模块。

## `issue-acceptance/` — Issue 验收闸门与显式 accept/close（C3 交付）

回答"这个 Issue 现在能不能被接受、不接受还差什么"：`evaluateIssueAcceptanceGate(view, facts)` 按 D3 规则求值——每个必需节点 observation ∈ {finalized, run-terminal}（与 execution binding 同一条工作完成规则，非 query 的 archive-based `blockedBy`）、health ≠ failed、读取完备且零 status problem——事实阻塞项**一起点名**（un-terminal 节点带 observation、failed 节点、status problem；g-002 起阻塞环只数 required+intent 节点，cancelled/superseded 以带 reason 的 exclusion 名单列在门旁，快照同 progress 口径、0/0 连贯）；结构化拒绝为独立码（`issue_accept_requires_plan`/`issue_accept_conditions_required`/`issue_accept_already_accepted`/`issue_accept_dropped`）。

- **关键文件**：`types.ts`（闸门契约：`IssueAcceptanceFacts`/`GateView`/闭集 blocker 分类法/`IssueAcceptanceStatusBlock`）、`gate.ts`（纯求值 + `acceptanceRefusalFix`；被 projection import 填 `status.acceptance.gate`——唯一 runtime 边且无回流，零加载环）、`orchestration.ts`（`readIssueAcceptanceFacts`：验收内容的唯一读取者，checkout 工作树 + digest 验证；`acceptIssue`：D6 evaluate-fresh-then-lock——经 issue-status 一条缝读状态 → 求值 → 带快照+exclusions 调 `StoreIssues.accept`；Phase 5 g-002 起门的 exclusion 持久化进 accepted 记录（可选字段、无排除则省略不进 digest 体——同 plan-node suggestion-field 纪律））、`index.ts`（barrel）。
- **拓扑守则**：组合模式（同 C2）；`store/issues` 保持零上向依赖——mutation 只收已求值的可移植快照，锁内零 run-state 读。TOCTOU 边界（求值与加锁之间 run-state 可移动）由记录内快照自标注，不遮掩。
- **CLI 缝**：`src/commands/store-issue.ts` 的 `acceptance`（`--from-file` 发布条件修订）与 `accept`（`--note`）子命令；show 的 acceptance 节（条件 + 闸门行 + 记录）。
- **连接**：被 `src/commands/store-issue.ts` 与 `src/core/issue-status/projection.ts`（反向仅 gate.js）消费。

## `issue-publication/` — portfolio/decomposition → Execution Plan 发布通道（Phase 2 g-001；Phase 4 g-002 增分解源）

回答"怎么把 auto-decompose 的真实 portfolio 结构变成 Issue 的 Execution Plan 修订"：`publishPlanFromPortfolio`（`rasen store issue plan <id> --from-portfolio <parent>`）按 `pipeline resume` 的同一放置链（ephemera → workDir → change dir，probe-only 不铸造 work dir）定位 `portfolio-run.json`，strict 读（invalid ≠ absent）+ `state.parent` 一致性 + 非空 children，编译为节点输入（nodeId/changeAlias = child id、dependsOn 原样、零 status/pipeline/delivery 字段），每个 child 按**名字**解析成 committed 实例后交给 `StoreIssues.publishPlan`（序数/摘要/图检查/锁/commit 建议全继承，无平行实现）。通道唯一写物 = 修订文件；run-state 逐字节不动。

Phase 4（g-002）增**第三发布源** `--from-decomposition <path>`（`publishPlanFromDecomposition`）：分解文档 = 纯 YAML `nodes:` 列表，每节点 `kind: intent`（change-kind 拒收并指向 `--from-portfolio`）+ `suggestedPipeline` + `rationale`/`uncertainty` 至少其一（缺字段点名节点+字段拒绝）；authored `lifecycle: required|optional` 在文档层接受——g-003 起编译**前传入 intent 节点**（absent 读 required、canonical 省略；**修订**才是 required/optional 提案的 durable record，文档逐字节不动回到纯输入）；文档路径 caller 自给（dogfood 放 evidence/），unreadable ≠ absent。节点三字段（`suggestedPipeline`/`rationale`/`uncertainty`）在 `store/issues/plans.ts` schema：可选、canonical absent 即省略（旧修订 digest 字节不变）、`rationale`/`uncertainty` 过 `assertPortableIssueText`、发布期注册表校验 `assertPlanNodeSuggestions`（validator 经 `PublishExecutionPlanInput.pipelineKnown` 注入——CLI 对全部三源组合 `listPipelines(projectRoot)` 的 root-aware 缝，同 `store issue start --pipeline`）；authored 输入另有 **extra-keys 拒收**（g-003 起 `planNodeUnknownFields`：per-kind 已知字段集外的 key 按节点+字段名拒收，throwing/reporting 两路同规，与 stored 面的 strict 对称）。

- **关键文件**：`types.ts`（输入 + refusal 码闭集 `issue_plan_portfolio_*`/`issue_plan_decomposition_*`/`issue_plan_source_*` + `source` 判别联合块）、`compiler.ts`（portfolio 纯编译）、`decomposition.ts`（分解文档纯读取 + intent 节点输入编译）、`resolution.ts`（名字→实例：`gatherChildEvidence` 复用 `gatherReferenceEvidence`；复用 `issue_reference_*` 族拒绝——unresolved/uncommitted/ambiguous/foreign-store + `store_query_ref_unreadable` 只在缺席型结论上改判）、`orchestration.ts`（两通道：定位缝 + 拒绝 + 发布）、`index.ts`（barrel）。
- **archived 算证据**：archived 条目的目录名是 `<date>-<change>`（或 v2 `<date>-<change>--<instanceShort>`），用 `archive-engine.ts` 的 `archiveDatePrefixedNameMatches`（只对 archived 条目启用；active 目录长得像日期前缀不算）——子项完成后重发布仍可解析是本片核心 dogfood。
- **边界**：只 import 不改 `src/core/pipeline-registry` 的冻结面（g-002 起唯一解冻点 = `execution-plan-internal.ts` 的 decompose-bearing v1 裁决改名，见 workflow-pipeline 域）；`store/issues` mutation 词汇不动（新码不进 `StoreIssueErrorCode`）。CLI 缝在 `src/commands/store-issue.ts` 的 `plan` 子命令（三源恰取其一：`--from-file`/`--from-portfolio`/`--from-decomposition`，任两同给或全缺拒绝并点名三源）。
- **连接**：被 `src/commands/store-issue.ts` 消费；g-003 全环 dogfood（真实 portfolio 重发布）依赖本通道；Phase 4 dogfood（Issue #3 decompose→review-ready）走分解源。

## `store/issues/` — 系统分配身份、V1/V2 resources 与条件 CAS

- `identity.ts` 是 Issue 身份的深缝：`allocateIssueIdentity` 用注入 entropy 分配 lowercase UUIDv4 并派生稳定 `ISS-` key，`projectStoredIssueIdentity` 用 Store UID + legacy id 投影 V1 UUIDv5，`resolveIssueSelector` 对 UID/key/slug/alias 生成式 catalog fail-closed。UID 是锁/关系/canonical route 权威；`IssueStorageKey` 只作内部路径 locator，绝不进入 HTTP/UI/CLI JSON。
- `records.ts` 保留 V1 canonical bytes，同时 strict 读写带 `identity` 的 V2 Issue record；`plans.ts`/`acceptance.ts` 同样保留 V1 digest/serializer，并为所有新 owned resources 写 V2 `issueUid`。V1 Issue 可拥有 V1→V2 混合修订历史，不做 read-side rewrite。
- `module.ts` 创建只要求 title（可选旧 `issueId` 仅转 legacy alias），在 Store allocation/selector lock → UID Issue lock 下 expected-absent 发布 UID 目录的 V2 record；其他 mutation 也在同一 allocation 边界内 resolve selector，再按 UID 加锁并按 resolved storage locator 重读/写入，阻止并发创建在解析后引入 slug/alias 歧义。`query/issues-read.ts` 先解析/投影每个 copy，再按 UID 分组并保留 copy 自己的 storage locator；selector index 永远由 records 生成、可丢弃、零写读取。
- **创建提交/恢复边界**：`issue.yaml` V2 exact bytes 是 commit point。atomic writer 抛错后若读回 exact bytes，返回已提交 identity + path-free warning；读回失败、非预期 bytes，或 target 缺席但 intent/claim/backup 可能保留时，抛 `issue_publication_indeterminate`，公开 `{kind, identity:{uid,key}, retrySafe:false}` 且 raw cause 仅留 core。`issue_identity_allocation_failed` 只保留给发布前 bounded allocation exhaustion 的零写语义。`management-api/stores.ts` 是公共 Issue diagnostic/warning projector：不可验证 summary/copy/problem 的 `issueId`/`itemId`/path/reason/diagnostic/storage locator 一律不出 HTTP/UI/CLI JSON。
- `types.ts` 的 `PublishExecutionPlanInput.expectedRevisionId?: ExecutionPlanRevisionId | null` 是可选 compare-and-publish 前置条件：omitted 保留既有无条件顺序分配，`null` 要求当前无 plan，revision id 要求它正是 latest。
- `module.ts` 的 `StoreIssuesModule.publishPlan` 在既有 per-Issue write lock 内读取 `{previous,next}` 并比较 expectation；mismatch 抛 `execution_plan_revision_conflict`，且在 reference reads 与 revision write 之前退出，所以零修订写入。匹配后仍走同一 reference/schema/digest/immutable publication 路径，没有第六种 Issue mutation。
- HTTP 边界 `management-api/stores.ts` 的 `handleStorePublishPlan` 校验 undefined/null/canonical 四位 revision，`wire-types.ts` 与 UI request mirror 携带该字段；共享错误映射把 stale conflict 呈现为 HTTP 409。完整 plan-node 字段镜像保证 read-modify-publish 不丢 lifecycle/reason/suggestion/rationale/uncertainty。

## `store/issues/` 的 target-project 门（Phase 3 g-001 `issue-target-project-binding`）

- 节点的 target project **就是既有必填 `projectId`**——无新 schema 字段，修订字节/digest/序列化零变化（golden：序列化字节 + digest 双字面量钉在 `store-issue-plan-canonicalization`）。
- **发布门**在 `reference-verification.ts` 的 `verifyExecutionPlanReferences`（`--from-file`/`--from-portfolio` 双源经 `publishPlan` 一处继承）：目标须为 `roles.planning: true` 的成员，否则新码 `issue_reference_target_not_planning_member`（与 no-record 的 `issue_reference_scope_conflict` 分码：两条件修复不同；点名节点/项目/roles/planning members/`rasen store add-project` 修复）；change 与 intent 节点同规。门只赋 eligibility，永不替作者选目标。
- `IssueReferenceCatalogs.projects: {projectId, roles}[]`（原 `projectIds` 由它派生）。两个 caller 各按自身权威供 roster：`module.ts` `verifyReferences` 传 `listProjectEntries` 解析的 roles；`layout-migration/plan.ts` 传冻结 member 集（一律 planning-eligible——grandfathered replay 不被角色漂移卡死，回归测试在 `layout-migration-plan-gates`）。
- **读路径永不复查 membership**：Phase-2-era 修订（含 knowledge-only 目标）照读、digest 照验（降级套件 `issue-status-target-project-degradation`；持久 store 只读实证 evidence/dogfood-persistent-*）。读面加宽缝 = `IssueNodeStatus.projectId/targetLineId` + Phase 4 起 `suggestedPipeline/rationale/uncertainty`（`withLifecycle` 单点填充，absent 读 null，驱动零轴值——同 target project 的"事实只读"规则）；show 节点行 `<nodeId> <kind> <projectId> <alias> — <obs>` + `(suggest: …)`/`(rationale: …)`/`(uncertainty: …)` 段（仅有值时），`--json` 结构性携带；g-003 起 list 也带分组段（见上 lanes 条）。issue-cross-project-gating 起 show 节点行的依赖段渲染 `(blockedBy y@<project>: <state>[, …])`（work-complete 基准 + `issueBlockerState` 细化），`--json` 携带结构数组。

## `change-metadata/` — 每 change 元数据（`change.yaml`）

- **唯一实质文件**：`schema.ts`（Zod + TS）。`ChangeMetadata = {schema, created?, goal?, affected_areas?, initiative?}`，`InitiativeLink = {store, id}`（跨 store 引用）。
- **连接**：被 `artifact-graph/instruction-loader.ts`（解析 change 用哪个工作流 schema）+ `utils/change-metadata.ts`（读写文件）消费。叶子模块。

## `change-run/` — Durable Run Record 引擎（reducer/reconciler/projector 事件溯源）

rasen 最复杂的子系统。驱动 change pipeline（start/resume/complete），append-only + 全链摘要完整性。

- **公共面**：`facade.ts`（`ChangePipelineRuntime` 接口：`start/resume/complete/inspect/control`，各返 `ChangeRunReceipt`）、`contracts.ts`（branded IDs + Run Record 契约类型）。
- **内部（`internal/`，37 文件）**：`reducer.ts`（stimulus→record）、`reconciler.ts`（admit/block 逻辑）、`projector.ts`（record→view）、`run-store.ts`+`run-store-fs.ts`（append-only ledger，每次 commit 链自前序摘要）、`review-cycle-runtime.ts`/`goal-cycle-runtime.ts`/`task-loop.ts`（循环编排）、`reservations.ts`（workspace 锁）、`evidence.ts`、`lowerer.ts`（plan→DAG）。
- **核心类型**：branded IDs（`RunId`/`NodeId`/`AttemptId`/`EffectId`/`WorkspaceInstanceId` 等均为 `prefix:<64hex>`）、`ChangeRunView`（投影的人类可读视图）、`CanonicalRunRecord`（append-only 记录）、`EvidenceRef`（content-addressed 证据绑定）、`WorkspaceRevision`。
- **连接**：facade 被 CLI 驱动实验性 artifact 工作流的命令调用；依赖 `store/`（workspace git ops）+ `contracts.ts`。reducer/reconciler/projector 三元组是核心事件溯源模式。

## `parsers/` — Markdown→领域对象解析器

- **关键文件**：`markdown-parser.ts`（`MarkdownParser` 基类，代码栅栏感知）、`change-parser.ts`（`ChangeParser`，解析 change + deltas）、`requirement-blocks.ts`（delta 节解析 + requirement 块抽取）、`spec-structure.ts`（main spec 结构 lint）。
- **核心**：`MarkdownParser.parseSections()`/`parseSpec()`；`ChangeParser.parseChangeWithDeltas()`；`parseDeltaSpec(content)`→`{added,modified,removed,renamed,sectionPresence}`；`extractRequirementsSection()`（外科式编辑 requirement 块）。
- **连接**：被 `validation/`（先解析再校验）+ `converters/` 消费；`requirement-blocks.ts` 也被 `artifact-graph/instruction-loader.ts` 用。

## `converters/` — spec/change → JSON 导出

- **唯一文件**：`json-converter.ts`（`JsonConverter` 类：`convertSpecToJson()`/`convertChangeToJson()`，经 `parsers` 解析后 `JSON.stringify`）。
- **连接**：依赖 `parsers/` + `schemas/`。被 CLI `convert` 调用。叶子模块。

## `shared/` — 跨切面工具（工具检测 / skill 生成 / YAML 转义）

服务于 `init`/`update` 命令的脚手架路径，**与 store/artifact/change-run 无关**。

- **关键文件**：`tool-detection.ts`（检测已装 AI 工具 + skill 目录 + 版本）、`skill-generation.ts`（从模板生成 skill 文件 + 拷贝 sidecar）、`yaml.ts`（YAML scalar 安全引号/转义）。
- **核心**：`SKILL_NAMES`（init 创建的 10 个 skill 目录）、`COMMAND_IDS`（~16 命令模板 ID）、`resolveConfiguredTools()`/`getToolStates()`、`generateSkillContent()`/`copySkillSidecars()`。
- **连接**：被 CLI `init`/`update` + 命令生成管线消费。`skill-generation.ts` 依赖 `templates/skill-templates.ts` + `workflow-registry/index.ts`。
