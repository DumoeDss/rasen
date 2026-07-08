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
- **跨任务隔离、同任务可续聊**：不同 change 各自一支 worker 团队、互不串扰；同一任务内 LEAD 可用 `SendMessage` 唤醒某个 worker 续聊（如让原评审员只复审增量）。当一个任务被 **decompose 扇出**成多个子 change 时，这条「每个 change 各自一支 worker 团队」就真正落地——每个子 change 跑自己的流水线、各有独立 worker 团队（见 §2.7）。
- **Persistent planner（propose 专属复用——上条隔离规则的唯一例外）**：一次 run 只有**一个 planner**。首个 propose 前，LEAD 把已知上下文（用户意图、自己的调研、拆分依据）写进 `planning-context.md` 播种给它；之后每个子 change 的 propose 用 `SendMessage` 续聊**同一个** planner——代码库只调研一次、兄弟 spec 天然一致；planner 每轮把新结论追加回 digest。planner 指针记在 `portfolio-run.json` 顶层（`planner` 字段），重启后按暖播种续接；上下文膨胀时退役换新。**其余阶段（apply/verify/review/ship…）保持冷隔离，不复用**（playbook Step B.1）。
- **结构化 author ≠ verifier**：评审 worker ≠ 实现 worker；design-level 的 fixer ≠ 原作者；复审 worker ≠ fixer——由 LEAD 派不同 worker 保证（不再是同上下文的口头承诺）。
- **能力档位（自动探测；流水线定义不变，只变执行机制）**：
  - **Tier A**：Claude Code + `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` → spawn 角色 worker + `SendMessage` 暖续聊（完全体；`SendMessage` **仅会话内**有效，跨重启走 §2.5 的 transcript 暖播种）。**`openspec init` / `update` 安装 Claude Code 时会自动把这个 flag 合并进项目 `.claude/settings.json`**（保留已有键、幂等、坏 JSON 不覆盖），所以默认就是 Tier A。
  - **Tier B**：有 spawn、无 agent-teams → 每阶段 fresh spawn，靠 change 目录 + run-state 冷重建上下文。
  - **Tier C**：无子 agent 能力 → 单上下文顺序执行（明确的兜底，**非**主路径）。
- **状态在磁盘**：change 目录是持久黑板（阶段间靠产物交接）；LEAD 把进度记进 `openspec/changes/<id>/auto-run.json`（run-state），支撑中断续跑与可观测。

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
| **small-feature** _(默认)_ | propose → apply → verify → review-loop → ship → archive |
| **bug-fix** | propose → apply → 自适应 verify → ship → archive |
| **auto-decompose** | **decompose**(条件性首步，LEAD 自审、非人类 gate) → propose → apply → verify → review-loop → ship → archive；取了 decompose 就扇出成多个子 change，每个子跑 `childPipeline`（默认 small-feature，见 §2.7）|
| **goal-loop-measure** | define-goal → iterate（measure 闸门，循环至达标/maxRounds）→ ship → archive —— 由 `/opsx:goal` 驱动，**见 §9** |
| **goal-loop-evaluate** | define-goal → iterate（evaluate 闸门，循环）→ ship → archive —— 由 `/opsx:goal` 驱动，**见 §9** |
| **goal-loop-research** | define-goal → iterate（evaluate 闸门，循环）→ report —— 由 `/opsx:goal` 驱动，**见 §9** |

> 全部内置流水线的 **ship 和 archive 阶段都显式指定 `model: sonnet`**——这两个阶段是机械执行（跑测试/push/建 PR、归档/合并 spec），不需要大模型推理；不指定 `model` 时 worker 会继承主 agent 的模型，平白多花成本。自定义流水线也建议照此为 ship/archive 写上 `model: sonnet`。

**怎么选流水线**（显式优先，否则默认 `small-feature`）：
- **显式指定**：`/opsx:auto --pipeline <名字> <任务>`，或**直接把流水线名放最前面**——`/opsx:auto full-feature 重构鉴权子系统`（首个 token 是已知流水线名就直接用）。
- **默认**：`/opsx:auto <任务>`（不带显式选择）→ 直接用 **`small-feature`**，不自动升级到 full-feature/bug-fix。

可选：`openspec pipeline classify "<任务>"` 给个建议，或 `openspec pipeline list` 选别的——但显式选择始终覆盖，没有显式选择就走 `small-feature` 默认。

每个阶段带元数据，LEAD 据此执行：**kind**（`standard` 默认 / `decompose` 扇出点，§2.7）、**skill**（worker 调用的 OPSX skill；decompose 阶段无此字段）、**childPipeline**（仅 decompose——每个子 change 跑的流水线，默认 `small-feature`）、**role**（隔离）、**gate**（人类暂停）、**loop**（评审环）、**parallelGroup**（并发扇出，如 verify 的专家组）、**condition**（满足才跑；ui / non-ui 等互斥条件择一）、**leadReview**（LEAD 查方向漂移，§2.3）、**verifyPolicy**（adaptive / standard / light，§2.3）、**model**（该阶段 worker 的模型覆盖；省略则继承主 agent 模型——内置流水线给 ship/archive 写了 `model: sonnet`）。

### 2.3 两个任务相关增强

