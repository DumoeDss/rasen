# 工作流

本指南涵盖 OpenSpec 的常见工作流模式以及每种模式的适用场景。基础设置请参阅 [快速入门](getting-started.md)。命令参考请参阅 [命令](commands.md)。

## 理念：操作而非阶段

传统工作流强制你经历各个阶段：先规划、再实施、最后完成。但实际工作并不能整齐地放进这些框框里。

OPSX 采用了不同的方式：

```text
Traditional (phase-locked):

  PLANNING ────────► IMPLEMENTING ────────► DONE
      │                    │
      │   "Can't go back"  │
      └────────────────────┘

OPSX (fluid actions):

  proposal ──► specs ──► design ──► tasks ──► implement
```

**核心原则：**

- **操作而非阶段** - 命令是你可以执行的操作，而不是把你困在其中的阶段
- **依赖关系是推动者** - 它们展示的是可能性，而不是下一步必须做什么

> **自定义：** OPSX 工作流由定义产物序列的 schema 驱动。有关创建自定义 schema 的详情，请参阅 [自定义](customization.md)。

## 两种模式

### 默认快速路径（`core` profile）

新安装默认使用 `core`，提供以下命令：
- `/rasen:explore`
- `/rasen:propose`
- `/rasen:apply`
- `/rasen:sync`
- `/rasen:archive`

典型流程：

```text
/rasen:explore ──► /rasen:propose ──► /rasen:apply ──► /rasen:sync ──► /rasen:archive
  (optional)
```

#### 从探索开始（值得养成的习惯）

`/rasen:explore` 是默认 profile 的一部分，而不是什么高级附加功能。只要你有一个问题、却还没有方案时，就该用它——而在有 AI 助手的情况下，这大半时间都成立。

```text
You: /rasen:explore

AI:  What would you like to explore?

You: Our search results feel stale. I'm not sure if it's caching,
     indexing, or the query itself.

AI:  Let me look... [reads the search service and cache layer]
     It's the index: it only rebuilds nightly, so edits don't show
     up until the next day. Two options: rebuild on write (simple,
     more load) or a short-TTL cache invalidation (more moving parts,
     less load). Given your write volume is low, rebuild-on-write is
     the cleaner fix. Want to scope it?

You: Yes.

You: /rasen:propose rebuild-search-index-on-write
```

探索不会创建任何产物，也不会编写任何代码。它是一场免费的、零成本的对话，把一个模糊的担忧变成一个精确的变更，因此随后产出的提案会很犀利。已经确切知道想要什么？跳过它，直接用 `/rasen:propose`。完整指南：[先探索](explore.md)。

### 扩展/完整工作流（自定义选择）

如果你需要显式的脚手架和构建命令（`/rasen:new`、`/rasen:continue`、`/rasen:verify`、`/rasen:bulk-archive`、`/rasen:onboard`），通过以下方式启用：

```bash
rasen config profile
rasen update
```

## 工作流模式（扩展模式）

### 快速功能开发

当你清楚要构建什么、只需要执行时：

```text
/rasen:propose ──► /rasen:apply ──► /rasen:verify ──► /rasen:archive
```

**对话示例：**

```text
You: /rasen:propose add-logout-button

AI:  Created rasen/changes/add-logout-button/
     Creating all planning artifacts...
     ✓ proposal.md
     ✓ specs/
     ✓ design.md
     ✓ tasks.md
     Ready for implementation!

You: /rasen:apply

AI:  Working through tasks...
     ✓ Added logout button to header
     ✓ Implemented session clearing
     ✓ Added confirmation dialog
     All tasks complete!

You: /rasen:archive

AI:  ✓ Merged specs
     ✓ Archived change
```

**最适合：** 中小型功能、bug 修复、简单直接的变更。

### 探索式开发

当需求不明确或需要先调查研究时：

```text
/rasen:explore ──► /rasen:new ──► /rasen:continue ──► ... ──► /rasen:apply
```

**对话示例：**

