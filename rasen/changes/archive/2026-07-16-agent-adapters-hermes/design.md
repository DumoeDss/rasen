## Context

`agent-adapters-visible-tools` (shipped, commit a2a52ce) established: an `adapted?: boolean` flag on `AIToolOption`, `getToolsWithSkillsDir()` narrowed to `t.skillsDir && t.adapted` as the single selection chokepoint, an `isKnownUnadaptedTool()` rejection helper, and the `adapted-agent-visibility` capability. Adopting a new agent on that surface was designed to be "flip one flag." This change tests that design against a real agent and finds it holds for *selection* but not for *skill delivery*, because Hermes's skill model differs from the project-local model every current tool uses.

**Verified Hermes conventions** (Nous Research `hermes-agent` docs — configuration and CLI-commands references; no local binary available to live-verify):
- Binary `hermes`; home directory `~/.hermes/`, overridable via `HERMES_HOME`.
- **Skills are global-only**: stored under `~/.hermes/skills/<name>/SKILL.md` with YAML frontmatter; each installed skill auto-registers as a `/<name>` slash command. The docs show no project-local skills mechanism.
- **No per-file custom-command directory**: `quick_commands:` live inline in `config.yaml` as `exec`/`alias` shell shortcuts — not LLM prompt files. There is no analog of `.claude/commands/*.md` or `~/.codex/prompts/*.md`.
- Instruction/context files injected from the working directory include `AGENTS.md`, `CLAUDE.md`, `.hermes.md`, `SOUL.md`, `.cursorrules`.
- Non-interactive one-shot: `hermes -z "<prompt>"` (clean stdout, no banner); `hermes chat -q`. Session resume: `--resume`/`-r <session>`, `--continue`/`-c [name]`; `hermes sessions list|browse`.

**Current Rasen skill-install reality** (ground truth): `src/core/init.ts:641` writes skills to `path.join(projectPath, tool.skillsDir, 'skills')` — hardcoded project-local. `tool-detection.ts:106/189` read skill status/version from the same project-local path. The command generator, by contrast, already supports absolute/global paths (`init.ts:679` `path.isAbsolute(cmd.path)`), which is how Codex writes to `~/.codex/prompts/`. So global *command* files are already a solved pattern; global *skills* are not.

## Goals / Non-Goals

**Goals:**
- Make `hermes` a selectable, adapted agent, accepted by `--tools hermes`.
- Install Rasen's workflow skills where Hermes discovers them (its global skills home) so `/rasen-*` commands appear.
- Let `rasen update` correctly detect and refresh an installed Hermes.
- Reuse the shipped visibility mechanism unchanged (`getToolsWithSkillsDir` already includes any `adapted` tool with a `skillsDir`).

**Non-Goals:**
- Any runtime/dispatch/resume bridge for Hermes (a follow-up, mirroring `codex-exec-runtime`).
- A command-file adapter for Hermes (Hermes has no such convention).
- Changing behavior for any other tool; the skills-root resolver defaults to today's project-local path for all non-Hermes tools.
- Inventing project-local Hermes conventions the docs do not support.

## Decisions

### D1: Register `hermes` as an adapted tool; no command adapter

Add to `AI_TOOLS` (`config.ts`): `{ name: 'Hermes', value: 'hermes', available: true, successLabel: 'Hermes', skillsDir: '.hermes', adapted: true }`. The `skillsDir` value satisfies the shipped `getToolsWithSkillsDir()` filter (`t.skillsDir && t.adapted`) so Hermes is offered and `--tools hermes` is accepted — the "flip one flag" property holds for selection. Do **not** add or register a `hermesAdapter`. With no registered command adapter, `init.ts:696` routes Hermes into `commandsSkipped` — exactly the Kimi CLI behavior — so command-file generation is skipped while skills are still installed.

- **Alternative — a codex-style command adapter writing `~/.hermes/prompts/*.md`:** rejected. Hermes has no `prompts/` directory or per-file command convention; that path would invent a location Hermes never reads, violating the "do not invent" constraint.

### D2: Per-tool skills-root resolver; Hermes resolves to its global skills home

Replace the hardcoded `path.join(projectPath, tool.skillsDir, 'skills')` with a single helper, e.g. `resolveToolSkillsRoot(tool, projectPath)`:
- Default (all current tools): `path.join(projectPath, tool.skillsDir, 'skills')` — unchanged behavior.
- Hermes: `path.join(resolveHermesHome(), 'skills')` where `resolveHermesHome()` returns `HERMES_HOME` or `~/.hermes` (new `src/core/hermes/hermes-home.ts`, mirroring `codex/codex-home.ts`).

