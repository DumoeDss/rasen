# Supported Tools

Rasen works with many AI coding assistants. When you run `rasen init`, rasen configures selected tools using your active profile/workflow selection and delivery mode.

## How It Works

For each selected tool, rasen can install:

1. **Skills** (always): `.../skills/rasen-*/SKILL.md`
2. **Commands** (if delivery is `both`, and the tool has a command adapter): tool-specific `rasen-*` command files

By default, rasen uses the `full` profile, which installs every workflow. If you'd rather slim down to the everyday essentials, switch to the `core` profile:
- `propose`
- `explore`
- `apply`
- `sync`
- `archive`

Switch profiles (in either direction) with `rasen config profile`, then run `rasen update`.

## Tool Directory Reference

| Tool (ID) | Skills path pattern | Command path pattern |
|-----------|---------------------|----------------------|
| Amazon Q Developer (`amazon-q`) | `.amazonq/skills/rasen-*/SKILL.md` | `.amazonq/prompts/rasen-<id>.md` |
| Antigravity (`antigravity`) | `.agent/skills/rasen-*/SKILL.md` | `.agent/workflows/rasen-<id>.md` |
| Auggie (`auggie`) | `.augment/skills/rasen-*/SKILL.md` | `.augment/commands/rasen-<id>.md` |
| IBM Bob Shell (`bob`) | `.bob/skills/rasen-*/SKILL.md` | `.bob/commands/rasen-<id>.md` |
| Claude Code (`claude`) | `.claude/skills/rasen-*/SKILL.md` | `.claude/commands/rasen/<id>.md` |
| Cline (`cline`) | `.cline/skills/rasen-*/SKILL.md` | `.clinerules/workflows/rasen-<id>.md` |
| CodeBuddy (`codebuddy`) | `.codebuddy/skills/rasen-*/SKILL.md` | `.codebuddy/commands/rasen/<id>.md` |
| Codex (`codex`) | `.codex/skills/rasen-*/SKILL.md` | `$CODEX_HOME/prompts/rasen-<id>.md`\* |
| ForgeCode (`forgecode`) | `.forge/skills/rasen-*/SKILL.md` | Not generated (no command adapter; use skill-based `/rasen-*` invocations) |
| Continue (`continue`) | `.continue/skills/rasen-*/SKILL.md` | `.continue/prompts/rasen-<id>.prompt` |
| CoStrict (`costrict`) | `.cospec/skills/rasen-*/SKILL.md` | `.cospec/rasen/commands/rasen-<id>.md` |
| Crush (`crush`) | `.crush/skills/rasen-*/SKILL.md` | `.crush/commands/rasen/<id>.md` |
| Cursor (`cursor`) | `.cursor/skills/rasen-*/SKILL.md` | `.cursor/commands/rasen-<id>.md` |
| Factory Droid (`factory`) | `.factory/skills/rasen-*/SKILL.md` | `.factory/commands/rasen-<id>.md` |
| Gemini CLI (`gemini`) | `.gemini/skills/rasen-*/SKILL.md` | `.gemini/commands/rasen/<id>.toml` |
| GitHub Copilot (`github-copilot`) | `.github/skills/rasen-*/SKILL.md` | `.github/prompts/rasen-<id>.prompt.md`\*\* |
| iFlow (`iflow`) | `.iflow/skills/rasen-*/SKILL.md` | `.iflow/commands/rasen-<id>.md` |
| Junie (`junie`) | `.junie/skills/rasen-*/SKILL.md` | `.junie/commands/rasen-<id>.md` |
| Kilo Code (`kilocode`) | `.kilocode/skills/rasen-*/SKILL.md` | `.kilocode/workflows/rasen-<id>.md` |
| Kimi CLI (`kimi`) | `.kimi/skills/rasen-*/SKILL.md` | Not generated (no command adapter; use skill-based `/rasen-*` invocations) |
| Kiro (`kiro`) | `.kiro/skills/rasen-*/SKILL.md` | `.kiro/prompts/rasen-<id>.prompt.md` |
| Lingma (`lingma`) | `.lingma/skills/rasen-*/SKILL.md` | `.lingma/commands/rasen/<id>.md` |
| Mistral Vibe (`vibe`) | `.vibe/skills/rasen-*/SKILL.md` | Not generated (no command adapter; use skill-based `/rasen-*` invocations) |
| OpenCode (`opencode`) | `.opencode/skills/rasen-*/SKILL.md` | `.opencode/commands/rasen-<id>.md` |
| Pi (`pi`) | `.pi/skills/rasen-*/SKILL.md` | `.pi/prompts/rasen-<id>.md` |
| Qoder (`qoder`) | `.qoder/skills/rasen-*/SKILL.md` | `.qoder/commands/rasen/<id>.md` |
| Qwen Code (`qwen`) | `.qwen/skills/rasen-*/SKILL.md` | `.qwen/commands/rasen-<id>.toml` |
| RooCode (`roocode`) | `.roo/skills/rasen-*/SKILL.md` | `.roo/commands/rasen-<id>.md` |
| Trae (`trae`) | `.trae/skills/rasen-*/SKILL.md` | Not generated (no command adapter; use skill-based `/rasen-*` invocations) |
| Windsurf (`windsurf`) | `.windsurf/skills/rasen-*/SKILL.md` | `.windsurf/workflows/rasen-<id>.md` |

