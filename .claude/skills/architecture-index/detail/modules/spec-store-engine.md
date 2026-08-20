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

- **关键文件**：`projection.ts`（`projectIssueStatus(input)`：per-node run-state 定位 + D4 观察映射 + phase/health/progress 推导 + acceptance 块组装）、`types.ts`（闭词汇表 + `ProjectIssueStatusInput`，显式路径输入零 ambient read）、`index.ts`（barrel）。
- **定位配方 = `pipeline resume` 原样复用**：`stateFileSearchChain` + `runStatePath`/`portfolioStatePath` + `readRunStateDetailed`/`readPortfolioStateDetailed`（`ephemera → workDir → planning change dir` 三段 sticky-legacy 链）；portfolio-run.json 存在即权威；escalated child/delivery = failed、escalated stage = waiting-human。C2 加宽：当前根链未命中后，逐个匹配的 workspace index 条目以其 execution root 自有链再探（ephemera → 条目 planning 侧 active-change 地址；index 根无 work-dir 腿），节点带 `locatedBy`（execution-root|workspace-index|null）与 attribution（pipeline/sessions/evidenceLocator——sessions 只含 durable 指针，agentId 构造上排除）。
- **done 规则（C3 起）**：`resolved` ∧ 验证过的 accepted 记录 → `done`；仅 resolved（含历史 close）→ `review`+`waiting-human`；archived 计数与裸状态翻转永不推导 done。验收内容读不回（篡改/无效）→ status problem（`unreadable-acceptance`）。`IssueStatus.acceptance` 块 = 最新条件修订 + 本次读取上求值的闸门（来自 `issue-acceptance/gate.ts` 的唯一 runtime 边）+ 已验证记录；省略 acceptance 输入时块为 null 且其余推导与 C2 逐字节一致。
- **边界**：只 import 不改 `src/core/pipeline-registry/`（冻结）与 `src/core/store/query/`（store-pure 契约不含 run-state——这就是它独立成顶层模块的原因）。CLI 缝在 `src/commands/store-issue.ts`：best-effort 解析 execution root（失败降级 visibility-none），list 行加 `phase/health n/m`，show 加 status 块 + 每节点 attribution 行 + acceptance 节，两命令 `--json` 增生 `status` 对象（含 `status.acceptance`）；index 条目每命令收集一次（`listAllWorkspaceIndexEntries` 按 store uid 过滤）；list/show 每命令额外经 `readIssueAcceptanceFacts` 读一次验收内容。
- **连接**：被 `src/commands/store-issue.ts` 与 `src/core/issue-acceptance/orchestration.ts` 消费（一条状态缝）。

## `issue-execution/` — Issue 节点启动绑定（resolve + verify + emit，不 spawn）

回答"这个 Issue 的下一个节点从哪里启动"：从 plan 修订 + 投影 observations 推导 runnable frontier（observation 规则，非 query 的 archive-based `blockedBy`），经固定路由序解析绑定的执行上下文（D4：workspace pair index 条目 → L6 `resolveSessionLaunchContext` 成员 checkout → unprepared 拒绝并给出确切 `store workspace plan --existing-change` 准备命令），输出 launch contract（cwd/attached/pipeline/mode）。读时推导、零写入；refusal 闭集九码（g-002 起 `--node` 命中 cancelled/superseded 节点有独立码并点名 lifecycle+reason，frontier 只含 wanted 节点 required|optional），每条拒结名名候选/阻塞/准备命令/L6 诊断。

- **关键文件**：`binding.ts`（`resolveIssueLaunchBinding` + `refusalFix`）、`types.ts`（`IssueLaunchBinding`/refusal taxonomy/injectable `launchContextFor`/`pipelineKnown`）、`index.ts`（barrel）。
- **组合而非重建**：import L6 `management-api/session-launch-context.ts`（经可注入 seam，生产默认 `store:<uid>` + `project:<id>`）、`store/workspace/registry.ts` 的 index 读取、`issue-status` 的投影（attribution.pipeline 即 D5 的 recorded pipeline 来源）、`pipeline-registry/resolver.ts` 的 catalog（`--pipeline` 校验）。只 import 不改 `src/core/pipeline-registry/`。
- **边界**：CLI 缝在 `src/commands/store-issue.ts` 的 `start` 子命令（`--node/--pipeline/--store/--json`；索引条目每命令收集一次，按 resolved store 的 uid 过滤）。
- **连接**：被 `src/commands/store-issue.ts` 消费；g-003 的验收/close 若需复用 frontier 规则，应 import 此模块。

