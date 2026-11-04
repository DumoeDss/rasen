<!-- architecture-index skill · on-demand · 仅在 skill 触发且需要该域时按需 Read，勿整文件预载。 -->
# 模块索引：项目布局 / Skills / Pipelines / 文档

> 仓库顶层与 `src/` 之外的目录：shipped 内容、项目工作区、文档、基础设施、`src/` 支撑层。

## 三层 skill 模型（`templates/*.ts` → `skills/` → `.claude/skills/`）

1. **`src/core/templates/{experts,workflows}/*.ts`** — **权威源**。TS 函数生成 `SKILL.md` 的 `instructions` 正文。如 `getReviewSkillTemplate()` 产 review skill 指令。
2. **`skills/`（shipped）** — **sidecar 内容**（参考文件/脚本/checklist），随 npm 包分发。每目录只放补充文件，**不含** `SKILL.md`（那是生成的）。如 `skills/experts/review/` 有 `checklist.md`/`design-checklist.md`；`skills/workflows/rasen-apply-change/` 有 `references/tdd/`。
3. **`pipelines/`（shipped）** — YAML 定义，**按名引用 skill**（`skill: rasen-propose`），无 skill 内容，只编排。
4. **`.claude/skills/rasen-*`（installed）** — `rasen init`/`update` 产出的**运行时产物**：生成的 `SKILL.md`（frontmatter 嵌 `generatedBy` 版本）+ 拷贝的 sidecar。这是 Claude Code 运行时实际读的。

> **流程**：`templates/*.ts`（码）+ `skills/`（sidecar）打进 npm 包 → `rasen init` 从模板生成 `SKILL.md`、拷 sidecar、装入 `.claude/skills/rasen-*/`。`pipelines/` 按名引用这些 skill，由 `/rasen-auto` 选择驱动。

## `skills/` — shipped sidecar 内容

- **`experts/`**（7 域）：`careful/`（`bin/check-careful.sh`）、`chrome-use/`（`scripts/cdp-proxy.mjs`/`match-site.mjs`/`check-deps.mjs` + `references/cdp-api.md`）、`investigate/`（`scripts/hitl-loop.template.sh`）、`qa/`（`references/issue-taxonomy.md` + `templates/qa-report-template.md`）、`review/`（`checklist.md`/`design-checklist.md`/`greptile-triage.md`/`TODOS-format.md`）、`workflow-author/`（`references/workflow-review/`）、`docs/`（`AGENTS.md`）。
- **`workflows/`**（5 域）：`rasen-apply-change/`（`references/tdd/`）、`rasen-explore/`（`references/prototype/`）、`rasen-help/`（`references/navigator.md`）、`rasen-propose/`（`references/codebase-design/`）、`rasen-retain/`（`codify.md`/`report.md`）。

## `pipelines/` — shipped workflow pipelines（8 个）

每个一个 `pipeline.yaml`：

| Pipeline | stages 摘要 | 用途 |
|---|---|---|
| `full-feature` | office-hours→propose→apply→[review,cso,benchmark,design-review,qa] 并行→review-loop(≤3)→ship→retain→archive | 最全；专家 review 经 `condition:` 条件触发 |
| `small-feature` | propose→apply→verify→review-loop→ship→archive | 轻量；分类器默认选它 |
| `bug-fix` | propose→apply→verify(自适应)→ship→archive | 最小 |
| `auto-decompose` | decompose(LEAD 门控可选)→propose→apply→verify→review-loop→ship→archive | 评估是否拆成多个子 change，各跑 `small-feature` |
| `task-loop` | iterate(goal-loop, evaluate 门)→ship→archive | spec-free；builder+critic 循环；**仅经 `/rasen-auto`**，分类器从不选它 |
| `goal-loop-measure` | define-goal→iterate(measure 门)→ship→retain→archive | 可测代码目标（perf/score） |
| `goal-loop-evaluate` | define-goal→iterate(evaluate 门)→ship→retain→archive | judge 评分目标 |
| `goal-loop-research` | define-goal→iterate→ship→report→archive | 研究任务；产报告非码 |

> stage 引用 skill 名 + role（planner/implementer/reviewer/fixer/shipper）+ 可选 `gate`/`condition`/`parallelGroup`/`loop`/`model`。LEAD 读这些编排全流。

## `schemas/spec-driven/` — 默认 artifact 工作流 schema

- `schema.yaml`（定义 artifact 序列：proposal→specs→design→tasks 的依赖图）、`templates/`（每 artifact 的 prompt 模板）。`rasen init` 装它，artifact 工作流读它。

## `rasen/` — 项目自身工作区（rasen dogfooding 自己）

rasen 项目用 rasen 管理自己的开发。spec-driven 工作区：

- **`specs/`** — **218 spec 域**（rasen 当前如何工作的真相）：`artifact-graph`/`autopilot-gate-policy`/`branding-migration`/`bundle-import-crash-consistency`/`canonical-severity-vocabulary` 等。
- **`changes/`** — **47 活跃** + **`archive/` 335 已归档**（日期戳文件夹）。活跃如 `ecp-run-spine`/`executable-composite-pipelines`/`goal-loop`/`file-placement-hardening`/`fork-phase1`。
- **`explorations/`**（6 探索文档）、**`handoff/`**（会话交接文档）、**`initiatives/`**（长寿命 workstream 规划）、**`office-hours/`**（产品验证文档）、**`work/`**（战略规划：`issue-centered-automation-platform/`、`direction-workflow/`、`simplify-context-and-workspace-model/`）。
- **`config.yaml`** — 项目实际配置（`context:` 填 TypeScript/Node/pnpm/Commander、`rules:`、`projectId` UUID、`handoff.threshold:0.7`、`tools:[claude,codex]`）。**根 `config.yaml` 是空模板**（`schema: spec-driven` + 注释示例，`rasen init` 为新用户创建的脚手架）。
- **vs `src/`**：`src/` 是实现 CLI 的**码**；`rasen/` 是描述工具行为、在飞 change、特性应如何的**规范与规划工作区**。agent 在做 rasen change 时消费 `rasen/specs/` 的行为契约。

