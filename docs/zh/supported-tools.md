# 支持的工具

OpenSpec 兼容多种 AI 编程助手。当你运行 `rasen init` 时，OpenSpec 会根据你激活的 profile/workflow 选择和交付模式来配置选定的工具。

## 工作原理

对于每个选定的工具，OpenSpec 可以安装：

1. **Skills**（如果交付模式包含 skills）：`.../skills/openspec-*/SKILL.md`
2. **Commands**（如果交付模式包含 commands）：工具特定的 `opsx-*` 命令文件

默认情况下，OpenSpec 使用 `core` 配置文件，包含：
- `propose`
- `explore`
- `apply`
- `sync`
- `archive`

你可以通过 `rasen config profile` 启用扩展工作流（`new`、`continue`、`verify`、`bulk-archive`、`onboard`），然后运行 `rasen update`。

## 工具目录参考

| 工具 (ID) | Skills 路径模式 | Command 路径模式 |
|-----------|---------------------|----------------------|
| Amazon Q Developer (`amazon-q`) | `.amazonq/skills/openspec-*/SKILL.md` | `.amazonq/prompts/opsx-<id>.md` |
| Antigravity (`antigravity`) | `.agent/skills/openspec-*/SKILL.md` | `.agent/workflows/opsx-<id>.md` |
| Auggie (`auggie`) | `.augment/skills/openspec-*/SKILL.md` | `.augment/commands/opsx-<id>.md` |
| IBM Bob Shell (`bob`) | `.bob/skills/openspec-*/SKILL.md` | `.bob/commands/opsx-<id>.md` |
| Claude Code (`claude`) | `.claude/skills/openspec-*/SKILL.md` | `.claude/commands/opsx/<id>.md` |
| Cline (`cline`) | `.cline/skills/openspec-*/SKILL.md` | `.clinerules/workflows/opsx-<id>.md` |
| CodeBuddy (`codebuddy`) | `.codebuddy/skills/openspec-*/SKILL.md` | `.codebuddy/commands/opsx/<id>.md` |
| Codex (`codex`) | `.codex/skills/openspec-*/SKILL.md` | `$CODEX_HOME/prompts/opsx-<id>.md`\* |
| ForgeCode (`forgecode`) | `.forge/skills/openspec-*/SKILL.md` | 不生成（无 command 适配器；请使用基于 skill 的 `/openspec-*` 调用） |
| Continue (`continue`) | `.continue/skills/openspec-*/SKILL.md` | `.continue/prompts/opsx-<id>.prompt` |
| CoStrict (`costrict`) | `.cospec/skills/openspec-*/SKILL.md` | `.cospec/openspec/commands/opsx-<id>.md` |
| Crush (`crush`) | `.crush/skills/openspec-*/SKILL.md` | `.crush/commands/opsx/<id>.md` |
| Cursor (`cursor`) | `.cursor/skills/openspec-*/SKILL.md` | `.cursor/commands/opsx-<id>.md` |
| Factory Droid (`factory`) | `.factory/skills/openspec-*/SKILL.md` | `.factory/commands/opsx-<id>.md` |
| Gemini CLI (`gemini`) | `.gemini/skills/openspec-*/SKILL.md` | `.gemini/commands/opsx/<id>.toml` |
| GitHub Copilot (`github-copilot`) | `.github/skills/openspec-*/SKILL.md` | `.github/prompts/opsx-<id>.prompt.md`\*\* |
| iFlow (`iflow`) | `.iflow/skills/openspec-*/SKILL.md` | `.iflow/commands/opsx-<id>.md` |
| Junie (`junie`) | `.junie/skills/openspec-*/SKILL.md` | `.junie/commands/opsx-<id>.md` |
| Kilo Code (`kilocode`) | `.kilocode/skills/openspec-*/SKILL.md` | `.kilocode/workflows/opsx-<id>.md` |
| Kimi CLI (`kimi`) | `.kimi/skills/openspec-*/SKILL.md` | 不生成（无 command 适配器；请使用基于 skill 的 `/skill:openspec-*` 调用） |
| Kiro (`kiro`) | `.kiro/skills/openspec-*/SKILL.md` | `.kiro/prompts/opsx-<id>.prompt.md` |
| Lingma (`lingma`) | `.lingma/skills/openspec-*/SKILL.md` | `.lingma/commands/opsx/<id>.md` |
| Mistral Vibe (`vibe`) | `.vibe/skills/openspec-*/SKILL.md` | 不生成（无 command 适配器；请使用基于 skill 的 `/openspec-*` 调用） |
| OpenCode (`opencode`) | `.opencode/skills/openspec-*/SKILL.md` | `.opencode/commands/opsx-<id>.md` |
| Pi (`pi`) | `.pi/skills/openspec-*/SKILL.md` | `.pi/prompts/opsx-<id>.md` |
| Qoder (`qoder`) | `.qoder/skills/openspec-*/SKILL.md` | `.qoder/commands/opsx/<id>.md` |
| Qwen Code (`qwen`) | `.qwen/skills/openspec-*/SKILL.md` | `.qwen/commands/opsx-<id>.toml` |
| RooCode (`roocode`) | `.roo/skills/openspec-*/SKILL.md` | `.roo/commands/opsx-<id>.md` |
| Trae (`trae`) | `.trae/skills/openspec-*/SKILL.md` | 不生成（无 command 适配器；请使用基于 skill 的 `/openspec-*` 调用） |
| Windsurf (`windsurf`) | `.windsurf/skills/openspec-*/SKILL.md` | `.windsurf/workflows/opsx-<id>.md` |

