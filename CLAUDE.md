# Rasen 项目文档

本文档只保留**每次任务都必须知道**的护栏与定位。详细规范按需加载自 `.claude/skills/`。

**可用 Skill**（按需触发）：`architecture-index`（文件定位/架构/模块职责）。

---

## 两条硬护栏（每次都遵守）

1. **探索/定位代码先查 `architecture-index` skill**——别上来就 Grep/Glob。索引里有「快速定位指南」(`detail/quick-locate.md`) + 按域的模块说明 (`detail/modules/*.md`) + 模块总览地图。只有索引没覆盖、或要查某变量/函数的所有引用时才搜索。

2. **`src/core/templates/` 不是文件脚手架模板**——它是 **AI skill 指令模板**（生成装进 `.claude/skills/rasen-*/SKILL.md` 的 `instructions` 正文）。要改某 skill 的行为，改 `src/core/templates/experts/<x>.ts` 或 `workflows/<x>.ts`（不是 `.claude/skills/` 里已生成的文件，那是产物、会被 `rasen update` 覆盖）。改全部 expert 共享的 preamble/词汇改 `experts/_shared.ts`；改 LEAD 编排改 `workflows/_orchestration.ts`。

---

## 项目概述

**rasen**（`@atelierai/rasen`）= 包在编码 agent（Claude Code / Codex）内层 loop 外的**自主 harness（外层 loop）**。给意图 → 自跑 propose → implement → review → fix → ship → archive。OpenSpec 的 fork，命名空间隔离共存。技术栈：TypeScript（ESM）+ Commander.js + Zod + pnpm；Web UI = Preact + Vite。

## 架构分层（详见 `architecture-index` skill）

```
bin/rasen.js → src/cli/ (Commander 程序树 + 本地化) → src/commands/ (动作处理器)
                                                          ↓
                                       src/core/ 引擎:
                                         A. Spec/Store/Artifact  (store, artifact-graph, schemas, validation, change-run)
                                         B. AI 集成              (claude, codex, keepalive, token-audit, learned-skills)
                                         C. Workflow/Pipeline    (workflow-registry, pipeline-registry, config-api, management-api)
                                         D. 模板/主题            (templates=skill 指令, theme-library)
                                       src/ui/ (终端) · packages/ui/ (web app)
shipped: skills/ (sidecar) · pipelines/ (8 YAML) · schemas/spec-driven/
工作区:  rasen/ (dogfood: specs + changes) · .rasen/ (次级根)
```

## 几个易混概念

- **workflow** = 可安装能力单元（生成一个 skill），`kind: task|driver|internal|expert`。
- **pipeline** = 编排 DAG（stages 引用 skill 名 + roles + gates + loops），被 `/rasen-auto` 的 LEAD 驱动。
- **skill** = 生成的 `SKILL.md`（Claude Code 实际执行），由 `src/core/templates/*.ts` 生成，**勿手改 `.claude/skills/`**。
- **spec** = `rasen/specs/`（当前行为真相）；**change** = `rasen/changes/`（提议修改，含 delta）；**delta** = ADDED/MODIFIED/REMOVED/REMOVED。
- **config-api vs management-api**：前者配置键读写 + 静态资产；后者运营生命周期（runs/sessions/spaces），同一 daemon server。
- `src/ui/`（终端欢迎动画）≠ `packages/ui/`（`@atelierai/rasen-ui` web app）。

---

## 维护索引（改完代码必做）

- 新增 / 重命名 / 移动 / 删除 core 子模块、命令、router 端点、shipped pipeline/skill → 同步更新 `architecture-index` skill：定位表进 `detail/quick-locate.md`，模块说明进 `detail/modules/<域>.md`，仅新增顶层分组时动 `SKILL.md` 的地图与清单。
- **保持索引精简**：`SKILL.md` 与本文件只放**护栏 + 派发表**；逐文件说明、类型清单、机制详解默认进对应 `detail/` 子文件按需加载，勿堆回常驻主文件。