- **propose 方向复审门**：在 propose 阶段的 `leadReview` 为 ON 时触发——**两种开法**：① 调用时带参数 `/opsx:auto --review-plan <任务描述>`（本次强制开、不分流水线；注意 `/opsx:auto` 是 skill 不是 CLI 二进制，没有 flag 解析器——参数由 LEAD 按本节指令识别并遵守）；② pipeline.yaml 的 propose 阶段写 `leadReview: true`（该流水线永久开）。内置 **full-feature 默认带**（propose.leadReview: true），**small-feature / bug-fix 默认不带**（用 `--review-plan` 临时开）。触发后：propose worker 返回、apply 前，LEAD 拿**原始意图**复审 proposal/design/specs/tasks 有无跑偏（LEAD 没写产物，是合法非作者复核）→ 对齐则继续、跑偏则打回新 planner worker 或抛给你；不开则 propose 直接进下一阶段。Tier C 下 LEAD 即作者，降级为显式人类确认门、**不**计为非作者复核。
- **Bug-Fix 自适应 verify**：简单改动（单文件 / 非核心路径 / 测试充分）单测绿即过、跳过评审环；复杂改动另派测试 worker 深查并进评审环。

### 2.4 review-cycle 就是 auto 的评审环

`/opsx:review-cycle`（§3.5）不再是游离的手动阶段——它**就是 full-feature / small-feature 里的 `review-loop` 阶段**，与 auto 共用同一套编排手册（同样的档位 / 角色隔离 / run-state / 升级）。单独手动跑它，用于对既有改动驱动「评审 → 修 → 只复审增量」直到干净。

### 2.5 暂停点与续跑

- 标了 `gate` 的阶段之后 LEAD 暂停：显示已完成 + 下一步，等你 **Continue / Stop（存盘可续）/ 切手动**。
- 续跑：`openspec pipeline resume <change> --json` 从 run-state + 产物推断下一个未完成阶段（run-state 的逐阶段状态为准，产物存在性是启发式 / 交叉校验）。run-state 写在 `auto-run.json`，每个 stage 记 worker 的 `role` / `agentId` / `transcript` 指针。
- **跨会话（重启后）暖播种**：新会话里上一会话的 worker 已不存在，`SendMessage` 够不到它（`agentId` 是死句柄）。要复用某个角色（如让"原评审员"只复审增量），LEAD 把它的持久 transcript（`agent-<agentId>.jsonl`）读回，**暖播种**一个同角色的新 worker——新 `agentId`、带着前任完整上下文。`resume --json` 的 `workers` 字段把可暖播种的指针列出来；transcript 已失效则降级为从 change 目录冷重建。这是平台允许范围内最接近"真正恢复旧 subagent session"的形态（Claude Code 不支持跨进程复活同一个 subagent）。

### 2.6 加自定义流水线（从已有步骤拼）

三步、零代码——把现有阶段 skill 重新编排成一条新流水线：

1. **建文件**（解析优先级 project > user > package，**同名会覆盖内置**，可用来定制内置流水线而不改源码）：
   - 项目级：`openspec/pipelines/<名字>/pipeline.yaml`
   - 用户级：`<XDG_DATA_HOME 或 ~/.local/share>/openspec/pipelines/<名字>/pipeline.yaml`
2. **写 stages，`skill` 从现有的挑**（这就是「从已有步骤选」）：
   ```yaml
   name: hotfix
   description: Fast-track — propose, apply, review loop, ship.
   stages:
     - { id: propose,     skill: openspec-propose,      role: planner,     gate: true }
     - { id: apply,       skill: openspec-apply-change, role: implementer, requires: [propose], gate: true }
     - { id: review-loop, skill: openspec-review-cycle, role: fixer,       requires: [apply],
         loop: { kind: review-cycle, maxRounds: 2 } }
     - { id: ship,        skill: openspec-opsx-ship,    role: shipper,     requires: [review-loop], model: sonnet }
   ```
   可挑的现成 skill：`openspec-propose` / `openspec-apply-change` / `openspec-review-cycle` / `openspec-opsx-office-hours` / `openspec-opsx-ship` / `openspec-archive-change` / `openspec-opsx-retro`，专家 `openspec:review` / `openspec:cso` / `openspec:benchmark` / `openspec:design-review` / `openspec:qa` / `openspec:qa-only`。stage 字段同 §2.2；抄现成写法用 `openspec pipeline show full-feature`。
3. **校验 + 用**：
   ```bash
   openspec validate <名字> --type pipeline   # 唯一id / requires可解析 / 无环 / skill存在 / parallelGroup独立 / decompose(至多一个·首位·childPipeline可解析且不含递归)
   openspec pipeline show <名字>              # 看 buildOrder
   ```
   之后 `/opsx:auto` 会把它列进 `available`，你在分类后**覆盖**选它即可。

> 两个真实约束：① **skill 名必须精确**——专家是 `openspec:xxx`（非 `openspec-xxx`）、apply 是 `openspec-apply-change`（非 `openspec-apply`），写错 `validate` 直接报 skill 不存在；② **classify 不会自动推荐自定义流水线**（它是内置关键词启发式，只在三个内置里建议）——自定义流水线一定在 `available` 里，但需你/用户在分类后**手动覆盖**选择。想让某关键词自动命中自定义流水线，目前要改 `src/commands/pipeline.ts` 的关键词表（可作后续增强）。