## `.rasen/` — 次级运行时根

- 轻量运行时/隔离工作区（仅 `changes/add-gauntlet-loop`/`add-task-loop-pipeline` 等少数活跃 change）。rasen CLI 按 root 优先级链解析（见 `docs/agent-contract.md`）。`rasen/` 是主提交工作区；`.rasen/` 是次级/并行/scratch 根。

## `packages/ui/` — management Web app

- Project 的 canonical home 是 `/p/:projectId/board`，`BoardPage.tsx` 与 Task Detail 只拥有 project Change/Run 面；Store 的 canonical home 是 `/s/:storeId/issues`，并以 Store-only Issue Detail、Operations、Unlinked Changes 分别拥有读面、执行与关联。
- `store/use-space.ts` 的 `spaceHomeHref`/`spaceSwitchHref` 集中维护类型感知 home/switch；common Config/Archive/Pipelines 可跨 namespace 保留，Issues/Operations/Unlinked 只在 Store→Store 保留，其他情况回 destination home。
- Issue provenance 是 `components/issue-provenance.ts` 对既有 projection/attention payload 的 render-time 映射，不是缓存或第二真相。旧 `StoreIssuesView`、`StoreAggregateBoard`、`RunningSessionsMenu` 及其专属 presentation/test assets 已删除。

## `docs/` — 文档（关键架构/概念文档）

| 文档 | 覆盖 |
|---|---|
| `overview.md` | 一屏心智模型：五核心概念（specs/changes/delta specs/artifacts/archiving）+ 日常工作流环 |
| `concepts.md` | 深度哲学 + specs 结构 + change 生命周期 + delta 格式 + **执行模型（workflow=内层 loop / pipeline=外层 loop）** + `kind`（task/driver/internal/expert） |
| `workflows.md` | 常见工作流模式：core vs full profile、explore→propose→apply→sync→archive 节奏 |
| `artifact-workflow.md` | artifact 工作流：schema.yaml、templates、profile 选择（core/full） |
| `cli.md` | 全 CLI 命令参考（flags + JSON 输出形） |
| `skill-authoring.md` | skill 编写标准：调用模式、description、信息层级、progressive disclosure |
| `workflow-packages.md` | `.rasenpkg` 可安装包契约（workflow.yaml/SKILL.md 生成/digest/版本） |
| `agent-contract.md` | CLI 的机器可读面：JSON 输出形、诊断信封、**root 选择优先级**、store/project 解析 — agent 依赖的契约 |
| `autopilot.md` | `/rasen-auto` 策略轴：gate/selection/run-engine |
| `architecture/executable-composite-pipelines.md` | ECP 架构：pipeline plan 的确定性 Run 拥有者（reconciler 引擎、immutable Run Record） |
| `review-cycle-workflow-design.md` | review→triage→fix→re-review 循环设计 |
| `retention-and-learned-skills.md` | retention 系统：完成的工作如何蒸馏成 learned skills |

> 另：`docs/zh/`（中文翻译）、`docs/codex-parity/`（Codex CLI 特性对等实验）、`docs/stores-beta/`（stores 特性）。

## 顶层基础设施

- **`bin/rasen.js`** — shebang 入口，import 调 `runCli()`（自 `dist/cli/index.js`）。
- **`build.js`** — 清 `dist/`、跑 `tsc`、报成功/失败（31 行）。
- **`hooks/`** — Claude Code 会话生命周期 shell hooks：`compact-recovery.sh`（上下文压缩后恢复）、`safety-check.sh`（预执行安全校验）。
- **`scripts/`** — dev/release/QA 工具：构建发布（`pack-version-check.mjs`/`release-contract.mjs`/`paired-pack-check.mjs`/`npm-command.mjs`）、skill 开发（`dev-skill.ts`/`skill-check.ts`）、postinstall（`postinstall.js`）、子目录（`local-version/`/`repo-hygiene/`/`session-cache-acceptance/`/`token-audit/`）、`update-flake.sh`（Nix）。
- **`.githooks/pre-commit`**、`.github/`（CODEOWNERS + CI）、`.codex/`（Codex CLI 配置）、`.rasen-worktrees/`（并行 agent worktree 隔离）。

## `src/` 支撑层

- **`prompts/`** — 交互 prompt UI（`searchable-multi-select.ts`）。
- **`telemetry/`** — 匿名用量分析（`config.ts`/`index.ts`，fire-and-forget HTTPS POST，隐私优先，`RASEN_TELEMETRY=0`/`DO_NOT_TRACK=1` opt-out，CI 自动禁）。
- **`locales/`** — i18n（`en.json`/`ja.json`/`zh-cn.json`/`index.ts`，CLI 消息）。
- **`utils/`** — 12 模块：`file-system.ts`/`interactive.ts`/`shell-detection.ts`/`locale.ts`/`match.ts`/`terminal-text.ts`/`task-progress.ts`/`item-discovery.ts` 等。
