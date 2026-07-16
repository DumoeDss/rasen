## 1. Registry: adapted designation

- [x] 1.1 Add optional `adapted?: boolean` field to the `AIToolOption` interface in `src/core/config.ts` (document it as "Rasen has adapted orchestration for this agent"; absence ⇒ not adapted).
- [x] 1.2 Set `adapted: true` on the `claude` and `codex` entries in `AI_TOOLS`; leave every other entry unchanged.

## 2. Selection surface narrowing

- [x] 2.1 Narrow `getToolsWithSkillsDir()` in `src/core/shared/tool-detection.ts` to `AI_TOOLS.filter(t => t.skillsDir && t.adapted).map(t => t.value)`.
- [x] 2.2 Add a small helper in `tool-detection.ts` to classify a token as a known-but-unadapted tool (e.g. `isKnownUnadaptedTool(value): boolean` — true when the value matches an `AI_TOOLS` entry that has `skillsDir` but is not adapted). Export from `src/core/shared/index.ts`.
- [x] 2.3 Confirm the tolerant-read functions (`getConfiguredTools`, `getToolStates`, `getToolVersionStatus`, `getConfiguredToolsForProfileSync`, and `getAvailableTools` in `available-tools.ts`) still iterate the FULL `AI_TOOLS` list — do NOT add the adapted filter to them.
- [x] 2.4 Update the `--tools` option help text in `src/cli/index.ts` (line ~145 `availableToolIds`) so it derives from the adapted set (via `getToolsWithSkillsDir()` or the same `adapted` filter), listing only `claude, codex`.

## 3. init: rejection message and detected-fallback

- [x] 3.1 In `resolveToolsArg` (`src/core/init.ts`), when a token is invalid, distinguish known-but-unadapted tokens (using the 2.2 helper) and throw a "recognized but not yet adapted in Rasen; currently adapted tools: claude, codex" error; keep the existing "Invalid tool(s)" error for genuinely unknown tokens.
- [x] 3.2 In `validateTools` (`src/core/init.ts`), apply the same known-but-unadapted distinction on its unknown-tool branch so interactive/edge paths give the consistent message.
- [x] 3.3 In `getSelectedTools` non-interactive detected-fallback (`src/core/init.ts` ~365-367), filter `detectedToolIds` to adapted tools before returning; if no adapted tools are detected, fall through to the existing "no tools / use --tools" error path.

## 4. update: nudge narrowing

- [x] 4.1 In `detectNewTools` (`src/core/update.ts` ~349), filter `newTools` to adapted tools only (join the `adapted` flag from `AI_TOOLS`), so the "Detected new tool … run rasen init" nudge never suggests an unadapted tool. Leave the configured-tools refresh path untouched.

## 5. Tests

- [x] 5.1 Update `test/core/shared/tool-detection.test.ts` `getToolsWithSkillsDir` expectations: assert it contains `claude` and `codex` and does NOT contain `cursor`/other unadapted tools.
- [x] 5.2 Update `test/core/init.test.ts` `--tools all` test (currently asserts `.cursor`/`.windsurf` skills): assert `all` produces claude + codex only and NOT cursor/windsurf. Reconcile with the recent `test(init): deflake --tools all` change rather than reverting its deflake.
- [x] 5.3 Update the `claude, cursor` selection test in `test/core/init.test.ts`: change to `claude, codex` (positive path) and add a case asserting `--tools cursor` fails with the "not yet adapted" message.
- [x] 5.4 Add a test that `--tools not-a-tool` still fails with the unknown/invalid-tool error (not the "not adapted" message).
- [x] 5.5 Add a tolerance test: a project with pre-existing `.cursor/` Rasen skill files is still detected/refreshed by the update path (via `getConfiguredTools`/`getConfiguredToolsForProfileSync`), and `detectNewTools` does not nudge for an unadapted `.windsurf/` directory. (Covered by pre-existing `multi-tool support > should update multiple configured tools` / `should update Qwen tool...` tests, which already exercise unadapted-tool refresh unmodified, plus the new `should not nudge for new unadapted tool directories` test.)
- [x] 5.6 Confirm `test/core/available-tools.test.ts` (detection) still passes unchanged (detection stays full-list — it validates the tolerance boundary).

## 6. Verify

- [x] 6.1 Run `pnpm build` and `pnpm test`; ensure the full suite is green (watch the known Windows CLI-spawn flakes — re-run isolated if they surface, they are not logic regressions).
- [x] 6.2 Manually verify: `rasen init --tools all` in a scratch dir configures only `.claude` and `.codex`; `rasen init --tools cursor` prints the "not yet adapted" message; the interactive multi-select lists only Claude Code and Codex.
