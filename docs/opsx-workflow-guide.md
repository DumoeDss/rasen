# OPSX 工作流指南：一键跑完 + 分阶段命令

> 日期：2026-05-30 · 适用：OpenSpec（OPSX 工作流）
> 相关参考：[`commands.md`](./commands.md)（每条命令的详细 reference）、[`workflows.md`](./workflows.md)（模式与时机）、[`cli.md`](./cli.md)（终端 CLI）、[`review-cycle-workflow-design.md`](./review-cycle-workflow-design.md)（review-cycle 设计）。
>
> 本文从「整条流水线」的视角，把当前 OPSX 工作流讲清楚：先给**一条命令端到端跑完**的用法，再给**每个阶段单独的命令**，最后是它们底下依赖的 **CLI 命令**、profile 开关与完整示例。

---

## 1. 工作流全景

OPSX 把「一个需求 → 已实现、已审查、已验证、已交付、已归档」拆成若干阶段。每个阶段既可以由 autopilot 自动串起来，也可以单独手动调用。

```
 explore ─▶ office-hours ─▶ propose ─▶ apply ─▶ review-cycle ─▶ verify(-enhanced) ─▶ ship ─▶ archive ─▶ retro
 (想清楚)   (验证需求)      (写计划)   (实现)   (评审→修→复审)   (深度验证)          (交付)   (归档合并)  (复盘)
   │            │             │          │           │               │                  │         │
  可选        可选          产出契约    勾选tasks   迭代直到干净     专家审/安全/QA      PR/部署   合并spec  学习沉淀
```

- **契约在哪**：`propose` 在 `openspec/changes/<id>/` 产出 `proposal.md` / `design.md` / `specs/<cap>/spec.md` / `tasks.md`。这就是各阶段之间传递的「真相」。
- **完成的定义**：每条 `### Requirement` 至少要有一个 `#### Scenario`（`openspec validate` 强制）。验证/审查阶段拿 scenario 对照实现。
- **依赖是「使能」不是「门禁」**：产物之间有依赖（`requires`），但你可以在任何合理顺序推进，只要依赖已就绪。

---

## 2. 一键跑完整个工作流：`/opsx:auto`

`/opsx:auto`（Autopilot）是**单命令端到端**入口。dispatch agent 会：① 给任务**分类**、② 按类型选择**流水线**、③ 按改动特征**挑选专家**、④ 在阶段切换处**暂停确认**。任何时候你都能打断、切回手动。

> 触发词：`auto` / `autopilot` / `end to end` / `do it all` / `one shot`。

### 2.1 按任务复杂度自动选流水线

| 分类 | 触发特征 | 流水线 |
|---|---|---|
| **Full Feature** | 新功能、多组件、范围大（"add system" / "implement module"） | office-hours → propose → 专家评审 → apply → verify → ship → archive → retro |
| **Small Feature** | 单一增量、增强（"add button" / "update form"） | propose → apply → verify → ship → archive |
| **Bug Fix** | 修 bug、纠错、回归（"fix" / "broken" / "doesn't work"） | propose（精简） → apply → verify → ship → archive |

分类结果会显示出来，**你可以在继续前覆盖它**。

### 2.2 Full Feature 流水线（含暂停点）

```
Stage 1  /opsx:office-hours          → office-hours-design.md
Stage 2  /opsx:propose               → proposal.md, design.md, specs/, tasks.md
         ⏸ 暂停点 1：计划完成，先 review 再实现？
Stage 3  专家评审（按需）            → /autoplan、/cso(安全)、/benchmark(性能)
Stage 4  /opsx:apply                 → 代码改动，tasks 勾选
         ⏸ 暂停点 2：实现完成，进入验证？
Stage 5  /opsx:verify                → review-report.md, cso-report.md, qa-report.md
         ⏸ 暂停点 3：验证完成，进入交付？（有严重问题先解决）
Stage 6  /opsx:ship                  → ship-log.md
Stage 7  /opsx:archive               → 归档 + 合并 spec
Stage 8  /opsx:retro <change>        → retro.md
```

