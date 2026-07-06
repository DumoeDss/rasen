# gen-skill-docs.ts 技术文档

`scripts/gen-skill-docs.ts`（约 2400 行）是 gstack 技能文档的生成引擎。它从 `SKILL.md.tmpl` 模板文件中读取内容，将 `{{占位符}}` 替换为由 TypeScript 函数动态生成的标准化内容段落，输出最终的 `SKILL.md` 文件供 AI Agent 消费。

本脚本的设计目标是**单一来源（Single Source of Truth）**：所有技能共享的通用方法论（QA 流程、测试覆盖审计、设计审查清单等）只在 TypeScript 函数中维护一份，通过占位符注入到各个技能文档中，避免跨文件复制粘贴导致的内容不一致。

---

## 运行方式

```bash
# 生成所有 SKILL.md（Claude 宿主，默认）
bun run gen:skill-docs

# 生成 Codex/Agents 宿主版本
bun run gen:skill-docs --host codex

# 干跑模式：仅检查 SKILL.md 是否过期，不写入文件（CI 使用）
bun run gen:skill-docs --dry-run
```

对应的 `package.json` 脚本：

| 脚本名 | 命令 | 用途 |
|--------|------|------|
| `gen:skill-docs` | `bun run scripts/gen-skill-docs.ts` | 重新生成所有 SKILL.md |
| `skill:check` | `bun run scripts/gen-skill-docs.ts --dry-run` | CI 中检测 SKILL.md 是否过期 |

### 命令行参数

| 参数 | 说明 |
|------|------|
| `--dry-run` | 不写入文件，仅在内存中生成并与磁盘文件比对，过期则 exit 1 |
| `--host claude` | 生成 Claude 宿主版本（默认值） |
| `--host codex` 或 `--host agents` | 生成 Codex 宿主版本，输出到 `.agents/skills/` |

---

## 整体处理流程

```
SKILL.md.tmpl ──读取──▶ 提取 YAML frontmatter（name、benefits-from）
                            │
                            ▼
                   正则扫描 {{占位符}}
                            │
                            ▼
                    RESOLVERS 映射表匹配
                    ┌────────┼────────┐
                    ▼        ▼        ▼
              generateXxx  generateYyy  ...
              (每个函数接收 TemplateContext)
                    └────────┼────────┘
                             ▼
                      替换后的完整文档
                             │
                             ▼
                  插入 AUTO-GENERATED 头部注释
                             │
                    ┌────────┴────────┐
                    ▼                 ▼
              Claude 宿主         Codex 宿主
            (原样输出到           (裁剪 frontmatter、
          skills/gstack/)       替换路径、注入安全提示、
                                输出到 .agents/skills/)
```

---

## 核心数据结构

### TemplateContext — 模板上下文

每次处理一个 `.tmpl` 文件时，脚本会构建一个 `TemplateContext` 对象并传递给所有占位符解析函数。这是解析函数访问技能元信息和宿主配置的唯一途径。

```typescript
interface TemplateContext {
  skillName: string;       // 从 frontmatter 的 name 字段读取，如 "autoplan"
  tmplPath: string;        // .tmpl 文件的绝对路径
  benefitsFrom?: string[]; // 前置技能列表，如 ["office-hours"]
  host: Host;              // "claude" 或 "codex"，决定路径和输出行为
  paths: HostPaths;        // 宿主对应的路径常量集合
}
```

各字段的来源：

- `skillName`：正则 `/^name:\s*(.+)$/m` 从 frontmatter 中提取；如匹配失败，回退到 `.tmpl` 文件的父目录名。
- `benefitsFrom`：正则 `/^benefits-from:\s*\[([^\]]*)\]/m` 提取 YAML 内联数组，如 `benefits-from: [office-hours, browse]`。
- `host`：由 CLI 参数 `--host` 决定，默认 `"claude"`。
- `paths`：从 `HOST_PATHS` 常量表查表获取。

### HostPaths — 宿主路径映射

Claude 和 Codex 两种宿主使用完全不同的技能安装路径体系。生成函数通过 `ctx.paths` 引用路径，使得同一段逻辑可以输出到两种宿主。