\* Codex commands are installed in the global Codex home (`$CODEX_HOME/prompts/` if set, otherwise `~/.codex/prompts/`), not your project directory.

\*\* GitHub Copilot prompt files are recognized as custom slash commands in IDE extensions (VS Code, JetBrains, Visual Studio). Copilot CLI does not currently consume `.github/prompts/*.prompt.md` directly.

## Non-Interactive Setup

For CI/CD or scripted setup, use `--tools` (and optionally `--profile`):

```bash
# Configure specific tools
rasen init --tools claude,cursor

# Configure all supported tools
rasen init --tools all

# Skip tool configuration
rasen init --tools none

# Override profile for this init run
rasen init --profile core
```

**Available tool IDs (`--tools`):** `amazon-q`, `antigravity`, `auggie`, `bob`, `claude`, `cline`, `codex`, `forgecode`, `codebuddy`, `continue`, `costrict`, `crush`, `cursor`, `factory`, `gemini`, `github-copilot`, `iflow`, `junie`, `kilocode`, `kimi`, `kiro`, `lingma`, `opencode`, `pi`, `qoder`, `qwen`, `roocode`, `trae`, `vibe`, `windsurf`

## Workflow-Dependent Installation

rasen installs workflow artifacts based on selected workflows:

- **Full profile (default):** every workflow ID
- **Core profile:** `propose`, `explore`, `apply`, `sync`, `archive`
- **Custom selection:** any subset of built-in workflow IDs plus valid workflows installed in the user-wide library. Required workflow dependencies are selected automatically.

In other words, skill count is profile-dependent (not fixed); command count additionally depends both on delivery (commands are only generated when delivery is `both`) and on whether the tool has a command adapter at all (ForgeCode, Kimi CLI, Mistral Vibe, and Trae are skill-only — see the table above).

## Generated Skill Names

When selected by profile/workflow config, rasen generates these skills:

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

See [Commands](commands.md) for command behavior and [CLI](cli.md) for `init`/`update` options.

User workflows generate the same tool-specific skill and optional command
formats as built-ins. Validated nested sidecars are copied beside the skill,
and `update` uses the managed-artifact ledger to detect source digest changes
and clean up only files Rasen generated.

## Related

- [CLI Reference](cli.md) — Terminal commands
- [Commands](commands.md) — Slash commands and skills
- [Getting Started](getting-started.md) — First-time setup
