---
name: architecture-index
description: rasen 项目架构索引，用于定位代码文件和理解模块职责。当需要查找文件位置、定位功能代码、理解项目结构、理解 spec/store/change-run/workflow/pipeline/agent 集成/daemon/UI 时使用。触发词：文件在哪里、代码位置、模块、架构、定位、查找功能、spec、change、delta、archive、pipeline、workflow、skill、store、run-record、daemon、keepalive、token-audit、learned-skills。
---

# rasen 项目架构索引

> **薄索引（导航层）**：本文件是代码库的**地图**，不是百科全书。先在这里找到方向，再按需 `Read` `detail/` 下的子文件深入。**不要一次读完所有 detail/。** 详细模块索引已下沉到 `detail/modules/*.md`（按功能域）。

## 如何使用本索引

| 你的需求 | 先读哪里 |
| -------- | -------- |
| "X 功能的代码在哪？" / "我要改 X" | `detail/quick-locate.md`（一行一答的「我想修改...」表） |
| "改 X 涉及哪些文件？"（按功能域） | `detail/modules/<域>.md`（见下方「详细目录索引」清单） |
| 项目布局 / shipped skills & pipelines / `rasen/` 工作区 / 文档 | `detail/modules/project-layout.md` |
| CLI 命令、Commander 程序树 | `detail/modules/cli-commands.md` |
| 三层 skill 模型、SKILL.md 如何生成 | `detail/modules/templates-ui.md`（开头「三层 skill 模型」） |
| workflow vs pipeline vs skill 区别 | `detail/modules/workflow-pipeline.md`（开头「三者关系」） |

**工作流**：触发本 skill → 读本文件定位到域 → `Read` 对应 `detail/` 子文件 → 直接 `Read` 目标代码文件。只在索引不足时才 Grep/Glob。

---

## 项目是什么

**rasen**（`@atelierai/rasen`，npm）= 包在编码 agent 内层 loop 外的**自主 harness（外层 loop）**。你给意图（goal/bug/feature），harness 自己跑 propose → implement → review → fix → ship → archive，循环到完成。OpenSpec 的 fork，与 OpenSpec 命名空间隔离共存（`rasen` vs `openspec`、`/rasen-*` vs `/opsx:*`、`rasen/` vs `openspec/`）。技术栈：TypeScript（ESM）+ Commander.js + Zod + pnpm；Web UI = Preact + Vite。

## 当前架构结构（从外到内）

```
bin/rasen.js ──▶ dist/cli/index.js ──▶ src/cli/index.ts (Commander 程序树)
                                          │ applyCliPresentation 本地化叠加
                                          ▼
                                    src/commands/*.ts (动作处理器)
                                          │ resolveRootForCommand → 委托
                                          ▼
╔═══════════════════════════════════════════════════════════════════╗
║                         src/core/  (引擎)                          ║
║  A. Spec/Store/Artifact 引擎  (spec-driven 基石)                   ║
║  B. AI/Agent 集成             (驱动 Claude/Codex leaf-worker)      ║
║  C. Workflow/Pipeline/配置    (可安装能力 + 编排图 + 守护进程)       ║
║  D. 模板/主题                 (skill 指令模板 + web UI 主题)        ║
╚═══════════════════════════════════════════════════════════════════╝
      │                                    │
      ▼                                    ▼
  src/ui/ (终端欢迎动画)           packages/ui/ (@atelierai/rasen-ui web app)
  src/{prompts,telemetry,locales,utils}/  (支撑层)

shipped 内容: skills/ (sidecar) · pipelines/ (8 YAML) · schemas/spec-driven/
项目工作区:   rasen/ (dogfooding: specs/218 + changes/47活跃+335归档) · .rasen/ (次级根)
```

> `src/core/index.ts` = 公共 barrel，re-export：`global-config`/`store`/`codex`/`workflow-registry`/`workflow-package`/`workflow-library`/`threshold-*`/`runtime-adapters`/`change-run` + `references`/`planning-home`/`workspace-root`。