| 字段 | Claude 值 | Codex 值 | 说明 |
|------|-----------|----------|------|
| `skillRoot` | `~/.claude/skills/gstack` | `$GSTACK_ROOT` | 全局技能安装根目录 |
| `localSkillRoot` | `.claude/skills/gstack` | `.agents/skills/gstack` | 项目内技能目录（相对路径） |
| `binDir` | `~/.claude/skills/gstack/bin` | `$GSTACK_BIN` | 工具脚本目录 |
| `browseDir` | `~/.claude/skills/gstack/browse/dist` | `$GSTACK_BROWSE` | 浏览器二进制所在目录 |

Codex 路径使用环境变量（`$GSTACK_ROOT` 等），因为 Codex 在沙盒中运行，技能安装位置在运行时动态确定。

### YAML Frontmatter 格式

每个 `SKILL.md.tmpl` 文件以 YAML frontmatter 开头，定义技能的元数据：

```yaml
---
name: autoplan
version: 1.0.0
description: |
  Auto-review pipeline — reads the full CEO, design, and eng review skills
  from disk and runs them sequentially with auto-decisions.
benefits-from: [office-hours]
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
hooks:
  PreToolUse:
    - matcher: "Edit"
      hooks:
        - type: command
          command: "bash ${CLAUDE_SKILL_DIR}/bin/check-freeze.sh"
---
```

脚本从 frontmatter 中仅提取 `name` 和 `benefits-from` 两个字段，其余字段由 Claude/Codex 框架直接消费。

---

## 占位符系统详解

### 工作机制

脚本核心是 `RESOLVERS` 映射表（`Record<string, (ctx: TemplateContext) => string>`），将占位符名称映射到生成函数。`processTemplate()` 使用正则 `/\{\{(\w+)\}\}/g` 扫描模板内容，遇到 `{{NAME}}` 时查找 `RESOLVERS["NAME"]` 对应的函数并调用，用返回的字符串替换占位符。

如果遇到未注册的占位符名称，脚本会抛出 `Error: Unknown placeholder`。替换完成后还会二次检查是否有残留的 `{{...}}`，确保所有占位符都被完全解析。

### 全量占位符一览

共 20 个占位符，按功能分组说明如下。

---

#### 一、初始化与环境检测

##### `{{PREAMBLE}}` — 核心前导块

**生成函数**：`generatePreamble(ctx)`

这是最大、最复杂的占位符。它将 9 个子函数的输出用 `\n\n` 连接为一个完整的前导内容块。几乎所有使用 `{{PREAMBLE}}` 的技能（autoplan、benchmark、browse、canary 等）都会在文档开头插入这段内容，确保每个技能启动时执行相同的初始化检查。

9 个子函数及其详细说明：

| 序号 | 子函数 | 说明 |
|------|--------|------|
| 1 | `generatePreambleBash(ctx)` | 生成一段 bash 脚本代码块，技能启动时首先执行 |
| 2 | `generateUpgradeCheck(ctx)` | gstack 版本升级检查的处理指南 |
| 3 | `generateLakeIntro()` | "Boil the Lake" 完整性原则的首次介绍 |
| 4 | `generateAskUserFormat(ctx)` | AskUserQuestion 的标准格式规范 |
| 5 | `generateCompletenessSection()` | 完整性原则的详细说明 |
| 6 | `generateRepoModeSection()` | 仓库所有权模式的行为指引 |
| 7 | `generateSearchBeforeBuildingSection(ctx)` | "先搜索再构建"原则 |
| 8 | `generateContributorMode()` | 贡献者模式的报告机制 |
| 9 | `generateCompletionStatus()` | 完成状态协议与计划文件状态尾部 |

**子函数 1：`generatePreambleBash(ctx)`**

生成一段 bash 脚本，在技能启动时执行以收集运行环境信息。Codex 宿主会在脚本开头额外插入 `$GSTACK_ROOT` 等环境变量的运行时解析逻辑。

该脚本收集以下信息并输出到 stdout：