## `issue-acceptance/` — Issue 验收闸门与显式 accept/close（C3 交付）

回答"这个 Issue 现在能不能被接受、不接受还差什么"：`evaluateIssueAcceptanceGate(view, facts)` 按 D3 规则求值——每个必需节点 observation ∈ {finalized, run-terminal}（与 execution binding 同一条工作完成规则，非 query 的 archive-based `blockedBy`）、health ≠ failed、读取完备且零 status problem——事实阻塞项**一起点名**（un-terminal 节点带 observation、failed 节点、status problem；g-002 起阻塞环只数 required+intent 节点，cancelled/superseded 以带 reason 的 exclusion 名单列在门旁，快照同 progress 口径、0/0 连贯）；结构化拒绝为独立码（`issue_accept_requires_plan`/`issue_accept_conditions_required`/`issue_accept_already_accepted`/`issue_accept_dropped`）。

- **关键文件**：`types.ts`（闸门契约：`IssueAcceptanceFacts`/`GateView`/闭集 blocker 分类法/`IssueAcceptanceStatusBlock`）、`gate.ts`（纯求值 + `acceptanceRefusalFix`；被 projection import 填 `status.acceptance.gate`——唯一 runtime 边且无回流，零加载环）、`orchestration.ts`（`readIssueAcceptanceFacts`：验收内容的唯一读取者，checkout 工作树 + digest 验证；`acceptIssue`：D6 evaluate-fresh-then-lock——经 issue-status 一条缝读状态 → 求值 → 带快照调 `StoreIssues.accept`）、`index.ts`（barrel）。
- **拓扑守则**：组合模式（同 C2）；`store/issues` 保持零上向依赖——mutation 只收已求值的可移植快照，锁内零 run-state 读。TOCTOU 边界（求值与加锁之间 run-state 可移动）由记录内快照自标注，不遮掩。
- **CLI 缝**：`src/commands/store-issue.ts` 的 `acceptance`（`--from-file` 发布条件修订）与 `accept`（`--note`）子命令；show 的 acceptance 节（条件 + 闸门行 + 记录）。
- **连接**：被 `src/commands/store-issue.ts` 与 `src/core/issue-status/projection.ts`（反向仅 gate.js）消费。

## `issue-publication/` — portfolio → Execution Plan 发布通道（Phase 2 g-001）

回答"怎么把 auto-decompose 的真实 portfolio 结构变成 Issue 的 Execution Plan 修订"：`publishPlanFromPortfolio`（`rasen store issue plan <id> --from-portfolio <parent>`）按 `pipeline resume` 的同一放置链（ephemera → workDir → change dir，probe-only 不铸造 work dir）定位 `portfolio-run.json`，strict 读（invalid ≠ absent）+ `state.parent` 一致性 + 非空 children，编译为节点输入（nodeId/changeAlias = child id、dependsOn 原样、零 status/pipeline/delivery 字段），每个 child 按**名字**解析成 committed 实例后交给 `StoreIssues.publishPlan`（序数/摘要/图检查/锁/commit 建议全继承，无平行实现）。通道唯一写物 = 修订文件；run-state 逐字节不动。

- **关键文件**：`types.ts`（输入 + 新 refusal 码闭集 `issue_plan_portfolio_*`/`issue_plan_source_*` + `source` 块）、`compiler.ts`（纯编译）、`resolution.ts`（名字→实例：`gatherChildEvidence` 复用 `gatherReferenceEvidence`；复用 `issue_reference_*` 族拒绝——unresolved/uncommitted/ambiguous/foreign-store + `store_query_ref_unreadable` 只在缺席型结论上改判）、`orchestration.ts`（定位缝 + 拒绝 + 发布）、`index.ts`（barrel）。
- **archived 算证据**：archived 条目的目录名是 `<date>-<change>`（或 v2 `<date>-<change>--<instanceShort>`），用 `archive-engine.ts` 的 `archiveDatePrefixedNameMatches`（只对 archived 条目启用；active 目录长得像日期前缀不算）——子项完成后重发布仍可解析是本片核心 dogfood。
- **边界**：只 import 不改 `src/core/pipeline-registry/`（冻结）；`store/issues` 五 mutation 词汇不动（新码不进 `StoreIssueErrorCode`）。CLI 缝在 `src/commands/store-issue.ts` 的 `plan` 子命令（`--from-file` XOR `--from-portfolio`，双给/双缺各拒绝且点名两源）。
- **连接**：被 `src/commands/store-issue.ts` 消费；g-003 全环 dogfood（真实 portfolio 重发布）依赖本通道。

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
