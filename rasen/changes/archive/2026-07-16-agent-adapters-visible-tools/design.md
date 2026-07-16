## Context

The tool registry `AI_TOOLS` (`src/core/config.ts`) is the single list of code agents Rasen knows about. It is consumed on two distinct paths:

1. **Selection/install surface** — decides which tools are *offered* to a user:
   - `getToolsWithSkillsDir()` (`src/core/shared/tool-detection.ts`) → drives the init interactive multi-select choices, `--tools all` expansion, and `--tools` token validation (`src/core/init.ts` `getSelectedTools` / `resolveToolsArg` / `validateTools`).
   - `src/cli/index.ts:145` builds the `--tools` option help text from `AI_TOOLS.filter(t => t.skillsDir)`.
2. **Tolerant-read surface** — operates on what is *already present on disk*, independent of what is offered:
   - `getConfiguredTools`, `getToolStates`, `getToolVersionStatus`, `getConfiguredToolsForProfileSync` (read installed skill/command files), and `getAvailableTools` (`available-tools.ts`, detects tool config dirs like `.cursor/`). These power `rasen update`, which refreshes whatever is already installed.

The two paths already have different inputs. That separation is what lets us narrow the *offer* without breaking *update* for a project that installed a now-hidden tool before this change. Codex is the precedent second-class adapted runtime (`src/core/codex/`, PR #4 merged); everything beyond claude+codex is install-scaffolding only, with no orchestration adaptation.

## Goals / Non-Goals

**Goals:**
- Offer only adapted agents (claude, codex) in every install/selection entry point.
- Keep the definition of "adapted" in one place, flowing to all surfaces.
- Preserve `rasen update` for projects that already configured a now-hidden tool.
- Give `--tools <known-unadapted>` a message that distinguishes "not yet adapted" from "unknown".
- Make re-enabling a future adapted agent a one-flag change (the hermes sibling flips exactly one entry).

**Non-Goals:**
- Deleting or altering adapter code, paths, or detection for the hidden agents (they stay verbatim).
- Any hermes-specific work (owned by the sibling change).
- Changing how already-installed artifacts are refreshed, beyond narrowing the "new tool" nudge.
- Migrating or removing any on-disk artifacts a user previously generated for a hidden tool.

## Decisions

### D1: Represent adaptation as an `adapted` boolean flag on `AIToolOption`, not a filtered export

Add `adapted?: boolean` to the `AIToolOption` interface (`src/core/config.ts`) and set `adapted: true` on the `claude` and `codex` entries only. Every other entry is left unchanged (flag absent → falsy → hidden).

- **Why over a separate `VISIBLE_TOOLS`/`ADAPTED_TOOLS` array:** many modules import `AI_TOOLS` directly (`init.ts`, `update.ts`, `tool-detection.ts`, `profile-sync-drift.ts`, `cli/index.ts`, `available-tools.ts`). A parallel array forces every consumer to choose the right list and risks drift. A per-entry flag keeps one list and mirrors the existing `available: boolean` field pattern, so the codebase already reads this shape.
- **Why a flag over deletion:** the user's intent is explicitly *hide, not delete* — retained code lets a future change flip one flag to adopt an agent. Deletion would lose the upstream adapter/path data and make re-adoption a re-port.

### D2: Narrow only `getToolsWithSkillsDir()`; leave tolerant-read functions on the full list

`getToolsWithSkillsDir()` becomes `AI_TOOLS.filter(t => t.skillsDir && t.adapted).map(t => t.value)`. This is the single chokepoint for the offer surface — it feeds init's interactive choices, `--tools all`, and `--tools` validation. Everything that reads already-installed state (`getConfiguredTools`, `getToolStates`, `getToolVersionStatus`, `getConfiguredToolsForProfileSync`, `getAvailableTools`) is deliberately **not** changed, so `rasen update` on a project with a pre-existing `.cursor/` install still detects, version-checks, and refreshes it.

- **Alternative considered — narrow detection too:** rejected. If `getAvailableTools`/`getConfiguredTools` filtered to adapted tools, a project that legitimately installed Cursor before this change would suddenly be treated as having "no configured tools" by update, silently orphaning its skills. The tolerance requirement forbids this.
- `src/cli/index.ts:145` help text switches to `getToolsWithSkillsDir()` (or the same `adapted` filter) so `--tools` documentation lists only claude, codex.

### D3: Distinguish "known but not adapted" from "unknown" in `--tools` rejection

`resolveToolsArg` currently rejects any token not in `getToolsWithSkillsDir()` with a single "Invalid tool(s)" error. After narrowing, `--tools cursor` falls into that bucket. Split the message: if the token matches a real `AI_TOOLS` entry that has a `skillsDir` but is not adapted, emit a message like *"Tool 'cursor' is recognized but not yet adapted in Rasen. Currently adapted tools: claude, codex."*; otherwise keep the existing "Invalid tool(s)" / unknown-tool error. A small helper (e.g. `isKnownUnadaptedTool(value)` or `getUnadaptedToolValues()` in `tool-detection.ts`) classifies the token by consulting the full `AI_TOOLS` list.

- **Why:** a bare "invalid tool: cursor" is misleading — Cursor *is* a real, known agent; it just is not adapted. The clearer message sets correct expectations and hints at the future.
- Applies symmetrically wherever an explicit invalid token surfaces (`resolveToolsArg`, and `validateTools`'s unknown-tool branch which is reachable via interactive/edge paths).

### D4: Narrow update's "new tool detected" nudge to adapted tools

`detectNewTools` (`src/core/update.ts:349`) compares `getAvailableTools` (full detection) against configured tools and prints "Detected new tool: X. Run 'rasen init' to add it." Filter its `newTools` to adapted tools only. Otherwise update would nudge the user to `rasen init` a hidden tool that init then refuses — a dead-end loop.

- Tolerance is preserved separately: an already-*configured* hidden tool is not a "new" tool, so this filter never touches the update-refresh path.

## Risks / Trade-offs

- **[A pre-existing test encodes old semantics and fails loudly]** → Intended. `test/core/init.test.ts` `--tools all` asserts cursor+windsurf skills exist, and the `claude, cursor` selection test, and `tool-detection.test.ts` `getToolsWithSkillsDir` `toContain('cursor')` must be updated to adapted-only semantics. The recent `test(init): deflake --tools all` work (origin/main 84da4e3) is on this exact surface — reconcile with it rather than reverting its deflake. This is captured as explicit tasks.
- **[A user relied on installing a now-hidden tool via `--tools cursor` in a script]** → They now get a clear "not yet adapted" error instead of a silent install. This is the intended correctness fix, not a regression; the escape hatch is that the tool can be re-adapted. Documented in the rejection message.
- **[Detection still surfaces hidden tools in update's tolerance path]** → By design. The only behavioral narrowing on update is the *nudge*; refresh of already-installed tools is retained to honor the tolerance requirement.
- **[`available: false` vs `adapted` confusion]** → `available` already gates the `agents` AGENTS.md pseudo-entry (no skillsDir). `adapted` is orthogonal (applies to real installable tools). Keep both; do not overload `available`.

## Migration Plan

No data migration. Deploy is code-only. Rollback is reverting the flag + filter (no persisted state changes). Existing installs are unaffected on disk; the only observable change is a narrower set of *offered* tools and a clearer rejection message.

## Open Questions

None blocking. The hermes sibling will add a third `adapted: true` entry and its adapter; this change's mechanism is designed so that is the whole diff on this surface.