| 输出变量 | 来源 | 用途 |
|----------|------|------|
| `_UPD` | `gstack-update-check` | 检查 gstack 是否有新版本 |
| `_SESSIONS` | `~/.gstack/sessions/` 目录下的文件计数 | 统计最近 2 小时内的并发会话数 |
| `_CONTRIB` | `gstack-config get gstack_contributor` | 是否启用贡献者模式 |
| `_PROACTIVE` | `gstack-config get proactive` | 是否主动推荐技能（默认 true） |
| `_BRANCH` | `git branch --show-current` | 当前分支名 |
| `REPO_MODE` | `gstack-repo-mode` 脚本 | solo / collaborative / unknown |
| `_LAKE_SEEN` | `~/.gstack/.completeness-intro-seen` 是否存在 | 是否已展示过完整性原则介绍 |

这些变量在后续子函数的指令中被引用。例如，`generateRepoModeSection()` 的行为取决于 `REPO_MODE` 的值。

**子函数 2：`generateUpgradeCheck(ctx)`**

指导 AI Agent 如何响应版本检查结果：
- 如果 `PROACTIVE` 为 `"false"`，不主动推荐技能
- 如果输出 `UPGRADE_AVAILABLE <old> <new>`，读取 `gstack-upgrade/SKILL.md` 执行升级流程
- 如果输出 `JUST_UPGRADED <from> <to>`，告知用户已升级

**子函数 3：`generateLakeIntro()`**

在首次使用时（`_LAKE_SEEN` 为 `no`）向用户介绍 "Boil the Lake"（烧干湖水）原则——当 AI 使边际成本趋近于零时，应始终追求完整实现。展示后写入 `~/.gstack/.completeness-intro-seen` 标记文件，确保只出现一次。

**子函数 4：`generateAskUserFormat(ctx)`**

规定了所有 `AskUserQuestion` 调用必须遵循的 4 步结构：

1. **重定位（Re-ground）**：说明当前项目和分支
2. **简化（Simplify）**：用非技术语言解释问题
3. **推荐（Recommend）**：给出推荐选项和完整性评分（1-10）
4. **选项（Options）**：字母编号选项，显示人力/AI 工时估算

核心假设是"用户已经 20 分钟没看屏幕了"，因此解释必须自包含、无需上下文。

**子函数 5：`generateCompletenessSection()`**

完整性原则的详细阐述，包括：

- **Lake vs Ocean 区分**："Lake"（可做完的事）如模块级 100% 测试覆盖；"Ocean"（不可做完的事）如从零重写整个系统
- **工时压缩比参考表**：6 种任务类型的人力 vs AI 时间对比（如脚手架代码 2 天 → 15 分钟，约 100 倍压缩）
- **反模式清单**：4 个具体的"不应该这样做"示例

**子函数 6：`generateRepoModeSection()`**

根据 `REPO_MODE` 定义两种行为模式：

- **solo 模式**：一个人负责 80%+ 的工作。发现问题时主动调查并提出修复，因为"你是唯一会修它的人"
- **collaborative 模式**：多人协作。发现问题时仅标记并询问，可能是别人的职责
- **unknown**：安全默认，按 collaborative 模式行事

配合"See Something, Say Something"原则——在任何工作流步骤中发现问题都必须标记，永不静默忽略。

**子函数 7：`generateSearchBeforeBuildingSection(ctx)`**

在构建任何基础设施或不熟悉的模式之前，强制要求先搜索。定义了三层知识模型：

- **Layer 1**（分内知识）：成熟的常规做法，不要重新发明轮子
- **Layer 2**（新流行）：需要搜索但要审慎对待，搜索结果是输入而非答案
- **Layer 3**（第一性原理）：从问题本身推导出的原创见解，价值最高

特别定义了"Eureka Moment"机制——当第一性原理推理揭示传统智慧的错误时，记录到 `~/.gstack/analytics/eureka.jsonl` 本地文件。

**子函数 8：`generateContributorMode()`**

当 `_CONTRIB` 为 `true` 时启用。在每个主要工作流步骤结束后，AI Agent 会反思工具体验并评分。如果发现可报告的 bug 或改进点，写入 `~/.gstack/contributor-logs/{slug}.md` 的标准格式报告。限制每个会话最多 3 份报告，不中断工作流。

**子函数 9：`generateCompletionStatus()`**

定义技能完成时的四种状态码：
- `DONE`：全部成功
- `DONE_WITH_CONCERNS`：完成但有需关注的问题
- `BLOCKED`：无法继续，说明阻塞原因
- `NEEDS_CONTEXT`：缺少继续所需的信息

