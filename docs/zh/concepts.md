# 核心概念

本指南解释了 OpenSpec 背后的核心理念以及它们如何相互配合。有关实际用法，请参阅[快速入门](getting-started.md)和[工作流](workflows.md)。

## 设计哲学

OpenSpec 围绕四条原则构建：

```
fluid not rigid         — 没有阶段门禁，做当下最合理的事
iterative not waterfall — 边构建边学习，边推进边完善
easy not complex        — 轻量级设置，最少的仪式感
brownfield-first        — 兼容现有代码库，不仅仅适用于全新项目
```

### 为什么这些原则很重要

**灵活而非僵化。** 传统的规格系统会把你锁定在固定阶段中：先规划，再实现，然后结束。OpenSpec 更加灵活——你可以按照对当前工作最合理的任意顺序创建产物。

**迭代而非瀑布式。** 需求会变化，理解会加深。一开始看起来不错的方案，在看过代码库之后可能就站不住脚了。OpenSpec 拥抱这一现实。

**简单而非复杂。** 有些规格框架需要大量设置、严格的格式或重量级的流程。OpenSpec 不会妨碍你的工作。几秒钟内初始化，立即开始工作，只在需要时才进行自定义。

**存量优先。** 大多数软件工作不是从零开始构建——而是修改现有系统。OpenSpec 基于增量（delta）的方法让指定对现有行为的修改变得容易，而不仅仅是描述全新系统。

## 整体架构

OpenSpec 将你的工作组织为两个主要区域：

```
┌────────────────────────────────────────────────────────────────────┐
│                        openspec/                                   │
│                                                                    │
│   ┌─────────────────────┐      ┌───────────────────────────────┐   │
│   │       specs/        │      │         changes/              │   │
│   │                     │      │                               │   │
│   │  Source of truth    │◄─────│  Proposed modifications       │   │
│   │  How your system    │ merge│  Each change = one folder     │   │
│   │  currently works    │      │  Contains artifacts + deltas  │   │
│   │                     │      │                               │   │
│   └─────────────────────┘      └───────────────────────────────┘   │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

**Specs** 是唯一事实来源——它们描述你的系统当前如何运作。

**Changes** 是提议的修改——它们存放在各自独立的文件夹中，直到你准备好将其合并。

这种分离是关键。你可以并行推进多个变更而互不冲突。你可以在变更影响主规格之前先对其进行审查。当你归档一个变更时，它的增量会干净地合并进唯一事实来源。

## 规格（Specs）

规格使用结构化的需求和场景来描述系统的行为。

### 目录结构

```
rasen/specs/
├── auth/
│   └── spec.md           # Authentication behavior
├── payments/
│   └── spec.md           # Payment processing
├── notifications/
│   └── spec.md           # Notification system
└── ui/
    └── spec.md           # UI behavior and themes
```

按领域（domain）组织规格——即对你的系统而言有意义的逻辑分组。常见模式：

- **按功能区域**：`auth/`、`payments/`、`search/`
- **按组件**：`api/`、`frontend/`、`workers/`
- **按限界上下文**：`ordering/`、`fulfillment/`、`inventory/`

### 规格格式

一个规格包含需求，每个需求又包含场景：

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
| `## Purpose` | 对该规格所属领域的高层描述 |
| `### Requirement:` | 系统必须具备的某项具体行为 |
| `#### Scenario:` | 该需求在实际行动中的一个具体示例 |
| SHALL/MUST/SHOULD | RFC 2119 关键字，表示需求的强度等级 |

### 为什么这样组织规格

**需求回答"做什么"**——它们陈述系统应当做什么，而不指定实现方式。

**场景回答"何时发生"**——它们提供可以验证的具体示例。好的场景：
- 可测试（你能据此编写自动化测试）
- 同时覆盖正常路径和边界情况
- 使用 Given/When/Then 或类似的结构化格式

**RFC 2119 关键字**（SHALL、MUST、SHOULD、MAY）传达意图：
- **MUST/SHALL** — 绝对要求
- **SHOULD** — 推荐，但允许存在例外
- **MAY** — 可选

### 规格是什么（以及不是什么）

规格是一份**行为契约**，而不是实现计划。

适合放进规格的内容：
- 用户或下游系统所依赖的可观察行为
- 输入、输出以及错误条件
- 外部约束（安全、隐私、可靠性、兼容性）
- 可以测试或显式验证的场景

应当避免放进规格的内容：
- 内部类名/函数名
- 库或框架的选型
- 逐步的实现细节
- 详尽的执行计划（这些属于 `design.md` 或 `tasks.md`）

快速判断标准：
- 如果实现方式可以改变、却不影响外部可见的行为，那它大概率不属于规格。

### 保持轻量：渐进式严格

OpenSpec 旨在避免官僚主义。使用能让变更可验证的最轻量级别即可。

