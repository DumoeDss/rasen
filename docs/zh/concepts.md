# 核心概念

本指南解释了 OpenSpec 背后的核心理念及其相互关联。有关实际用法，请参阅[快速入门](getting-started.md)和[工作流](workflows.md)。

## 设计哲学

OpenSpec 围绕四个原则构建：

```
fluid not rigid       — 没有阶段门禁，做当下最合理的事
iterative not waterfall — 边构建边学习，边推进边完善
easy not complex      — 轻量级设置，最少的仪式感
brownfield-first      — 兼容现有代码库，不仅仅适用于全新项目
```

### 为什么这些原则很重要

**灵活而非僵化。** 传统的规范系统会把你锁定在固定阶段中：先规划，再实现，然后结束。OpenSpec 更加灵活——你可以按照对工作最合理的任意顺序创建制品。

**迭代而非瀑布式。** 需求会变化，理解会加深。一开始看起来不错的方案，在看到代码库之后可能就站不住脚了。OpenSpec 拥抱这个现实。

**简单而非复杂。** 有些规范框架需要大量的设置、严格的格式或重量级的流程。OpenSpec 不会妨碍你的工作。几秒钟内初始化，立即开始工作，只在需要时才进行自定义。

**存量优先。** 大多数软件工作不是从零开始构建——而是修改现有系统。OpenSpec 基于增量（delta）的方法使得指定对现有行为的更改变得容易，而不仅仅是描述新系统。

## 整体架构

OpenSpec 将你的工作组织为两个主要区域：

```
┌─────────────────────────────────────────────────────────────────┐
│                        openspec/                                 │
│                                                                  │
│   ┌─────────────────────┐      ┌──────────────────────────────┐ │
│   │       specs/        │      │         changes/              │ │
│   │                     │      │                               │ │
│   │  Source of truth    │◄─────│  Proposed modifications       │ │
│   │  How your system    │ merge│  Each change = one folder     │ │
│   │  currently works    │      │  Contains artifacts + deltas  │ │
│   │                     │      │                               │ │
│   └─────────────────────┘      └──────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Specs** 是唯一事实来源——它们描述了你的系统当前的行为方式。

**Changes** 是提议的修改——它们存放在独立的文件夹中，直到你准备好将它们合并。

这种分离是关键。你可以并行处理多个变更而不会产生冲突。你可以在变更影响主规范之前对其进行审查。当你归档一个变更时，其增量会干净地合并到唯一事实来源中。

## 规范（Specs）

规范使用结构化的需求和场景来描述系统的行为。

### 目录结构

```
openspec/specs/
├── auth/
│   └── spec.md           # Authentication behavior
├── payments/
│   └── spec.md           # Payment processing
├── notifications/
│   └── spec.md           # Notification system
└── ui/
    └── spec.md           # UI behavior and themes
```

按领域组织规范——对你的系统有意义的逻辑分组。常见模式：

- **按功能区域**：`auth/`、`payments/`、`search/`
- **按组件**：`api/`、`frontend/`、`workers/`
- **按限界上下文**：`ordering/`、`fulfillment/`、`inventory/`

### 规范格式

一个规范包含需求，每个需求包含场景：

```markdown
# Auth Specification

## Purpose
Authentication and session management for the application.

## Requirements

### Requirement: User Authentication
The system SHALL issue a JWT token upon successful login.

#### Scenario: Valid credentials
- GIVEN a user with valid credentials
- WHEN the user submits login form
- THEN a JWT token is returned
- AND the user is redirected to dashboard

#### Scenario: Invalid credentials
- GIVEN invalid credentials
- WHEN the user submits login form
- THEN an error message is displayed
- AND no token is issued

### Requirement: Session Expiration
The system MUST expire sessions after 30 minutes of inactivity.

