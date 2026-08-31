<!-- architecture-index skill · on-demand · 由 SKILL.md 拆出。本文件仅在 skill 触发且需要一行定位时按需 Read，勿整文件预载。 -->
# 快速定位指南（「我想修改...」一行一答）

> 想理解某模块职责而非定位文件，去对应 `detail/modules/<域>.md`。本表只回答「去哪个文件/目录」。

### 我想修改 / 查找...

| 需求 | 去哪里找 |
|---|---|
| **Spec / Change 生命周期** | |
| 解析 spec markdown（Requirements/Scenarios） | `src/core/parsers/markdown-parser.ts`（`MarkdownParser.parseSpec`） |
| 解析 delta spec（ADDED/MODIFIED/REMOVED/RENAMED） | `src/core/parsers/requirement-blocks.ts`（`parseDeltaSpec`） |
| 解析整个 change 文件夹 | `src/core/parsers/change-parser.ts`（`ChangeParser.parseChangeWithDeltas`） |
| 校验 spec / change / delta | `src/core/validation/validator.ts`（`Validator`：`validateSpec`/`validateChange`/`validateChangeDeltaSpecs`） |
| spec/change/delta 的 Zod 类型定义 | `src/core/schemas/{base,spec,change}.schema.ts` |
| change 用哪个工作流 schema（`change.yaml`） | `src/core/change-metadata/schema.ts`（`ChangeMetadata`） |
| 决定 change 下一步产出哪个 artifact | `src/core/artifact-graph/graph.ts`（`ArtifactGraph.getNextArtifacts`）+ `instruction-loader.ts` |
| artifact schema YAML 文件 | `schemas/spec-driven/schema.yaml`（默认）+ `src/core/artifact-graph/resolver.ts`（三层解析） |
| spec/change → JSON 导出 | `src/core/converters/json-converter.ts`（`JsonConverter`） |
| **Archive（合并 delta + 移归档）** | `src/core/change-run/`（durable Run Record）+ CLI `archive` 命令（`src/commands/`） |
| **Store（git-backed spec 仓库）** | |
| Store 身份解析（当前项目是哪个 Store） | `src/core/store/identity.ts`（`resolveStoreBinding` 三态） |
| Store 注册 CRUD | `src/core/store/registry.ts` |
| Store 生命周期（setup/register/clone） | `src/core/store/operations.ts` |
| Issue 三轴状态投影（phase/health/progress） | `src/core/issue-status/projection.ts`（`projectIssueStatus`；CLI 面 `src/commands/store-issue.ts` list/show） |
| Issue 节点依赖阻塞显示（结构 blockedBy + 状态标签词汇） | `src/core/issue-status/projection.ts`（`withBlockerFacts` 后处理 = work-complete 基准唯一写者；`issueBlockerState` = 共享状态标签；CLI 面 `src/commands/store-issue.ts` show 节点行 `(blockedBy y@proj: state)` 段） |
| Issue 节点启动绑定（launch contract / start 子命令） | `src/core/issue-execution/binding.ts`（`resolveIssueLaunchBinding`；CLI 面 `src/commands/store-issue.ts` start；拒收/awaits 的逐 blocker `<id>@<project> (<state>)` 命名复用 `issueBlockerState`；g-003 起 fresh 链 = `--pipeline` > run-state > `suggestedPipeline`，契约 `pipelineSource` 命名来源） |
| Issue 确认报告（confirm 子命令 / launch contract 集 + pending Change） | `src/core/issue-execution/confirm.ts`（`composeIssueConfirm`：读-组装-报告，写零字节；CLI 面 `src/commands/store-issue.ts` confirm `--revision`；completions/locale 三文件同步） |
| Issue ready-set 确定性调度读面（ready 子命令 / 三面等价） | `src/core/issue-status/ready-set.ts`（`deriveIssueReadySet` = 投影后置 pass：membership = wanted ∧ not-started ∧ blockedBy 空；start frontier 与 confirm launchable 同一谓词，等价测试双向钉死；CLI 面 `src/commands/store-issue.ts` ready（只读、仅最新修订）；completions/locale 三文件同步） |
| Issue needs-attention 聚合（store attention / 跨 Issue 扫描） | `src/core/issue-status/attention.ts`（`deriveIssueAttention(issueId, status)` = 投影后置 pass：五类闭词汇 failure/blocked-behind(一跳)/waiting-human/acceptance-awaiting/problem，缺席纪律=in-flight/advanced/terminal/ready/串行等待不入列；fail-first 排序 + 每项带 issue 的 phase+health；CLI 面 `src/commands/store.ts` attention 子命令——store 级 fleet 读，per-Issue 组合逐字复用 show 的 `resolveProjectionContext`/`resolveStoreWideningContext`/`statusInputFor`（自 store-issue.ts 导出），`--issue` 收窄且未知 id 拒收；completions/locale 三文件同步） |
| Issue 归档记录 basis（legacy/invalid 裁决读面） | `src/core/store/query/module.ts`（`readArchiveEntry` 记 additive `outcomeBasis: 'v2'\|'legacy'\|'invalid'`，穿 `deriveReadiness` 进 `PlanNodeResolution`；投影消费在 `src/core/issue-status/projection.ts` `observeNode`：legacy→finalized+diagnostic、invalid→unknown+`invalid-archive-record` problem；query 自身 readiness 刻意 archive-outcome 不动） |
| Issue 交付证据（delivery evidence / show 专属读面） | 抽取缝 = `src/core/store/query/module.ts` `readArchiveEntry` 的 additive `delivery` 块（v1 ledger 防御式逐字段、v2 映射 `codeMerge.commit`/`planning.sourceRef`/outcome/evidence/missing；absent/damaged → null），穿 `deriveReadiness` 进 `PlanNodeResolution`；投影在 `src/core/issue-status/projection.ts` `deliveryFor`（`withLifecycle` 单点加宽，五态闭词汇 record/no-record/not-archived/unreadable/unattributed，intent=null，驱动零轴）；rollup = `src/core/issue-status/delivery.ts` `deriveIssueDeliveryEvidence(revisionId, status)` 纯后置 pass（不可读修订 → null）；CLI 面 `src/commands/store-issue.ts` show 的 `delivery evidence:` 段 + `--json` 的 `delivery` 键（list 不带 rollup）；ship-log 按 inventory 事实呈现、散文永不解析、无结构化 PR 事实 |
| Issue 统一 review 视图（determination / threads / show 末段） | `src/core/issue-status/review.ts` `deriveIssueReview(issueId, revisionId, status)` 纯后置 pass（组合同 status 的 delivery rollup + attention；never-null）；determination 七值一一映射 `status.acceptance.gate`（无第二 blocking basis）；threads = attention 映射 failure/blocked-behind/waiting-human（排除 acceptance-awaiting/problem）+ optional-open/archive-pending（终态∧not-archived）/record-absent/evidence-missing；CLI 面 `src/commands/store-issue.ts` show 末段 `review:` + `--json` 的 `review` 键（list 不带 review 事实） |
| Issue show 的修订 delta（最新修订 vs supersedes 前任） | `src/core/issue-status/projection.ts`（`deriveRevisionDelta` 纯函数 → `IssueStatus.delta`；前置修订经 `ProjectIssueStatusInput.predecessorPlan` 显式输入，CLI 用 `resolveExecutionPlan({revisionId: supersedes})` 取；驱动零轴） |
| Issue 验收闸门 / 显式 accept（done 规则） | `src/core/issue-acceptance/gate.ts`（`evaluateIssueAcceptanceGate`）+ `orchestration.ts`（`readIssueAcceptanceFacts`/`acceptIssue`；CLI 面 `src/commands/store-issue.ts` acceptance/accept） |
| Issue 验收内容 schema（条件修订 / accepted 记录） | `src/core/store/issues/acceptance.ts`（digest/serialize，镜像 plans.ts 纪律）；地址 = planning-layout-v2 的 `acceptance-conditions`/`acceptance-condition`/`issue-accepted-record` 三 kind |
| Issue 从 portfolio 发布 Execution Plan（`plan --from-portfolio`） | `src/core/issue-publication/orchestration.ts`（`publishPlanFromPortfolio`；定位缝同 `pipeline resume`，child 名字→committed 实例解析在 `resolution.ts`；CLI 面 `src/commands/store-issue.ts` plan） |
| Issue 从分解文档发布 Execution Plan（`plan --from-decomposition`）+ 节点建议/理由字段 | `src/core/issue-publication/decomposition.ts`（纯文档读取：intent-only + 每节点 `suggestedPipeline` + `rationale`/`uncertainty` 至少其一；拒绝码 `issue_plan_decomposition_*`）+ `orchestration.ts`（`publishPlanFromDecomposition`，文档只读、逐字节不动）；字段 schema/canonical 省略/发布期注册表校验在 `src/core/store/issues/plans.ts`（`assertPlanNodeSuggestions`，validator 由 CLI 注入 `store issue start --pipeline` 的同一缝） |
| Issue plan 节点 target project 门（planning-member gate）+ 读面 per-node 项目 | 门在 `src/core/store/issues/reference-verification.ts`（`verifyExecutionPlanReferences`，双发布源经 `publishPlan` 一处继承；migration replay 冻结集豁免在 `src/core/store/layout-migration/plan.ts`）；读面 = `src/core/issue-status/projection.ts` `withLifecycle` 填 `projectId/targetLineId`，`src/commands/store-issue.ts` show 节点行渲染 |
| Issue 按成员项目分组读面（per-project lanes / 分组进度） | `src/core/issue-status/projection.ts`（`deriveProjectLanes` 后处理 = `IssueStatus.projects`，`progressOver` 一条完成规则两个作用域；alias 是 CLI 组合输入）+ `src/commands/store-issue.ts`（`resolveStoreWideningContext` 读项目 catalogs 供 alias；show 泳道头 `project <alias|id> (<id>): x/y`；list 段 `[<alias|id> a/b · …]`） |
| Issue 读面组合（CLI 与 daemon 的**同一个**组装：list/show/attention） | `src/core/issue-read/composition.ts`（`composeIssueProjectionList` / `composeIssueProjectionDetail` / `composeStoreAttention`，query 注入；payload 类型 = CLI `--json` 字面量键序；下沉自 store-issue.ts 的 `statusInputFor`/`resolveStoreWideningContext`/`resolvePredecessorPlan` + list 的 `detailForList` + store.ts 的 attention 扫描环与 `attentionCounts`）+ `run-context.ts`（`resolveRunStateContext(startPath)`：CLI 传 cwd、daemon 传 launchProjectRoot，解不出即 `{}` → `runStateVisibility:'none'` 诚实降级，永不抛）。**改读面组合只改这里**：CLI（`store-issue.ts` list/show、`store.ts` attention）与 daemon（`management-api/stores.ts` 三 handler）调同一函数，parity 由构造保证 |
| Change↔Issue bulk association（active/archive、linked/unlinked/unknown） | `src/core/issue-read/change-links.ts`（`composeChangeIssueLinks`：一次 grouped Changes + Issues + 每个最新 plan 扫描，稳定 instance 精确关联；完整证据下零 link 才 `unlinked/attachable`，不可读/缺失/歧义为 `unknown`；零 cache/index/write）+ `index.ts` barrel |
| Issue 投影 HTTP 端点（三条 GET，flat Store-aggregate 族） | `src/core/management-api/stores.ts`（`handleStoreIssueProjections`/`handleStoreIssueProjection`/`handleStoreIssueAttention` = compose 的透传，零缓存零派生；`mapThrown` 的 `STATUS_FOR_STORE_ERROR_CODE` 表把 `issue_attention_unknown_issue` 这个**非** `StoreIssueErrorCode` 的拒收映到 404，否则落 500）+ `router.ts`（`/api/v1/stores/issue-projections|issue-projection|issue-attention`，`space=store:<uid>` 必填、每请求重解 run-state）+ `wire-types.ts`（三 alias，unwrapped passthrough）。未知 Issue 的**单 Issue 读**不是拒收——query 从不为找不到的 Issue 抛错，CLI 也照样打印空记录读，故服务端 404 会**破坏** parity |
| Change↔Issue HTTP 端点（flat Store-aggregate 族） | `src/core/management-api/stores.ts`（`handleStoreChangeIssueLinks` 直透 `composeChangeIssueLinks`）+ `router.ts`（`GET /api/v1/stores/change-issue-links?space=store:<id-or-uid>`）+ `wire-types.ts`（`StoreChangeIssueLinksResponse = ChangeIssueLinksPayload` 直接 alias）；勿扩展弃用的 `stores-routes.ts` 参数化族 |
| Execution Plan 条件发布 / stale-write CAS | `src/core/store/issues/types.ts`（`PublishExecutionPlanInput.expectedRevisionId?: ExecutionPlanRevisionId|null` + `execution_plan_revision_conflict`）、`module.ts`（既有 per-Issue lock 内 compare-and-publish，mismatch 零写）；HTTP 边界在 `src/core/management-api/stores.ts` `handleStorePublishPlan`（undefined/null/四位 revision 校验，conflict→409），请求镜像在 `wire-types.ts` 与 `packages/ui/src/api/types.ts` |
| Project Board / Store Issue canonical home 与类型感知切换 | `packages/ui/src/store/use-space.ts`（`spaceHomeHref`：project→Board、Store→Issues；`spaceSwitchHref`：common section 跨 namespace 保留，Store-only section 仅 Store→Store 保留）+ `app.tsx`（Store legacy Board→Issues、Task→Operations replace redirect）+ `SpaceBootstrap.tsx`/`SpaceSwitcher.tsx`/`SpacesPage.tsx`/`CreateSpaceDialog.tsx`；`BoardPage.tsx` 仅 project Change/Task，Store 不再有 Board/member branch |
| Issue Board / Detail 界面（Store canonical `/s/:storeId/issues[/:issueId]`） | `packages/ui/src/components/IssueBoardPage.tsx`（selector-keyed state child、页头新建 Issue 写入口、创建成功后全量重读、五固定 phase 泳道 + 不完整性通告条 + MemberChips 纯过滤不持久化）、`IssueCard.tsx`（main Detail link + phase/health/progress/attention evidence links）、`IssueDetailPage.tsx`（selector+Issue-keyed child、§9.2 七段 + Operations/Unlinked 只读交接）、`issue-provenance.ts`（record / plan-projection / acceptance-review / runtime / delivery / attention 六族、稳定 anchor、仅复制 payload 的 `git|runtime` locator）、`issue-vocabulary.ts`（**闭词汇→i18n 键的字面查表，UI 侧唯一映射层：不派生 phase/health/progress/determination**）；路由在 `app.tsx`（Store 专属，无 `/p/` 对，不进 `SWITCHABLE_SECTIONS`），导航项在 `Layout.tsx`；旧 `StoreIssuesView`/`StoreAggregateBoard`/`RunningSessionsMenu` 已删除 |
| Store Operations / Unlinked Changes 界面 | `packages/ui/src/components/OperationsPage.tsx`（Store roster 扇出 Sessions/Runs、cwd 与 frozen execution 分离、D1 Change/Issue attribution、member-local retry/paging/live polling）+ `operations-model.ts`（纯分类/归属）+ `OperationsSection.tsx`（Task Detail 与 Store 页共用的 server-authorized Run panel）；`UnlinkedChangesPage.tsx` + `LinkChangeDialog.tsx`（D1 inventory、preview-confirm attach/create、revision CAS、partial-create recovery）。路由 `/s/:storeId/operations|unlinked-changes` 与导航在 `app.tsx`/`Layout.tsx`，均 Store-only、无 `/p/` 对、不进 `SWITCHABLE_SECTIONS` |
| `rasen store` 命令 | `src/commands/store.ts` |
| `rasen store issue` 命令（Issue CRUD + 状态面 + 验收面） | `src/commands/store-issue.ts` |
| `rasen store workspace` 命令（planning/execution worktree **对**，与 `rasen workset` 无关） | `src/commands/workspace.ts`（plan / plan --apply / apply / show / cleanup；`--apply` = 一次调用内计划+应用，路由到 `StoreWorkspace.prepare()`）+ `src/core/store/workspace/`（`module.ts` = plan/apply/prepare/describe/cleanup 编排与锁持有；`plan.ts` = 只读全量计划：create-vs-reuse、pair 分支 absent/reattach/被别的 worktree 占用三态、own-Change index 条目对账；`apply.ts` = 只消费 token 的重校验+写入（created 侧要的是**缺席**，recorded identity 只对同 root 的续跑比对）；`registry.ts` = 机器索引=可重建投影、对任何事都不是权威；`locks.ts` = scope→workspace→change→integration 固定序） |
| **Workflow / Pipeline** | |
| 添加 / 修改 built-in workflow 定义 | `src/core/workflow-registry/builtins.ts`（ID 表 + 适配表） |
| workflow 目录加载（built-in + user） | `src/core/workflow-registry/registry.ts`（`loadWorkflowCatalog`） |
| `workflow.yaml` manifest 解析 | `src/core/workflow-registry/manifest.ts` |
| workflow 传递依赖闭包 | `src/core/workflow-registry/dependency-graph.ts` |
| 添加 shipped pipeline | `pipelines/<name>/pipeline.yaml`（新增一个目录） |
| pipeline 定义解析 / 校验 | `src/core/pipeline-registry/pipeline.ts`（`loadPipeline`/`parsePipeline`）+ `types.ts` |
| ECP v2 定义图（Canvas 共享缝） | `src/core/pipeline-registry/definition.ts` |
| pipeline run-state（resume / 可观测） | `src/core/pipeline-registry/run-state.ts`（`auto-run.json` 契约） |
| pipeline stage 有效配置（config 层 + CLI flag） | `src/core/pipeline-registry/stage-overrides.ts` |
| pipeline 的多 Provider 推理选择 / frozen route | `src/core/omnicross/` + `pipeline-registry/{types,prepared-execution-view,run-state}.ts` |
| `.rasenpkg` 打包 / 安装 | `src/core/workflow-package/{codec,transaction}.ts` |
| `rasen pipeline` / `pipeline-library` 命令 | `src/commands/pipeline.ts` / `pipeline-library.ts` |
| `rasen workflow-library` 命令 | `src/commands/workflow-library.ts`（委托 `core/workflow-library.ts`） |
| **Skill 生成（SKILL.md 正文）** | |
| 改某 skill 的指令正文 | `src/core/templates/experts/<x>.ts` 或 `workflows/<x>.ts`（`get*SkillTemplate`） |
| 改所有 expert 共享的 preamble / 词汇 | `src/core/templates/experts/_shared.ts` |
| 改 LEAD 编排 playbook | `src/core/templates/workflows/_orchestration.ts`（`ORCHESTRATION_PLAYBOOK`） |
| shipped skill 的 sidecar 参考文件 | `skills/experts/<x>/` 或 `skills/workflows/rasen-<x>/` |
| 装入用户 `.claude/skills/` 的逻辑 | `src/core/shared/skill-generation.ts`（`generateSkillContent`/`copySkillSidecars`） |
| **Agent 派发（驱动 Claude/Codex）** | |
| 派发一轮 Claude Code | `src/core/claude/runner.ts`（`runClaudePrint`）+ `invocation.ts`（argv + GUARD） |
| 派发一轮 Codex | `src/core/codex/runner.ts`（`runCodexExec`）+ `invocation.ts` |
| OmniCross lease / descriptor / inference file | `src/core/omnicross/`（`config` → `client` → `launch-binding` → `lease-execution`） |
| frozen Action 的 OmniCross 执行缝 | `src/core/frozen-action-executor/omnicross-lifecycle.ts` + `executor.ts` |
| Codex 线程死亡检测 / warm-seed | `src/core/codex/lifecycle.ts` |
| keepalive beat（parked worker 保 prompt cache） | `src/core/keepalive/index.ts`（`rasen agent wait` 调它） |
| token 花费审计 | `src/core/token-audit/audit.ts`（`runAudit`，Claude/Codex/Zed） |
| `rasen agent` 命令（dispatch/context/wait/audit） | `src/commands/agent.ts` |
| **Learned Skills / Knowledge** | |
| learned skill 读路径（解析有效集） | `src/core/learned-skills/resolve.ts`（`resolveLearnedSkills`） |
| learned skill 写路径（两阶段） | `src/core/learned-skills/mutate.ts`（`planLearnedSkillMutation`/`commitLearnedSkillPlan`） |
| learned skill manifest schema | `src/core/learned-skills/schema.ts` |
| 可移植知识 bundle（import/export） | `src/core/knowledge-bundle/{export,import}.ts` |
| `rasen knowledge` 命令 | `src/commands/knowledge.ts` |
| **CLI 命令 & 程序树** | |
| 加 / 改一个 `rasen` 命令 | `src/commands/<name>.ts`（`register*`）+ 在 `src/cli/index.ts`（`buildUnlocalizedProgram`）接线 |
| 命令 help / 描述 / 本地化 | `src/cli/commander-presentation.ts`（`applyCliPresentation`）+ `src/locales/*.json` |
| shell 补全（zsh/bash/fish/PS） | `src/core/completions/{command-registry,factory}.ts` |
| 动态补全（change/spec/schema ID） | `src/core/completions/completion-provider.ts` |
| **Daemon / Management API / Web UI** | |
| `rasen daemon` / `rasen ui` 启动 management server | `src/core/management-api/server.ts`（`startManagementServer`）+ `src/commands/daemon.ts` |
| Web UI 自动浏览器会话 / `/p/config` 启动项目短入口 / 过期续签 | `src/core/management-api/server.ts`（HttpOnly cookie、loopback Host 门、`GET /api/v1/auth/session`、短入口重定向）+ `packages/ui/src/{app.tsx,api/client.ts}`（无 fragment 启动、401 单次续签）+ `src/commands/ui-launch.ts`（token-free URL） |
| 管理路由（runs/sessions/spaces/pipelines） | `src/core/management-api/router.ts` + `sessions.ts`/`runs.ts`/`supervisor.ts` |
| 配置键 HTTP API | `src/core/config-api/router.ts` |
| 暖会话池（reusable session） | `src/core/management-api/reusable-session-api.ts`（`ReusableSessionService`） |
| `rasen session` 命令（exec/list/retire） | `src/commands/session.ts` |
| Web UI（Board/Canvas/Config） | `packages/ui/src/`（`app.tsx` 路由 + `canvas/PipelineCanvasPage.tsx`） |
| Web UI 主题（CSS 变量应用） | `packages/ui/src/theme/runtime.ts` |
| 终端欢迎动画 | `src/ui/welcome-screen.ts`（仅 CLI，非 web） |
| **配置 / Profile / Root 解析** | |
| 全局配置（`~/.rasen`） | `src/core/global-config.ts`（re-export 自 `core/index.ts`） |
| 有效配置解析（scope 合并） | `src/core/effective-config.ts`（被 config 命令/API 包） |
| `rasen config` 命令 | `src/commands/config.ts` |
| profile（哪些 workflow 启用） | `src/commands/profile.ts` + `src/core/workflow-registry/selection.ts` |
| root 选择优先级 / store-project 解析 | `docs/agent-contract.md`（契约）+ `src/core/workspace-root.ts`/`planning-home.ts` |
| 项目 context/rules 配置 | `rasen/config.yaml`（项目实际）/ 根 `config.yaml`（空模板） |
| **基础设施** | |
| `rasen` binary 入口 | `bin/rasen.js`（→ `dist/cli/index.js`） |
| 构建（tsc） | `build.js` |
| 上下文压缩恢复 hook | `hooks/compact-recovery.sh` |
| 预执行安全 hook | `hooks/safety-check.sh` |
| 国际化（CLI 消息） | `src/locales/{en,ja,zh-cn}.json` |
| 遥测（匿名、opt-out） | `src/telemetry/index.ts`（`RASEN_TELEMETRY=0` 关） |
| agent 依赖的 CLI 机器契约 | `docs/agent-contract.md`（JSON 输出形 + root 优先级） |
