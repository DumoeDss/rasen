# Planning Context — agent-adapters portfolio

## User intent (verbatim)

> 我们的rasen对于subagent resume的需求很高，因此需要为每个code agent进行专门的适配开发，我们的claudecode作为第一公民拥有所有的功能（因为最初就是围绕claudecode进行开发设计的）。而原本的openspec包含了大量code agent的安装，而我们现在没有适配这些，因此我需要你先在安装程序中隐藏其他未实现的code agent的安装，仅保留claudecode和codex。然后开始实现hermes的支持。新建worktree开始工作。

Interpretation:
- Rasen's orchestration (subagent dispatch/resume, worker lifecycle) requires per-agent adaptation work; an agent listed in the installer implies Rasen actually supports it.
- Claude Code is the first-class citizen (full functionality); Codex is the second adapted runtime (see `src/core/codex/` — exec bridge, thread resume, lifecycle; PR #4 merged).
- Upstream OpenSpec shipped installers for ~27 code agents; Rasen has NOT adapted them. Advertising their install is misleading.
- Deliverable 1: **hide** (not delete) unadapted agents from the install surface — keep only `claude` and `codex` selectable.
- Deliverable 2: implement **Hermes** support as the third adapted agent.

## Codebase findings (LEAD scout, 2026-07-16)

- Install-visible tool list: `src/core/available-tools.ts` exports `AI_TOOLS`; consumed by `src/core/init.ts` (interactive multi-select + `--tools` flag parsing, lines ~348-511), `src/core/update.ts`, `src/core/config.ts`, `src/core/shared/tool-detection.ts`, `src/core/profile-sync-drift.ts`, `src/cli/index.ts`.
- Command adapters: `src/core/command-generation/adapters/` has 27 adapters (claude, codex, cursor, windsurf, cline, github-copilot, gemini, opencode, kilocode, qoder, amazon-q, antigravity, auggie, bob, codebuddy, continue, costrict, crush, factory, iflow, junie, kiro, lingma, pi, qwen, roocode); registered in `registry.ts`.
- No `hermes` reference anywhere in `src/` — greenfield adaptation.
- Codex adaptation precedent: `src/core/codex/` (buildCodexExecInvocation, threadId resume, rollout probing) + docs/codex-parity/ (14-item capability mapping). Hermes should follow the same "capability parity research → adapter + runtime bridge" pattern, but THIS portfolio's scope for hermes is at minimum the **install/adapter layer** (AI_TOOLS entry + command-generation adapter + detection); deeper runtime bridging (exec/resume) should be scoped by the planner based on what Hermes actually offers.
- `--tools all` semantics in init must be decided: with hidden tools, `all` should mean "all VISIBLE/adapted tools" (claude+codex), not all 27. Hidden tools already configured in existing projects must not break `update` (tolerant read).
- Recent test `test(init): deflake --tools all on Windows CI` (84da4e3 on origin/main) touches this surface — check test expectations.

## Constraints / decisions already made

- Working branch: `worktree-agent-adapters` (worktree at `.claude/worktrees/agent-adapters`), reset onto local `dev/0.1.4` (28b1606) — PRs base `dev/0.1.4`.
- HIDE, don't delete: adapter code for the other 25 agents stays in the tree (future re-enable when adapted); only the install/selection surface narrows.
- Dependency: agent-adapters-hermes depends on agent-adapters-visible-tools (same files: available-tools.ts, registry/adapters, init tests). Strict serial.
- Portfolio delivery: children ship local-only; ONE parent-level delivery at the end.
- Open research item for hermes child: establish Hermes' actual command/skill install conventions (config dir, command file format, frontmatter dialect) before designing; if conventions cannot be established from real sources, surface as open question rather than inventing.

## Findings from agent-adapters-visible-tools proposal (planner, 2026-07-16)

- **Two-path architecture confirmed** (the whole reason hide-not-delete is safe):
  - *Selection/offer surface* = `getToolsWithSkillsDir()` (`src/core/shared/tool-detection.ts:93`). Single chokepoint feeding init interactive choices, `--tools all`, `--tools` validation, and `cli/index.ts:145` help text. This is what narrows to adapted.
  - *Tolerant-read surface* = `getConfiguredTools`, `getToolStates`, `getToolVersionStatus`, `getConfiguredToolsForProfileSync`, `getAvailableTools`. These read on-disk state and MUST stay full-list, or `rasen update` orphans a pre-existing hidden-tool install.
- **Mechanism decided: `adapted?: boolean` flag on `AIToolOption`** (mirrors existing `available` flag), set true on claude+codex only. Chosen over a parallel filtered array because ~6 modules import `AI_TOOLS` directly (drift risk). Re-adopting a future agent = flip one flag → **this is the whole surface diff the hermes sibling makes here.**
- **`--tools cursor` decision: reject with a DISTINCT "recognized but not yet adapted" message** (not the generic "invalid tool"), via a new `isKnownUnadaptedTool()` helper. Genuinely-unknown tokens keep the old error.
- **Two non-obvious extra edits beyond the LEAD's list:** (a) init's non-interactive detected-fallback (`init.ts` ~365-367 `return [...detectedToolIds]`) must filter to adapted, else CI `rasen init` in a repo with `.cursor/` auto-configures a hidden tool; (b) `update.ts` `detectNewTools` (~349) must filter its nudge to adapted, else update tells the user to `rasen init` a tool init then refuses (dead loop).
- **Test surface that flips:** `init.test.ts` `--tools all` (asserts cursor+windsurf → must become claude+codex), the `claude, cursor` selection test, `tool-detection.test.ts` `getToolsWithSkillsDir toContain('cursor')`. `available-tools.test.ts` (detection) stays unchanged and is the tolerance-boundary guard. Reconcile with recent `deflake --tools all` (origin/main 84da4e3), don't revert it.
- **Spec layout:** new capability `adapted-agent-visibility` owns the central contract; deltas to `ai-tool-paths` (adapted field), `cli-init` (offer/reject/detected-fallback), `cli-update` (tolerance + nudge). Validated clean.

## Findings from agent-adapters-hermes proposal (planner, 2026-07-16)

- **Hermes = Nous Research `hermes-agent`** (docs verified; NO local binary — `which hermes` not found, so nothing version-pinned was assumed). Real conventions:
  - Home `~/.hermes/` (env `HERMES_HOME`). Analogous to `~/.codex`.
  - **Skills are GLOBAL-only**: `~/.hermes/skills/<name>/SKILL.md` (frontmatter); each installed skill auto-registers as `/<name>` slash command. No project-local skills mechanism exists.
  - **No per-file custom-command directory**: `quick_commands:` are inline `config.yaml` shell shortcuts (exec/alias), NOT LLM prompts. So a codex-style command adapter is the WRONG model — Hermes needs NO command adapter.
  - Context files injected from cwd: `AGENTS.md`, `CLAUDE.md`, `.hermes.md`, `SOUL.md`, `.cursorrules`.
  - Runtime primitives (for a FUTURE bridge, out of scope now): one-shot `hermes -z "<prompt>"` (clean stdout); resume `--resume/-r <session>`, `--continue/-c [name]`; `hermes sessions list|browse`.
- **SCOPE RESIZE — the LEAD's "flip one flag" assumption holds for SELECTION but NOT skill delivery.** Rasen's skill installer is hardcoded project-local (`init.ts:641` `path.join(projectPath, tool.skillsDir, 'skills')`; same in `tool-detection.ts:106/189` and `update.ts:168`). Hermes reads skills only globally. So the child's ONE non-trivial shared-code change is a **per-tool skills-root resolver** (`resolveToolSkillsRoot(tool, projectPath)`) threaded through those ~4 call sites — default preserves project-local for all existing tools, returns `~/.hermes/skills` for hermes. This is the installer layer for a global-home agent = in scope, but it's a real feature, not a one-liner. Precedent: command generator ALREADY supports absolute/global paths (`init.ts:679 path.isAbsolute`) for codex — this applies the same idea to skills.
- **Command generation for hermes = SKIP via existing no-adapter path** (identical to Kimi CLI; cli-init already has generic "Selected tool has no command adapter" requirement). Do NOT register a hermesAdapter.
- **Detection asymmetry:** configured-state detection (getToolSkillStatus) must use the resolver → reads global `~/.hermes/skills/rasen-*` so update works. But presence auto-detection (getAvailableTools scans projectPath) stays weak for hermes (no project footprint) — same as codex; users pick hermes explicitly.
- **Spec layout:** new `hermes-integration` capability (install contract) + deltas to `adapted-agent-visibility` (adapted set → {claude,codex,hermes}, accept hermes), `ai-tool-paths` (hermes entry + per-tool skills-root resolution), `cli-init` (skills to global home, commands skipped). Validated clean. NOTE: visible-tools already archived + specs synced to main, so these deltas target the synced main specs.

## Decomposition plan

1. `agent-adapters-visible-tools` (small-feature) — narrow install surface to claude+codex: AI_TOOLS visibility flag or filtered export, init multi-select + `--tools all` semantics, update/config tolerance for already-configured hidden tools, tests.
2. `agent-adapters-hermes` (small-feature, depends on 1) — hermes adapter: AI_TOOLS entry, command-generation adapter, tool detection, tests; scope runtime-bridge depth per research.