#### Scenario: Idle timeout
- GIVEN an authenticated session
- WHEN 30 minutes pass without activity
- THEN the session is invalidated
- AND the user must re-authenticate
```

**关键要素：**

| 要素 | 用途 |
|---------|---------|
| `## Purpose` | 该规范领域的高层描述 |
| `### Requirement:` | 系统必须具有的一个特定行为 |
| `#### Scenario:` | 需求的一个具体示例 |
| SHALL/MUST/SHOULD | RFC 2119 关键字，指示需求的强度等级 |

### 为什么要这样组织规范

**需求是"做什么"**——它们陈述系统应该做什么，而不指定实现方式。

**场景是"何时发生"**——它们提供可以验证的具体示例。好的场景：
- 可测试的（你可以为其编写自动化测试）
- 覆盖正常路径和边界情况
- 使用 Given/When/Then 或类似的结构化格式

**RFC 2119 关键字**（SHALL、MUST、SHOULD、MAY）传达意图：
- **MUST/SHALL** — 绝对要求
- **SHOULD** — 推荐，但存在例外
- **MAY** — 可选

### 规范是什么（以及不是什么）

规范是一份**行为契约**，而不是实现计划。

适合放在规范中的内容：
- 用户或下游系统依赖的可观察行为
- 输入、输出和错误条件
- 外部约束（安全性、隐私、可靠性、兼容性）
- 可以测试或明确验证的场景

应避免放在规范中的内容：
- 内部类/函数名
- 库或框架选择
- 逐步实现细节
- 详细的执行计划（这些属于 `design.md` 或 `tasks.md`）

快速判断标准：
- 如果实现可以改变而不影响外部可见行为，那么它可能不属于规范。

### 保持轻量：渐进式严格

OpenSpec 旨在避免官僚主义。使用能让变更可验证的最轻量级别。

**轻量规范（默认）：**
- 简短的行为优先需求
- 清晰的范围和非目标
- 少量具体的验收检查

**完整规范（用于高风险场景）：**
- 跨团队或跨仓库的变更
- API/契约变更、迁移、安全/隐私问题
- 歧义可能导致高成本返工的变更

大多数变更应保持在轻量模式。

### 人机协作

在许多团队中，人类负责探索，智能体负责起草制品。预期的循环是：

1. 人类提供意图、上下文和约束。
2. 智能体将其转化为行为优先的需求和场景。
3. 智能体将实现细节保存在 `design.md` 和 `tasks.md` 中，而非 `spec.md`。
4. 验证在实现之前确认结构和清晰度。

这使得规范对人类可读，对智能体一致。

## 变更（Changes）

变更是对系统的一项提议修改，打包为一个文件夹，其中包含理解和实现它所需的一切。

### 变更结构

```
openspec/changes/add-dark-mode/
├── proposal.md           # Why and what
├── design.md             # How (technical approach)
├── tasks.md              # Implementation checklist
├── .openspec.yaml        # Change metadata (optional)
└── specs/                # Delta specs
    └── ui/
        └── spec.md       # What's changing in ui/spec.md
```

每个变更都是自包含的。它包含：
- **制品（Artifacts）**——捕获意图、设计和任务的文档
- **增量规范（Delta specs）**——描述正在添加、修改或删除的内容的规范
- **元数据（Metadata）**——此特定变更的可选配置

### 为什么变更是文件夹

将变更打包为文件夹有以下好处：

1. **一切集中。** 提案、设计、任务和规范都在一个地方。无需在不同位置之间翻找。

2. **并行工作。** 多个变更可以同时存在而不冲突。在处理 `add-dark-mode` 的同时，`fix-auth-bug` 也在进行中。

3. **清晰的历史。** 归档后，变更带着完整的上下文移动到 `changes/archive/`。你可以回顾并理解不仅是什么改变了，还有为什么。

4. **方便审查。** 变更文件夹很容易审查——打开它，阅读提案，检查设计，查看规范增量。

## 制品（Artifacts）

制品是变更中指导工作的文档。

### 制品流程

```
proposal ──────► specs ──────► design ──────► tasks ──────► implement
    │               │             │              │
   why            what           how          steps
 + scope        changes       approach      to take
```

