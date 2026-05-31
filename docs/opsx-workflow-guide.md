# OPSX 工作流指南：一键跑完 + 分阶段命令

> 日期：2026-06-01 · 适用：OpenSpec（OPSX 工作流，含编排式 autopilot + 数据驱动 pipeline 注册表）
> 相关参考：[`commands.md`](./commands.md)（每条命令的详细 reference）、[`workflows.md`](./workflows.md)（模式与时机）、[`cli.md`](./cli.md)（终端 CLI）、[`review-cycle-workflow-design.md`](./review-cycle-workflow-design.md)（review-cycle 设计）。
>
> 本文从「整条流水线」的视角，把当前 OPSX 工作流讲清楚：先给**一条命令端到端跑完**的用法，再给**每个阶段单独的命令**，最后是它们底下依赖的 **CLI 命令**、profile 开关与完整示例。

---

## 1. 工作流全景

OPSX 把「一个需求 → 已实现、已审查、已验证、已交付、已归档」拆成若干阶段。每个阶段既可以由 autopilot 自动串起来，也可以单独手动调用。

```
 explore ─▶ office-hours ─▶ propose ─▶ apply ─▶ verify ─▶ review-cycle ─▶ ship ─▶ archive ─▶ retro
 (想清楚)   (验证需求)      (写计划)   (实现)  (专家评审) (评审环:修→复审Δ) (交付)  (归档合并)  (复盘)
   │            │             │          │        │            │           │         │
  可选         可选         产出契约   勾选tasks 专家/安全/QA  迭代直到干净  PR/部署  合并spec  学习沉淀
```

> 注：在 autopilot 流水线里，`verify`（专家评审，可并行 review/cso/benchmark/design-review/qa）先跑出 findings，再由 `review-cycle`（=`review-loop` 阶段）驱动「triage→修→复审Δ」直到干净。bug-fix 走自适应 verify、不带 review-loop。

- **契约在哪**：`propose` 在 `openspec/changes/<id>/` 产出 `proposal.md` / `design.md` / `specs/<cap>/spec.md` / `tasks.md`。这就是各阶段之间传递的「真相」。
- **完成的定义**：每条 `### Requirement` 至少要有一个 `#### Scenario`（`openspec validate` 强制）。验证/审查阶段拿 scenario 对照实现。
- **依赖是「使能」不是「门禁」**：产物之间有依赖（`requires`），但你可以在任何合理顺序推进，只要依赖已就绪。

---

## 2. 一键跑完整个工作流：`/opsx:auto`

`/opsx:auto`（Autopilot）是**单命令端到端**入口。它把执行者变成 **LEAD**：LEAD 只编排、不亲自做阶段工作——它给任务**分类 → 选流水线 → 把每个阶段派给一个角色隔离的子 agent 执行 → 在 gate 处暂停确认**。任何时候你都能打断、切回手动。

> 触发词：`auto` / `autopilot` / `end to end` / `do it all` / `one shot`。

### 2.1 编排模型：LEAD + 角色隔离子 agent（含能力档位）

- **LEAD 是唯一编排者，子 agent 是叶子**：所有 loop / 派活 / triage 都在 LEAD；每个 worker 调用该阶段既有的 OPSX skill、干完即返回，**worker 不再 spawn 子 agent**（扁平层级）。
- **跨任务隔离、同任务可续聊**：不同 change 各自一支 worker 团队、互不串扰；同一任务内 LEAD 可用 `SendMessage` 唤醒某个 worker 续聊（如让原评审员只复审增量）。
- **结构化 author ≠ verifier**：评审 worker ≠ 实现 worker；design-level 的 fixer ≠ 原作者；复审 worker ≠ fixer——由 LEAD 派不同 worker 保证（不再是同上下文的口头承诺）。
- **能力档位（自动探测；流水线定义不变，只变执行机制）**：
  - **Tier A**：Claude Code + `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` → spawn 角色 worker + `SendMessage` 暖续聊（完全体）。
  - **Tier B**：有 spawn、无 agent-teams → 每阶段 fresh spawn，靠 change 目录 + run-state 冷重建上下文。
  - **Tier C**：无子 agent 能力 → 单上下文顺序执行（明确的兜底，**非**主路径）。
