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
| `rasen store` 命令 | `src/commands/store.ts` |
| `rasen store issue` 命令（Issue CRUD + 状态面） | `src/commands/store-issue.ts` |
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