制品相互构建。每个制品为下一个提供上下文。

### 制品类型

#### 提案（`proposal.md`）

提案在高层次上捕获**意图**、**范围**和**方法**。

```markdown
# Proposal: Add Dark Mode

## Intent
Users have requested a dark mode option to reduce eye strain
during nighttime usage and match system preferences.

## Scope
In scope:
- Theme toggle in settings
- System preference detection
- Persist preference in localStorage

Out of scope:
- Custom color themes (future work)
- Per-page theme overrides

## Approach
Use CSS custom properties for theming with a React context
for state management. Detect system preference on first load,
allow manual override.
```

**何时更新提案：**
- 范围变化（缩小或扩大）
- 意图更加清晰（对问题有了更好的理解）
- 方法发生根本性转变

#### 规范（`specs/` 中的增量规范）

增量规范描述了相对于当前规范**正在发生什么变化**。参见下方的[增量规范](#增量规范delta-specs)。

#### 设计（`design.md`）

设计捕获**技术方法**和**架构决策**。

````markdown
# Design: Add Dark Mode

## Technical Approach
Theme state managed via React Context to avoid prop drilling.
CSS custom properties enable runtime switching without class toggling.

## Architecture Decisions

### Decision: Context over Redux
Using React Context for theme state because:
- Simple binary state (light/dark)
- No complex state transitions
- Avoids adding Redux dependency

### Decision: CSS Custom Properties
Using CSS variables instead of CSS-in-JS because:
- Works with existing stylesheet
- No runtime overhead
- Browser-native solution

## Data Flow
```
ThemeProvider (context)
       │
       ▼
ThemeToggle ◄──► localStorage
       │
       ▼
CSS Variables (applied to :root)
```

## File Changes
- `src/contexts/ThemeContext.tsx` (new)
- `src/components/ThemeToggle.tsx` (new)
- `src/styles/globals.css` (modified)
````

**何时更新设计：**
- 实现过程中发现方法行不通
- 发现了更好的解决方案
- 依赖项或约束发生变化

#### 任务（`tasks.md`）

任务是**实现清单**——带有复选框的具体步骤。

```markdown
# Tasks

## 1. Theme Infrastructure
- [ ] 1.1 Create ThemeContext with light/dark state
- [ ] 1.2 Add CSS custom properties for colors
- [ ] 1.3 Implement localStorage persistence
- [ ] 1.4 Add system preference detection

## 2. UI Components
- [ ] 2.1 Create ThemeToggle component
- [ ] 2.2 Add toggle to settings page
- [ ] 2.3 Update Header to include quick toggle

## 3. Styling
- [ ] 3.1 Define dark theme color palette
- [ ] 3.2 Update components to use CSS variables
- [ ] 3.3 Test contrast ratios for accessibility
```

**任务最佳实践：**
- 在标题下分组相关任务
- 使用层级编号（1.1、1.2 等）
- 保持任务足够小，可以在一次会话中完成
- 完成后勾选任务

## 增量规范（Delta Specs）

增量规范是使 OpenSpec 适用于存量开发的关键概念。它们描述的是**正在发生什么变化**，而不是重述整个规范。

### 格式

```markdown
# Delta for Auth

## ADDED Requirements

### Requirement: Two-Factor Authentication
The system MUST support TOTP-based two-factor authentication.

#### Scenario: 2FA enrollment
- GIVEN a user without 2FA enabled
- WHEN the user enables 2FA in settings
- THEN a QR code is displayed for authenticator app setup
- AND the user must verify with a code before activation

#### Scenario: 2FA login
- GIVEN a user with 2FA enabled
- WHEN the user submits valid credentials
- THEN an OTP challenge is presented
- AND login completes only after valid OTP

## MODIFIED Requirements

### Requirement: Session Expiration
The system MUST expire sessions after 15 minutes of inactivity.
(Previously: 30 minutes)

#### Scenario: Idle timeout
- GIVEN an authenticated session
- WHEN 15 minutes pass without activity
- THEN the session is invalidated

## REMOVED Requirements

### Requirement: Remember Me
(Deprecated in favor of 2FA. Users should re-authenticate each session.)
```

### 增量区段

| 区段 | 含义 | 归档时的行为 |
|---------|---------|------------------------|
| `## ADDED Requirements` | 新行为 | 追加到主规范 |
| `## MODIFIED Requirements` | 变更的行为 | 替换现有需求 |
| `## REMOVED Requirements` | 废弃的行为 | 从主规范中删除 |

### 为什么使用增量而不是完整规范

**清晰。** 增量准确地展示了正在改变的内容。阅读完整规范时，你需要在脑海中与当前版本做对比。

**避免冲突。** 两个变更可以触及同一个规范文件而不冲突，只要它们修改的是不同的需求。

**审查效率。** 审查者看到的是变更，而不是未改变的上下文。聚焦于重要的部分。

**适合存量开发。** 大多数工作是修改现有行为。增量使修改成为一等公民，而非事后补充。

## 模式（Schemas）

模式定义了工作流中的制品类型及其依赖关系。

### 模式的工作方式

```yaml
# openspec/schemas/spec-driven/schema.yaml
name: spec-driven
artifacts:
  - id: proposal
    generates: proposal.md
    requires: []              # No dependencies, can create first

  - id: specs
    generates: specs/**/*.md
    requires: [proposal]      # Needs proposal before creating

  - id: design
    generates: design.md
    requires: [proposal]      # Can create in parallel with specs

  - id: tasks
    generates: tasks.md
    requires: [specs, design] # Needs both specs and design first
```

**制品形成依赖图：**

```
                    proposal
                   (root node)
                       │
         ┌─────────────┴─────────────┐
         │                           │
         ▼                           ▼
      specs                       design
   (requires:                  (requires:
    proposal)                   proposal)
         │                           │
         └─────────────┬─────────────┘
                       │
                       ▼
                    tasks
                (requires:
                specs, design)
```

**依赖是启用条件，而非门禁。** 它们展示了什么可以创建，而不是你接下来必须创建什么。如果不需要 design，你可以跳过它。你可以在 design 之前或之后创建 specs——两者都只依赖于 proposal。

### 内置模式

**spec-driven**（默认）

用于规范驱动开发的标准工作流：

```
proposal → specs → design → tasks → implement
```

最适合：大多数功能开发，你希望在实现之前就规范达成一致。

### 自定义模式

为你的团队工作流创建自定义模式：

```bash
# Create from scratch
openspec schema init research-first

# Or fork an existing one
openspec schema fork spec-driven research-first
```

**自定义模式示例：**

```yaml
# openspec/schemas/research-first/schema.yaml
name: research-first
artifacts:
  - id: research
    generates: research.md
    requires: []           # Do research first

  - id: proposal
    generates: proposal.md
    requires: [research]   # Proposal informed by research

  - id: tasks
    generates: tasks.md
    requires: [proposal]   # Skip specs/design, go straight to tasks
```

有关创建和使用自定义模式的完整详情，请参阅[自定义配置](customization.md)。

## 归档（Archive）

归档通过将变更的增量规范合并到主规范中来完成一个变更，并为历史记录保留该变更。

### 归档时发生了什么

```
Before archive:

openspec/
├── specs/
│   └── auth/
│       └── spec.md ◄────────────────┐
└── changes/                         │
    └── add-2fa/                     │
        ├── proposal.md              │
        ├── design.md                │ merge
        ├── tasks.md                 │
        └── specs/                   │
            └── auth/                │
                └── spec.md ─────────┘


After archive:

openspec/
├── specs/
│   └── auth/
│       └── spec.md        # Now includes 2FA requirements
└── changes/
    └── archive/
        └── 2025-01-24-add-2fa/    # Preserved for history
            ├── proposal.md
            ├── design.md
            ├── tasks.md
            └── specs/
                └── auth/
                    └── spec.md
```

### 归档流程

1. **合并增量。** 每个增量规范区段（ADDED/MODIFIED/REMOVED）被应用到对应的主规范。

2. **移至归档。** 变更文件夹移动到 `changes/archive/`，带有日期前缀以便按时间排序。

3. **保留上下文。** 所有制品在归档中保持完整。你随时可以回顾以理解变更的原因。

### 为什么归档很重要

**状态清晰。** 活跃变更（`changes/`）只显示正在进行的工作。已完成的工作移出视线。

**审计跟踪。** 归档保留了每个变更的完整上下文——不仅是什么发生了变化，还有解释原因的提案、解释方法的设计，以及展示已完成工作的任务。

**规范演进。** 随着变更被归档，规范有机增长。每次归档都合并其增量，随时间构建出全面的规范。

## 所有部分如何协同工作

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              OPENSPEC FLOW                                   │
│                                                                              │
│   ┌────────────────┐                                                         │
│   │  1. START      │  /opsx:propose (core) or /opsx:new (expanded)          │
│   │     CHANGE     │                                                         │
│   └───────┬────────┘                                                         │
│           │                                                                  │
│           ▼                                                                  │
│   ┌────────────────┐                                                         │
│   │  2. CREATE     │  /opsx:ff or /opsx:continue (expanded workflow)         │
│   │     ARTIFACTS  │  Creates proposal → specs → design → tasks              │
│   │                │  (based on schema dependencies)                         │
│   └───────┬────────┘                                                         │
│           │                                                                  │
│           ▼                                                                  │
│   ┌────────────────┐                                                         │
│   │  3. IMPLEMENT  │  /opsx:apply                                            │
│   │     TASKS      │  Work through tasks, checking them off                  │
│   │                │◄──── Update artifacts as you learn                      │
│   └───────┬────────┘                                                         │
│           │                                                                  │
│           ▼                                                                  │
│   ┌────────────────┐                                                         │
│   │  4. VERIFY     │  /opsx:verify (optional)                                │
│   │     WORK       │  Check implementation matches specs                     │
│   └───────┬────────┘                                                         │
│           │                                                                  │
│           ▼                                                                  │
│   ┌────────────────┐     ┌──────────────────────────────────────────────┐   │
│   │  5. ARCHIVE    │────►│  Delta specs merge into main specs           │   │
│   │     CHANGE     │     │  Change folder moves to archive/             │   │
│   └────────────────┘     │  Specs are now the updated source of truth   │   │
│                          └──────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**良性循环：**

1. 规范描述当前行为
2. 变更提议修改（以增量形式）
3. 实现使变更成为现实
4. 归档将增量合并到规范中
5. 规范现在描述新的行为
6. 下一个变更基于更新后的规范构建

## 术语表

| 术语 | 定义 |
|------|------------|
| **制品（Artifact）** | 变更中的一个文档（提案、设计、任务或增量规范） |
| **归档（Archive）** | 完成变更并将其增量合并到主规范中的过程 |
| **变更（Change）** | 对系统的一项提议修改，打包为包含制品的文件夹 |
| **增量规范（Delta spec）** | 描述相对于当前规范的变化（ADDED/MODIFIED/REMOVED）的规范 |
| **领域（Domain）** | 规范的逻辑分组（例如 `auth/`、`payments/`） |
| **需求（Requirement）** | 系统必须具有的一个特定行为 |
| **场景（Scenario）** | 需求的一个具体示例，通常采用 Given/When/Then 格式 |
| **模式（Schema）** | 制品类型及其依赖关系的定义 |
| **规范（Spec）** | 描述系统行为的规范文档，包含需求和场景 |
| **唯一事实来源（Source of truth）** | `openspec/specs/` 目录，包含当前达成一致的行为 |

## 后续步骤

- [快速入门](getting-started.md) - 实际的第一步
- [工作流](workflows.md) - 常见模式及其使用场景
- [命令参考](commands.md) - 完整的命令参考
- [自定义配置](customization.md) - 创建自定义模式并配置你的项目
