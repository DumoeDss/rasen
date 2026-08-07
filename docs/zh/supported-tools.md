# 支持的工具

rasen 兼容多种 AI 编程助手。当你运行 `rasen init` 时，rasen 会根据你激活的 profile/workflow 选择和交付模式来配置选定的工具。

## 工作原理

对于每个选定的工具，rasen 可以安装：

1. **Skills**（如果交付模式包含 skills）：`.../skills/rasen-*/SKILL.md`
2. **Commands**（如果交付模式包含 commands）：工具特定的 `opsx-*` 命令文件

默认情况下，rasen 使用 `core` 配置文件，包含：
- `propose`
- `explore`
- `apply`
- `sync`
- `archive`

你可以通过 `rasen config profile` 启用扩展工作流（`new`、`continue`、`verify`、`bulk-archive`、`onboard`），然后运行 `rasen update`。

## 工具目录参考

| 工具 (ID) | Skills 路径模式 |
|-----------|---------------------|
| Amazon Q Developer (`amazon-q`) | `.amazonq/skills/rasen-*/SKILL.md` |
| Antigravity (`antigravity`) | `.agent/skills/rasen-*/SKILL.md` |
| Auggie (`auggie`) | `.augment/skills/rasen-*/SKILL.md` |
| IBM Bob Shell (`bob`) | `.bob/skills/rasen-*/SKILL.md` |
| Claude Code (`claude`) | `.claude/skills/rasen-*/SKILL.md` |
| Cline (`cline`) | `.cline/skills/rasen-*/SKILL.md` |
| CodeBuddy (`codebuddy`) | `.codebuddy/skills/rasen-*/SKILL.md` |
| Codex (`codex`) | `.codex/skills/rasen-*/SKILL.md` |
| ForgeCode (`forgecode`) | `.forge/skills/rasen-*/SKILL.md` |
| Continue (`continue`) | `.continue/skills/rasen-*/SKILL.md` |
| CoStrict (`costrict`) | `.cospec/skills/rasen-*/SKILL.md` |
| Crush (`crush`) | `.crush/skills/rasen-*/SKILL.md` |
| Cursor (`cursor`) | `.cursor/skills/rasen-*/SKILL.md` |
| Factory Droid (`factory`) | `.factory/skills/rasen-*/SKILL.md` |
| Gemini CLI (`gemini`) | `.gemini/skills/rasen-*/SKILL.md` |
| GitHub Copilot (`github-copilot`) | `.github/skills/rasen-*/SKILL.md` |
| Hermes (`hermes`) | `<HERMES_HOME 或 ~/.hermes>/skills/rasen-*/SKILL.md`（机器级全局目录，不在项目内） |
| iFlow (`iflow`) | `.iflow/skills/rasen-*/SKILL.md` |
| Junie (`junie`) | `.junie/skills/rasen-*/SKILL.md` |
| Kilo Code (`kilocode`) | `.kilocode/skills/rasen-*/SKILL.md` |
| Kimi CLI (`kimi`) | `.kimi/skills/rasen-*/SKILL.md` |
| Kiro (`kiro`) | `.kiro/skills/rasen-*/SKILL.md` |
| Lingma (`lingma`) | `.lingma/skills/rasen-*/SKILL.md` |
| Mistral Vibe (`vibe`) | `.vibe/skills/rasen-*/SKILL.md` |
| Oh My Pi (`omp`) | `.omp/skills/rasen-*/SKILL.md` |
| OpenCode (`opencode`) | `.opencode/skills/rasen-*/SKILL.md` |
| Pi (`pi`) | `.pi/skills/rasen-*/SKILL.md` |
| Qoder (`qoder`) | `.qoder/skills/rasen-*/SKILL.md` |
| Qwen Code (`qwen`) | `.qwen/skills/rasen-*/SKILL.md` |
| RooCode (`roocode`) | `.roo/skills/rasen-*/SKILL.md` |
| Trae (`trae`) | `.trae/skills/rasen-*/SKILL.md` |
| Windsurf (`windsurf`) | `.windsurf/skills/rasen-*/SKILL.md` |

此表不再列出 command 路径：per-tool 的 command 界面已停用，skill 是唯一的交付形式，`rasen init` 会主动清理遗留的 command 文件。

## 非交互式设置

用于 CI/CD 或脚本化设置时，使用 `--tools`（可选 `--profile`）：

```bash
# 配置特定工具
rasen init --tools claude,codex

# 配置所有支持的工具
rasen init --tools all

# 跳过工具配置
rasen init --tools none

# 为本次 init 运行覆盖 profile
rasen init --profile core
```

**可安装的工具 ID（`--tools`）：** `claude`、`codex`、`hermes`、`omp`。`--tools all` 恰好展开为这四个。

上表中的其他 ID 都是已识别但不提供安装的工具：rasen 需要针对每个 agent 适配 dispatch、worker 生命周期和 resume 行为，显式指定未适配的工具会失败，并给出"已识别但尚未适配"的提示——与"无法识别的 ID"错误不同。

## 依赖工作流的安装

rasen 根据选定的工作流安装工作流产物：

- **Core profile（默认）：** `propose`、`explore`、`apply`、`sync`、`archive`
- **自定义选择：** 所有工作流 ID 的任意子集：
  `propose`、`explore`、`new`、`continue`、`apply`、`sync`、`archive`、`bulk-archive`、`verify`、`onboard`

换句话说，skill/command 的数量取决于 profile 和交付模式，并非固定不变。

## 生成的 Skill 名称

当通过 profile/workflow 配置选定时，rasen 会生成以下 skill：

- `rasen-propose`
- `rasen-explore`
- `rasen-new-change`
- `rasen-continue-change`
- `rasen-apply-change`
- `rasen-sync-specs`
- `rasen-archive-change`
- `rasen-bulk-archive-change`
- `rasen-verify-change`
- `rasen-onboard`

参见 [Commands](commands.md) 了解命令行为，以及 [CLI](cli.md) 了解 `init`/`update` 选项。

## 相关文档

- [CLI 参考](cli.md) — 终端命令
- [Commands](commands.md) — 斜杠命令和 skill
- [快速入门](getting-started.md) — 首次设置