### 2.3 专家选择矩阵（autopilot 在 verify 阶段自动挑）

| 条件 | 专家 | 时机 |
|---|---|---|
| Full Feature | `/autoplan` | 规划阶段：全面任务生成 |
| 涉及安全（auth/加密/输入校验/数据处理） | `/cso` | verify：安全审计 |
| 性能敏感（DB 查询/接口/渲染/算法） | `/benchmark` | verify：性能分析 |
| UI 改动（.tsx/.jsx/.vue/.svelte） | `/design-review` | verify：视觉审查 |
| Full/Standard 总是 | `/review` | verify：代码评审 |
| Full Feature + UI | `/qa` | verify：浏览器测试 |
| Standard/Small | `/qa-only` | verify：精简 QA |

> 说明：autopilot 当前在「验证」阶段用的是 `/opsx:verify`。**新增的 `/opsx:review-cycle`（迭代评审环，§3.5）目前是独立的手动阶段命令**，尚未编入 auto 的默认流水线——把它接入 auto（在 apply 与 verify 之间）是后续增强项。

---

## 3. 分阶段单独命令

需要细粒度控制时，逐个手动调用。下表是速查，详细见 [`commands.md`](./commands.md)。

| 阶段 | 命令 | 用途 | 主要产物 |
|---|---|---|---|
| 探索 | `/opsx:explore [topic]` | 不带结构地想清楚、查代码、比方案 | （无；可转入 propose/new）|
| 需求验证 | `/opsx:office-hours` | YC 式需求验证（Startup 六问 / Builder 头脑风暴）| `office-hours-design.md` |
| 立项 | `/opsx:propose [name-or-desc]` | 一步建 change + 生成全部规划产物 | proposal/design/specs/tasks |
| 立项（细粒度）| `/opsx:new` → `/opsx:continue` → `/opsx:ff` | 逐个产物 / 按依赖生成下一个 / 一次性全生成 | 同上，分步 |
| 实现 | `/opsx:apply` | 按 `tasks.md` 实现，逐条勾选 | 代码 + 勾选的 tasks |
| **迭代评审（新增）** | `/opsx:review-cycle` | review→triage→fix→re-review(Δ)→{pass\|循环\|升级} | 评审/修复记录 |
| 验证 | `/opsx:verify` | 校验实现是否匹配产物（spec scenario）| 验证结论 |
| 深度验证 | `/opsx:verify-enhanced` | 产物检查 + 代码评审 + 安全审计 + 浏览器 QA + 视觉审查（按改动规模自动伸缩）| 各类 report |
| 交付 | `/opsx:ship` | 测试、push、建 PR、可选合并 & 部署；PR 正文取自 proposal | `ship-log.md` |
| 归档 | `/opsx:archive` / `/opsx:bulk-archive` | 归档 change，把 delta spec 合并进 canonical specs | 归档目录 + 更新的 specs |
| 合并 spec | `/opsx:sync` | 把 delta specs 合并进主 specs | 更新的 specs |
| 复盘 | `/opsx:retro [change]` | 工程复盘：分析交付内容、模式、学习（change/general/global 三种模式）| `retro.md` |
| 引导 | `/opsx:onboard` | 走一遍完整工作流的教学 | （教学）|

### 3.1 `/opsx:explore` — 先想清楚
不带结构的探索对话：查代码、比选项、画图。想法成型后可转入 `/opsx:propose`（默认）或 `/opsx:new`（expanded）。

### 3.2 `/opsx:office-hours` — 先验证需求该不该做
两种模式：**Startup**（六个 forcing question 逼问真实需求）/ **Builder**（设计头脑风暴）。产出文档分两种落点：
- **已有 active change**：写进 `openspec/changes/<id>/office-hours-design.md`（任务目录内固定名，同 `proposal.md`；会被 propose 自动消费）。
- **还没立项**：按主题推导 kebab-case slug，写 `openspec/office-hours/<topic-slug>.md`——**每个主题一个文件**，多次验证不同想法不会互相覆盖（不要用单一固定名）。

