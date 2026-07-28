# Supported Tools

Rasen works with many AI coding assistants. When you run `rasen init`, rasen configures selected tools using your active profile/workflow selection.

## How It Works

For each selected tool, rasen installs:

1. **Skills** (always): `.../skills/rasen-*/SKILL.md`

Skills are the only delivery format — rasen no longer generates separate per-tool slash command files. Every supported tool that natively discovers project skills (Claude Code and 15+ others) picks these up automatically; consult your tool's own docs for how it surfaces a skill as an invocable command.

By default, rasen uses the `full` profile, which installs every workflow. If you'd rather slim down to the everyday essentials, switch to the `core` profile:
- `propose`
- `explore`
- `apply`
- `sync`
- `archive`

Switch profiles (in either direction) with `rasen config profile`, then run `rasen update`.

## Tool Directory Reference

| Tool (ID) | Skills path pattern |
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
| iFlow (`iflow`) | `.iflow/skills/rasen-*/SKILL.md` |
| Junie (`junie`) | `.junie/skills/rasen-*/SKILL.md` |
| Kilo Code (`kilocode`) | `.kilocode/skills/rasen-*/SKILL.md` |
| Kimi CLI (`kimi`) | `.kimi/skills/rasen-*/SKILL.md` |
| Kiro (`kiro`) | `.kiro/skills/rasen-*/SKILL.md` |
| Lingma (`lingma`) | `.lingma/skills/rasen-*/SKILL.md` |
| Mistral Vibe (`vibe`) | `.vibe/skills/rasen-*/SKILL.md` |
| OpenCode (`opencode`) | `.opencode/skills/rasen-*/SKILL.md` |
| Pi (`pi`) | `.pi/skills/rasen-*/SKILL.md` |
| Qoder (`qoder`) | `.qoder/skills/rasen-*/SKILL.md` |
| Qwen Code (`qwen`) | `.qwen/skills/rasen-*/SKILL.md` |
| RooCode (`roocode`) | `.roo/skills/rasen-*/SKILL.md` |
| Trae (`trae`) | `.trae/skills/rasen-*/SKILL.md` |
| Windsurf (`windsurf`) | `.windsurf/skills/rasen-*/SKILL.md` |

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

In other words, skill count is profile-dependent, not fixed.

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

See [Commands](commands.md) for how to invoke workflows and [CLI](cli.md) for `init`/`update` options.

User workflows generate the same tool-specific skill format as built-ins.
Validated nested sidecars are copied beside the skill, and `update` uses the
managed-artifact ledger to detect source digest changes and clean up only
files Rasen generated.

## Related

- [CLI Reference](cli.md) — Terminal commands
- [Commands](commands.md) — Slash commands and skills
- [Getting Started](getting-started.md) — First-time setup