**轻量规格（默认）：**
- 简短、行为优先的需求
- 清晰的范围与非目标
- 少量具体的验收检查

**完整规格（用于较高风险场景）：**
- 跨团队或跨仓库的变更
- API/契约变更、数据迁移、安全/隐私相关的关切
- 歧义可能导致高昂返工成本的变更

大多数变更都应保持在轻量模式。

### 人机协作

在许多团队中，由人类负责探索，由智能体负责起草产物。预期的循环是：

1. 人类提供意图、上下文和约束。
2. 智能体把这些内容转化为行为优先的需求和场景。
3. 智能体把实现细节留在 `design.md` 和 `tasks.md` 中，而不是写进 `spec.md`。
4. 在实现之前，先通过校验确认结构与清晰度。

这样能让规格对人保持可读，对智能体保持一致。

## 变更（Changes）

变更是对系统的一项提议修改，打包为一个文件夹，其中包含理解和实现它所需的一切。

### 变更结构

```
rasen/changes/add-dark-mode/
├── proposal.md           # Why and what
├── design.md             # How (technical approach)
├── tasks.md              # Implementation checklist
├── .openspec.yaml        # Change metadata (optional)
└── specs/                # Delta specs
    └── ui/
        └── spec.md       # What's changing in ui/spec.md
```

每个变更都是自包含的。它包含：
- **产物（Artifacts）**——捕获意图、设计和任务的文档
- **增量规格（Delta specs）**——描述要新增、修改或删除的内容的规格
- **元数据（Metadata）**——针对该具体变更的可选配置

### 为什么变更是一个文件夹

把变更打包成文件夹有几点好处：

1. **一切集中一处。** 提案、设计、任务和规格都在同一个地方。无需在不同位置之间翻找。

2. **可并行推进。** 多个变更可以同时存在而不互相冲突。你可以在推进 `add-dark-mode` 的同时，让 `fix-auth-bug` 也在进行中。

3. **历史清晰。** 归档时，变更带着完整上下文移动到 `changes/archive/`。你随时可以回看，理解的不仅仅是"改了什么"，还包括"为什么改"。

4. **便于审查。** 一个变更文件夹很容易审查——打开它，阅读提案、查看设计、看看规格增量。

## 产物（Artifacts）

产物是变更之中用来指导工作的文档。

### 产物流向

```
proposal ──────► specs ──────► design ──────► tasks ──────► implement
    │               │             │              │
   why            what           how          steps
 + scope        changes       approach      to take
```

产物彼此承接。每个产物都为下一个提供上下文。

### 产物类型

#### 提案（`proposal.md`）

提案在较高层次上捕获**意图**、**范围**和**方法**。

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
- 范围发生变化（收窄或扩大）
- 意图变得更清晰（对该问题的理解加深）
- 方法出现根本性转变

#### 规格（`specs/` 中的增量规格）

