# 命令是如何工作的

**你只需要知道一件事：OpenSpec 有两种命令，它们在两个不同的地方运行。**

- `rasen ...` 命令在你的**终端**里运行。（例如：`rasen init`。）
- 以规范名字 `rasen-*` 调用的技能（skill）在你的 **AI 助手的聊天**里运行。（例如：`rasen-propose`。）

如果你曾经把 `rasen-propose` 打进终端却毫无反应，这一页就是原因所在。你和 OpenSpec 的另一半说错话了。斜杠命令不是终端命令。它们是你给 AI 编程助手的指令，打在你平时输入“加一个登录表单”的同一个聊天框里。

这一个区别是新用户最常见的绊脚石，所以我们把它讲得清清楚楚。

## 两个半边

OpenSpec 是同一个项目戴着两顶帽子。

**CLI（终端那一半）。** 一个名为 `openspec` 的程序，你从 shell 里安装并运行它。它设置你的项目、列出并校验变更、展示一个仪表盘、归档已完成的工作。你在 iTerm、VS Code 终端、PowerShell——任何你会运行 `git` 或 `npm` 的地方——里输入这些命令。

```bash
rasen init        # 在本项目中设置 OpenSpec
rasen list        # 查看进行中的变更
rasen view        # 打开交互式仪表盘
```

**斜杠命令（聊天那一半）。** 像 `rasen-propose` 和 `rasen-apply-change` 这样简短的命令，你把它们打进 AI 助手。这些命令告诉 AI 去遵循 OpenSpec 工作流：起草 proposal、编写 specs、按任务清单构建、完成后归档。你在 Claude Code、Cursor、Windsurf、Copilot，或你使用的任何助手里输入这些命令。

```text
rasen-propose add-dark-mode    （打在你的 AI 聊天里）
rasen-apply-change                    （打在你的 AI 聊天里）
rasen-archive-change                  （打在你的 AI 聊天里）
```

用一个画面把心智模型概括一下：

```text
        YOUR TERMINAL                         YOUR AI ASSISTANT'S CHAT
   ┌──────────────────────┐               ┌──────────────────────────────┐
   │  $ rasen init     │   installs    │  rasen-propose add-dark-mode  │
   │  $ rasen list     │  ──────────►  │  rasen-apply-change                  │
   │  $ rasen view     │   commands    │  rasen-archive-change                │
   └──────────────────────┘    & skills   └──────────────────────────────┘
        run rasen here                       run rasen-* skills here
```

注意那个箭头。在终端里运行 `rasen init`，正是把斜杠命令*安装*进你的 AI 工具的动作。终端那一半把聊天那一半设置好。此后，日常的驱动主要发生在聊天里。

## “我要怎么开启交互模式？”

**没有需要单独开启的交互模式。** 这个问题很常见，所以值得给一个直白的回答。

你不需要进入某个特殊的 OpenSpec 模式。你只需像平时那样打开你的 AI 编程助手，然后在聊天里敲一个斜杠命令。斜杠命令*就是*你“进入” OpenSpec 的方式。你的助手认出它、加载对应的 OpenSpec skill、然后开始遵循工作流。

所以真正的步骤是：

1. 在你的项目里打开 AI 编程助手（Claude Code、Cursor、Windsurf 等等）。
2. 在它的聊天里输入 `rasen-propose`，就和你输入任何其他请求的位置一样。
3. 看自动补全：如果 OpenSpec 已经安装，你一边敲斜杠，就会看到 `rasen-propose`、`rasen-apply-change` 等陆续出现。

就是这样。没有要切换的模式、没有要启动的守护进程、也没有单独的窗口。

有一件*真正*是交互式的东西确实住在终端里：`rasen view`。它会打开一个仪表盘，用来浏览你的 specs 和变更。但它是一个查看器，而不是你用来提议和构建的工具。构建是通过聊天里的斜杠命令完成的。

## 为什么会有这种拆分

这值得理解一下，因为它解释了为什么 OpenSpec 能和 25+ 种不同的 AI 工具配合工作。

CLI 是**引擎**。它掌握规则：变更文件夹长什么样、哪些产物依赖哪些、如何把一份 delta spec 合并进你的事实来源。它在任何地方都一样。

斜杠命令是**方向盘**，而每个 AI 工具的方向盘都略有不同。Claude Code 把它们叫作命令。Cursor 和 Windsurf 有各自的格式。有些工具把它们叫作 skill。当你运行 `rasen init` 时，OpenSpec 会为你选定的每个工具生成正确类型的文件，于是同样的 `rasen-propose` 意图，无论你偏爱哪个助手都能奏效。

这种设计的长处：你学一次工作流，就能把它带到各个工具里。代价是：一条命令的确切语法在不同工具之间可能略有不同——这正是下一节的内容。

## 各工具的斜杠命令语法

意图在任何地方都完全一样。标点符号有所不同。使用与你的助手匹配的那种形式。