- **状态在磁盘**：change 目录是持久黑板（阶段间靠工件交接）；LEAD 把进度记进 `openspec/changes/<id>/auto-run.json`（run-state），支撑中断续跑与可观测。

### 2.2 流水线是数据：按任务选，从注册表取

分类与流水线定义都来自**数据驱动的 pipeline 注册表**（不再硬编码在 auto 里）。加一种任务类型 = 加一个 YAML、零代码改动。

```bash
openspec pipeline classify "<任务描述>" --json   # → { suggested, matched, available }
openspec pipeline show <name> --json             # → { name, description, buildOrder, stages }
openspec pipeline list --json                     # 列出 package/user/project 的全部流水线
```

内置流水线（可被 user/project 覆盖或新增；解析优先级 project > user > package）：

| 流水线 | 阶段（buildOrder 概要）|
|---|---|
| **full-feature** | office-hours → propose(可方向复审) → apply → 并行专家评审(review / cso / benchmark / design-review / qa\|qa-only) → review-loop(评审环) → ship → archive → retro |
| **small-feature** | propose → apply → verify → review-loop → ship → archive |
| **bug-fix** | propose → apply → 自适应 verify → ship → archive |

分类结果会显示、**你可以覆盖**，也可选 `available` 里任何 user/project 自定义流水线。

每个阶段带元数据，LEAD 据此执行：**role**（隔离）、**gate**（人类暂停）、**loop**（评审环）、**parallelGroup**（并发扇出，如 verify 的专家组）、**condition**（满足才跑；ui / non-ui 等互斥条件择一）、**leadReview**（LEAD 查方向漂移，§2.3）、**verifyPolicy**（adaptive / standard / light，§2.3）。

### 2.3 两个任务相关增强

- **propose 方向复审门（可选，`--review-plan`）**：propose worker 返回后、apply 前，LEAD 拿着**原始意图**复审 proposal/design/specs/tasks 有无跑偏（LEAD 没写产物，是合法的非作者复核）。Tier C 下 LEAD 即作者，降级为显式人类确认门、**不**计为非作者复核。
- **Bug-Fix 自适应 verify**：简单改动（单文件 / 非核心路径 / 测试充分）单测绿即过、跳过评审环；复杂改动另派测试 worker 深查并进评审环。

### 2.4 review-cycle 就是 auto 的评审环

`/opsx:review-cycle`（§3.5）不再是游离的手动阶段——它**就是 full-feature / small-feature 里的 `review-loop` 阶段**，与 auto 共用同一套编排手册（同样的档位 / 角色隔离 / run-state / 升级）。单独手动跑它，用于对既有改动驱动「评审 → 修 → 只复审增量」直到干净。

### 2.5 暂停点与续跑

- 标了 `gate` 的阶段之后 LEAD 暂停：显示已完成 + 下一步，等你 **Continue / Stop（存盘可续）/ 切手动**。
- 续跑：`openspec pipeline resume <change> --json` 从 run-state + 工件推断下一个未完成阶段（run-state 的逐阶段状态为准，工件存在性是启发式 / 交叉校验）。

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
| 验证 | `/opsx:verify` | 校验实现是否匹配产物（spec scenario）| 验证结论 |
| 深度验证 | `/opsx:verify-enhanced` | 产物检查 + 代码评审 + 安全审计 + 浏览器 QA + 视觉审查（按改动规模自动伸缩）| 各类 report |
| **迭代评审环** | `/opsx:review-cycle` | review→triage→fix→re-review(Δ)→{pass\|循环\|升级}；也是 `auto` 的 `review-loop` 阶段 | `review-cycle-report.md` |
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

