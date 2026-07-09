# 设计：`review-cycle` 工作流 —— 迭代式 评审 → 修复 → 复审

> 状态：设计草稿 · 日期：2026-05-29
> 范围：为 OpenSpec 引入一条一等公民级别的**迭代式**实现后评审循环，弥合现有 `review`/`verify-enhanced`/`ship` 各个一次性环节之间的缺口。核心保持工具无关，并辅以一项 Claude Code agent-teams 加速能力。
>
> 这是一份设计文档（位于 `docs/`）。其写法使其可以被提升为一个 OpenSpec change（`rasen/changes/add-review-cycle-workflow/`）—— 参见 [§9 提升为 OpenSpec change](#9-promote-to-an-openspec-change)。

---

## 1. 动机

OpenSpec 的流程是 `propose → apply → archive`，而 OPSX/gstack 融合工作又新增了专家技能与运行时命令：

- **规划期评审**由 propose 工作流对设计密集型 change 的方法论咨询（`/codebase-design`，条件式引用）覆盖；`schemas/spec-driven/schema.yaml` 不再携带任何 `enhance` 钩子（机制保留、当前无使用方）。
- **一次性代码评审**以始终安装的专家技能 `openspec-review`（源：`src/core/templates/experts/review.ts`）形式存在。
- **验证 / 交付**以融合命令（`verify-enhanced`、`ship`）形式存在 —— 参见进行中的 change `rasen/changes/add-opsx-fusion-commands/`。

**缺失**的是一条一等公民级别的、在 `apply` 之后将这些环节串联起来的**迭代循环**：

1. **没有强制的 `fix → re-review` 循环。** `review` 能产出问题清单，但没有任何结构化机制来驱动"修复这些问题，然后**只复审增量部分**，重复直到干净为止"。修复可能在未经验证的情况下落地。
2. **没有"作者 ≠ 验证者"不变量。** 实现（或修复）某项改动的人，也可以是宣布它已干净的人。对*修复本身*的独立验证无法得到保证。
3. **复审代价高昂。** 每次修复后重跑一遍完整评审会重新读取所有内容。借助现已可用的 Claude Code agent-teams `SendMessage`，可以**恢复**最初的评审员 subagent，使其只检查修复增量 —— 既廉价又聚焦 —— 但 OpenSpec 目前没有任何工作流利用这一点。

`review-cycle` 恰好补上了这条循环，复用现有的 `review` 引擎，并与融合方向保持一致。

---

## 2. 改动内容（概览）

- **新增运行时工作流** `review-cycle`（`/rasen:review-cycle`，技能 `openspec-review-cycle`），通过现有的模板 → 适配器流水线为所有受支持的工具生成。
- 它负责编排：**review → triage → fix → re-review(Δ) → {pass | loop | escalate}**，将实际的评审判断委托给现有的 `openspec-review` 技能，将修复委托给实现该改动的 agent。
- 将**作者 ≠ 验证者**不变量与一套**修复规模分级**（trivial / non-trivial / design-level）编码其中。
- 可选的 **Claude Code 加速**：通过 `SendMessage` 恢复评审员 subagent，使其只复审增量；并为所有其他工具提供**优雅的、工具无关的降级方案**（针对增量的全新评审 + 一份共享的问题清单文件）。
- **不改动核心 schema，也不改动产物图（artifact graph）** —— 这是一条位于命令/技能轴上的运行时循环，而非规划产物（参见 §4）。
- Profile：随**扩展/可选启用（expanded/opt-in）**集合发布（不进 `core`），与其他融合命令保持一致。

非目标：取代 `review`/`verify-enhanced`/`ship`（它与之组合）；将该循环强行塞进产物 DAG；让 agent-teams 成为硬依赖。

---

## 3. 它的定位 —— OpenSpec 的两条扩展轴

| 轴 | 机制 | 用途 |
| --- | --- | --- |
| **Schema 轴** | `schemas/<name>/schema.yaml`：产物（`id/generates/template/instruction/requires/enhance/provider/context-from`）+ `apply`（`requires/tracks/instruction`）。图 = `ArtifactGraph`（`src/core/artifact-graph/graph.ts`），Kahn 拓扑排序，"使能者而非门禁（enablers not gates）"。 | **规划期、产出文件的**步骤（proposal、specs、design、tasks）。规划评审通过 `enhance:` 技能搭载在此轴上。 |
| **命令/技能轴** | `src/core/templates/workflows/*.ts` → `src/core/templates/skill-templates.ts` → `src/core/shared/skill-generation.ts` → `src/core/profiles.ts` → 各工具适配器（`src/core/command-generation/adapters/`）。 | **运行时、迭代式**行为（propose、apply、archive、verify-enhanced、ship 等）。 |

**决策：`review-cycle` 是一个命令/技能轴工作流，而非 schema 产物。** 理由：

- 该循环是**迭代式且运行时**的 —— 它在实现*期间/之后*针对工作树/diff 运行，并可能重复 N 次。产物图建模的是一张*一次性创建的文件 DAG*，而非循环。
- 把它建模为单个 `review.md` 产物会导致：(a) 丢失迭代性，(b) 丢失逐次修复的复审，以及 (c) 让"完成"等价于"文件存在"，而非"问题已解决且经独立确认"。
- 它与现有的 `apply` 阶段组合：`apply` 实现各项任务；`review-cycle` 则是在 `verify-enhanced`/`ship`/`archive` 之前推荐的**下一运行时步骤**。

（规划期评审仍留在 schema 轴上，通过 `enhance:` 实现 —— 保持不变。）

---

## 4. 循环

```
                      ┌──────── orchestrator / lead agent (the only SendMessage hub) ────────┐
                      │                                                                       │
  apply (done) ─▶ review ─▶ triage ─▶ fix ─▶ re-review(Δ) ─▶ ┬─ pass ──▶ verify-enhanced ─▶ ship/archive
                   │         │         │        │            │
                   │         │         │        ├─ findings remain ─▶ (loop: triage → fix → re-review)
                   │         │         │        └─ max rounds reached ─▶ escalate to human
                   │         │         │
          `openspec-review`  │   implementing agent      resume original reviewer (Δ only)
            expert skill     │   (or orchestrator inline  via SendMessage if available;
                             │    for trivial)            else fresh delta review + findings file
                       fix-size triage (§4.2)
```

### 4.1 步骤

| 步骤 | 做什么 | 引擎 |
| --- | --- | --- |
| **review** | 对照该 change 的 specs/tasks 评审已实现的 diff；按严重程度（Blocker/Major/Minor）产出问题清单，每条问题都关联到一处 file:line，并（在可能时）关联到一条规格的 `#### Scenario`。 | 复用 `openspec-review`（`src/core/templates/experts/review.ts`）。 |
| **triage** | 按修复规模（§4.2）对每条可执行的问题分级，以决定由谁来修复。 | review-cycle 指令。 |
| **fix** | 应用修复。 | 非平凡修复由（被恢复的）实现 agent 负责；平凡修复由 orchestrator 内联完成；设计级修复由全新的修复 agent 负责。 |
| **re-review(Δ)** | 对照原始问题清单，**只重新检查修复增量**；确认已解决且无回归。 | 被恢复的原始评审员（Claude），或全新的增量评审（其他工具）。 |
| **decision** | 所有问题已解决并确认 → 退出至 `verify-enhanced`/`ship`。仍有问题遗留 → 循环。达到最大轮次 → 上报人工。 | review-cycle 指令。 |

### 4.2 修复规模分级（谁来修 —— 验证者永远是另一个人）

| 类别 | 启发式判定 | 谁来修 | 必需的复检 |
| --- | --- | --- | --- |
| **trivial** | 重命名 / 删除死代码 / 单处调用替换；无行为变化 | orchestrator 内联 | orchestrator 重跑各项 gate + 阅读 diff（即非作者检查） |
| **non-trivial** | 逻辑/行为变化 | 恢复实现 agent（保留上下文） | 被恢复的评审员复审增量 |
| **design-level** | 需要重新决策 / 横切影响 | 全新修复 agent（与实现者分离） | 评审员复审增量 |

### 4.3 不变量 —— 作者 ≠ 验证者

> 产出某项修复的 agent/persona MUST NOT 成为确认该修复正确的唯一确认者。复审 MUST 由一个不同的评审员身份执行；对于平凡/内联路径，orchestrator 的独立 gate 重跑 + diff 阅读即为等价的非作者检查，且 MUST 被记录在案。

工具无关的表述（适用于任何工具）：*"只有当一个并非该修复作者的评审员对照原始问题确认无误时，该问题才算解决。"*

### 4.4 终止条件

最大轮次（默认 **3**）。当达到上限时仍存在未解决的 Blocker/Major 问题，循环会**停止并连同残留问题上报人工** —— 它绝不会悄无声息地判定通过。

---

## 5. Claude Code 加速（agent-teams）+ 工具无关降级

OpenSpec 面向约 24 个工具；`SendMessage`/agent-teams 是 **Claude-Code 专属**（由 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` 控制开关）。因此该循环以工具中立的方式规约，恢复机制只是一项*优化*：

- **Claude Code，开关开启，同一会话内：** 工作流保留评审员 subagent 的 `agentId`；做 re-review(Δ) 时，**orchestrator/lead 通过 `SendMessage` 恢复该评审员**，只附带修复增量 + 对原始问题清单的引用。评审员保留其完整的先前上下文 → 既廉价、聚焦，又无需重新读取。（限制：只有 lead 才能发起 `SendMessage`，因此 coder↔reviewer 永远不会直接对话 —— orchestrator 是中枢。）
- **跨会话（重启 / `--resume` 之后）—— transcript 暖播种：** `SendMessage` **仅在会话内有效**；上一会话的 worker 已不存在（`agentId` 是死句柄）。此时 lead 不再 `SendMessage`，而是把评审员的**持久 transcript**（`agent-<agentId>.jsonl`）读回，**暖播种**一个全新的同角色评审员——新 `agentId`，但带着前任的完整上下文，仍只复审增量。run-state 在每个 stage 记录 worker 的 `agentId` + `transcript` 指针正是为此；`rasen pipeline resume` 的 `workers` 字段把这些指针透出来。这才是平台允许范围内"真正恢复评审员"的最接近形态。
- **任何其他工具，或开关关闭，或 transcript 已失效：** 降级 —— 运行一次**范围限定为增量的全新评审**，通过一份共享文件（如该 change 的 `review.md` / `FINDINGS.md`）传递原始问题清单。行为等价，只是代价更高。

生成的 Claude 技能（`.claude/skills/openspec-review-cycle/SKILL.md`）记录恢复路径；通用技能正文记录降级路径。这一切以指令文本表达 —— **OpenSpec 核心中不含任何工具特定代码**，与适配器模型保持一致。

---

## 6. 实现计划（具体方案，与真实流水线对齐）

> 复刻 `verify-enhanced`/`ship` 的引入方式（进行中的 change `add-opsx-fusion-commands`）。

1. **新增工作流模板** `src/core/templates/workflows/review-cycle.ts`
   - `export function getReviewCycleSkillTemplate(): SkillTemplate` —— 工具无关的循环指令（§4）+ Claude 恢复说明 + 降级（§5）。引用调用 `openspec-review` 作为评审引擎。
   - `export function getOpsxReviewCycleCommandTemplate(): CommandTemplate` —— `name: 'OPSX: Review Cycle'`、`category: 'Workflow'`、`tags: ['workflow','review','experimental']`，内容相同。
2. 从 `src/core/templates/skill-templates.ts` **导出**：
   `export { getReviewCycleSkillTemplate, getOpsxReviewCycleCommandTemplate } from './workflows/review-cycle.js';`
3. 在 `src/core/shared/skill-generation.ts` 中**注册**：
   - 加入 `getSkillTemplates()` 的 `workflowSkills`：`{ template: getReviewCycleSkillTemplate(), dirName: 'openspec-review-cycle', workflowId: 'review-cycle' }`
   - 加入 `getCommandTemplates()`：`{ template: getOpsxReviewCycleCommandTemplate(), id: 'review-cycle' }`
   - 在文件顶部添加 import。
4. **Profiles** `src/core/profiles.ts`：将 `'review-cycle'` 加入 `ALL_WORKFLOWS`。将其排除在 `CORE_WORKFLOWS` 之外（可选启用，与其他融合命令一致）。
5. **复用而非重复评审引擎**：指令调用现有的 `openspec-review` 专家技能（始终安装）来做评审/复审判断；review-cycle 只负责*循环 + 分级 + 不变量 + 终止 + 恢复*。
6. **适配器**：无需改动 —— 生成过程会自动向所有工具扇出；Claude 适配器会产出 `.claude/skills/openspec-review-cycle/SKILL.md` + `.claude/commands/opsx/review-cycle.md`。
7. **可选的 schema 提示（独立、可选）**：一个分叉出的 schema `spec-driven-reviewed`，其 `apply.instruction` 将 `/rasen:review-cycle` 指向为推荐的下一步。**不要**修改核心的 `spec-driven` schema。这纯属建议性质；该工作流没有它也能运行。
8. **文档**：实现后，向 `docs/commands.md` + `docs/workflows.md`（及 `docs/zh/` 镜像）添加面向用户的章节；本设计文档是其立论依据。

### 涉及的文件
- 新增：`src/core/templates/workflows/review-cycle.ts`。
- 编辑：`src/core/templates/skill-templates.ts`、`src/core/shared/skill-generation.ts`、`src/core/profiles.ts`。
- 新增测试：`test/commands/review-cycle.test.ts`（外加在 skill-generation/profile 测试中的断言）。
- 文档：现阶段是本文件；实现时补 `docs/commands.md` / `docs/workflows.md`（+ zh）。
- 不改动：`schemas/spec-driven/**`、artifact-graph 代码、archive/validate 核心。

---

## 7. 测试策略（遵循仓库惯例 —— vitest、临时文件系统、无快照）

- **生成**：一个测试，验证 `getSkillTemplates()`/`getCommandTemplates()` 包含 `review-cycle`，并验证 `rasen init --tools claude`（输出到临时目录）会物化出 `.claude/skills/openspec-review-cycle/SKILL.md` + `.claude/commands/opsx/review-cycle.md`。
- **Profile 过滤**：`review-cycle` 在 expanded/custom 下存在，在 `core` 下缺失（它是可选启用的）。
- **适配器扇出**：抽查另外 2–3 个工具适配器，确认它们同样产出该命令/技能。
- **指令内容不变量**：生成的技能文本应包含作者≠验证者规则、最大轮次/上报条款，以及 Claude 恢复路径和工具无关降级路径**两者**。
- 遵循 `test/commands/*.test.ts`：`os.tmpdir()`、`XDG_CONFIG_HOME` 隔离、`vi.resetModules()`、动态 `import()`。无快照。

---

## 8. 待定问题

1. **Core 还是 expanded profile** —— 提议：expanded/可选启用。需与维护者确认（与融合命令先例一致）。
2. **独立命令 还是 并入 `verify-enhanced`** —— `verify-enhanced` 已经会做一遍多阶段验证；`review-cycle` 应作为其同级兄弟，还是应将该循环并入 `verify-enhanced`？提议：**同级兄弟**（单一职责 = 迭代式修复循环），在 `verify-enhanced` 之前组合执行。需要拍板。
3. **对于没有可寻址 subagent 的工具，如何表达"作者 ≠ 验证者"？** 对于没有独立评审员身份的工具，该不变量降级为"对增量的一次独立评审通过"+ orchestrator 的独立 gate 重跑。须明确记录这一降级。
4. **默认最大轮次**（提议 3），以及它是否可通过 `rasen/config.yaml` 的 `rules` 配置。
5. **与进行中的 `add-opsx-fusion-commands` change 的关系/排序** —— `review-cycle` 应被加*入*那个 change，还是在其之后作为自己独立的 change 落地？提议：作为依赖于融合 change 的独立 change（这样它复用的 gstack `review` 技能届时已存在）。

---

## 9. 提升为 OpenSpec change

OpenSpec 对自身做 dogfood（`rasen/changes/`）。要把这份设计变成一个被追踪的 change（这是维护者对此规模功能的惯例）：

```bash
cd <OpenSpec-code>
rasen new change add-review-cycle-workflow      # or: /rasen:propose "add review-cycle iterative review→fix→re-review workflow"
```

然后填充：
- `proposal.md` —— §1 动机、§2 改动内容、capabilities（`New: review-cycle-workflow`）、Impact（§6 涉及的文件）。
- `design.md` —— §3–§5（轴决策、循环、agent-teams + 降级）。
- `tasks.md` —— §6 各步骤作为清单 + §7 测试。
- `specs/review-cycle-workflow/spec.md` —— 增量需求，例如：

```markdown
## ADDED Requirements

### Requirement: Iterative review→fix→re-review loop
The `review-cycle` workflow SHALL drive review → fix → re-review iterations until all Blocker/Major findings are resolved and independently confirmed, or a maximum round count is reached.

#### Scenario: Fix is independently re-reviewed
- **WHEN** a finding from the review step is fixed
- **THEN** the fix is confirmed by a reviewer who did not author the fix
- **AND** the confirmation checks the fix against the original finding

#### Scenario: Unresolved findings escalate, never silently pass
- **WHEN** the maximum round count is reached with unresolved Blocker/Major findings
- **THEN** the workflow stops and surfaces the residual findings to the human
- **AND** does not report the change as review-clean

### Requirement: Tool-agnostic with optional Claude acceleration
The workflow SHALL be expressed tool-agnostically; on Claude Code with agent-teams enabled it MAY resume the original reviewer to re-review only the delta, and MUST fall back to a fresh delta review (with findings passed via a shared file) when resume is unavailable.

#### Scenario: Resume unavailable degrades gracefully
- **WHEN** the agent-teams resume capability is unavailable
- **THEN** the re-review is performed as a fresh review scoped to the fix delta
- **AND** the loop's outcome is equivalent (only more expensive)
```

通过常规的 `rasen validate` / `/rasen:apply` / `rasen archive` 流程进行验证 + 应用 + 归档。

---

## 10. 参考（本仓库中的真实路径）
- Schema 模型：`schemas/spec-driven/schema.yaml`；图 `src/core/artifact-graph/graph.ts`，类型 `src/core/artifact-graph/types.ts`，加载器 `src/core/artifact-graph/instruction-loader.ts`。
- 命令/技能流水线：`src/core/templates/workflows/*.ts`、`src/core/templates/skill-templates.ts`、`src/core/shared/skill-generation.ts`、`src/core/profiles.ts`，适配器 `src/core/command-generation/adapters/`。
- 复用的评审引擎：`src/core/templates/experts/review.ts`（以 `openspec-review` 安装）。
- 融合先例：`rasen/changes/add-opsx-fusion-commands/`（office-hours、verify-enhanced、ship、retro、auto + `hooks/safety-check.sh`）。
- 文档惯例：`docs/concepts.md`、`docs/opsx.md`、`docs/commands.md`、`docs/workflows.md`、`docs/customization.md`（+ `docs/zh/`）。
- 测试：`test/commands/*.test.ts`、`vitest.config.ts`。