### 3.3 `/opsx:propose` — 立项 + 一步生成规划产物
建 `openspec/changes/<id>/` 并生成实现前所需的全部产物（spec-driven：proposal → specs → design → tasks），停在「可 apply」状态。要分步控制就用 expanded 的 `/opsx:new` + `/opsx:continue`。

### 3.4 `/opsx:apply` — 实现
按 `tasks.md` 逐条实现并勾选复选框。实现中可随时回头改任何产物（无 phase gate）。

### 3.5 `/opsx:review-cycle` — 迭代评审环（本仓新增）
实现之后的**迭代**循环：调用 `openspec-gstack-review` 做评审 → 按修复体量分级（trivial / non-trivial / design-level）→ 修复 → **只复审增量** → 直到无 Blocker/Major 或达上限升级人工。

要点（详见 [设计文档](./review-cycle-workflow-design.md)）：
- **作者 ≠ 验证者**：修复只有被「非修复作者」对照原问题确认后才算解决；trivial 内联修复则以「独立重跑 gate + 读 diff」作为等价的非作者复核并记录。
- **工具无关 + Claude 加速**：Claude Code 开 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` 时，lead 可用 `SendMessage` 恢复原评审员只审增量；其他工具/未开则降级为「针对增量的全新评审 + 共享 findings 文件」，结果等价、只是更费。
- **终止**：最大轮次（默认 3），达上限仍有未解决问题 → 停止并升级人工，绝不悄悄判过。
- **profile**：opt-in（在 `ALL_WORKFLOWS`，不在 `core`）。

### 3.6 `/opsx:verify` / `/opsx:verify-enhanced` — 验证
`verify` 校验实现匹配产物；`verify-enhanced` 是多阶段深度验证（产物检查 + 代码评审 + 安全审计 + 浏览器 QA + 视觉审查），按改动规模自动伸缩，内部会调用相应 gstack 专家。

### 3.7 gstack 专家技能（始终安装，按需调用）
不论 profile 如何，`openspec init` 都会装上一组专家技能（生成为 `openspec-gstack-*`），可在验证/规划阶段单独调用：

`/review`（代码评审）、`/qa` `/qa-only`（QA）、`/cso`（安全）、`/benchmark`（性能）、`/design-review` `/design-consultation`（设计/视觉）、`/autoplan`（全面规划）、`/investigate` `/careful` `/guard`（排查/谨慎/护栏）、`/land-and-deploy` `/setup-deploy` `/canary`（部署）、`/freeze` `/unfreeze`、`/document-release`、`/codex`、`/cso`、`/plan-ceo-review` `/plan-design-review` `/plan-eng-review`、`/setup-browser-cookies` 等。

---

## 4. 底层 CLI 命令（slash 命令依赖的确定性基座）

slash 命令是「指挥」，真正读写状态、做校验/归档的是 `openspec` CLI（也可手动直接用）。详见 [`cli.md`](./cli.md)。

| 命令 | 用途 |
|---|---|
| `openspec init [path] --tools <list>` | 初始化；按 AI 工具生成 skills/commands |
| `openspec update` | CLI 升级后刷新生成的指令文件 |
| `openspec new change <name> [--schema <s>]` | 新建 change 目录 + `.openspec.yaml` |
| `openspec status --change <id> [--json]` | 显示某 change 的产物完成度（done/total/blocked）|
| `openspec instructions [artifact] --change <id> [--json]` | 输出某产物的生成指令（slash 命令据此工作）|
| `openspec list [--specs] [--json]` | 列出 changes 或 specs |
| `openspec show [item] [--json] [--deltas-only]` | 展示某 change/spec |
| `openspec validate [item] [--all\|--changes\|--specs] [--strict] [--json]` | 校验结构/scenario/archive 安全性 |
| `openspec archive <change> [--skip-specs] [--no-validate]` | 归档 + 把 delta 合并进 canonical specs |
| `openspec templates / schemas [--json]` | 查看产物模板路径 / 可用 schema |
| `openspec config <list\|profile\|edit>` | 查看/切换 profile 与 delivery |
| `openspec schema <init\|fork\|validate\|which>` | 管理自定义 workflow schema |

**AI 友好**：`list/show/validate/status/instructions/templates/schemas` 都支持 `--json`，便于命令/脚本程序化消费。

---

## 5. Profile 与 delivery（决定哪些命令可用、怎么生成）

- **Profile = 装哪些 workflow 命令**：
  - `core`（默认）= `propose` / `explore` / `apply` / `archive`。
  - `custom`（expanded）= 你勾选的集合，可含 `new` `continue` `ff` `verify` `sync` `bulk-archive` `onboard` `review-cycle` 以及 fusion 命令 `auto` `ship` `verify-enhanced` `office-hours` `retro`。
  - **gstack 专家技能与 profile 无关，始终安装**。
- **启用 expanded / fusion 命令**：
  ```bash
  openspec config profile      # 交互选择 profile + workflows
  openspec update              # 在项目里重新生成对应的 skills/commands
  ```
- **Delivery = 生成 skill 还是 command 还是都生成**：`both`（默认）/ `skills` / `commands` / `skills-first` / `commands-first`。在全局配置（`openspec config`）里设。
  - ⚠️ 注意：若全局设了 `delivery: commands-first`，`openspec init` 会生成 commands 并清掉对应的 workflow skill 目录——这会让"断言生成了 skill 文件"的测试在该机器上失败（已知点，测试侧需隔离全局配置）。

---

## 6. 完整示例

### 6.1 一键（autopilot）
```text
You: /opsx:auto 给设置页加一个"导出全部数据"的功能