还包含升级（Escalation）协议——允许 AI Agent 在尝试 3 次失败后、安全敏感变更不确定时、或超出可验证范围时停止并上报。

此外还包含 **Plan Status Footer** 部分：在退出 plan 模式前，读取审查日志并在计划文件末尾写入 `## GSTACK REVIEW REPORT` 表格。

##### `{{BROWSE_SETUP}}` — 浏览器环境初始化

**生成函数**：`generateBrowseSetup(ctx)`

生成一段 bash 脚本，用于检测 browse 二进制文件是否已编译就绪：
1. 先检查项目本地 `.claude/skills/gstack/browse/dist/browse` 是否可执行
2. 回退到全局安装路径
3. 如果找到可执行文件，输出 `READY: $B`（后续所有 browse 命令使用 `$B` 变量调用）
4. 如果未找到，输出 `NEEDS_SETUP`，提示用户运行一次性构建

##### `{{BASE_BRANCH_DETECT}}` — PR 目标分支检测

**生成函数**：`generateBaseBranchDetect(ctx)`

三级回退逻辑确定 PR 的目标分支：
1. `gh pr view --json baseRefName` — 已有 PR 时直接获取
2. `gh repo view --json defaultBranchRef` — 无 PR 时获取仓库默认分支
3. 硬编码回退到 `main`

检测结果在后续所有 `git diff`、`git log`、`gh pr create` 命令中作为 base 分支使用。

---

#### 二、浏览器命令文档

##### `{{COMMAND_REFERENCE}}` — 命令参考表

**生成函数**：`generateCommandReference(ctx)`

**数据源**：`browse/src/commands.ts` 中的 `COMMAND_DESCRIPTIONS` 对象

从代码中读取所有 browse 命令的元数据（命令名、分类、描述、用法示例），按 9 个分类（Navigation、Reading、Interaction、Inspection、Visual、Snapshot、Meta、Tabs、Server）分组，每个分类内按字母排序，生成 Markdown 表格。

这确保了 SKILL.md 中的命令文档与实际二进制支持的命令始终同步——添加新命令只需修改 `commands.ts`，重新生成即可。

##### `{{SNAPSHOT_FLAGS}}` — 快照命令标志文档

**生成函数**：`generateSnapshotFlags(ctx)`

**数据源**：`browse/src/snapshot.ts` 中的 `SNAPSHOT_FLAGS` 数组

将快照命令的所有标志格式化为对齐的文本表格（短标志、长标志、描述），并附加用法说明：

- `@e` refs（元素引用）和 `@c` refs（cursor-interactive 引用）的编号规则
- 引用在导航后失效的注意事项
- 各种组合用法示例

---

#### 三、QA 与设计审查

##### `{{QA_METHODOLOGY}}` — QA 测试方法论

**生成函数**：`generateQAMethodology(ctx)`

这是最长的独立解析函数之一，定义了完整的 QA 测试工作流。包含四种模式：

- **Diff-aware 模式**（自动触发）：分析分支 diff，识别受影响的页面/路由，在本地开发服务器上针对性测试
- **Full 模式**：系统性探索所有可达页面，产出 5-10 个有据可查的问题
- **Quick 模式**：30 秒冒烟测试，仅访问首页 + 前 5 个导航目标
- **Regression 模式**：与上次 baseline.json 对比，生成回归报告

工作流分 6 个阶段：初始化 → 认证 → 定位 → 探索 → 记录 → 收尾。包含：
- 健康评分体系（8 个维度加权平均，如 Console 15%、Functional 20%）
- 框架特定指导（Next.js 水合错误、Rails CSRF、WordPress 插件冲突、SPA 路由）
- 12 条核心规则（如"复现是一切"、"永不阅读源码"、"每次交互后检查控制台"）

##### `{{DESIGN_METHODOLOGY}}` — 设计审查方法论

**生成函数**：`generateDesignMethodology(ctx)`

完整的设计审计框架，包含 10 大类约 80 项检查项：