| 工具 | 你怎么输入 |
|------|-----------------|
| Claude Code | `/rasen-propose`、`/rasen-apply-change` |
| Cursor | `/opsx-propose`、`/opsx-apply` |
| Windsurf | `/opsx-propose`、`/opsx-apply` |
| GitHub Copilot（IDE） | `/opsx-propose`、`/opsx-apply` |
| Kimi CLI | skill 风格，例如 `/skill:openspec-propose` |
| Trae | skill 风格，例如 `/openspec-propose` |

每个工具都会通过前导斜杠来呈现该 skill，具体语法因工具而异。完整的逐工具清单（包括究竟哪些文件被写到哪里）在[支持的工具](supported-tools.md)里。

拿不准时，就在 AI 聊天里敲一个斜杠，然后看自动补全。你的工具会把它期望的形式显示给你。

## 这些命令是怎么来的：skill 与 command

当你运行 `rasen init`（或 `rasen update`）时，OpenSpec 会在你的项目里写入一些小文件，好让你的 AI 工具找到工作流。取决于你的工具和设置，这些文件是 **skill**、**command**，或两者皆是。

- **Skill** 放在 `.claude/skills/openspec-*/SKILL.md` 这类位置。它们是正在兴起的跨工具标准：一个你的助手会自动探测到的指令文件夹。
- **Command** 放在 `.claude/commands/opsx/<id>.md` 这类位置。它们是较早的、按工具生成的斜杠命令文件。

你不必关心你的工具用的是哪一种。你只需敲出斜杠命令，它就能工作。但知道这些文件的存在，在出问题时会有帮助：如果你的命令消失了，通常意味着这些文件缺失或过期，而 `rasen update` 会重新生成它们。

参见[支持的工具](supported-tools.md)了解每个工具的确切路径，以及[迁移指南](migration-guide.md)了解 skill 是如何取代较早的、纯 command 方案的。

## 确认它已安装

几个快速检查，最快的排前面：

1. **在 AI 聊天里敲一个斜杠。** 开始输入 `/opsx`，留意自动补全的建议。如果它们出现了，你就准备好了。
2. **去找那些文件。** 对于 Claude Code，检查 `.claude/skills/` 里是否包含 `openspec-*` 文件夹。其他工具使用它们自己的目录（[支持的工具](supported-tools.md)列出了它们）。
3. **重新运行设置。** 从你的项目根目录运行 `rasen update`。这会为你配置的任何工具重新生成 skill 和 command 文件。
4. **重启你的助手。** 许多工具在启动时扫描 skill 和 command，所以开一个新窗口可能正是缺的那一步。

## 我到底有哪些命令？

默认情况下，OpenSpec 安装 **core** 这一组斜杠命令：

- `rasen-explore`：在承诺一项变更之前，先和 AI 一起把想法想清楚（拿不准时极好的第一步）
- `rasen-propose`：一步创建一个变更并起草它的全部规划产物
- `rasen-apply-change`：按变更的任务清单逐项构建
- `rasen-sync-specs`：把变更的 spec 更新合并进你的主 specs（通常是自动的）
- `rasen-archive-change`：完成一项变更并把它归档

一个不错的默认节奏：`explore`（想清楚做什么）→ `propose` → `apply` → `archive`。[先做探索](explore.md)这份指南解释了为什么开头那一步值得。

此外还有一个**扩展**命令集，给那些想要更精细控制的人（`rasen-new-change`、`rasen-continue-change`、`rasen-verify-change`、`rasen-bulk-archive-change`、`rasen-onboard`）。你用 `rasen config profile` 开启它，再用 `rasen update` 应用。

对这一切都还陌生？`rasen-onboard`（在扩展命令集里）会带你用自己的代码库走完一整个变更，并为每一步讲解。它是你能找到的最友好的入门。

要了解每条命令的详细作用，参见[命令](commands.md)。要了解何时该用哪一条，参见[工作流](workflows.md)。

## 一次干净的首跑

把它们串起来，下面是完整的流程，每一步都标注了它发生在哪里。

```text
TERMINAL   $ npm install -g @fission-ai/openspec@latest
TERMINAL   $ cd your-project
TERMINAL   $ rasen init
              (installs slash commands into your AI tool)

AI CHAT      rasen-explore
              (optional: think the idea through with the AI first)

AI CHAT      rasen-propose add-dark-mode
              (AI drafts proposal, specs, design, tasks)

AI CHAT      rasen-apply-change
              (AI builds it, checking off tasks)

AI CHAT      rasen-archive-change
              (change is merged into your specs and filed away)
```

两步终端设置。然后你就活在聊天里。这就是节奏。

## 相关

- [快速入门](getting-started.md)：完整的首次变更走查
- [命令](commands.md)：每一条斜杠命令的详解
- [CLI](cli.md)：每一条终端命令的详解
- [支持的工具](supported-tools.md)：各工具的语法和文件位置
- [FAQ](faq.md)：更多快速问答
- [故障排查](troubleshooting.md)：命令不出现时的修复办法