\* Codex 的 command 安装在全局 Codex 主目录中（如果设置了 `$CODEX_HOME`，则为 `$CODEX_HOME/prompts/`，否则为 `~/.codex/prompts/`），而非你的项目目录。

\*\* GitHub Copilot 的 prompt 文件在 IDE 扩展（VS Code、JetBrains、Visual Studio）中被识别为自定义斜杠命令。Copilot CLI 目前不直接使用 `.github/prompts/*.prompt.md`。

## 非交互式设置

用于 CI/CD 或脚本化设置时，使用 `--tools`（可选 `--profile`）：

```bash
# 配置特定工具
rasen init --tools claude,cursor

# 配置所有支持的工具
rasen init --tools all

# 跳过工具配置
rasen init --tools none

# 为本次 init 运行覆盖 profile
rasen init --profile core
```

**可用的工具 ID（`--tools`）：** `amazon-q`、`antigravity`、`auggie`、`bob`、`claude`、`cline`、`codex`、`forgecode`、`codebuddy`、`continue`、`costrict`、`crush`、`cursor`、`factory`、`gemini`、`github-copilot`、`iflow`、`junie`、`kilocode`、`kimi`、`kiro`、`lingma`、`opencode`、`pi`、`qoder`、`qwen`、`roocode`、`trae`、`vibe`、`windsurf`

## 依赖工作流的安装

OpenSpec 根据选定的工作流安装工作流产物：

- **Core profile（默认）：** `propose`、`explore`、`apply`、`sync`、`archive`
- **自定义选择：** 所有工作流 ID 的任意子集：
  `propose`、`explore`、`new`、`continue`、`apply`、`sync`、`archive`、`bulk-archive`、`verify`、`onboard`

换句话说，skill/command 的数量取决于 profile 和交付模式，并非固定不变。

## 生成的 Skill 名称

当通过 profile/workflow 配置选定时，OpenSpec 会生成以下 skill：

- `openspec-propose`
- `openspec-explore`
- `openspec-new-change`
- `openspec-continue-change`
- `openspec-apply-change`
- `openspec-sync-specs`
- `openspec-archive-change`
- `openspec-bulk-archive-change`
- `openspec-verify-change`
- `openspec-onboard`

参见 [Commands](commands.md) 了解命令行为，以及 [CLI](cli.md) 了解 `init`/`update` 选项。

## 相关文档

- [CLI 参考](cli.md) — 终端命令
- [Commands](commands.md) — 斜杠命令和 skill
- [快速入门](getting-started.md) — 首次设置
