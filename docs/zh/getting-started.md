# 快速入门

本指南讲解在安装并初始化 OpenSpec 之后，它是如何运作的。有关安装说明，请参阅[主 README](../../README.md#quick-start) 或 [安装指南](installation.md)。第一次接触这一整套文档？[文档首页](README.md) 给出了全景地图。

> **这些命令到底在哪里输入？** 两个地方，而把它们搞混是最常见的早期磕碰。
>
> - `rasen ...` 命令（如 `rasen init`）在你的**终端**里运行。
> - `/rasen:...` 命令（如 `/rasen:propose`）在你的 **AI 助手的聊天里**运行——就是你让它写代码的那个对话框。
>
> 没有一个单独的“交互模式”需要启动。你只需在聊天里输入斜杠命令，你的助手就会接手。完整解释见 [命令是如何工作的](how-commands-work.md)。

## 你的头五分钟

完整循环，每一步都标注了它发生在哪里：

```text
TERMINAL   $ npm install -g @fission-ai/openspec@latest
TERMINAL   $ cd your-project && rasen init
AI CHAT      /rasen:explore                    （可选：先想透）
AI CHAT      /rasen:propose add-dark-mode      （AI 起草计划；你评审它）
AI CHAT      /rasen:apply                      （AI 构建它）
AI CHAT      /rasen:archive                    （规格更新，变更归档）
```

两个终端步骤完成配置，之后你就生活在聊天里。本指南余下部分会拆解每一步做什么、你会看到什么。

> **还不确定要构建什么？从 `/rasen:explore` 开始。** 它是一个零成本的思考伙伴——读你的代码库、权衡各种选项，在任何产物或代码存在之前，把一个模糊的想法打磨成具体的计划。当图景清晰了，它会把工作交接给 `/rasen:propose`。这是与一个“否则会自信满满地造错东西的 AI”协作时，最值得养成的单一习惯。参见 [探索指南](explore.md)。

## 工作原理

OpenSpec 是一套自主引擎：你只需提供意图，它便自行驱动改动走完规划、实施、评审、修复、交付、归档。

**默认的快速路径（core profile）：**

```text
/rasen:explore ──► /rasen:propose ──► /rasen:apply ──► /rasen:sync ──► /rasen:archive
   （可选）
```

当你在斟酌要做什么时，从 `/rasen:explore` 开始；已经胸有成竹时，则直接跳到 `/rasen:propose`。explore 包含在默认 profile 里，所以你想用的时候它总在。

**扩展路径（自定义工作流选择）：**

```text
/rasen:new ──► /rasen:ff or /rasen:continue ──► /rasen:apply ──► /rasen:verify ──► /rasen:archive
```

默认的全局 profile 是 `core`，包含 `propose`、`explore`、`apply`、`sync` 和 `archive`。你可以通过 `rasen config profile` 再加上 `rasen update` 来启用扩展工作流命令。

## OpenSpec 创建的内容

运行 `rasen init` 后，你的项目会拥有如下结构：

```
openspec/
├── specs/              # 唯一事实来源（你系统的行为）
│   └── <domain>/
│       └── spec.md
├── changes/            # 提议的更新（每次变更一个文件夹）
│   └── <change-name>/
│       ├── proposal.md
│       ├── design.md
│       ├── tasks.md
│       └── specs/      # Delta 规格（什么在变）
│           └── <domain>/
│               └── spec.md
└── config.yaml         # 项目配置（可选）
```

**两个关键目录：**

- **`specs/`** - 唯一事实来源。这些规格描述了你的系统当前是如何运作的，按领域组织（例如 `specs/auth/`、`specs/payments/`）。

- **`changes/`** - 提议的修改。每次变更都有自己的文件夹，装着所有相关产物。当一次变更完成时，它的规格会并入主 `specs/` 目录。

## 理解产物

每个变更文件夹里都装有指导这项工作的产物：

| 产物 | 用途 |
|----------|---------|
| `proposal.md` | “为什么”和“做什么”——记录意图、范围和方法 |
| `specs/` | Delta 规格，展示 ADDED/MODIFIED/REMOVED 的需求 |
| `design.md` | “怎么做”——技术方案和架构决策 |
| `tasks.md` | 带复选框的实施清单 |

**产物层层递进：**

```
proposal ──► specs ──► design ──► tasks ──► implement
   ▲           ▲          ▲                    │
   └───────────┴──────────┴────────────────────┘
            update as you learn
```

在实施过程中，随着你了解得更多，你随时可以回头打磨更早的产物。

## Delta 规格如何运作

Delta 规格是 OpenSpec 的核心概念。它们展示的是相对于你当前规格，什么东西在变。

### 格式

Delta 规格用分节来标明变更类型：

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

当你归档一次变更时：

1. **ADDED** 的需求会追加到主规格中
2. **MODIFIED** 的需求会替换掉现有版本
3. **REMOVED** 的需求会从主规格中删除

变更文件夹会被移动到 `rasen/changes/archive/`，作为审计历史。

## 示例：你的第一个变更

我们来走一遍给一个应用添加暗色模式（dark mode）的过程。

### 1. 发起变更（默认方式）

```text
You: /rasen:propose add-dark-mode

AI:  Created rasen/changes/add-dark-mode/
     ✓ proposal.md — why we're doing this, what's changing
     ✓ specs/       — requirements and scenarios
     ✓ design.md    — technical approach
     ✓ tasks.md     — implementation checklist
     Ready for implementation!
```

如果你启用了扩展工作流 profile，也可以分两步来做：先 `/rasen:new`，然后 `/rasen:ff`（或用 `/rasen:continue` 逐步推进）。

### 2. 创建出的内容

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
You: /rasen:apply

AI:  Working through tasks...
     ✓ 1.1 Created ThemeContext with light/dark state
     ✓ 1.2 Added CSS custom properties to globals.css
     ✓ 1.3 Implemented localStorage persistence
     ✓ 2.1 Created ThemeToggle component
     ...
     All tasks complete!
```

在实施过程中，如果你发现设计需要调整，只需更新对应产物然后继续。

### 4. 归档

```
You: /rasen:archive

AI:  Archiving add-dark-mode...
     ✓ Merged specs into rasen/specs/ui/spec.md
     ✓ Moved to rasen/changes/archive/2025-01-24-add-dark-mode/
     Done! Ready for the next feature.
```

你的 delta 规格现在已成为主规格的一部分，记录着你的系统是如何运作的。

## 验证与评审

用 CLI 来查看你的变更：

```bash
# List active changes
rasen list

# View change details
rasen show add-dark-mode

# Validate spec formatting
rasen validate add-dark-mode

# Interactive dashboard
rasen view
```

## 后续步骤

- [先做探索](explore.md) - 在拍板之前，用 `/rasen:explore` 把一个想法想透
- [评审一次变更](reviewing-changes.md) - 在写任何代码之前，该检查 AI 起草计划里的哪些东西
- [写好规格](writing-specs.md) - 一条强需求和一个好场景长什么样
- [在现有项目中使用 OpenSpec](existing-projects.md) - 在庞大的棕地代码库上起步
- [编辑与迭代一次变更](editing-changes.md) - 更新产物、回退、调和手动改动
- [核心概念一览](overview.md) - 一页讲清整套心智模型
- [示例与配方](examples.md) - 真实变更，从头到尾
- [工作流](workflows.md) - 常见模式，以及何时用哪个命令
- [命令](commands.md) - 所有斜杠命令的完整参考
- [概念](concepts.md) - 深入理解 spec、变更和 schema
- [自定义](customization.md) - 让 OpenSpec 按你的方式工作
- [Store](stores-beta/user-guide.md) - 规划横跨多个仓库或团队？把它放进它自己的仓库里（beta）
- [FAQ](faq.md) 和 [故障排查](troubleshooting.md) - 卡住的时候