```text
You: /rasen:explore

AI:  What would you like to explore?

You: I want to improve page load performance but I'm not sure
     where the bottlenecks are.

AI:  Let me help investigate...
     [Analyzes bundle sizes, identifies slow queries, reviews
     component render patterns]

     I found three main bottlenecks:
     1. Large unoptimized images
     2. Synchronous data fetching in ProductList
     3. Re-renders from context changes

     Which would you like to address first?

You: Let's tackle the data fetching issue.

You: /rasen:new optimize-product-list-fetching

AI:  Created change. Ready to create: proposal

You: /rasen:continue

AI:  Creating proposal based on our exploration...
     [Writes proposal incorporating investigation insights]

     Ready to create: specs, design
     Which would you like next?

You: /rasen:continue

AI:  Creating specs...
```

**最适合：** 性能优化、调试、架构决策、需求不明确的场景。

### 并行变更

同时处理多个变更：

```text
Change A: /rasen:propose ──► /rasen:apply (in progress)
                               │
                          context switch
                               │
Change B: /rasen:propose ──────► /rasen:apply
```

**对话示例：**

```text
You: I'm working on add-dark-mode but got pulled into a bug fix

You: /rasen:propose fix-login-redirect

AI:  Created rasen/changes/fix-login-redirect/
     ✓ Created planning artifacts

You: /rasen:apply

AI:  Working on fix-login-redirect...
     [Implements the fix]
     All tasks complete!

You: /rasen:archive

AI:  ✓ Archived fix-login-redirect

You: Let's get back to dark mode

You: /rasen:apply add-dark-mode

AI:  Resuming add-dark-mode...
     Picking up at task 2.3: Update Header...
```

**最适合：** 并行工作流、紧急中断、团队协作。

当你有多个已完成的变更时，使用 `/rasen:bulk-archive`：

```text
You: /rasen:bulk-archive

AI:  Found 3 completed changes:
     - add-dark-mode (all tasks done)
     - fix-login-redirect (all tasks done)
     - update-footer (all tasks done)

     Checking for spec conflicts...
     ⚠ add-dark-mode and update-footer both touch specs/ui/

     Inspecting codebase to resolve...
     Both changes are implemented. Will apply in chronological order.

     Archive all 3 changes?

You: Yes

AI:  ✓ Archived add-dark-mode
     ✓ Archived fix-login-redirect
     ✓ Archived update-footer
     Specs merged in order: add-dark-mode → update-footer
```

批量归档会检测多个变更是否涉及相同的 specs，并通过检查实际实现来解决冲突。

### 完成变更

推荐的完成流程：

```text
/rasen:apply ──► /rasen:verify ──► /rasen:archive
                    │                 │
              validates          prompts to sync
              implementation     if needed
```

#### 验证：检查你的工作

`/rasen:verify` 从三个维度验证实现是否符合产物：

```text
You: /rasen:verify

AI:  Verifying add-auth...

     COMPLETENESS
     ✓ All 12 tasks in tasks.md are checked
     ✓ All requirements in specs have corresponding code
     ⚠ Scenario "Session timeout after inactivity" not tested

     CORRECTNESS
     ✓ Implementation matches spec intent
     ✓ Edge cases from scenarios are handled
     ✓ Error states match spec definitions

     COHERENCE
     ✓ Design decisions reflected in code structure
     ✓ Naming conventions consistent with design.md
     ⚠ Design mentions "event-driven" but implementation uses polling

     SUMMARY
     ─────────────────────────────
     Critical issues: 0
     Warnings: 2
     Ready to archive: Yes (with warnings)

     Recommendations:
     1. Add test for session timeout scenario
     2. Consider refactoring to event-driven as designed, or update design.md
```

**验证检查的内容：**

| 维度 | 验证内容 |
|-----------|------------------|
| 完整性 | 所有任务已完成、所有需求已实现、场景已覆盖 |
| 正确性 | 实现符合规格意图、边界情况已处理 |
| 一致性 | 设计决策体现在代码中、模式保持一致 |