---

## 模块总览地图

### 入口 & CLI 表面

| 模块 | 一句话 |
|---|---|
| `src/cli/` | Commander 程序树构建（`buildUnlocalizedProgram`/`createProgram`/`runCli`）+ `commander-presentation.ts` 本地化叠加（结构对等校验） |
| `src/commands/` | ~40 命令动作处理器（pipeline/config/store/session/daemon/agent/knowledge/workflow-library…），Commander options ↔ core 逻辑之桥 |
| `src/commands/workflow/` | artifact 驱动 change 工作流（status/instructions/new-change/templates/schemas），注册在根 program |

### core/ — A. Spec/Store/Artifact 引擎 → `modules/spec-store-engine.md`

| 模块（`src/core/`）| 一句话 |
|---|---|
| `store/` | Store 抽象（git-backed、registry-tracked、永久 `uid`）；`resolveStoreBinding()` 三态零写 |
| `issue-status/` | Issue 三轴状态投影（phase×health×progress，读时推导不持久化；run-state 定位 + workspace index 加宽 + attribution） |
| `issue-execution/` | Issue 节点启动绑定（frontier 解析 + launch contract 输出，resolve+verify 不 spawn；七码 refusal 闭集） |
| `artifact-graph/` | 工作流 schema DAG（artifact 依赖序）+ 三层 schema 解析（project>user>package） |
| `schemas/` | Zod 校验 schema：Spec / Requirement·Scenario / Change·Delta |
| `validation/` | `Validator`：结构规则 + SHALL/MUST + delta 合法性 |
| `change-metadata/` | 每 change `change.yaml`（用哪个工作流 schema + goal + initiative） |
| `issue-status/` | Issue 三轴状态投影器（`phase×health×progress`，读时推导不持久化；import 只读复用 run-state readers + store query） |
| `change-run/` | **最复杂**。durable Run Record 引擎（reducer/reconciler/projector 事件溯源 + 全链摘要完整性） |
| `parsers/` | Markdown→领域对象（`MarkdownParser`/`ChangeParser`/`parseDeltaSpec`） |
| `converters/` | spec/change → JSON 导出（`JsonConverter`，叶子模块） |
| `shared/` | 工具检测 + skill 生成 + YAML 转义（服务 `init`/`update` 脚手架） |

### core/ — B. AI/Agent 集成 → `modules/ai-integration.md`

| 模块（`src/core/`）| 一句话 |
|---|---|
| `claude/` | Claude Code leaf-worker 派发（`claude -p` + FLAT_HIERARCHY_GUARD + 单 writer 锁） |
| `codex/` | Codex leaf-worker 派发（`codex exec` + 线程生命周期 + warm-seed 蒸馏） |
| `hermes/` | Hermes agent home 发现（未来第三后端 stub） |
| `completions/` | Shell 补全（zsh/bash/fish/PS）+ 动态 change/spec/schema ID 补全 + `COMMAND_REGISTRY` |
| `keepalive/` | prompt-cache 保活 beat（270s beat / 12-beat 上限 / 信号文件） |
| `knowledge-bundle/` | 可移植 `.bundle.json` learned-skill 传输（含机器路径守卫） |
| `learned-skills/` | learned skill 生命周期（项目/全局/store 目录；两阶段写 + effective 解析） |
| `token-audit/` | token 花费审计（Claude/Codex/Zed + cache-churn 分类） |

### core/ — C. Workflow/Pipeline/配置 → `modules/workflow-pipeline.md`

| 模块（`src/core/`）| 一句话 |
|---|---|
| `workflow-registry/` | 可安装 workflow 目录（built-in + user；`kind: task\|driver\|internal\|expert`） |
| `workflow-package/` | `.rasenpkg` 编解码 + 事务性两阶段安装 |
| `pipeline-registry/` | 编排 pipeline 定义/校验/解析/run-state + ECP v2 定义图（Canvas 共享缝） |
| `config-api/` | `/api/v1/*` 配置键 HTTP 路由 + 静态资产 |
| `management-api/` | 管理路由（status/changes/runs/sessions/spaces/pipelines/workflows）+ daemon server + session 监督 |