1. **视觉层级与构图**（8 项）：焦点清晰度、视线流动、信息密度
2. **排版**（15 项）：字体数量、比例尺度、行高、每行字符数、禁用字体黑名单
3. **色彩与对比度**（10 项）：WCAG AA 合规、语义色一致性、暗色模式规则
4. **间距与布局**（12 项）：网格一致性、间距比例、border-radius 层级
5. **交互状态**（10 项）：hover/focus/active/disabled/loading/empty/error 状态
6. **响应式设计**（8 项）：触控目标尺寸、无水平滚动、导航折叠
7. **动效**（6 项）：缓动函数选择、时长范围、`prefers-reduced-motion` 支持
8. **内容与微文案**（8 项）：空状态设计、错误消息具体性、按钮标签明确性
9. **AI 生成痕迹检测**（10 项反模式）：紫色渐变、3 列特征网格、彩色圆圈图标、居中一切等
10. **性能即设计**（6 项）：LCP < 2.0s、CLS < 0.1、图片懒加载

工作流分 6 个阶段：第一印象 → 设计系统提取 → 逐页视觉审计 → 交互流程审查 → 跨页一致性 → 编制报告。产出双重评分：设计分（A-F）和 AI 生成痕迹分（A-F）。

##### `{{DESIGN_REVIEW_LITE}}` — 轻量级设计审查

**生成函数**：`generateDesignReviewLite(ctx)`

嵌入在代码审查流程中的快速设计检查。通过 `gstack-diff-scope` 脚本判断 diff 是否涉及前端文件，如果不涉及则静默跳过。对涉及的文件执行代码级设计检查（如 `outline: none`、`!important`、`font-size < 16px`），分为 AUTO-FIX（机械修复）和 ASK（需人工判断）两类。

##### `{{DESIGN_SKETCH}}` — UI 线框图生成

**生成函数**：`generateDesignSketch(ctx)`

当方案涉及 UI 时，生成一个粗糙风格的 HTML 线框图（系统字体、灰色细边框、无色彩），使用 browse 二进制渲染为截图。5 步流程：收集设计上下文 → 生成 HTML → 渲染截图 → 展示给用户 → 嵌入设计文档。仅 UI 相关方案触发，纯后端方案静默跳过。

---

#### 四、测试相关

##### `{{TEST_BOOTSTRAP}}` — 测试框架引导

**生成函数**：`generateTestBootstrap(ctx)`

当项目没有测试框架时的完整引导流程（8 个步骤）：

1. 检测项目运行时（Ruby/Node/Python/Go/Rust/PHP/Elixir）
2. WebSearch 搜索当前最佳实践
3. 向用户推荐框架（含内置推荐表，如 Node → vitest、Ruby → minitest）
4. 安装并配置
5. 生成 3-5 个真实测试
6. 验证测试通过
7. 创建 CI/CD pipeline（GitHub Actions）
8. 编写 TESTING.md 和更新 CLAUDE.md

如果已有框架，读取 2-3 个现有测试文件学习约定后跳过。用户可通过 `.gstack/no-test-bootstrap` 文件永久拒绝。

##### `{{TEST_COVERAGE_AUDIT_PLAN}}` / `{{TEST_COVERAGE_AUDIT_SHIP}}` / `{{TEST_COVERAGE_AUDIT_REVIEW}}`

**生成函数**：`generateTestCoverageAuditPlan/Ship/Review(ctx)` → 内部委托给 `generateTestCoverageAuditInner(mode)`

三个占位符共享同一个内部函数，按模式（plan/ship/review）生成不同的测试覆盖审计指令。共享部分包括：

- **代码路径追踪方法**：读取 diff 或计划，追踪每个入口点的数据流，绘制包含所有分支的 ASCII 图
- **用户流程覆盖**：映射用户交互路径（双击、中途导航、过期会话等边界场景）
- **质量评分标准**：★★★（行为+边界+错误路径）/ ★★（快乐路径）/ ★（冒烟/存在性检查）
- **E2E 决策矩阵**：何时用 E2E 测试、何时用 Eval 测试、何时用单元测试
- **回归规则（IRON RULE）**：回归必须立即写测试，不允许跳过