验证不会阻止归档，但会暴露你可能想先解决的问题。

#### 审查循环：循环直至干净（可选）

`/rasen:verify` 是单次通过；`/rasen:review-cycle` 则是包裹审查器、持续推进直到变更真正干净的**循环**：

```text
review ──► triage ──► fix ──► re-review(Δ) ──► { pass | loop | escalate }
```

每一轮审查都委托给始终安装的 `openspec-review` 引擎 —— 循环本身不重新实现审查启发式。它在此之上增加四件事：

- **按修复规模分诊。** 每条发现按其修复规模路由：**琐碎（trivial）** → 编排者就地修复；**非琐碎（non-trivial）** → 编写该代码的实现 agent；**设计级（design-level）** → 单独的修复 agent（而非原作者）。
- **作者≠验证者。** 只有当确认者不是修复作者、并对照原始发现确认后，发现才算解决。对于琐碎的就地修复，等价的非作者检查是一次独立的门禁运行（测试/lint/构建）加上对该改动的 diff 阅读 —— 且必须记入循环报告。
- **只复审增量。** 在启用 agent-teams 的 Claude Code（`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`）上，lead 可通过 `SendMessage` 唤回原审查器只复审增量（仅 lead 可发起 `SendMessage`）。否则回退为全新的增量审查，将先前发现与修复 diff 通过共享文件传入 —— 结果等价，只是成本更高。
- **有界终止。** 循环上限为最大轮次（默认 3）。达到上限且仍有未解决的 Blocker/Major 发现时，连同开放发现与轮次历史一并上报给人类 —— 绝不静默报告通过。

在实现**之后**针对实时 diff 使用。它是可选项：通过自定义 profile 启用（不在 `core` 中）。轮次历史与每条非作者确认会记录在变更目录下的 `review-cycle-report.md`。

#### 归档：最终完成变更

`/rasen:archive` 完成变更并将其移至归档：

```text
You: /rasen:archive

AI:  Archiving add-auth...

     Artifact status:
     ✓ proposal.md exists
     ✓ specs/ exists
     ✓ design.md exists
     ✓ tasks.md exists (12/12 tasks complete)

     Delta specs: Not yet synced to main
     → Would you like to sync now?

You: Yes

AI:  ✓ Synced specs to rasen/specs/auth/spec.md
     ✓ Moved to rasen/changes/archive/2025-01-24-add-auth/

     Change archived successfully.
```

如果 specs 尚未同步，归档时会进行提示。它不会因未完成的任务而阻止归档，但会发出警告。

## 何时使用什么

### `/rasen:propose` 与 `/rasen:continue` 的对比

| 场景 | 使用 |
|------|------|
| 需求明确，准备构建 | `/rasen:propose` |
| 探索中，想逐步审查 | `/rasen:new` 然后 `/rasen:continue` |
| 想在 specs 之前迭代 proposal | `/rasen:new` 然后 `/rasen:continue` |
| 时间紧迫，需要快速推进 | `/rasen:propose` |
| 复杂变更，需要精细控制 | `/rasen:new` 然后 `/rasen:continue` |

**经验法则：** 如果你能提前描述完整范围，使用 `/rasen:propose`。如果你在过程中逐步摸索，使用 `/rasen:new` 然后 `/rasen:continue`。

### 何时更新已有变更 vs 重新开始

一个常见问题：什么时候可以更新现有变更，什么时候应该新建一个？

**更新现有变更的情况：**

- 意图相同，执行方式改进
- 范围缩小（先做 MVP，其余以后再说）
- 基于学习的修正（代码库与预期不符）
- 基于实现发现的设计调整

**新建变更的情况：**

- 意图发生了根本性变化
- 范围扩展成了完全不同的工作
- 原始变更可以独立标记为「完成」
- 补丁会带来更多困惑而非清晰

