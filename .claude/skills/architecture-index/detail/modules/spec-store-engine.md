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