增量规格描述相对于当前规格**正在发生什么变化**。参见下文的[增量规格](#增量规格delta-specs)。

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
- 发现了更好的方案
- 依赖或约束发生变化

#### 任务（`tasks.md`）

任务是**实现清单**——带复选框的具体步骤。

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

**任务的最佳实践：**
- 在标题下对相关任务分组
- 使用层级编号（1.1、1.2 等）
- 让每个任务小到能在一轮会话中完成
- 完成后就勾选掉

## 增量规格（Delta Specs）

增量规格是让 OpenSpec 适用于存量开发的关键概念。它们描述**正在发生什么变化**，而不是把整份规格重述一遍。

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

| 区段 | 含义 | 归档时会发生什么 |
|---------|---------|------------------------|
| `## ADDED Requirements` | 新增行为 | 追加到主规格 |
| `## MODIFIED Requirements` | 变更后的行为 | 替换既有需求 |
| `## REMOVED Requirements` | 废弃的行为 | 从主规格中删除 |

### 为什么用增量而不是完整规格

**清晰。** 增量精确展示正在改变什么。如果读一份完整规格，你得自己在脑海里和当前版本做 diff。

**避免冲突。** 两个变更可以触及同一份规格文件而不冲突，只要它们修改的是不同的需求。

**审查高效。** 审查者看到的是变更本身，而不是未改动的上下文。注意力集中在真正重要的地方。

**契合存量场景。** 大多数工作都是在修改既有行为。增量让"修改"成为一等公民，而不是事后才想起的补充。

## 模式（Schemas）

模式定义了一个工作流中有哪些产物类型，以及它们之间的依赖关系。

### 模式如何运作

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

**产物构成一张依赖图：**

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

**依赖是启用条件，而非门禁。** 它们展示的是"可以创建什么"，而不是"接下来必须创建什么"。你不需要 design 就可以跳过它。你可以在 design 之前或之后创建 specs——两者都只依赖于 proposal。

### 内置模式

**spec-driven**（默认）

用于规格驱动开发的标准工作流：

```
proposal → specs → design → tasks → implement
```

最适合：大多数功能开发——你希望在动手实现之前先就规格达成一致。

### 自定义模式

为你的团队工作流创建自定义模式：

```bash
# Create from scratch
rasen schema init research-first

# Or fork an existing one
rasen schema fork spec-driven research-first
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

关于创建和使用自定义模式的完整说明，请参阅[自定义配置](customization.md)。

## 归档（Archive）

归档通过把变更的增量规格合并进主规格来完成一个变更，同时为历史记录保留该变更。

### 归档时会发生什么

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

1. **合并增量。** 把每个增量规格区段（ADDED/MODIFIED/REMOVED）应用到对应的主规格。

2. **移入归档。** 变更文件夹移到 `changes/archive/`，并加上日期前缀以便按时间排序。

3. **保留上下文。** 所有产物在归档中保持完整。你随时可以回头理解一项变更为何而做。

### 为什么归档很重要

**状态干净。** 活跃变更（`changes/`）只显示进行中的工作。已完成的工作会被移出视线。

**审计轨迹。** 归档保留了每个变更的完整上下文——不仅仅是"改了什么"，还包括解释"为什么"的提案、解释"怎么做"的设计，以及展示"做了哪些工作"的任务。

**规格演进。** 随着变更被归档，规格有机地生长。每一次归档都合并它带来的增量，日积月累构建出一份全面的规格。

## 一切如何协同运作

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              OPENSPEC FLOW                                   │
│                                                                              │
│   ┌────────────────┐                                                         │
│   │  1. START      │  /rasen:propose (core) or /rasen:new (expanded)           │
│   │     CHANGE     │                                                         │
│   └───────┬────────┘                                                         │
│           │                                                                  │
│           ▼                                                                  │
│   ┌────────────────┐                                                         │
│   │  2. CREATE     │  /rasen:continue (expanded workflow)                     │
│   │     ARTIFACTS  │  Creates proposal → specs → design → tasks              │
│   │                │  (based on schema dependencies)                         │
│   └───────┬────────┘                                                         │
│           │                                                                  │
│           ▼                                                                  │
│   ┌────────────────┐                                                         │
│   │  3. IMPLEMENT  │  /rasen:apply                                            │
│   │     TASKS      │  Work through tasks, checking them off                  │
│   │                │◄──── Update artifacts as you learn                      │
│   └───────┬────────┘                                                         │
│           │                                                                  │
│           ▼                                                                  │
│   ┌────────────────┐                                                         │
│   │  4. VERIFY     │  /rasen:verify (optional)                                │
│   │     WORK       │  Check implementation matches specs                     │
│   └───────┬────────┘                                                         │
│           │                                                                  │
│           ▼                                                                  │
│   ┌────────────────┐     ┌──────────────────────────────────────────────┐    │
│   │  5. ARCHIVE    │────►│  Delta specs merge into main specs           │    │
│   │     CHANGE     │     │  Change folder moves to archive/             │    │
│   └────────────────┘     │  Specs are now the updated source of truth   │    │
│                          └──────────────────────────────────────────────┘    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**良性循环：**

1. 规格描述当前行为
2. 变更提议修改（以增量形式）
3. 实现让变更落地成真
4. 归档把增量合并进规格
5. 规格现在描述的是新行为
6. 下一个变更基于更新后的规格继续构建

## 术语表

| 术语 | 定义 |
|------|------------|
| **产物（Artifact）** | 变更之中的一个文档（提案、设计、任务或增量规格） |
| **归档（Archive）** | 完成一个变更并把它的增量合并进主规格的过程 |
| **变更（Change）** | 对系统的一项提议修改，打包为一个包含产物的文件夹 |
| **增量规格（Delta spec）** | 描述相对于当前规格所发生变化（ADDED/MODIFIED/REMOVED）的规格 |
| **领域（Domain）** | 规格的逻辑分组（例如 `auth/`、`payments/`） |
| **需求（Requirement）** | 系统必须具备的某项具体行为 |
| **场景（Scenario）** | 需求的一个具体示例，通常采用 Given/When/Then 格式 |
| **模式（Schema）** | 产物类型及其依赖关系的定义 |
| **规格（Spec）** | 描述系统行为的规格文档，包含需求和场景 |
| **唯一事实来源（Source of truth）** | `rasen/specs/` 目录，存放当前已达成一致的行为 |

## 后续步骤

- [快速入门](getting-started.md) - 上手实操的第一步
- [工作流](workflows.md) - 常见模式以及各自适用的场景
- [命令参考](commands.md) - 完整的命令参考
- [自定义配置](customization.md) - 创建自定义模式并配置你的项目