```text
                     ┌─────────────────────────────────────┐
                     │     Is this the same work?          │
                     └──────────────┬──────────────────────┘
                                    │
                 ┌──────────────────┼──────────────────┐
                 │                  │                  │
                 ▼                  ▼                  ▼
          Same intent?      >50% overlap?      Can original
          Same problem?     Same scope?        be "done" without
                 │                  │          these changes?
                 │                  │                  │
       ┌────────┴────────┐  ┌──────┴──────┐   ┌───────┴───────┐
       │                 │  │             │   │               │
      YES               NO YES           NO  NO              YES
       │                 │  │             │   │               │
       ▼                 ▼  ▼             ▼   ▼               ▼
    UPDATE            NEW  UPDATE       NEW  UPDATE          NEW
```

**示例：「添加深色模式」**

- "还需要支持自定义主题" → 新建变更（范围扩展）
- "系统偏好检测比预期更困难" → 更新（意图相同）
- "先上线切换功能，偏好设置以后再加" → 更新后归档，然后新建变更

## 最佳实践

### 保持变更聚焦

每个变更对应一个逻辑工作单元。如果你在做「添加功能 X 同时重构 Y」，考虑拆分为两个独立变更。

**为什么这很重要：**
- 更容易审查和理解
- 更清晰的归档历史
- 可以独立发布
- 需要时回滚更简单

### 需求不明确时使用 `/rasen:explore`

在提交变更之前，先探索问题空间：

```text
You: /rasen:explore

AI:  What would you like to explore?

You: How should we handle rate limiting for our API?

AI:  Let me investigate your current setup and options...
     [Researches codebase, considers patterns]

     I see three approaches we could take:
     1. Middleware-based (simple, per-endpoint)
     2. Redis-backed (scalable, shared state)
     3. Token bucket per user (fair, complex)

     Your current stack suggests #1 or #2. What's your scale?
```

探索可以在创建产物之前理清思路。

### 归档前先验证

使用 `/rasen:verify` 检查实现是否与产物匹配：

```text
You: /rasen:verify

AI:  Verifying add-dark-mode...

     ✓ All tasks in tasks.md are checked
     ✓ Requirements in specs have corresponding code
     ✓ Design decisions are reflected in implementation

     Ready to archive!
```

在关闭变更之前捕获不一致之处。

### 清晰命名变更

好的命名让 `rasen list` 更加实用：

```text
Good:                          Avoid:
add-dark-mode                  feature-1
fix-login-redirect             update
optimize-product-query         changes
implement-2fa                  wip
```

## 命令快速参考

完整命令详情和选项请参阅 [命令](commands.md)。

| 命令 | 用途 | 适用场景 |
|---------|---------|-------------|
| `/rasen:propose` | 创建变更 + 规划产物 | 快速默认路径（`core` profile） |
| `/rasen:explore` | 和 AI 一起思考想法 | 不确定时从这里开始：需求不明确、调查研究、比较方案 |
| `/rasen:new` | 创建变更脚手架 | 扩展模式，显式产物控制 |
| `/rasen:continue` | 创建下一个产物 | 扩展模式，逐步创建产物 |
| `/rasen:apply` | 实施任务 | 准备编写代码 |
| `/rasen:verify` | 验证实现 | 扩展模式，归档前 |
| `/rasen:sync` | 合并增量规格 | 扩展模式，可选 |
| `/rasen:archive` | 完成变更 | 所有工作已完成 |
| `/rasen:bulk-archive` | 归档多个变更 | 扩展模式，并行工作 |

## 后续步骤

- [编写好的规格](writing-specs.md) - 什么是强有力的需求和场景，以及如何把变更规模定得合适
- [审查变更](reviewing-changes.md) - 在写任何代码之前，对草案计划的两分钟快速过审
- [团队中的 OpenSpec](team-workflow.md) - 变更如何配合分支和 pull request
- [命令](commands.md) - 完整命令参考及选项
- [概念](concepts.md) - 深入了解 specs、产物和 schemas
- [自定义](customization.md) - 创建自定义工作流