Signal the global case with an optional marker on `AIToolOption` (e.g. `skillsHome?: 'global'`) or by keying the resolver on `toolId`; the resolver is the single source of truth. Thread it through the four skill-path call sites: install (`init.ts:641`), skill status (`tool-detection.ts:106`), version status (`tool-detection.ts:189`), and update's prune/refresh (`update.ts:168` and the update install path). Rasen's skills already carry the `rasen-` prefix (`SKILL_NAMES`), so writing into the shared `~/.hermes/skills/` namespace does not collide with a user's own skills.

- **Why this is in scope:** the task scopes "the installer/adapter layer" as the deliverable. For a global-home agent, the installer layer *is* global skill placement. This directly parallels the already-accepted global-command-path pattern for Codex.
- **Alternative — install Hermes skills project-locally (`.hermes/skills/`), zero shared-code change:** rejected. Hermes does not read project-local skills, so the install would be inert — "support" in name only, contradicting the user's intent to actually implement Hermes support.
- **Alternative — a Hermes-specific install branch instead of a shared resolver:** rejected. A resolver keeps one code path, avoids Hermes special-cases scattered across init/update/detection, and makes the next global-home agent trivial.

### D3: Configured-state detection reads the global home; presence auto-detection stays weak

"Is Hermes Rasen-configured?" (`getToolSkillStatus`/`getToolVersionStatus`, used by `update`) uses the D2 resolver, so it inspects `~/.hermes/skills/rasen-*` and update refreshes correctly. Tool *presence* auto-detection (`getAvailableTools`, which scans the project directory for `skillsDir`) will rarely fire for Hermes because Hermes keeps no project-local footprint — the same weakness Codex has. This is acceptable: Hermes is chosen explicitly (`--tools hermes`) or from the interactive list. Not worth adding a global-`~/.hermes` probe to project detection in this change.

### D4: Runtime bridge deferred, but the primitives are recorded

`hermes -z` (clean one-shot) and `--resume`/`--continue` (session resume by id/title) are the building blocks a future dispatch/resume bridge needs — the Hermes analog of Codex's `exec` + threadId resume. This change records them (here and in the spec's Why) and stops at the install layer. Pin a `HERMES_CLI_VERSION_PREMISE` (mirroring `CODEX_CLI_VERSION_PREMISE`) only once a local binary can live-verify behavior; until then version pinning is an open question, not an assumption.

## Risks / Trade-offs

- **[Global skills install writes outside the project]** → Rasen skills for Hermes land in `~/.hermes/skills/`, a machine-global location, so `rasen init` for Hermes affects all Hermes projects on the machine. This is inherent to Hermes's design (global skills), not a Rasen choice; the `rasen-` prefix scopes what Rasen writes, and update/uninstall operate on that same prefix. Document it in the success output so the user knows where skills went.
- **[Conventions verified from docs, not a running binary]** → No local `hermes` to live-verify. Mitigation: the install-layer facts used (home dir, global `~/.hermes/skills/<name>/SKILL.md`, skills-as-slash-commands, no command-file dir) are stated directly in the Nous docs and are low-volatility; anything version-sensitive (exact resume/exec event shapes) is deferred to the runtime change with a version premise.
- **[Threading a resolver through four call sites risks a missed path]** → A single shared helper with a default that preserves current behavior means non-Hermes tools are provably unchanged; tests assert both the Hermes global path and an unchanged project-local path for another tool.
- **[`hermes` was the example in a visible-tools rejection test]** → If any shipped test used `hermes` as the "not yet adapted" example, switch it to a still-unadapted tool (e.g. `cursor`) so the rejection test stays meaningful.

## Migration Plan

No data migration. Additive: a new tool entry, a new home resolver, and a resolver indirection with a behavior-preserving default. Rollback = remove the hermes entry + resolver (no persisted state beyond skills the user can delete from `~/.hermes/skills/rasen-*`). Existing installs of other tools are provably unaffected (resolver default is the current path).

## Open Questions

- **Version pinning**: no local `hermes` binary to live-verify; defer `HERMES_CLI_VERSION_PREMISE` and any runtime-behavior assumptions to the runtime follow-up.
- **Instruction injection**: should Rasen also write a Hermes-read instruction file (`AGENTS.md`/`.hermes.md`) for project-level guidance, or are skills sufficient? Recommend skills-only for this change; revisit with the runtime bridge.
- **Uninstall/update semantics for global skills**: confirm `rasen update` and any future uninstall correctly scope to `~/.hermes/skills/rasen-*` and never touch user-authored Hermes skills. (The `rasen-` prefix makes this tractable; verify in tests.)