### 2.7 decompose 扇出（一次拆成多个可独立交付的 change）

大任务硬塞进一个 change，会得到一个无法 review、无法 merge 的巨型 diff。`decompose` 阶段让 LEAD 在运行时把任务**扇出**成多个内聚、可独立交付的子 change，再逐个驱动各自的流水线——这正是 §2.1「每个 change 各自一支 worker 团队」落地的地方。

- **它是一种阶段类型（`kind: decompose`），且是流水线的条件性首步。** 内置 `auto-decompose` 流水线把它放在最前。`/opsx:auto auto-decompose <任务>` 触发；LEAD 根据任务**自行判断执行还是跳过**：单个内聚、可一次性 review 的切片 → 跳过，其余阶段照常在一个 change 上跑；多个相互独立的交付物 / 多个不同能力 / 大到无法当作单个 diff 来 review → 执行并扇出。
- **LEAD 自审，默认不设人类 gate（`gate: false`）。** 取了 decompose 后，LEAD 自审拆分方案（切片内聚性、并行同批的独立性依据、依赖 DAG 是否正确）并**自动继续**；只有在无法形成安全方案时才升级给你。你随时仍可中断。
- **父 change 变成规划容器。** 它自己的剩余阶段被标记为 delegated（不在父级跑）；每个子 change 用 `openspec new change <child-id>` 创建，跑解析出的 `childPipeline`（默认 `small-feature`，始终不含 decompose）。**允许逐个子 change 覆盖流水线**——一个子可以是 `bug-fix`，其同级是 `full-feature`。
- **保守的串行/并行策略（安全核心）：**
  - **有依赖边 → 严格串行**，按拓扑顺序。依赖者要等**每一个**前置都已实现且 review 干净才开始，绝不与前置并发。**共享工作树 + review 干净就足够**让依赖者消费前置代码，无需先把前置 ship/archive；仅当依赖的是已落地/已合并产物时才升级。
  - **仅当全部成立才并行**：① 任一方向都无依赖边、② 触及的能力/规格目录/文件无重叠、③ 宿主为 **Tier A**。满足条件的子 change 各起独立 worker 团队并发，**不设固定的并发上限**；Tier B/C 一律串行。
  - **独立性不确定 → 串行**（「宁可串行也不能乱并行」：并行需要*积极*的独立性证明，而非「没发现冲突」）。
- **单层扇出（递归防护）。** `childPipeline` 必须解析到一条**不含 decompose** 的流水线（`validate` 强制），子流水线运行绝不会再 decompose。
- **可观测 + 可续跑。** 父目录有一份 `portfolio-run.json`（拆分方案、子列表、依赖 DAG、每个子的执行模式/同批/流水线/状态、可运行前沿、顶层 `planner` 指针——persistent planner 跨子复用，见 §2.1），每个子仍各有 `auto-run.json`。`openspec pipeline resume <parent>` 从组合状态算出下一个可运行的子（`runnableChildren`），并单独报出 `interruptedChildren`（中断时停在 `in_progress` 的子——重启后**暖播种续跑**，不晾死）与 `escalatedChildren`（失败/升级、需人工）；某个子失败/升级时，停掉它的依赖链、保留已完成的独立子，连同前沿一起上报。
- **跨子 worker 复用（暖复用 vs 退役）。** 依赖者直接消费前置的代码，所以刚写完这份代码的 implementer 就是依赖者最暖的 worker——前提是它还有余量。由流水线的 `reuse` 配置管控（`reuse: { planner, implementer: auto|never, threshold, roles }`，由 `resolvePipelineReuseConfig` 解析；默认 `{ auto, auto, 0.25 }`）。在**解锁依赖者的同一个 review-clean gate** 上，LEAD 探针前置 implementer 的 transcript（`openspec agent context --transcript`）：**≤ 解析出的 reuse 阈值** → 暖复用同一 worker（Tier A `SendMessage`），并带**污染防护条款**（前置的约定仅在依赖者自己的 proposal/design 沉默处成立——先读这些）；**>** → **retired-between-children 退役**（该 worker 写一份 handoff 文档，reason 为 `retired-between-children`，重心是跨 change 可迁移知识，`Remaining` 留空），再从「该文档 + LEAD 派工简报」双源播种一个新 implementer。复用要求**唯一暖前驱**——DAG 汇合点（依赖 >1 个前置的子）一律新开 worker，从各前置的 durable findings 多源播种。被复用的 worker 记录带上 `reusedFrom: <前置子 id>`。planner 复用由 `reuse.planner` 单独配置（`never` 时每次 propose 新开 planner，从 `planning-context.md` 播种）。范围护栏：设计级 fixer 排除（新鲜眼睛是其价值）；Tier B / Codex 走既有的暖播种 / `threadId` resume 阶梯降级；用户手动连续跑的无关 change 序列不在范围内。实现发现通过 worker `DONE` 契约的 **durable-findings** 条款前向回流（1-3 行，LEAD 原文转贴进下一个 planner 的派工）。

