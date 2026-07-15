## Why

Rasen adapts its orchestration per code agent (Claude Code first-class, Codex second). Hermes Agent (Nous Research, `hermes` CLI) is the next agent to adopt. This change makes Hermes a selectable, adapted agent by installing Rasen's workflow skills where Hermes actually discovers them, so a Hermes user gets Rasen's `/rasen-*` workflow surface. It is the first consumer of the `adapted` flag shipped by `agent-adapters-visible-tools`.

Research note: all conventions below are established from real sources — the Nous Research `hermes-agent` docs (configuration and CLI-commands references). No local `hermes` binary is installed on this machine (`which hermes` → not found), so version-pinned runtime behavior is left to a future change and flagged as an open question rather than assumed.

## What Changes

- **Hermes becomes an adapted, selectable agent.** A `hermes` entry is added to the tool registry with `adapted: true`, so it appears in the init multi-select, in `--tools all`, and is accepted by `--tools hermes` (reversing the "not yet adapted" rejection for `hermes` only).
- **Rasen skills install to Hermes's global skills home.** Hermes discovers skills only from its global home (`~/.hermes/skills/`, overridable via `HERMES_HOME`), where each `<name>/SKILL.md` is auto-registered as a `/<name>` slash command. Rasen therefore installs its workflow skills to `~/.hermes/skills/rasen-<name>/SKILL.md` rather than a project-local directory. This requires the skill-install path (today hardcoded to `<projectRoot>/<skillsDir>/skills/`) to resolve a per-tool skills root — the same indirection the command adapter already has for Codex's global prompts, applied to skills.
- **No command-file adapter for Hermes.** Hermes has no per-file custom-command directory (its `quick_commands:` are inline `config.yaml` shell shortcuts, not LLM prompts); installed skills already surface as slash commands. Command-file generation is skipped for Hermes via the existing "no registered adapter" path — the same behavior as Kimi CLI. Skills are still always installed.
- **Detection and update tolerate the global home.** Whether Hermes is Rasen-configured is determined from its global skills home, so `rasen update` refreshes an installed Hermes correctly. Auto-detection of Hermes from a project directory is intentionally weak (Hermes keeps no project-local footprint, same limitation as Codex); users select it explicitly or interactively.
- **Runtime bridging is out of scope here.** Hermes exposes a clean non-interactive one-shot (`hermes -z "<prompt>"`) and session resume (`--resume`/`-r`, `--continue`/`-c`), which are promising for Rasen's dispatch/resume needs, but this change delivers only the install/adapter layer. The runtime bridge is left to a follow-up (analogous to `codex-exec-runtime`).
- Tests cover: hermes offered by the adapted surface, skills written to the resolved Hermes home, command generation skipped, and update recognizing an installed Hermes.

## Capabilities

### New Capabilities
- `hermes-integration`: The Hermes install contract — Hermes is an adapted agent; Rasen workflow skills are installed to Hermes's global skills home so they auto-register as slash commands; no per-file command generation is performed for Hermes; configured-state detection reads the global skills home.

### Modified Capabilities
- `adapted-agent-visibility`: the adapted-agent set grows from {claude, codex} to {claude, codex, hermes}; `--tools hermes` is accepted rather than refused as "not yet adapted".
- `ai-tool-paths`: a `hermes` entry is defined (`adapted: true`), and the tool-paths contract gains the notion of a per-tool skills root that MAY resolve to a global home (Hermes) rather than a project-local directory.
- `cli-init`: for Hermes, skills are installed to Hermes's resolved global skills home and command-file generation is skipped (no adapter), while skills remain always-installed under every delivery setting.

## Impact

- **Code**: `src/core/config.ts` (hermes `AI_TOOLS` entry + optional global-skills-home marker on `AIToolOption`); new `src/core/hermes/hermes-home.ts` (resolve `HERMES_HOME`/`~/.hermes`, mirrors `codex/codex-home.ts`); a per-tool skills-root resolver threaded through the hardcoded project-local skill paths in `src/core/init.ts` (~641), `src/core/shared/tool-detection.ts` (~106/189 status + version), and the `src/core/update.ts` refresh/prune paths (~168). No command adapter is added or registered. `getToolsWithSkillsDir()` already includes hermes once `adapted: true` + `skillsDir` are set — no change to the shipped visibility chokepoint.
- **Tests**: new hermes cases in `test/core/init.test.ts` and `test/core/shared/tool-detection.test.ts`; the `agent-adapters-visible-tools` "not yet adapted" test for a still-unadapted tool stays (use a different unadapted example if `hermes` was used there).
- **Scope**: minimal additions on top of `agent-adapters-visible-tools`; the one non-trivial shared-code touch is the skills-root resolver, which is the installer layer for a global-home agent (in scope). No runtime/dispatch code changes.
- **Dependency**: builds on `agent-adapters-visible-tools` (the `adapted` flag and `getToolsWithSkillsDir` narrowing). No new external dependency.
