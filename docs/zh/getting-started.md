# 快速入门

本指南介绍安装并初始化 OpenSpec 之后的使用方法。有关安装说明，请参阅[主 README](../../README.md#quick-start)。

## 工作原理

OpenSpec 帮助你和你的 AI 编程助手在编写任何代码之前，就要构建的内容达成一致。

**默认快速路径（core profile）：**

```text
/opsx:propose ──► /opsx:apply ──► /opsx:archive
```

**扩展路径（自定义工作流选择）：**

```text
/opsx:new ──► /opsx:ff or /opsx:continue ──► /opsx:apply ──► /opsx:verify ──► /opsx:archive
```

默认的全局 profile 是 `core`，包含 `propose`、`explore`、`apply` 和 `archive`。你可以通过 `openspec config profile` 和 `openspec update` 来启用扩展工作流命令。

## OpenSpec 创建的内容

运行 `openspec init` 后，你的项目将具有以下结构：

```
openspec/
├── specs/              # 唯一事实来源（系统的行为定义）
│   └── <domain>/
│       └── spec.md
├── changes/            # 提议的变更（每个变更一个文件夹）
│   └── <change-name>/
│       ├── proposal.md
│       ├── design.md
│       ├── tasks.md
│       └── specs/      # Delta specs（变更的内容）
│           └── <domain>/
│               └── spec.md
└── config.yaml         # 项目配置（可选）
```

**两个关键目录：**

- **`specs/`** - 唯一事实来源。这些 spec 描述了系统当前的行为方式，按领域组织（例如 `specs/auth/`、`specs/payments/`）。

- **`changes/`** - 提议的修改。每个变更都有自己的文件夹，包含所有相关产物。当变更完成后，其 spec 会合并到主 `specs/` 目录中。

## 理解产物

每个变更文件夹包含指导工作的产物：

| 产物 | 用途 |
|----------|---------|
| `proposal.md` | "为什么"和"做什么"——记录意图、范围和方法 |
| `specs/` | Delta spec，展示新增/修改/删除的需求 |
| `design.md` | "怎么做"——技术方案和架构决策 |
| `tasks.md` | 带复选框的实施清单 |

**产物逐层构建：**

```
proposal ──► specs ──► design ──► tasks ──► implement
   ▲           ▲          ▲                    │
   └───────────┴──────────┴────────────────────┘
            update as you learn
```

你可以在实施过程中随时回头完善早期的产物。

## Delta Spec 的工作方式

Delta spec 是 OpenSpec 的核心概念。它们展示了相对于当前 spec 的变更内容。

### 格式

Delta spec 使用分节来标识变更类型：

```markdown
# Delta for Auth

## ADDED Requirements

### Requirement: Two-Factor Authentication
The system MUST require a second factor during login.

#### Scenario: OTP required
- GIVEN a user with 2FA enabled
- WHEN the user submits valid credentials
- THEN an OTP challenge is presented

## MODIFIED Requirements

### Requirement: Session Timeout
The system SHALL expire sessions after 30 minutes of inactivity.
(Previously: 60 minutes)

#### Scenario: Idle timeout
- GIVEN an authenticated session
- WHEN 30 minutes pass without activity
- THEN the session is invalidated

## REMOVED Requirements

### Requirement: Remember Me
(Deprecated in favor of 2FA)
```

### 归档时发生什么

当你归档一个变更时：

1. **ADDED** 的需求会追加到主 spec 中
2. **MODIFIED** 的需求会替换现有版本
3. **REMOVED** 的需求会从主 spec 中删除

变更文件夹会移动到 `openspec/changes/archive/` 作为审计历史记录。

## 示例：你的第一个变更

让我们来演练为应用程序添加暗色模式的过程。

### 1. 启动变更（默认方式）

```text
You: /opsx:propose add-dark-mode

AI:  Created openspec/changes/add-dark-mode/
     ✓ proposal.md — why we're doing this, what's changing
     ✓ specs/       — requirements and scenarios
     ✓ design.md    — technical approach
     ✓ tasks.md     — implementation checklist
     Ready for implementation!
```

如果你启用了扩展工作流 profile，也可以分两步完成：先 `/opsx:new`，然后 `/opsx:ff`（或使用 `/opsx:continue` 逐步推进）。

### 2. 创建的内容

**proposal.md** - 记录意图：

```markdown
# Proposal: Add Dark Mode

## Intent
Users have requested a dark mode option to reduce eye strain
during nighttime usage.

## Scope
- Add theme toggle in settings
- Support system preference detection
- Persist preference in localStorage

## Approach
Use CSS custom properties for theming with a React context
for state management.
```

**specs/ui/spec.md** - 展示新需求的 Delta：

```markdown
# Delta for UI

## ADDED Requirements

### Requirement: Theme Selection
The system SHALL allow users to choose between light and dark themes.

#### Scenario: Manual toggle
- GIVEN a user on any page
- WHEN the user clicks the theme toggle
- THEN the theme switches immediately
- AND the preference persists across sessions

#### Scenario: System preference
- GIVEN a user with no saved preference
- WHEN the application loads
- THEN the system's preferred color scheme is used
```

**tasks.md** - 实施清单：

```markdown
# Tasks

## 1. Theme Infrastructure
- [ ] 1.1 Create ThemeContext with light/dark state
- [ ] 1.2 Add CSS custom properties for colors
- [ ] 1.3 Implement localStorage persistence

## 2. UI Components
- [ ] 2.1 Create ThemeToggle component
- [ ] 2.2 Add toggle to settings page
- [ ] 2.3 Update Header to include quick toggle

## 3. Styling
- [ ] 3.1 Define dark theme color palette
- [ ] 3.2 Update components to use CSS variables
```

### 3. 实施

```
You: /opsx:apply

AI:  Working through tasks...
     ✓ 1.1 Created ThemeContext with light/dark state
     ✓ 1.2 Added CSS custom properties to globals.css
     ✓ 1.3 Implemented localStorage persistence
     ✓ 2.1 Created ThemeToggle component
     ...
     All tasks complete!
```

在实施过程中，如果你发现设计需要调整，只需更新对应的产物然后继续。

### 4. 归档

```
You: /opsx:archive

AI:  Archiving add-dark-mode...
     ✓ Merged specs into openspec/specs/ui/spec.md
     ✓ Moved to openspec/changes/archive/2025-01-24-add-dark-mode/
     Done! Ready for the next feature.
```

你的 delta spec 现在已成为主 spec 的一部分，记录了系统的工作方式。

## 验证与审查

使用 CLI 检查变更状态：

```bash
# List active changes
openspec list

# View change details
openspec show add-dark-mode

# Validate spec formatting
openspec validate add-dark-mode

# Interactive dashboard
openspec view
```

## 后续步骤

- [工作流](workflows.md) - 常见模式及各命令的使用场景
- [命令参考](commands.md) - 所有斜杠命令的完整参考
- [核心概念](concepts.md) - 深入理解 spec、变更和 schema
- [自定义配置](customization.md) - 让 OpenSpec 按你的方式工作