> 注：跨 change 的依赖 DAG 记在 `portfolio-run.json` 里，不依赖 `dependsOn`/`parent` 元数据；待 `add-change-stacking-awareness` 落地后，decompose 会额外写这些元数据并复用 `openspec change graph`。

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
| 交付 | `/opsx:ship` | 测试、push、建 PR、可选合并 & 部署；PR 正文取自 proposal（流水线中固定用 `model: sonnet` 跑）| `ship-log.md` |
| 归档 | `/opsx:archive` / `/opsx:bulk-archive` | 归档 change，把 delta spec 合并进 canonical specs（流水线中固定用 `model: sonnet` 跑）| 归档目录 + 更新的 specs |
| 合并 spec | `/opsx:sync` | 把 delta specs 合并进主 specs | 更新的 specs |
| 复盘 | `/opsx:retro [change]` | 工程复盘：分析交付内容、模式、学习（change/general/global 三种模式）| `retro.md` |
| **交接** | `/opsx:handoff` | 探测上下文占用并写交接文档，供新会话/继任 worker 续作（opt-in）| `handoff/lead-<n>.md` + run-state 指针 |
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
实现之后的**迭代**循环：调用 `openspec-review` 做评审 → 按修复体量分级（trivial / non-trivial / design-level）→ 修复 → **只复审增量** → 直到无 Blocker/Major 或达上限升级人工。

要点（详见 [设计文档](./review-cycle-workflow-design.md)）：
- **作者 ≠ 验证者**：修复只有被「非修复作者」对照原问题确认后才算解决；trivial 内联修复则以「独立重跑 gate + 读 diff」作为等价的非作者复核并记录。
- **多 agent 为主路径**：评审 / 修 / 复审是不同角色的隔离 worker；Tier A（Claude Code + `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`）下 lead 用 `SendMessage` 恢复原评审员只审增量。无子 agent 能力时**才**降级为单上下文「针对增量的全新评审 + 共享 findings 文件」（明确兜底、非基线）。与 `/opsx:auto` 共用同一套编排手册。
- **终止**：最大轮次（默认 3），达上限仍有未解决问题 → 停止并升级人工，绝不悄悄判过。
- **profile**：opt-in（在 `ALL_WORKFLOWS`，不在 `core`）。

### 3.6 `/opsx:verify` / `/opsx:verify-enhanced` — 验证
`verify` 校验实现匹配产物；`verify-enhanced` 是多阶段深度验证（产物检查 + 代码评审 + 安全审计 + 浏览器 QA + 视觉审查），按改动规模自动伸缩，内部会调用相应专家技能。

### 3.7 上下文感知与交接（`openspec agent context` + `/opsx:handoff`）

Agent 感知不到自己的上下文占用——它只能**测量**。`openspec agent context` 从 transcript 里记录的 API usage 读出精确占用（`--latest` 测主会话自己，`--transcript <path>` 测某个 worker，`--json` 输出 `{ model, contextTokens, limit, pct }`）。整套交接机制建立在这个探针 + 「离散检查点、绝不注入持续倒计时」的原则上：

