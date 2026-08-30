<!-- architecture-index skill · on-demand · 仅在 skill 触发且需要该域时按需 Read，勿整文件预载。 -->
# 模块索引：Workflow / Pipeline / 配置 / 管理服务

> 可安装能力（workflow）、编排图（pipeline）、`.rasenpkg` 包、config HTTP API、management 守护进程。所有路径前缀 `src/core/`。

## 三者关系（workflow vs pipeline vs skill）

- **workflow** = 可安装的能力单元，`kind` ∈ `task | driver | internal | expert`。每个 workflow 生成一个 skill。被 `workflow-registry` 编目，打包成 `.rasenpkg`。用户在 profile 里选哪些启用。
- **pipeline** = 编排定义（YAML），stages 引用 skill 名，含 roles（planner/implementer/reviewer/fixer/shipper）、gates、loops、handoff/reuse。被 LEAD 消费驱动多 agent 执行。`standard` stage 引用 skill；`decompose` stage 扇出子 change 各跑子 pipeline。
- **skill** = 生成的产物（`SKILL.md` + sidecar），Claude Code 实际加载执行。每 workflow 恰好一个 skill。

## `workflow-registry/` — 可安装 workflow 目录（built-in + user）

- **关键文件**：`registry.ts`（`loadWorkflowCatalog`：built-in + user 合并）、`catalog.ts`（`WorkflowCatalog` 类：去重 + 查找）、`builtins.ts`（`BUILT_IN_WORKFLOW_IDS`/`CORE_WORKFLOW_IDS`/`INTERNAL_BUILTIN_WORKFLOW_IDS` + 适配表）、`validator.ts`（`validateWorkflowDirectory`）、`manifest.ts`（`parseWorkflowManifest`：`workflow.yaml` Zod）、`types.ts`（`WorkflowDefinition`/`WorkflowKind`）、`dependency-graph.ts`（`computeWorkflowDependencyGraph` 传递依赖闭包）。
- **核心**：`WorkflowDefinition`（`{id, source:'built-in'|'user', kind, skill:{dirName,SkillTemplate}, requires, files[], digest}`）。`WorkflowCatalog` 构造时拒绝重复 ID/skill-dir 碰撞。
- **连接**：被 workflow-package 系统、CLI `workflow-library`、config-api workflow 端点消费。built-in 定义从 `templates/skill-templates.ts` 取模板。

## `workflow-package/` — `.rasenpkg` 编解码 + 事务性安装

- **关键文件**：`codec.ts`（`createWorkflowPackage`/`encodePackage`/`decodePackage`）、`schema.ts`（`RasenPackageSchema` Zod，判别联合 `kind:'workflow'|'profile'|'pipeline'`，含 `packageDigest` sha256）、`transaction.ts`（`stagePackageWorkflows`/`commitWorkflowInstall`/`discardWorkflowInstall` 两阶段安装）、`version-gate.ts`（`preflightPackageVersion` semver 兼容门）、`json-preflight.ts`。
- **连接**：被 `commands/workflow-library.ts` + `commands/pipeline-library.ts`（import/export）消费。schema 是 CLI 打包与管理 API 校验端点的共享契约。

## `pipeline-registry/` — 编排 pipeline 定义/校验/解析/运行态

语义核心。stage DAG + roles + loops + gates + run-state。