### core/ — D. 模板/主题 → `modules/templates-ui.md`

| 模块 | 一句话 |
|---|---|
| `core/templates/` | **AI skill 指令模板**（生成 SKILL.md 正文；`_orchestration.ts`=LEAD playbook、`experts/_shared.ts`=共享 prose） |
| `core/styles/` | 终端调色板（4 色 chalk） |
| `core/theme-library/` | web UI 主题服务端校验 + 持久化（27 token 闭词汇表） |

### UI

| 模块 | 一句话 |
|---|---|
| `src/ui/` | 终端欢迎动画（ASCII 8 帧） |
| `packages/ui/` | `@atelierai/rasen-ui` Preact web app（Board/Canvas/Config/Sessions，`rasen ui` 服务） |

### Shipped 内容 & 工作区 → `modules/project-layout.md`

| 路径 | 一句话 |
|---|---|
| `skills/` | shipped **sidecar** 内容（参考文件/脚本，**不含** SKILL.md） |
| `pipelines/` | 8 个 pipeline YAML（full-feature/small-feature/bug-fix/auto-decompose/task-loop/goal-loop-*） |
| `schemas/spec-driven/` | 默认 artifact 工作流 schema（proposal→specs→design→tasks） |
| `rasen/` | 项目自身 dogfood 工作区（specs/218 + changes/47 活跃+335 归档 + work/initiatives/…） |
| `.rasen/` | 次级运行时/隔离根（少数活跃 change） |
| `docs/` | 用户/开发者文档（关键：overview/concepts/cli/agent-contract/architecture/） |

---

## 详细目录索引（按需阅读）

> 以下文件仅在需要时 `Read`，勿整文件预载。路径前缀 `.claude/skills/architecture-index/`。

| 文件 | 覆盖功能 |
|---|---|
| `detail/quick-locate.md` | 「我想修改...」一行一答定位表 |
| `detail/modules/spec-store-engine.md` | Store、artifact-graph DAG、schemas、validation、change-metadata、change-run（Run Record）、parsers、converters、shared |
| `detail/modules/ai-integration.md` | Claude/Codex/Hermes 派发、shell 补全、keepalive beat、knowledge-bundle、learned-skills、token-audit |
| `detail/modules/workflow-pipeline.md` | workflow-registry、workflow-package、pipeline-registry（ECP v2）、config-api、management-api/daemon |
| `detail/modules/cli-commands.md` | `src/cli/`（Commander）、`src/commands/`（命令组）、`commands/workflow/`（artifact 工作流） |
| `detail/modules/templates-ui.md` | skill 指令模板、终端调色板、主题库、`src/ui`、`packages/ui`（web app） |
| `detail/modules/project-layout.md` | 三层 skill 模型、`skills/`/`pipelines/`/`schemas/`、`rasen/` 工作区、`.rasen/`、`docs/`、顶层基础设施、`src/` 支撑层 |

---

## 索引维护规则

当完成以下操作后，**必须**同步更新本索引：

- 新增 / 重命名 / 移动 / 删除 core 子模块、命令、router 端点、shipped pipeline/skill
- 新增 core 子目录 → 加进上方「模块总览地图」对应分组表 + 在 `detail/modules/<域>.md` 加节
- 新增 CLI 命令或子命令 → 同步 `detail/modules/cli-commands.md` + `detail/quick-locate.md`
- 新增 shipped pipeline → `detail/modules/project-layout.md` 的 pipeline 表

更新遵循渐进式：先更 `detail/quick-locate.md` 和上方「模块总览地图」，再按域更 `detail/modules/<域>.md`。**保持索引精简**——本 SKILL.md 只放导航 + 派发表，逐文件说明默认进 `detail/` 子文件，勿堆回本文件。