- **Session 级**：`/opsx:handoff` 随时可调——探测、写 `openspec/changes/<id>/handoff/lead-<n>.md`（原始意图 / 关键决策 / 死胡同 / 下一步），并把 `sessionHandoff` 指针（含接力代数 `n`）记入 `auto-run.json`。`/opsx:auto` 入口会做一次非阻塞预检：达到阈值时给出三选一——现在自动接力 / 继续本会话 / 手动处理——由用户决定。不交接也没关系——harness 的 auto-compact 是兜底。
- **Session 接力（主动拉起继任者）**：经用户授权，撞线会话可以自己拉起继任者——在项目根目录打开一个可见的交互式 Claude Code 窗口，bootstrap 指令为「读交接文档 → 运行 `openspec pipeline resume` → 按文档的下一步继续」。不变式：只在 stage 边界接力（所有 worker 已返回、run-state 已落盘）；文档 + run-state 落盘之后才 spawn，spawn 后前任退场；bootstrap prompt 走文件中转（`handoff/relay-prompt.txt`）或 PowerShell `-EncodedCommand`——裸拼引号会被嵌套 shell 解析截断；`sessionHandoff.n` 达到 `maxRelays` 时停止自动接力，改为建议拆分。subagent 绝不跨会话恢复——继任者按「交接文档 / 已记录 transcript / 变更目录」梯度重建 worker。
- **Compact 恢复 hook（被动加固）**：可选的 `SessionStart` hook（matcher `compact`，脚本 `hooks/compact-recovery.sh`；`openspec init` 打印 copy-paste 配置片段，绝不自动改写 `.claude/settings.json`）在 auto-compact 发生后立即注入指引：运行 `openspec pipeline resume`、优先读交接蒸馏物、不要信任机器摘要里的细节。与主动接力互补——同一恢复入口，不引入第二套状态。
- **Worker 级（自动）**：每个派工 prompt 带交接条款——worker 察觉被压缩 / 达到软预算时，写 `handoff/<role>-<n>.md`（fixer/debugger 必须写「已排除假设及证据」节），返回结构化 `HANDOFF {path, reason, completed, remaining}`；LEAD 记账（stage 的 `handoffs[]`，单写者不变）并在同一会话派继任者续作，pipeline 不中断。LEAD 每次 `SendMessage` 续聊（复审/planner 复用）前也会先探测该 worker，超阈值则「写交接文档→退役换新」。
- **接力上限与升级阶梯（LEAD 优先，最小化人工打断）**：`maxRelays`（默认 3，第 4 次触发 LEAD 审查）+ `stallLimit`（连续 2 次无进展提前触发；排除一个假设也算进展）。LEAD 审查按代价择策略：换打法/改播种 → 退回 planner 升维返工 → 拆解隔离，全部记入 `strategyAttempts`；策略预算（默认 3）耗尽才把 stage 标记 `escalated` **挂起**——继续其余工作，在下一个 gate 或 run 结束时集中呈报。绝不悄悄判过，也绝不因单个卡住的 stage 中断整个 run。review-loop 轮次耗尽同样走这个阶梯，不再立即中断叫人。
- **可调配置 + 默认值** — 所有编排参数都在 `pipeline.yaml` 里（内置流水线在 `pipelines/<name>/pipeline.yaml`；解析优先级 `project > user > package`，同名文件覆盖内置）。随时可用 `openspec pipeline show <name> --json` 查看**解析后的**取值。

  **默认值速查：**

  | 配置块 | 键 | 默认值 | 含义 |
  |---|---|---|---|
  | `handoff` | `threshold` | `0.5` | worker 达到该上下文占比即退役交接 |
  | | `roles` | `{}` | 按角色的阈值覆盖，如 `reviewer: 0.65` |
  | | `maxRelays` | `3` | 每个 stage 的继任者接力次数上限，超出触发 LEAD 审查 |
  | | `stallLimit` | `2` | 连续无进展的接力次数，提前触发审查 |
  | `reuse` | `planner` | `auto` | `auto` = 跨 propose 复用 planner；`never` = 每次 propose 新开 |
  | | `implementer` | `auto` | `auto` = 跨依赖子 change 暖复用；`never` = 每次 apply 新开 |
  | | `threshold` | `0.25` | *接下一个完整 change* 所需的余量（比 `handoff.threshold` 更严）|
  | | `roles` | `{}` | 按角色的复用阈值覆盖——仅限 `planner` / `implementer` |

  **`handoff`** — *何时在 stage 中途退役 worker*。按 stage 解析：stage `handoff` > pipeline `handoff.roles[<role>]`（仅阈值）> pipeline `handoff` > 内置默认 `{threshold: 0.5, maxRelays: 3, stallLimit: 2}`。`roles` 接受任意 stage 角色；装载成本高的角色（reviewer、fixer）通常给更多余量。

  ```yaml
  handoff:
    threshold: 0.5
    roles: { reviewer: 0.65, fixer: 0.65 }   # 装载成本高的角色给更多余量
    maxRelays: 3
    stallLimit: 2
  stages:
    - id: review-loop
      handoff: { threshold: 0.7, maxRelays: 5 }   # 难题场景放宽容量维度；质量维度(maxRounds)不放宽
  ```

  **`reuse`** — *是否在已存在的暖 worker 上接新活*。仅 pipeline 级（无 stage 覆盖——复用是跨 stage / 跨 change 的关注点）；`roles` 仅限 `planner` / `implementer`。

  ```yaml
  reuse:
    planner: auto          # auto | never
    implementer: auto      # auto | never
    threshold: 0.25        # 仅在剩余 ≥75% 余量时才接新活
    roles: { planner: 0.4 } # 给（更便宜的）planner 更多余量，让它持续接活
  ```

  **能力分层**（自动检测，不在 YAML 配置）：设置 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` 启用 Tier A（`SendMessage` 暖续聊——默认值，因为 `openspec init`/`update` 会把该标志并入项目 `.claude/settings.json`）。缺省时走 Tier B（每个 stage 新开 worker）。

  **Hooks**（可选，通过 `openspec init` 的 copy-paste 片段启用——绝不自动写入 `.claude/settings.json`）：`hooks/safety-check.sh`（`PreToolUse`，拦截危险命令）与 `hooks/compact-recovery.sh`（`SessionStart`，matcher `compact`，compact 后重新锚定到交接文档）。

- **续跑消费**：`openspec pipeline resume --json` 输出 `sessionHandoff` / 各 stage 最新交接文档指针 / 各 worker 的 `contextEstimate`；新会话**先读交接文档**（蒸馏物），raw transcript 暖播种降级为兜底。

### 3.8 专家技能（始终安装，按需调用）
不论 profile 如何，`openspec init` 都会装上一组专家技能（生成为 `openspec-*`），可在验证/规划阶段单独调用：

`/review`（代码评审）、`/qa` `/qa-only`（QA）、`/cso`（安全）、`/benchmark`（性能）、`/design-review` `/design-consultation`（设计/视觉）、`/investigate` `/careful` `/guard`（排查/谨慎/护栏）、`/freeze` `/unfreeze`、`/codex`、`/setup-browser-cookies` 等。

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
  - `custom`（expanded）= 你勾选的集合，可含 `new` `continue` `ff` `verify` `sync` `bulk-archive` `onboard` `review-cycle` `handoff` 以及 fusion 命令 `auto` `ship` `verify-enhanced` `office-hours` `retro`。
  - **专家技能与 profile 无关，始终安装**。
- **启用 expanded / fusion 命令**：
  ```bash
  openspec config profile      # 交互选择 profile + workflows
  openspec update              # 在项目里重新生成对应的 skills/commands
  ```
- **Delivery = 生成 skill 还是 command 还是都生成**：`both`（默认）/ `skills` / `commands` / `skills-first` / `commands-first`。在全局配置（`openspec config`）里设。
  - ⚠️ **编排靠 skill**：`/opsx:auto` 与 `/opsx:review-cycle` 在运行时让模型**调用其它 skill**（worker 调阶段 skill；review-loop 调 `openspec-review`）。模型能调 skill、**不能**调 command——所以 `commands` / `commands-first`（会删掉有 command 对应物的 skill）会**打断编排**。要编排正常就保 skill：用 `both`（默认）或 `skills` / `skills-first`。
  - ⚠️ 注意：若全局设了 `delivery: commands-first`，`openspec init` 会生成 commands 并清掉对应的 workflow skill 目录——这也会让"断言生成了 skill 文件"的测试在该机器上失败（已知点，测试侧需隔离全局配置）。

### 升级已安装过的项目（拿到本次的编排 + pipeline）

已经跑过旧版 `openspec init` 的项目，**不要**重跑 init —— 用 **`openspec update`**：

1. **先升级 CLI 包本身**（`update` 不会升级自己）：
   - 全局：`npm install -g @fission-ai/openspec@latest`（pnpm/yarn/bun 同理，见 [`installation.md`](./installation.md)）
   - 本地 devDep：提升版本后重装（见 [`local-install.md`](./local-install.md)）
2. **在项目里刷新生成物**：
   ```bash
   openspec update          # 按已配置的 工具/profile/delivery 重新生成 .claude/skills + commands；含 legacy 迁移
   ```
   这样就拿到本次更新的 `auto` / `review-cycle` 指令（编排式 + 档位 + run-state）。你的 `openspec/`（changes / specs）内容不受影响。
3. **新的 `openspec pipeline` CLI 与内置流水线随包发布** —— 升级后的二进制里**立即可用**，不需要往项目里生成任何东西。
4. 若之前是 `core` profile、想启用本次的 opt-in 工作流（`review-cycle` / fusion 的 `auto` 等）：先 `openspec config profile` 重选，再 `openspec update`。

> `init` vs `update`：`init` 是**首次**搭建（建 `openspec/` 脚手架 + 选工具）；**已装过的项目升级用 `update`**。两者都会检测并引导清理 legacy 文件（见 [`migration-guide.md`](./migration-guide.md)）。

---

## 6. 完整示例

### 6.1 一键（autopilot，编排式）
```text
You: /opsx:auto 给设置页加一个"导出全部数据"的功能