- **关键文件**：`types.ts`（`Stage`/`PipelineYaml`/`HandoffConfig`/`ReuseConfig`/`StageLoop`）、`definition.ts`（**ECP v2 定义图**：`AtomicStage`/`CompositeRef`/`BoundedLoop`/`Choice`/`FanOut`/`Join`/`Gate`/`Finish` — registry/管理/Canvas 共享的权威语义缝）、`pipeline.ts`（`loadPipeline`/`parsePipeline`/`PipelineValidationError`）、`resolver.ts`（`loadPipelineByName`/`listPipelines`/路径解析）、`run-state.ts`（`RunState`：`auto-run.json` 契约，resume/可观测）、`stage-overrides.ts`（`resolvePipelineStageOverrides`：config 层 project>store>global + CLI flag 合并）、`graph.ts`（`PipelineGraph`：Kahn 拓扑序 + ready/blocked 查询）、`profile-resolver.ts`（从 profile 层解析 pipeline 定义）。
- **核心**：`Stage = {id, kind:'standard'|'decompose', skill?, childPipeline?, role?, requires[], gate, loop?, inference?}`；`inference` 是闭合的 credential-free OmniCross 上游选择，模型仍来自既有 `model` 优先级；`PreparedExecutionStageView.inference` 合并 effective runtime/model/非 secret connection identity。`StageLoop` 判别联合 `review-cycle`（有界 review→fix）/ `goal`（measure XOR evaluate 门，maxRounds）；`PortfolioState`（多 change portfolio run）；`WorkerContract = 'leaf'|'evaluate'`。
- **路由恢复**：`run-state.ts` 只允许 `frozenInference`，`pipeline resume` 返回 frozen map；lease id、token、launch descriptor 不属于 run-state。canonical profile/Action 的对应冻结由 `execution-plan-internal.ts` / `change-run/internal/actions.ts` 完成。
- **reconciler 支持裁决**（`execution-plan-internal.ts` `analyzeReconcilerSupport`）：v1 decompose-bearing 定义报 `unsupported_pipeline_semantics`（0.3.0 Dispatch 边界；检查在 requiresV2 分支的 null-profile 短路**之前**——`normalizeV1` 给 decompose stage 合成 `pipeline:<child>` capability 致 discovery profile 为 null，旧首达答案 `execution_profile_unavailable` 读作"可解析的 profile 问题"是谎言；fail-closed 启动结局不变，边界标签 `issue-dispatch-0.3.0` 钉在 `builtins.ts`）。`execution_profile_unavailable` 仍为真不可解析 bindings 保留（flat 路径经 `hasUnsupportedSemantics` 同理由拒绝）。
- **连接**：CLI `pipeline`（list/show/start/status/resume/cancel）+ `pipeline-library`（init/validate/import/export/delete）直接消费；管理 API `/api/v1/pipelines` 消费 resolver/validator；`definition.ts` ECP v2 模型与 UI Canvas 共享做可视化编辑。

## `config-api/` — 配置 HTTP 路由（`/api/v1/*` 配置键 + 静态资产）

- **关键文件**：`router.ts`（`createRouter(context)`：method+path 派发）、`config-context.ts`（`resolveConfigContext`：project/space 寻址）、`wire-types.ts`（`WireConfigKeyDefinition`/`WireConfigEntry`，HTTP JSON 形，丢掉不可序列化的 `validate` 函数改派生 `constraints`）、`serialize.ts`、`global-write.ts`（`writeGlobalConfigKeyMinimalDiff`）、`project-addressing.ts`（`resolveProjectSelector`/`resolveSpaceSelector`）。
- **核心**：`ConfigApiContext = {token, launchProjectRoot, launchProjectRef, version, uiAssetsDir}`（server 启动时铸的 per-session bearer-token 上下文）。写 scope = `['global','store','project']`。
- **连接**：management server（`management-api/server.ts`）组合的两个路由组之一。`isManagementPath()` 路由到 management，其余落 config。

## `management-api/` — 管理路由（status/changes/runs/sessions/spaces/pipelines/workflows + 守护进程生命周期）

