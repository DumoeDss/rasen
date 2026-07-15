## Why

Rasen inherited installers for ~30 code agents from upstream OpenSpec, but it has only adapted its orchestration (subagent dispatch, worker resume, lifecycle) for **Claude Code** (first-class) and **Codex**. Listing the other agents as installable choices tells users Rasen supports runtimes it has not adapted — a correctness and trust problem: someone selects "Cursor", gets skill files generated, and then finds Rasen's dispatch/resume features do not actually drive that agent. The install surface should advertise only what Rasen truly supports.

## What Changes

- Rasen's install/selection surface (interactive multi-select and `rasen init --tools`) offers **only `claude` and `codex`** — the currently adapted agents. The other agents are **hidden, not removed**: their adapter code, paths, and detection stay in the tree so a future adaptation change can re-expose one by flipping a single flag.
- `rasen init --tools all` means "all **adapted** tools" (claude + codex), not all ~30.
- `rasen init --tools <unadapted>` (e.g. `--tools cursor`) is **rejected with a clear "recognized but not yet adapted" message** distinct from the "unknown tool" error, so users understand the tool exists but Rasen has not adapted it yet.
- Projects that already configured a now-hidden tool keep working: `rasen update` still refreshes that tool's already-installed artifacts (tolerant read from disk). Update's "new tool detected — run init to add it" nudge is narrowed to adapted tools only, so it never suggests adding a tool the installer will refuse.
- Auto-detection of on-disk tool config directories is unchanged (stays full) — it feeds the tolerant update path — but detection no longer drives selection of unadapted tools during init.
- Existing tests on this surface are updated to the new semantics (notably `--tools all`, the mixed `claude, cursor` selection test, and `getToolsWithSkillsDir` expectations).

No user data is deleted and no generated artifacts are removed by this change.

## Capabilities

### New Capabilities
- `adapted-agent-visibility`: The central contract that an agent is offered for installation only when Rasen has adapted its orchestration for that agent. Defines the "adapted" designation on the tool registry, that the install/selection surface is derived from adapted tools, that unadapted-but-known tools are recognized (not silently unknown) and refused with a distinguishing message, and that already-configured unadapted tools remain serviceable by update.

### Modified Capabilities
- `ai-tool-paths`: `AIToolOption` gains an `adapted` designation; the tool registry marks only `claude` and `codex` as adapted. Path/detection entries for the other tools are retained unchanged.
- `cli-init`: `--tools all` resolves to adapted tools only; the interactive multi-select lists only adapted tools; an explicit `--tools <known-unadapted>` is rejected with a "not yet adapted" message; auto-detection continues to cover all tools but no longer selects unadapted ones.
- `cli-update`: update tolerates already-configured unadapted tools (continues refreshing them); the "new tool directory detected" nudge is limited to adapted tools.

## Impact

- **Code**: `src/core/config.ts` (AIToolOption + AI_TOOLS `adapted` flags), `src/core/shared/tool-detection.ts` (`getToolsWithSkillsDir` narrows to adapted; new helper to identify known-unadapted tools), `src/core/init.ts` (`resolveToolsArg` rejection message, selection surface), `src/core/update.ts` (`detectNewTools` nudge filter), `src/cli/index.ts` (`--tools` option help text lists adapted tools). Tolerant-read functions (`getConfiguredTools`, `getToolStates`, `getAvailableTools`, `getToolVersionStatus`) are intentionally left full-list.
- **Tests**: `test/core/init.test.ts`, `test/core/shared/tool-detection.test.ts` updated to adapted-only semantics; `test/core/available-tools.test.ts` (detection) stays full-list and validates the tolerance boundary.
- **No dependency or API changes.** Independently shippable; the sibling `agent-adapters-hermes` change depends on this one (it flips a third tool to adapted).