AI:  默认流水线 small-feature（未显式指定；可覆盖；回车确认）
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
| 一条命令端到端跑完 | `/opsx:auto <任务>`（默认 small-feature 流水线）|
| 指定用某条流水线 | `/opsx:auto --pipeline <名> <任务>` 或 `/opsx:auto <名> <任务>` |
| 看有哪些流水线 | `openspec pipeline list` |
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
| 测上下文占用 / 交接 | `openspec agent context --latest`；`/opsx:handoff` |
| 看 change 完成度 | `openspec status --change <id>` |
| 校验 | `openspec validate <id> --strict` |
| 启用更多命令 | `openspec config profile` → `openspec update` |
---

## 8. Claude / Codex agent runtime 切换

OPSX pipeline 现在支持把每个 role 单独切换到 `claude` 或 `codex`。可切换的 role 是：

- `planner`
- `implementer`
- `reviewer`
- `fixer`
- `shipper`

临时切换用于单次 `/opsx:auto` 调用：

```text
/opsx:auto --planner codex --reviewer codex --fixer claude <task>
```

固化到某条 pipeline，用 CLI 写入项目本地覆盖：

```bash
openspec pipeline agents small-feature --planner codex --reviewer codex
openspec pipeline agents small-feature --json
openspec pipeline show small-feature --json
```

这会创建或更新：

```text
openspec/pipelines/small-feature/pipeline.yaml
```

解析优先级仍然是 `project > user > package`，所以内置 pipeline 不会被改动；当前项目会优先使用本地覆盖。要切回 Claude：

```bash
openspec pipeline agents small-feature --planner claude --reviewer claude
```

也可以直接在 `pipeline.yaml` 中写 role 默认：

```yaml
agents:
  planner:
    runtime: codex
    sessionReuse: run-planner
    sandbox: workspace-write
  reviewer:
    runtime: codex
    sessionReuse: review-thread
    sandbox: read-only
  fixer: claude
```

stage 级别仍可覆盖 role 默认：

```yaml
stages:
  - id: verify
    skill: openspec:review
    role: reviewer
    runtime: codex
    sessionReuse: review-thread
    sandbox: read-only
```

会话恢复语义不同：

- Claude worker 记录 `agentId` / `transcript`，跨重启后用 transcript 暖播种新 worker。
- Codex worker 记录 `threadId` / `turnId`，跨重启后优先用 `thread/resume(threadId)` 继续同一个 Codex thread。

`openspec pipeline resume <change> --json` 会把两类恢复句柄都放在 `workers` 中，并用 `runtime` 区分。

---