- **关键文件**：`router.ts`（`createManagementRouter`/`isManagementPath`）、`server.ts`（`startManagementServer`：`http.createServer`，loopback 绑定，组合两路由组；浏览器文档自动发 HttpOnly/Strict session cookie，`GET /api/v1/auth/session` 续签，非 loopback Host 403 防 DNS rebinding，`/p/config` 重定向启动项目；identity 头 `x-rasen-daemon`/`x-rasen-pid`，socket 跟踪 + 优雅关停，返 `ManagementServerHandle.stopServer()`）、`supervisor.ts`（`SessionSupervisor`：agent CLI 进程 spawn/kill-tree/监控；`createAgentCliResolver()` 解析调哪个 CLI binary）、`runs.ts`、`sessions.ts`、`reusable-session-api.ts`（`ReusableSessionService` 暖会话池：launch/list/retire/wake）、`workflows.ts`/`pipelines.ts`、`run-control.ts`（`RunControlSpawner`）、`wire-types.ts`（48KB，全部管理面 HTTP JSON 形 + `ApiErrorBody` 共享错误信封）。
- **Store aggregate 两族**：维护中的是 **flat 族**（`/api/v1/stores/{projects,target-lines,changes,issues,issue,issue-state,issue-references,execution-plan}` + Phase 7 的 `issue-projections`/`issue-projection`/`issue-attention`/`change-issue-links`），`space=store:<uid>` 寻址、`stores.ts` 的 `run()`/`statusForIssueCode` 统一错误映射、wire 类型 = core 类型 alias 的 unwrapped passthrough。`stores-routes.ts` 的 0.1.7-port 参数化族（手抄 `Wire*` + 粗错误映射）**弃用，不扩展**。
- **Issue 投影三条读（g-001）**：`handleStoreIssueProjections`/`handleStoreIssueProjection`/`handleStoreIssueAttention` 是 `src/core/issue-read/` 三个 compose 函数的透传——服务端零派生、零翻译层、零缓存，每请求重解 run-state（所以两次相同 GET 之间的 Store 变更不需要任何失效步骤就被第二次读到）。review **不设第四端点**：它是单 Issue 读载荷的 `review` 键（同一 status 同一派生）。`mapThrown` 的 `STATUS_FOR_STORE_ERROR_CODE` 表专收**不属于** `StoreIssueErrorCode` 闭 union 的拒收码（今天只有 `issue_attention_unknown_issue` → 404），否则它会落到 500 `store_query_failed` 把客户端错误报成服务端故障。**未知 Issue 的单 Issue 读不是拒收**——query 从不为找不到的 Issue 抛错，CLI 照样打印空记录读，故服务端加 404 会破坏 parity 要求。
- **Change↔Issue bulk 读（g-002）**：`handleStoreChangeIssueLinks` 直透 `issue-read/change-links.ts` 的 `composeChangeIssueLinks`；`GET /api/v1/stores/change-issue-links?space=store:<id-or-uid>` 返回 unwrapped `ChangeIssueLinksPayload` 直接 alias。它一次扫描 active/archive Change occurrence 与每个 Issue 的 latest readable plan，输出闭合 `linked|unlinked|unknown` + eligibility/completeness，不持有 cache/index；Operations 与 Unlinked 两页只消费该真值。
- **Execution Plan 条件发布（g-002）**：flat `POST /api/v1/stores/execution-plan` 的 request 增 `expectedRevisionId?: string|null`，边界只接受 omitted/null/四位 canonical id。Store Issue mutation 在同一 Issue lock 内比较 latest；stale 返回 409 `execution_plan_revision_conflict` 且零写，omitted caller 保持兼容。core/UI wire 的 node mirrors 列全 schema 字段，避免 aggregate attach 的完整图替换丢字段。
- **核心**：`ManagementApiContext`（扩展 `ConfigApiContext`）；`SessionSupervisor` 管理 agent CLI 进程；`ReusableSessionService` 跨 stage 复用会话。
- **config-api vs management-api**：config 处理配置键读写 + 静态资产（包 `resolveEffectiveConfig()`）；management 处理运营生命周期（changes/runs/sessions/spaces/pipelines/workflows/profiles，包会话监督/run-state/registries）。同一 HTTP server、同一 `ConfigApiContext`、同一 project-addressing，但独立路由组。
- **连接**：由 `rasen daemon` 命令（`commands/daemon.ts`）启动。`rasen session`（`commands/session.ts`）是对该 server 的 CLI 客户端。状态经 `daemon-state.ts` 持久化，`daemon-probe.ts` 探测。
