<!-- architecture-index skill · on-demand · 仅在 skill 触发且需要该域时按需 Read，勿整文件预载。 -->
# 模块索引：CLI 表面与命令

> `rasen` binary 的入口：Commander 程序树构建、本地化叠加、所有命令动作处理器。所有路径前缀 `src/`。

## `cli/` — Commander 程序树 + 本地化叠加（唯一入口）

- **`index.ts`**（~1146 行）：
  - `buildUnlocalizedProgram({locale, presentation})` — 构建完整 Commander `program` 树：所有命令（`init`/`update`/`migrate`/`list`/`view`/`archive`/`validate`/`show`/`feedback`/`completion`/`status`/`instructions`/`templates`/`schemas`/`new change`/`pipeline`（12 子命令）/`agent`（4 子命令）+ 注册的命令组 `config`/`ui`/`daemon`/`session`/`profile`/`scheme`/`knowledge`/`schema`/`store`/`bootstrap`/`doctor`/`context`/`workset`/`work`/`workflow-library`）。此阶段所有描述为空串，本地化后加。
  - `createProgram(options)` — 解析 CLI presentation（自 `core/completions/cli-presentation.ts`），建 unlocalized program，再 `applyCliPresentation(program, presentation)` 盖本地化描述。
  - `runCli(argv)` — 入口：adopt legacy data、解析 locale、建 program、解析 argv。
  - 全局 hooks：`preAction`（应用 `--no-color`、遥测通知（非 JSON）、跟踪命令执行）、`postAction`（关遥测）。
- **`commander-presentation.ts`** — `applyCliPresentation(program, presentation)`：locale/i18n 叠加层。遍历 Commander 树并断言**结构对等**（`preflightCommand`）：每个可见 option/positional/alias/子命令须与 presentation 定义精确匹配，否则抛 `CliPresentationError`。对等则写本地化描述/help/usage。
- **连接**：`rasen` binary 唯一入口（`bin/rasen.js` → `dist/cli/index.js`）。从 `src/commands/` 导入命令实现，从 `src/core/` 导入命令类（`InitCommand`/`UpdateCommand` 等）。presentation 系统（+ `core/completions/`）保证 help/补全/locale 目录与 Commander 树结构同步。

## `commands/` — 命令动作处理器（Commander parsed options ↔ core 业务逻辑之桥）

每个模块导出 `register*` 函数或 Command 类，`cli/index.ts` 建程序树时调用。命令经 `resolveRootForCommand()` 解析项目根，再委托 `core/` 模块。

**Pipeline / Workflow 库**：
- `pipeline.ts`（~123KB）— `PipelineCommand`：list/show/start/status/resumeRun/cancelRun/complete/control/agents/classify/resume。主编排 CLI 面。
- `pipeline-library.ts` — `PipelineLibraryCommand`：init/validate/import/export/save/delete。
- `workflow-library.ts` — `registerWorkflowLibraryCommand`：init/validate/import/export/save/delete（workflows），委托 `core/workflow-library.ts`。
- `pipeline-messages.ts` / `workflow-messages.ts` — i18n 消息 + 错误格式化。

**Session / Daemon**：
- `session.ts`（~33KB）— `registerSessionCommand`：exec/list/retire。management API reusable-session 服务的 CLI 客户端（HTTP 谈 daemon）。
- `daemon.ts`（~18KB）— `registerDaemonCommand`：run（前台）/start（detach spawn）/stop/status。管理 management server 生命周期。

**Config / Profile**：
- `config.ts`（~33KB）— `registerConfigCommand`：get/set/list/edit 跨 scope 配置键。桥 `core/config-keys.ts` + `core/effective-config.ts`。
- `profile.ts` / `profile-editor.ts` — `registerProfileCommand`：profile 选择与编辑（哪些 workflow 启用）。

**Store / Bootstrap**：
- `store.ts`（~53KB）— `registerStoreCommands`：setup/list/remove/add-project/doctor + `attention` 子命令（issue-needs-attention：跨 Issue needs-attention 扫描，store 级 fleet 读；per-Issue 组合复用 store-issue.ts 导出的 show 组合缝，只读）。管理 Rasen stores。
- `store-issue.ts` — `registerStoreIssueCommand`：`store issue new/list/show/state/plan/start/acceptance/accept`（Issue CRUD + 状态面 + 验收面；加子命令须三面同步：commander 树 + en/ja/zh-cn locale + completions `COMMAND_REGISTRY`，CLI 测试跑 dist/）。
- `bootstrap.ts` — `registerBootstrapCommand`：初始项目 setup。
- `store-migration.ts` — store 迁移工具（`registerArchiveRelocateSubcommand`/`registerHomeCommand`）。

**Work / Workset**：
- `work.ts` — `registerWorkCommand`：`work migrate`（legacy state 迁移）。
- `workset.ts` — `registerWorksetCommand`：管理 worksets（并行 change 上下文）。配套 `workset-input.ts`/`workset-prompts.ts`。

**Agent / 诊断 / 知识**：
- `agent.ts`（~24KB）— `AgentCommand`：dispatch/context/wait/audit。agent 运行时内省（`wait` 是 keepalive 薄消费者）。
- `doctor.ts`（~25KB）— `registerDoctorCommand`：健康诊断。
- `knowledge.ts`（~60KB）— `registerKnowledgeCommand`：知识库管理（list/show/apply/effective/retire/migrate/bundle）。

**其他**：`schema.ts`（spec schema 管理）、`validate.ts`（`ValidateCommand`：校验 specs/changes/pipelines）、`show.ts`（`ShowCommand`：显示内容）、`completion.ts`（`CompletionCommand`：shell 补全生成）、`context.ts`（上下文管理）、`change.ts`、`spec.ts`、`ui.ts`/`ui-launch.ts`（web UI 启动）、`feedback.ts`。

## `commands/workflow/` — artifact 驱动的 change 工作流（spec-driven 生命周期，非 library）

操作 artifact 驱动的 change 工作流（proposal→design→specs→tasks→implement→archive），**早于** pipeline 系统。

- **`index.ts`** — barrel：导出 `statusCommand`/`instructionsCommand`/`templatesCommand`/`schemasCommand`/`newChangeCommand`。
- **`instructions.ts`**（~22KB）— `instructionsCommand` + `applyInstructionsCommand`：取某 artifact 下一步指令或 apply 阶段指令。
- **`new-change.ts`** — `newChangeCommand`：scaffold 新 change（proposal/design/specs/tasks），可选 `--pipeline` 关联 pipeline。
- **`status.ts`** — `statusCommand`：显示某 change 的 artifact 存在与完整度。
- **`shared.ts`**（`DEFAULT_SCHEMA` + 共享解析）、`templates.ts`（`templatesCommand`）、`schemas.ts`（`schemasCommand`）。
- **连接**：直接注册在根 `program`（非子命令组下 — `rasen status`/`rasen instructions`/`rasen new change`/`rasen templates`/`rasen schemas`）。桥 `core/` change 管理，可经 `--pipeline` 与 pipeline 系统交互。
