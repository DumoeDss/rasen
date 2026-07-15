## 1. Registry: Hermes entry

- [x] 1.1 Add a `hermes` entry to `AI_TOOLS` in `src/core/config.ts`: `{ name: 'Hermes', value: 'hermes', available: true, successLabel: 'Hermes', skillsDir: '.hermes', adapted: true }`.
- [x] 1.2 Add an optional marker to `AIToolOption` signalling a global skills home (e.g. `skillsHome?: 'global'`), and set it on the `hermes` entry. (Keeps the skills-root resolver declarative rather than a hardcoded `toolId === 'hermes'` check.)
- [x] 1.3 Confirm `getToolsWithSkillsDir()` now includes `hermes` with no change to that function (it already filters `skillsDir && adapted`); confirm `--tools hermes` is accepted and no longer hits the `isKnownUnadaptedTool` rejection.

## 2. Hermes home + skills-root resolver

- [x] 2.1 Create `src/core/hermes/hermes-home.ts` exporting `resolveHermesHome()` → `HERMES_HOME` (trimmed) or `~/.hermes`, always absolute. Mirror `src/core/codex/codex-home.ts`. Do NOT add a version premise constant yet (no local binary to live-verify — see design Open Questions).
- [x] 2.2 Add a single resolver `resolveToolSkillsRoot(tool, projectPath)` (co-locate with `getToolsWithSkillsDir` in `src/core/shared/tool-detection.ts` or a small new module): returns `path.join(resolveHermesHome(), 'skills')` when the tool has the global marker, else `path.join(projectPath, tool.skillsDir, 'skills')`. Export it.

## 3. Thread the resolver through skill paths

- [x] 3.1 In `src/core/init.ts` (~641), replace the hardcoded `path.join(projectPath, tool.skillsDir, 'skills')` with `resolveToolSkillsRoot(tool, projectPath)`.
- [x] 3.2 In `src/core/shared/tool-detection.ts`, use the resolver in `getToolSkillStatus` (~106) and `getToolVersionStatus` (~189) so Hermes's configured/version state is read from its global home.
- [x] 3.3 In `src/core/update.ts`, use the resolver for the prune path (~168) and wherever update re-installs/refreshes skills, so `rasen update` refreshes Hermes skills in the global home.
- [x] 3.4 Verify no other call site computes `<projectPath>/<skillsDir>/skills` directly (grep for `skillsDir, 'skills'` and `skillsDir + '/skills'`); route any stragglers through the resolver. Found and fixed two extra call sites beyond the ones named in the task: `src/core/migration.ts:32` (legacy pre-profile-system scan) and `src/core/profile-sync-drift.ts:121,215` (`hasToolProfileOrDeliveryDrift` / `getInstalledWorkflowsForTool`, which drive `getToolsNeedingProfileSync` — without this fix, `rasen update` would report Hermes as perpetually drifted since its project-local `.hermes/skills` never exists).

## 4. Command generation (no adapter)

- [x] 4.1 Do NOT add or register a `hermesAdapter`. Confirm that with no adapter, `init.ts` routes Hermes into `commandsSkipped` (the existing Kimi-CLI path) and that skills still install. No code change expected here beyond confirming behavior.

## 5. Success output

- [x] 5.1 In the init success/summary output (`src/core/init.ts` ~761-791, which joins `t.skillsDir`), ensure Hermes reports the global install location (its `~/.hermes/skills` home), not a project-local `.hermes` dir, so the user knows skills were installed machine-globally.

## 6. Tests

- [x] 6.1 `test/core/shared/tool-detection.test.ts`: assert `getToolsWithSkillsDir()` now contains `hermes` (alongside `claude`, `codex`).
- [x] 6.2 `test/core/init.test.ts`: `--tools hermes` installs skills under the resolved Hermes home (set `HERMES_HOME` to a temp dir in the test), NOT under project-local `.hermes/skills/`; assert `~/.hermes/skills/rasen-explore/SKILL.md` (temp) exists and project `.hermes/` does not.
- [x] 6.3 `test/core/init.test.ts`: `--tools hermes` skips command-file generation and reports Hermes among skipped-command tools; skills still present.
- [x] 6.4 Add a resolver unit test: `resolveToolSkillsRoot` returns the project-local path for `claude` and the `HERMES_HOME`-based path for `hermes`; honors a `HERMES_HOME` override.
- [x] 6.5 Update/`rasen update` test: with Rasen skills pre-installed under a temp `HERMES_HOME`, update treats Hermes as configured and refreshes the `rasen-` skills without touching a sibling non-`rasen-` skill dir.
- [x] 6.6 If any `agent-adapters-visible-tools` test used `hermes` as the "not yet adapted" example, switch it to a still-unadapted tool (e.g. `cursor`). (Checked: no test referenced `hermes` before this change — no-op.)

## 7. Verify

- [x] 7.1 Run `pnpm build` and `pnpm test`; ensure green. Use a temp `HERMES_HOME` in Hermes tests so no real `~/.hermes` is touched. Watch the known Windows CLI-spawn flakes (re-run isolated; not logic regressions).
- [x] 7.2 Manual check: `HERMES_HOME=$(mktemp -d) rasen init --tools hermes` in a scratch project → skills land in `$HERMES_HOME/skills/rasen-*/SKILL.md`, no project `.hermes/`, command generation reported as skipped for Hermes; `rasen init --tools cursor` still prints the "not yet adapted" message.
