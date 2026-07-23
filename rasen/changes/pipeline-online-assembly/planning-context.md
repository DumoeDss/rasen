# Planning context — pipeline-online-assembly (portfolio parent)

## User intent
Pipeline 在线组装：Pipelines 页可视化画布（节点流工具式），把 workflow 组装成 pipeline。前置：统一 pipeline HTTP API，并朝"daemon 可部署到远程服务器"的目标收敛（单一 API 面/token/信封）。画布选型已拍板：**React Flow v12 + preact/compat + 路由级懒加载**。

## Decided plan (user-approved, 2026-07-23)
4 个子 change，严格串行（每个依赖前一个）：
1. **unify-pipeline-http-api** — `/api/v1/pipelines` GET+POST 从 config-api router 硬移入 management router（加 MANAGEMENT_PATHS + pipeline-id matcher，新 management-api/pipelines.ts handler）；WirePipeline*/PipelineMutationRequest 迁入 management-api/wire-types.ts（消费方仅两 router+pipeline-submit，无需 shim）；抽共享模块：resolveConfigContext/pipelineResolutionBundle 从 config-api router 移出（move 不 copy）；统一错误信封=management 风格 + 可选 `fix` 字段并入；退役 test-only startConfigApiServer。stage 配置覆盖键（pipelines.<name>.gates.<stage>）留在 config-api。对外零迁移（单服务器，config router 是 management server 的 fall-through 委托——management-api/server.ts:87-97）。
2. **pipeline-definition-api** — `GET /api/v1/pipelines/<name>`（resolved 视图 + 可往返 WirePipelineDefinition；内置 pipeline 只读返回）；`POST /api/v1/pipeline-validation`（进程内 dry-run，200-with-issues，跑 Zod→结构校验含环检测→执行前置 skill 启用检查）;save：POST /api/v1/pipelines 新 op:'save'（新 `rasen pipeline save` CLI 子命令 + save-pipeline whitelist 行 + server 临时文件交接，Windows 文件锁注意）；`GET /api/v1/pipeline-catalog`（词汇表：可用 skill、role/loop.kind/condition/verifyPolicy 枚举——独立路径防与名为 catalog 的 pipeline 撞路由）。JSON⇄YAML 往返承诺（save 需要）。
3. **pipeline-canvas-view** — Pipelines 页只读 DAG 可视化：React Flow v12 (@xyflow/react) + preact/compat（vite alias react/react-dom/jsx-runtime → preact/compat，demo 已实测全绿）+ 路由级懒加载（画布 chunk 仅编辑视图加载）；dagre LR 自动布局；节点=stage 卡片（role 徽章/gate 图标，走现有 UI 设计语言）；parallelGroup 用 subflow 分组表达。参考 demo：rasen/office-hours/canvas-demos/react-flow/。
4. **pipeline-canvas-edit** — 画布编辑：拖放组装（palette=catalog 端点数据）、连线/删线、客户端环检测即时反馈（服务端 dry-run 为权威）、校验错误上图（issue→节点/边高亮）、保存（save op）。质量底线：UI 产 pipeline 的 origin 章与 validateComposedPolicyFloor 适配在 child 2 设计时定。

## Constraints
- 设计稿（已被 4 点计划取代但研究事实仍有效）：rasen/office-hours/pipeline-http-unification.md；demo 三份在 rasen/office-hours/canvas-demos/。
- core wire-types 与 packages/ui 镜像必须同步改（漂移教训）；跨平台路径；版本号归用户管。
- 6 个 OQ 已裁决：信封=management+可选 fix；校验=独立路径；save=CLI 桥；内置只读=是；JSON⇄YAML=承诺；test-only server=退役。
- 远程部署的 TLS/鉴权加固**不在本 portfolio 范围**。