## 9. 目标驱动迭代：`/opsx:goal`

`/opsx:auto` 假设产物是一份可 review 的单次代码变更（propose → apply → verify → ship）。有些任务不符合这个形状——它们的「完成」是一个**条件**，不是一份文档：把 Lighthouse 分数刷到 90、让某模块满足一套 rubric、研究并写一份 brief。`/opsx:goal` 就是给这类任务用的入口：它重复 **修改 → 判定**，直到闸门达标或轮次上限。

> 当产物是一个靠迭代满足的*条件*时用 `/opsx:goal`；当产物是一份代码变更文档时用 `/opsx:auto`。两者共用同一套编排手册（LEAD + 角色隔离 worker、档位、run-state、gate、resume）——`/opsx:goal` 是一个平级入口，不是第二套系统。

### 9.1 一个入口，LEAD 分流到三条同构后端 pipeline

你只看到一个命令。LEAD 据任务分类，选**恰好一条**后端 pipeline（显式覆盖总赢）：

```text
/opsx:goal <任务>                        # LEAD 按关键词分类
/opsx:goal measure <任务>                # 强制 measure 变体
/opsx:goal evaluate <任务>               # 强制 evaluate 变体
/opsx:goal research <任务>               # 强制 research 变体
/opsx:goal --pipeline goal-loop-<变体> <任务>   # 显式指定 pipeline 名
```

**分类关键词**（仅作建议；显式优先）。歧义时默认 **evaluate**（质量判定是最通用的闸门；如果任务其实可量化，define-goal 阶段可以再把 measure 命令精化出来）。

| 任务中的关键词 | 选中的 pipeline | 闸门（考官） | 工作产物 | 尾部 |
|---|---|---|---|---|
| `score` `latency` `optimize` `lighthouse` `benchmark` `p99` `memory` `throughput` | **goal-loop-measure** | measure —— 一条确定性命令产出 `{score, passed}` | 代码 | ship → archive |
| `rubric` `quality` `clean` `standard` `refactor-quality` | **goal-loop-evaluate** | evaluate —— 一个 fresh reviewer worker 判 `{satisfied, gaps}` | 代码 | ship → archive |
| `research` `investigate` `write report` `write brief` `autoresearch` `literature` | **goal-loop-research** | evaluate —— 一个 fresh reviewer worker 判 | 散文（研究 + 写作） | report |

每条 pipeline 都是**同构**的——恰好一种闸门类型、一种 iterate-skill 风味、一种尾部。没有运行时条件、没有闸门组合。这是刻意的：早先一个把 measure+evaluate 闸门组合在一起的单 pipeline 设计被三个缺陷否决了（AND 语义的 stall 漏洞、未强制的条件尾部、被敷衍的 generic skill）；一族同构 pipeline 把三者一并消解。

```bash
openspec pipeline show goal-loop-measure        # 查看 DAG + loop 元数据
openspec pipeline show goal-loop-measure --json  # { name, buildOrder, stages }
```

`iterate` 阶段带 `loop: { kind: goal, gate: {...} }`。LEAD 通过 playbook 的 **Step L** 解释它（每轮单次 dispatch、暖复用 implementer、闸门、`goal-run.json`）。

### 9.2 流程：define-goal → iterate → 尾部

1. **define-goal**（planner，`openspec-goal-plan`）—— 把任务翻译成 `goal-plan.md`：`goal`（自然语言）、具体的 `gate`（`{kind: measure, command, threshold/target, direction}` 或 `{kind: evaluate, goal, rubric}`）、`workProduct`（`code` | `prose`）、`maxRounds`。该阶段带 `gate: true`——用户暂停以在首轮跑之前**确认 measure 命令**（这是「measure.command 是任意 shell」的安全阀）。它**不**产出 proposal/design/specs；产物是迭代后的代码或文档，不是一份变更规格。
2. **iterate**（implementer，`openspec-goal-iterate`）—— 循环体。LEAD 在首轮前把 `goal-plan.md` 里的具体闸门配置合并进 run-state 的 `loopConfig`。每轮：dispatch **暖复用**的 implementer（所有轮同一个 worker，就像 review-cycle 复用 fixer thread），然后跑闸门：
   - **measure** —— 运行 `gate.command`，解析 `{score, passed, detail}`。命令失败（非零退出 / 超时 / 无法解析的 JSON）记为 `{round, error}` 并按未达标处理——**不会死锁**。
   - **evaluate** —— dispatch 一个 **fresh reviewer worker**（≠ implementer——author ≠ verifier），必须返回结构化的 `{satisfied: boolean, gaps: string[]}`。
3. **尾部** —— measure/evaluate → `ship` → `archive`（迭代出的代码正常交付）；research → `report`（`openspec-goal-report` skill 把整轮 run 汇总成最终文档——没有代码要 ship）。

### 9.3 `goal-run.json` —— 循环位置的权威脊柱

每轮往 change 目录的 `goal-run.json` 追加一条记录：

```json
{ "round": 2, "score": 87, "measurePassed": false, "detail": "...", "gitTreeFingerprint": "abc123" }
```