AI:  分类：Small Feature → 流水线 propose → apply → verify → ship → archive
     （可覆盖；回车确认）
     Stage propose … 生成 proposal/specs/tasks
     ⏸ 计划完成，先看一眼再实现？ → 你：继续
     Stage apply … 实现 + 勾选 tasks
     ⏸ 实现完成，进入验证？ → 你：继续
     Stage verify … /review 通过，无 Blocker
     ⏸ 验证完成，进入交付？ → 你：先不 ship
     （停在 archive 前，按需手动 ship/archive）
```

### 6.2 手动逐阶段（细粒度控制）
```bash
# 1) 想清楚（可选）
/opsx:explore 移动端鉴权怎么做

# 2) 立项（生成 proposal/design/specs/tasks）
/opsx:propose add-jwt-auth
openspec status --change add-jwt-auth        # 看产物完成度

# 3) 实现
/opsx:apply

# 4) 迭代评审（新增）：评审→修→只复审增量
/opsx:review-cycle

# 5) 深度验证（按规模自动伸缩）
/opsx:verify-enhanced

# 6) 交付
/opsx:ship

# 7) 归档（合并 delta spec 进 canonical specs）
openspec validate add-jwt-auth --strict
openspec archive add-jwt-auth

# 8) 复盘（可选）
/opsx:retro add-jwt-auth
```

---

## 7. 速查表

| 我想… | 用 |
|---|---|
| 一条命令端到端跑完 | `/opsx:auto` |
| 先想清楚再动 | `/opsx:explore` |
| 验证需求该不该做 | `/opsx:office-hours` |
| 立项 + 生成计划 | `/opsx:propose`（细粒度：`/opsx:new`+`/opsx:continue`+`/opsx:ff`）|
| 实现 | `/opsx:apply` |
| 评审→修→复审（直到干净）| `/opsx:review-cycle` |
| 深度验证（代码/安全/QA/视觉）| `/opsx:verify-enhanced`（或 `/opsx:verify`）|
| 单独跑某个专家 | `/review` `/cso` `/qa` `/benchmark` `/design-review` … |
| 交付（测试/PR/部署）| `/opsx:ship` |
| 归档并合并 spec | `/opsx:archive`（或 CLI `openspec archive`）|
| 复盘 | `/opsx:retro` |
| 看 change 完成度 | `openspec status --change <id>` |
| 校验 | `openspec validate <id> --strict` |
| 启用更多命令 | `openspec config profile` → `openspec update` |