## Durable findings (planner-1, child 1 propose, 2026-07-23)
- **信封统一实为收敛而非改型**：两组信封形状已同为 `{ error: { code, message, fix? } }`（config-api wire-types.ts:75 / management-api wire-types.ts:33，后者另有 cliExitCode/stderr）；差异只在 management `sendError`(router.ts:250) 从不发 fix。child 1 给它加可选 fix 参数（additive-only）。child 2-4 一律用 management 信封类型作 canonical。
- **`matchPipelineIdPath` 在 child 1 就加**（镜像 matchWorkflowIdPath，router.ts:122，一段深）；child 1 内保留段答 management 404 `not_found`，child 2 的 `GET /api/v1/pipelines/<name>` 直接填 handler，不再动路径匹配。`/api/v1/pipelines/x/y` 继续 fall through。
- **共享 seam 落点定为新模块 `src/core/config-api/config-context.ts`**（非 effective-config.ts）：resolveConfigContext(router.ts:212)/contextResolveOptions(:261)/pipelineResolutionBundle(:401)/ConfigContext。child 2 的 detail/validation handler 直接 import 此模块。
- **child 2 的四端点全部落 `src/core/management-api/pipelines.ts`**（child 1 创建，含 GET 列表+POST dispatch）；wire types 新家=management-api/wire-types.ts，无 shim。
- config-http-api spec 对 pipelines 的提及仅为配置键（gates/models/handoff 覆盖，:168-198），无陈旧端点条款——child 1 不需要 config-http-api delta。
- management-http-api 既有条款 "Loopback and bearer security..." 已列 `POST /api/v1/pipelines` 于 CLI-bridge 清单，故 child 1 delta 用 ADDED（pipeline paths 条款镜像 workflow paths 条款）而非 MODIFIED。

## Durable findings (planner, child 2 propose, 2026-07-23)
- **origin 章已拍板**：`origin` 由 `z.literal('composed')` 扩为 `z.enum(['composed','ui'])`（types.ts:416）；质量底线（≥1 reviewer 角色 stage + ≥1 loop.kind:review-cycle）适用于任何 origin 章（floor 改为 origin-presence-scoped），无 origin 的手写 YAML 完全不受影响=逃生门。**child 4 的画布保存时客户端给 definition 盖 `origin:'ui'`**；`pipeline save` CLI 原样保留 origin、自己不盖章。
- **floor 违规在 validation 端点作普通 error issue 上报**（编辑器实时提示），save 才硬拒——child 4 编辑器应先调 validation 再 save。
- **child 3/4 的 UI 契约锚点**：`PipelineDetailResponse { pipeline, definition, editable }`（built-in 可读 editable:false）；`PipelineValidationResponse { valid, issues:[{severity:'error'|'warning', path:'/stages/2/skill', message}] }`（200-with-issues，issue.path=JSON-pointer-ish 可直接映射到画布节点/字段高亮）；catalog 含 skills(id/description/enabled)+roles/runtimes/stageKinds/loopKinds/verifyPolicies/conditionLabels+gate.default+handoff 约束，palette 用 enabled 灰显。**UI mirror（packages/ui/src/api/types.ts）本 change 有意不动**——由首个消费的 child（3/4）同步补，勿在 review 中误判为漏。
- **枚举实况**（catalog 数据源，来自 Zod schema .options 勿重打字面量）：roles=planner/implementer/reviewer/fixer/shipper；runtimes=claude/codex；stageKinds=standard/decompose；verifyPolicies=adaptive/standard/light；condition 是自由文本，惯例标签 always/security-relevant/performance-sensitive/ui/non-ui 仅作建议。
- **floor/origin 的 spec 家在 opsx-pipeline-registry**（非 autopilot-composed-pipelines——后者只述 LEAD 组装行为，未动）；save CLI 以 ADDED 独立条款进 opsx-pipeline-registry，未改既有 CLI Surface 枚举条款。
- validation/catalog 走独立顶层路径（`/api/v1/pipeline-validation`、`/api/v1/pipeline-catalog`）防与同名 pipeline 撞路由；两者不占 bridge cap-1 槽。