模式差异：
- **plan**：将缺失的测试作为需求添加到计划文件
- **ship**：自动生成测试并提交，输出前后测试计数（如 `Tests: 12 → 17 (+5 new)`）
- **review**：将覆盖缺口作为 INFORMATIONAL 发现，走 Fix-First 流程

##### `{{TEST_FAILURE_TRIAGE}}` — 测试失败分类处理

**生成函数**：`generateTestFailureTriage(ctx)`

当测试失败时的四步处理协议：

1. **分类**：对每个失败测试，通过 `git diff` 判断是 in-branch（本分支引入）还是 pre-existing（已有问题）
2. **In-branch 处理**：立即停止，开发者必须修复
3. **Pre-existing 处理**：根据 REPO_MODE 给出不同选项：
   - solo：推荐立即修复 / 添加 P0 TODO / 跳过
   - collaborative：推荐 git blame + 创建 GitHub Issue 分配给引入者 / 立即修复 / TODO / 跳过
4. **执行选择**：根据用户选择执行对应操作

---

#### 五、审查与报告

##### `{{SPEC_REVIEW_LOOP}}` — 规格文档对抗性审查循环

**生成函数**：`generateSpecReviewLoop(ctx)`

通过 Agent 工具分派独立的子代理审查文档，确保"真正的对抗性独立"——子代理有全新上下文，看不到脑暴对话，只看到文档本身。

审查维度：完整性、一致性、清晰性、范围、可行性。流程：
1. 分派子代理审查 → 返回质量分（1-10）和问题列表
2. 修复问题后重新审查，最多 3 轮
3. 连续两轮返回相同问题时触发收敛保护，将问题作为"Reviewer Concerns"持久化到文档

审查结果记录到 `~/.gstack/analytics/spec-review.jsonl` 本地文件。

##### `{{REVIEW_DASHBOARD}}` — 审查就绪仪表板

**生成函数**：`generateReviewDashboard(ctx)`

通过 `gstack-review-read` 读取审查日志，展示各审查技能的运行状态表。包含：

- 四种审查类型：Eng Review（必须）、CEO Review（可选）、Design Review（可选）、Adversarial（自动）
- 每种审查的运行次数、最后运行时间、状态
- 过期检测：比较审查时的 commit hash 与当前 HEAD，计算间隔 commit 数
- 判定逻辑：Eng Review 7 天内通过 → `CLEARED`，否则 → `NOT CLEARED`

##### `{{PLAN_FILE_REVIEW_REPORT}}` — 计划文件审查报告

**生成函数**：`generatePlanFileReviewReport(ctx)`

在计划文件中写入结构化审查状态表（`## GSTACK REVIEW REPORT`），包含 CEO/Codex/Eng/Design 四种审查的运行数、状态、发现数。支持更新已有报告（用 Edit 工具替换）或追加新报告。使用各审查 JSONL 日志中的字段构建发现摘要。

##### `{{ADVERSARIAL_STEP}}` / `{{CODEX_REVIEW_STEP}}` — 对抗性审查

**生成函数**：`generateAdversarialStep(ctx)`（两个占位符指向同一函数）

根据 diff 大小自动分级的对抗性审查：

| diff 大小 | 级别 | 执行内容 |
|-----------|------|----------|
| < 50 行 | Small | 跳过对抗性审查 |
| 50-199 行 | Medium | Codex 对抗性挑战（或回退到 Claude 子代理） |
| 200+ 行 | Large | 全部 3 个额外 pass：Codex 结构化审查 + Claude 对抗性子代理 + Codex 对抗性 |

最后进行跨模型综合分析，将高置信度发现（多个来源一致）优先处理。

在 Codex 宿主下返回空字符串（Codex 不应调用自身）。

---

#### 六、前置条件与部署

##### `{{BENEFITS_FROM}}` — 前置技能推荐

**生成函数**：`generateBenefitsFrom(ctx)`

当 frontmatter 中定义了 `benefits-from` 列表时，生成一段"前置技能推荐"指令。例如 autoplan 技能 `benefits-from: [office-hours]`，在没有找到设计文档时会向用户推荐先运行 `/office-hours`。用户可跳过，不会在同一会话中再次推荐。

如果 `benefitsFrom` 为空，返回空字符串（不注入任何内容）。

##### `{{DEPLOY_BOOTSTRAP}}` — 部署平台检测

