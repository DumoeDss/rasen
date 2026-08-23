<!-- architecture-index skill · on-demand · 仅在 skill 触发且需要该域时按需 Read，勿整文件预载。 -->
# 模块索引：Skill 指令模板 / 主题 / UI

> **重要纠正**：`src/core/templates/` **不是** artifact 文件脚手架模板（proposal.md/tasks.md 等）。它是 **AI agent skill 指令模板** — 成为每个 rasen skill 的 `instructions` 正文的大段 markdown prompt 字符串。

## `core/templates/` — AI skill 指令模板（生成 SKILL.md 正文）

三层 skill 模型的**权威源**。每个 `get*SkillTemplate(): SkillTemplate` 返回一个 skill 的完整 prompt 指令。

- **顶层文件**：`types.ts`（`SkillTemplate = {name, description, instructions, license?, compatibility?, metadata?, disableModelInvocation?}`）、`skill-templates.ts`（兼容 facade，re-export 所有 `get*SkillTemplate()`）、`index.ts`（barrel）。
- **`experts/`（12 expert + `_shared.ts` + `index.ts`）**：每个 expert 一个文件导出 `get*SkillTemplate()` —— `review`/`cso`/`qa`/`benchmark`/`design-review`/`design-consultation`/`investigate`/`codex`/`chrome-use`/`careful`/`workflow-author`/`office-hours`。
  - **`_shared.ts`**（大文件）= 所有 expert 模板经模板字面量内插的**可复用 prose 常量**单一真相：`PREAMBLE`/`PREAMBLE_DIALOGUE`/`PREAMBLE_LITE`/`SEVERITY_VOCABULARY`/`DISPATCH_CONTRACT`/`ASK_USER_QUESTION_FORMAT`/`DIALOGUE_OVERRIDE`/`REPO_OWNERSHIP`/`COMPLETION_STATUS`/`BASE_BRANCH_DETECT`/`CHROME_USE_*`/`QA_METHODOLOGY`/`DESIGN_METHODOLOGY`/`ADVERSARIAL_STEP`/`SPEC_REVIEW_LOOP` 等。改一处全 expert 生效。
- **`workflows/`（27 workflow + `_orchestration.ts`）**：每个 workflow 一个文件 —— `propose`/`explore`/`new-change`/`continue-change`/`apply-change`/`ship`/`archive-change`/`bulk-archive-change`/`sync-specs`/`verify-change`/`verify-enhanced`/`review-cycle`/`auto`/`goal-command`/`goal-plan`/`goal-iterate`/`goal-report`/`handoff`/`audit`/`help`/`onboard`/`office-hours`/`direction`/`retain`/`retro`/`task-loop`/`change-context`/`feedback`/`store-selection`。
  - **`_orchestration.ts`**（很大）= 导出 `ORCHESTRATION_PLAYBOOK`（canonical LEAD 编排正文）+ 模块拆分系统（`splitCanonicalModules`/`OrchestrationFeatureSet`/`includesModule`/`renderOrchestration`），按 pipeline 类型（auto/goal/review-cycle）选 feature 子集。`OrchestrationFeatureSet` 切换 `persistentPlanner`/`stageMetadata`/`reviewLoop`/`goalLoop`/`portfolio`。
- **连接**：`workflow-registry/builtins.ts` 导入这些工厂函数并接到 CLI skill 注册。`rasen init`/`update` 时生成 `SKILL.md`（frontmatter + `instructions`）装入 `.claude/skills/rasen-*/`。

## `core/styles/` — 终端调色板

- **唯一文件**：`palette.ts` — `PALETTE` 对象，4 个 chalk 色函数：`white`(#f4f4f4)/`lightGray`(#c8c8c8)/`midGray`(#8a8a8a)/`darkGray`(#4a4a4a)。
- **连接**：被 `src/ui/welcome-screen.ts` 等 CLI 输出用。**与 theme-library（web UI 主题）无关**。

## `core/theme-library/` — 服务端主题校验 + 持久化（web UI 的 Node 侧）

- **关键文件**：`manifest.ts`（`ThemeManifest` schema + `validateThemeManifest()` + `THEME_TOKEN_DEFINITIONS` 27 个设计 token 闭词汇表）、`index.ts`（文件系统 op：`listImportedThemes()`/`installTheme()`）。
- **核心**：`ThemeManifest = {schemaVersion, id, name, mode, tokens:{light?,dark?}, effects}`。安全姿态偏执：拒符号链接、强制 `realpath` 容纳在 data root 内、文件 ≤256KB、原子 temp-file + 硬链接发布。`BUILT_IN_THEME_IDS = ['editorial','crt']`。
- **连接**：CLI 经 config API 暴露主题管理；`packages/ui` 经 `client.listThemes()` 取目录运行时应用。`ThemeManifest` 类型在 `packages/ui/src/theme/manifest.ts` **镜像（非 import）**使浏览器侧自包含。

## `ui/`（src/ui）— 终端欢迎动画

- **关键文件**：`ascii-patterns.ts`（`WELCOME_ANIMATION`：8 帧 Rasen 菱形 logo，Unicode 块字符 + Windows 非-WT 的 ASCII 回退）、`welcome-screen.ts`（`showWelcomeScreen()` async：左右并排布局 [动画 logo | 欢迎文]，等 Enter 键后清屏）。
- **连接**：onboard/setup 流程中交互工具选择前显示。用 `styles/palette.ts` 的 `PALETTE`。

## `packages/ui/` — `@atelierai/rasen-ui`（本地管理 Web App）

独立 npm 包。Preact SPA，由 `rasen ui` 服务（loopback + per-session token + same-origin API）。

- **关键文件**：`main.tsx`（DOM bootstrap）、`app.tsx`（`preact-iso` Router 路由壳，懒加载重 pipeline canvas）、`theme/runtime.ts`（**浏览器侧主题运行时**：`ThemeManifest` token → CSS custom properties on `document.documentElement`，自适应 light/dark，`activateTheme()`/`subscribeTheme()`/`initializeTheme()`）、`theme/manifest.ts`（自包含浏览器侧 schema/校验副本）、`api/client.ts`（同源 config API HTTP 客户端）、`canvas/PipelineCanvasPage.tsx`（`@xyflow/react` + `dagre` 的 pipeline DAG 编辑器）。
- **子目录**：`canvas/`（7 文件，pipeline 图编辑：`StageNode`/`PalettePanel`/`StagePanel`/`IssuesDrawer`/`DeclarationsPanel`/`EngineSupportPanel`/`V2NodePanel`/dagre `layout.ts`）、`components/`（~30 页面/widget）、`config/`、`i18n/`（6 文件）、`store/`（5 文件，Zustand）、`api/`。
- **App 路由**：Board / Config / Pipelines / Archive / Audit / Spaces / Workflows / Profiles / TaskDetail / IssueBoard / IssueDetail（后两者 store 空间专属 `/s/:storeId/issues[/:issueId]`，只读投影呈现，闭词汇→label 查表在 `components/issue-vocabulary.ts`，不派生任何轴）+ 懒加载 PipelineCanvas。
- **技术栈**：Preact + `preact-iso`、Vite、Vitest、`@xyflow/react`+dagre、Zustand。
- **连接**：`rasen ui` 服务其 build `dist/` 到随机端口 + token 认证 same-origin API。dev 下 `vite.config.ts` 代理 `/api/*` 到 `rasen ui --no-open`。主题流：`theme-library`（服务端校验+盘持久化）→ config API → `api/client.ts` → `theme/runtime.ts`（CSS 变量应用）。