### 3.5 `/opsx:review-cycle` — 迭代评审环（也是 `/opsx:auto` 的 review-loop 阶段）
实现之后的**迭代**循环：调用 `openspec-gstack-review` 做评审 → 按修复体量分级（trivial / non-trivial / design-level）→ 修复 → **只复审增量** → 直到无 Blocker/Major 或达上限升级人工。

要点（详见 [设计文档](./review-cycle-workflow-design.md)）：
- **作者 ≠ 验证者**：修复只有被「非修复作者」对照原问题确认后才算解决；trivial 内联修复则以「独立重跑 gate + 读 diff」作为等价的非作者复核并记录。
- **多 agent 为主路径**：评审 / 修 / 复审是不同角色的隔离 worker；Tier A（Claude Code + `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`）下 lead 用 `SendMessage` 恢复原评审员只审增量。无子 agent 能力时**才**降级为单上下文「针对增量的全新评审 + 共享 findings 文件」（明确兜底、非基线）。与 `/opsx:auto` 共用同一套编排手册。
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
| `openspec validate [item] [--all\|--changes\|--specs\|--pipelines] [--strict] [--json]` | 校验结构/scenario/archive 安全性（含流水线定义）|
| `openspec pipeline <list\|show <name>\|classify "<task>"\|resume <change>> [--json]` | 数据驱动流水线注册表：列出 / 查看 DAG / 任务分类 / 续跑（`auto` 据此取流水线）|
| `openspec archive <change> [--skip-specs] [--no-validate]` | 归档 + 把 delta 合并进 canonical specs |
| `openspec templates / schemas [--json]` | 查看产物模板路径 / 可用 schema |
| `openspec config <list\|profile\|edit>` | 查看/切换 profile 与 delivery |
| `openspec schema <init\|fork\|validate\|which>` | 管理自定义 workflow schema |

**AI 友好**：`list/show/validate/status/instructions/templates/schemas/pipeline` 都支持 `--json`，便于命令/脚本程序化消费。

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
  - ⚠️ **编排靠 skill**：`/opsx:auto` 与 `/opsx:review-cycle` 在运行时让模型**调用其它 skill**（worker 调阶段 skill；review-loop 调 `openspec-gstack-review`）。模型能调 skill、**不能**调 command——所以 `commands` / `commands-first`（会删掉有 command 对应物的 skill）会**打断编排**。要编排正常就保 skill：用 `both`（默认）或 `skills` / `skills-first`。
  - ⚠️ 注意：若全局设了 `delivery: commands-first`，`openspec init` 会生成 commands 并清掉对应的 workflow skill 目录——这也会让"断言生成了 skill 文件"的测试在该机器上失败（已知点，测试侧需隔离全局配置）。

---

## 6. 完整示例

### 6.1 一键（autopilot，编排式）
```text
You: /opsx:auto 给设置页加一个"导出全部数据"的功能

AI:  openspec pipeline classify → suggested: small-feature（可覆盖；回车确认）
     探测档位：Tier A（agent-teams 开）→ LEAD 编排角色隔离子 agent
     从注册表取 DAG：propose → apply → verify → review-loop → ship → archive
     ▸ planner worker → 生成 proposal/specs/tasks
     ⏸ gate：计划完成，先看一眼再实现？ → 你：继续
     ▸ implementer worker（≠planner）→ 实现 + 勾选 tasks
     ⏸ gate：实现完成，进入验证？ → 你：继续
     ▸ reviewer worker（≠implementer）→ /review 出 1 个 Major
     ▸ review-loop：派 fixer 修 → SendMessage 唤醒原评审员只复审增量 → 干净
     ⏸ gate：进入交付？ → 你：先不 ship（run-state 已存，可 `pipeline resume` 续）
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

# 4) 迭代评审环：评审→修→只复审增量（= auto 的 review-loop，手动单跑）
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