## Durable findings (planner, child 3 propose, 2026-07-23)
- **画布挂载已定：专属懒路由** `/p/:id/pipelines/:name`、`/s/:id/pipelines/:name`（preact-iso `lazy()` 做 chunk 边界），非列表页内展开；PipelinesPage 每节加 "View graph" 入口（name 需 percent-encode）。
- **关键 wire 事实**：resolved `WirePipelineStage`（wire-types.ts:56）**无 requires/parallelGroup**——DAG 边和分组只能取自 detail 的 `definition`；节点徽章（effectiveGate/model/handoff/runtime）按 stage id 与 `detail.pipeline.stages` join。
- **alias 是 app 级 vite 决策**：react/react-dom/react-dom/test-utils/react/jsx-runtime → preact 等价物（demo 原配置），tsconfig `paths` 同步映射供 typecheck；今天只有 @xyflow/react 经此解析。破 compat 的兜底=canvas 子树 React island（文档在 demo README，不改画布代码）。
- **mirror 策略**：child 3 一次性全量声明 `WirePipelineDefinition`/`WirePipelineDefinitionStage`（含全部 loader 字段）+`PipelineDetailResponse` 进 packages/ui/src/api/types.ts——**child 4 不再动 definition 的 mirror**；validation/catalog 形状仍未 mirror（child 4 是首消费者，届时补）。
- **canvas 模块边界**（child 4 在此之上加交互）：`packages/ui/src/canvas/{PipelineCanvasPage,StageNode,layout}`；`layout.ts` 纯函数（definitionToGraph+dagre LR+parallelGroup 事后包围盒 parentId 分组），不含 JSX，单测锚点。
- **只读姿态**：fitView+zoom/pan+Controls+Background；nodesDraggable/Connectable=false、elementsSelectable=true；无 minimap（小图，child 4 编辑器需要再加）；布局拥有坐标，无位置持久化。
- **jsdom 测试分层**：真 canvas 不在 jsdom 渲（缺 ResizeObserver/DOMMatrix）——layout 纯函数测逻辑、page 测 mock 掉 flow、build manifest 断言 chunk 分离；真浏览器渲染验证归 child 4 的 rasen-qa。
- 新依赖：@xyflow/react、dagre(+@types/dagre)；pipelines-ui delta 为 ADDED 两条款（graph view + lazy chunk），未动既有条款（"validation 无 UI 面"条款 child 4 需 MODIFIED）。

## Durable findings (planner, child 4 propose, 2026-07-23 — portfolio propose 完结)
- **编辑器共存已定：同路由页内模式切换**（非 /edit 子路由）——单 chunk/单 fetch/单 editable 守卫，脏态导航守卫不跨路由；新草稿走 **name-first 对话框 + 内存 pending-draft hint**（无保留 URL 段，名为 `new` 的 pipeline 不被遮蔽）；硬刷新未保存草稿退化为 404+"Start assembling" 恢复入口（有意为之）。built-in 视图加 "Duplicate to edit"（seed 其 definition 换名新草稿）。
- **draft.ts 纯模块是编辑核心**：draft=完整 WirePipelineDefinition（非 flow 节点态），所有变更 spread-patch——未暴露字段（goal-loop gate/sessionReuse/sandbox/effort/agents/reuse）逐字保留，专项测试断言 save body 中原样；issuePathTarget 按 draft stage 顺序解析 /stages/<i>，不可映射 issue 降级进 drawer 不丢弃。
- **编辑面**：左 palette（disabled skill 灰显且不可拖）+右 StagePanel（词汇全取自 catalog 响应）+IssuesDrawer；loop 仅 review-cycle kind+maxRounds 可编，goal-loop 只读保留；坐标 session-only 不持久化（YAML 无布局节）；parallelGroup 改动=全量 re-layout（接受跳变，保 group-before-member/parentId/extent 契约）。
- **save UX**：validate 前置硬门（error 阻断，floor 违规必先在此现身）；origin:'ui' 在 save 边界盖章；422 撞名→显式 Overwrite 重试（import 对话框先例）、422 其他→verbatim、409 busy→手动重试不自动循环。
- **无 undo/redo、无 localStorage 草稿持久化**——明确列为 future work 非半成品；Discard 为逃生门。
- spec 基线注意：child 4 的 pipelines-ui delta MODIFIED 了 child 3 的 ADDED 条款（graph view 条款改为 view-mode-scoped read-only）与既有 library 条款（save/validation 的 UI 面归画布编辑器）——archive 同步时 child 3/4 delta 需按序叠放。
- 4/4 children 已全部 propose 完成（本条目后 planner 无遗留 propose 义务）。