**生成函数**：`generateDeployBootstrap(ctx)`

生成一段 bash 脚本，自动检测项目使用的部署平台：

1. 先检查 CLAUDE.md 中是否有持久化的部署配置
2. 通过配置文件自动检测（`fly.toml` → Fly、`vercel.json` → Vercel、`Procfile` → Heroku 等）
3. 扫描 `.github/workflows/` 中的 deploy/release 相关 workflow

---

## 外部数据源

脚本通过 `import` 直接从 browse 子系统的 TypeScript 源文件中导入数据：

```typescript
import { COMMAND_DESCRIPTIONS } from '../browse/src/commands';
import { SNAPSHOT_FLAGS } from '../browse/src/snapshot';
```

| 数据源 | 类型 | 用途 | 文件 |
|--------|------|------|------|
| `COMMAND_DESCRIPTIONS` | `Record<string, {category, description, usage?}>` | browse 命令元数据 | `browse/src/commands.ts` |
| `SNAPSHOT_FLAGS` | `Array<{short, long, description, valueHint?}>` | 快照命令标志 | `browse/src/snapshot.ts` |

`commands.ts` 是零依赖的纯数据文件（无 import），可安全地在构建脚本中导入。`snapshot.ts` 依赖 `diff` 包和 `playwright` 类型，因此 `diff` 必须在 `package.json` 的 `devDependencies` 中声明。

---

## Codex 宿主特殊处理

当使用 `--host codex` 运行时，`processTemplate()` 对输出执行以下额外转换：

### 1. Frontmatter 裁剪（`transformFrontmatter()`）

Codex 版本只保留 `name` 和 `description` 两个字段。`allowed-tools`、`hooks`、`version`、`metadata`、`benefits-from` 等其他字段全部移除。

函数处理两种 YAML description 格式：
- 内联格式：`description: some text`
- 块标量格式：`description: |` 后跟缩进行

### 2. 路径替换

对生成后的全文执行字符串替换：

| 原始路径 (Claude) | 替换为 (Codex) |
|-------------------|----------------|
| `~/.claude/skills/gstack` | `$GSTACK_ROOT` |
| `.claude/skills/gstack` | `.agents/skills/gstack` |
| `.claude/skills/review` | `.agents/skills/gstack/review` |
| `.claude/skills` | `.agents/skills` |

替换顺序有意义——更具体的路径先替换，避免子串误匹配。

### 3. 安全提示注入（`extractHookSafetyProse()`）

Codex 环境无法运行 Claude 的 `PreToolUse` hooks。为了保留安全提示的语义，脚本从 frontmatter 中提取 hook matcher 名称，生成一段人类可读的安全提示文本注入到文档正文开头。

例如，匹配 `Edit` 和 `Bash` 的 hooks 会生成：
> **Safety Advisory:** This skill includes safety checks that verify file edits are within the allowed scope boundary before applying, and check bash commands for destructive operations before execution.

### 4. 输出路由

| 宿主 | 输出路径模式 |
|------|-------------|
| Claude | `skills/gstack/{skill-name}/SKILL.md` |
| Codex | `.agents/skills/openspec-{skill-name}/SKILL.md` |

Codex 的 skill 名称通过 `codexSkillName()` 函数添加 `openspec-` 前缀，避免与其他技能包冲突。

### 5. 对抗性审查跳过

`generateAdversarialStep()` 在 `ctx.host === 'codex'` 时直接返回空字符串——Codex 不应调用自身进行对抗性审查。

### 6. /codex 技能跳过

主循环中，当 `HOST === 'codex'` 时跳过 `codex/` 目录的 `.tmpl`——这个技能本身就是 Claude 封装 Codex 的工具，在 Codex 环境中无意义。

---

## 模板发现逻辑

`findTemplates()` 函数按以下策略发现所有需要处理的模板文件：

1. 检查 `skills/gstack/SKILL.md.tmpl`（根级 browse 技能模板）
2. 遍历 `skills/gstack/` 下的所有**一级子目录**（不递归）
3. 跳过：以 `.` 开头的目录、`node_modules`、`docs`
4. 在每个子目录中查找 `SKILL.md.tmpl`

当前共发现 **28 个模板**（1 个根级 + 27 个子技能）。