`goal-run.json` 是**权威的**循环位置。run-state（`auto-run.json`）带注入的 `loopConfig`（生效的闸门配置）和一份 best-effort 的 `loopProgress` 缓存（当前轮、上次分数、stall 连击、`historyRef → goal-run.json`）；两者冲突时以 `goal-run.json` 为准。这也是跨 implementer relay 存活的关键：implementer 是暖复用的，但当其上下文撞线时，它走标准的 Step H.3 self-handoff，LEAD 暖播种继任者去读盘上的记录。

### 9.4 边界与 stall —— 绝不谎报、绝不静默烧轮

- **`maxRounds` 上限（默认 5）。** 循环是有界的。轮次用尽且闸门仍未达标时，run 照常进尾部，但 outcome 标记为 `maxRounds-exhausted`——**绝不谎报成功**。
- **`loopStallLimit`（默认 2）。** 一轮算有进展 = （measure 在且分数朝目标移动——`gte` 上升 / `lte` 下降）或（evaluate 在且 gap 集合收缩或新达标）。第 1 轮总算进展。`loopStallLimit` 连续无进展轮触发 LEAD 策略评审阶梯（Step H.5——换打法 / 改播种 / 升级），而非静默烧轮。

### 9.5 中断后续跑

跑到一半 kill 掉，然后：

```bash
openspec pipeline resume <change> --json   # 下一个未完成阶段 + worker 指针
```

goal-loop 的 resume 协议读 `goal-run.json` 的**最后一条记录**：

| 最后一条记录 | 续跑动作 |
|---|---|
| 闸门**已达标** | 直接进尾部（**不重跑**已达标的那一轮）|
| **未达标**（该轮完成、有记录）| 从 **lastRound + 1** 起跑（fresh dispatch，种子带前轮 gap）——该轮已有判定记录，不重跑 |
| **无记录**（define-goal 完成、iterate 在首判前就死了）| dispatch 第 1 轮 |

续跑某一轮之前，LEAD **可以**先在当前 tree 上重判一次（抓 flaky 命令或外部改动达标的状态）；`gitTreeFingerprint` 用来检测 tree 是否在自己之下被改动。

### 9.6 完整示例

**measure —— 把 Lighthouse 性能分刷到 90。**
```text
You: /opsx:goal drive the Lighthouse performance score to 90

AI:  关键词 "lighthouse" + "score" -> goal-loop-measure
     取 DAG：define-goal -> iterate（measure 闸门）-> ship -> archive
     ▸ planner -> goal-plan.md（gate: measure, command: lighthouse --output=json,
        threshold: 90, direction: gte, workProduct: code, maxRounds: 5）
     ⏸ gate：确认 measure 命令？ -> 你：继续
     ▸ implementer（第 1 轮）-> 改性能热点路径
     ▸ measure 闸门：score 82（未达标）-> 记入 goal-run.json
     ▸ implementer（第 2 轮，暖复用，种子带 score 82）-> 继续改
     ▸ measure 闸门：score 91（达标）-> 记入
     ▸ ship -> archive   (outcome: satisfied)
```

**evaluate —— 让某模块满足 rubric。**
```text
You: /opsx:goal make the auth module error-handling satisfy this rubric

AI:  关键词 "rubric" -> goal-loop-evaluate
     ▸ planner -> goal-plan.md（gate: evaluate, goal: "auth 错误处理满足
        rubric", rubric: "不得吞错误；每条失败路径都返回类型化错误",
        workProduct: code, maxRounds: 5）
     ⏸ gate：确认？ -> 你：继续
     ▸ implementer（第 1 轮）-> 重构错误路径
     ▸ evaluate 闸门：FRESH reviewer worker -> { satisfied: false, gaps: [...] }
     ▸ implementer（第 2 轮，暖复用，种子带 gaps）-> 逐条修
     ▸ evaluate 闸门：FRESH reviewer -> { satisfied: true } -> 记入
     ▸ ship -> archive   (outcome: satisfied)
```

**research —— 研究并写一份 brief。**
```text
You: /opsx:goal research and write a brief on WebGPU compute adoption

AI:  关键词 "research" + "write brief" -> goal-loop-research
     ▸ planner -> goal-plan.md（gate: evaluate, goal: "一份覆盖 WebGPU compute
        采用情况的 brief", workProduct: prose, maxRounds: 5）
     ⏸ gate：确认？ -> 你：继续
     ▸ implementer（第 1 轮）-> 内联研究（web search/fetch），起草 brief
        （上下文消耗大 -> pipeline 降低后的 implementer 阈值 0.35 在需要时更早
         走 Step H.3 relay）
     ▸ evaluate 闸门：FRESH reviewer -> { satisfied: false, gaps: ["缺浏览器支持矩阵"] }
     ▸ implementer（第 2 轮，暖复用）-> 补上矩阵
     ▸ evaluate 闸门：FRESH reviewer -> { satisfied: true } -> 记入
     ▸ report -> 最终 brief + run 摘要   (无 ship/archive；outcome: satisfied)
```

> **速查**：`/opsx:goal <任务>`（或 `measure|evaluate|research` 选择子 / `--pipeline goal-loop-<变体>`）；每轮记录落 `goal-run.json`；`maxRounds` 用尽会诚实标注；`openspec pipeline resume <change>` 从最后一条记录续跑。循环语义在 LEAD playbook（Step L），由与 `/opsx:auto` 同一套编排驱动。