---

## 模板处理流程详解

`processTemplate(tmplPath, host)` 函数的完整处理步骤：

```
 1. 读取 .tmpl 文件内容为字符串
 2. 正则提取 frontmatter 中的 name 字段
 3. 正则提取 frontmatter 中的 benefits-from 数组
 4. 构建 TemplateContext 对象
 5. 正则 /\{\{(\w+)\}\}/g 替换所有占位符：
    ├─ 查找 RESOLVERS[name]
    ├─ 找到 → 调用函数，用返回值替换
    └─ 未找到 → throw Error
 6. 二次检查：如果仍有 {{...}} 残留 → throw Error
 7. [仅 Codex] 提取 hook 描述，生成安全提示文本
 8. [仅 Codex] transformFrontmatter() 裁剪 frontmatter
 9. [仅 Codex] 注入安全提示到正文开头
10. [仅 Codex] 全文路径替换
11. 在 frontmatter 结束标记 --- 之后插入 AUTO-GENERATED 头部注释
12. 返回 { outputPath, content }
```

---

## 干跑模式（--dry-run）

在 CI 中使用 `--dry-run` 参数时：

1. 在内存中生成每个 SKILL.md 的完整内容
2. 读取磁盘上同名文件的现有内容
3. 逐字符比较：
   - 相同 → 输出 `FRESH: skills/gstack/benchmark/SKILL.md`
   - 不同 → 输出 `STALE: skills/gstack/benchmark/SKILL.md`，标记 `hasChanges = true`
4. 遍历完成后，如果 `hasChanges` 为 `true`：
   - 输出 `Generated SKILL.md files are stale. Run: bun run gen:skill-docs`
   - 以退出码 1 退出（触发 CI 失败）

这确保了提交到版本库的 SKILL.md 文件始终与模板和生成逻辑同步。如果开发者修改了 `gen-skill-docs.ts` 中的解析函数但忘记重新生成，CI 会拦截。

---

## 生成文件格式

每个生成的 SKILL.md 文件包含以下结构：

```markdown
---
name: skill-name
version: 1.0.0
description: |
  技能描述...
allowed-tools:
  - Bash
  - Read
  ...
---
<!-- AUTO-GENERATED from SKILL.md.tmpl — do not edit directly -->
<!-- Regenerate: bun run gen:skill-docs -->

[展开后的模板内容...]
```

frontmatter 原样保留自 `.tmpl` 文件（Codex 宿主除外）。头部注释提醒开发者不要直接编辑生成文件。

---

## 文件位置汇总

| 类型 | 路径 |
|------|------|
| 生成脚本 | `scripts/gen-skill-docs.ts` |
| 技能目录 | `skills/gstack/{skill-name}/` |
| 模板文件 | `skills/gstack/{skill-name}/SKILL.md.tmpl` |
| 生成文件 (Claude) | `skills/gstack/{skill-name}/SKILL.md` |
| 生成文件 (Codex) | `.agents/skills/openspec-{skill-name}/SKILL.md` |
| 命令元数据源 | `browse/src/commands.ts` |
| 快照标志源 | `browse/src/snapshot.ts` |

---

## 扩展指南

### 添加新占位符

1. 在 `gen-skill-docs.ts` 中编写生成函数：`function generateXxx(ctx: TemplateContext): string`
2. 在 `RESOLVERS` 映射表中注册：`XXX: generateXxx`
3. 在需要的 `.tmpl` 文件中使用 `{{XXX}}`
4. 运行 `bun run gen:skill-docs` 重新生成
5. 运行 `bun run gen:skill-docs --dry-run` 验证

### 添加新技能

1. 在 `skills/gstack/` 下创建新目录
2. 编写 `SKILL.md.tmpl`，包含 YAML frontmatter 和所需的 `{{占位符}}`
3. 运行 `bun run gen:skill-docs` 生成 `SKILL.md`
4. （可选）在 `src/core/templates/experts/` 中创建对应的 TypeScript 模块，用于代码内集成

### 修改共享内容

修改某个 `generate*()` 函数后，所有使用对应占位符的技能文档都会在下次生成时更新。这是单一来源原则的核心优势——改一处，更新所有。
