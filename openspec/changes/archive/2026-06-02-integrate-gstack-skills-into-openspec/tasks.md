## 1. OpenSpec Config Extensions

- [x] 1.1 Add `proactive?: boolean` and `repoMode?: 'solo' | 'collaborative'` to `GlobalConfig` interface in `src/core/global-config.ts`, with defaults `proactive: true`, `repoMode: 'collaborative'`
- [x] 1.2 Update `DEFAULT_CONFIG` and `getGlobalConfig()` schema evolution logic to handle the new fields
- [x] 1.3 Update `openspec init` in `src/core/init.ts` to read `proactive` and `repoMode` from global config and pass them to a `transformInstructions` callback for expert skills that embeds the values

## 2. Rewrite gen-skill-docs.ts Preamble

- [x] 2.1 Rewrite `generatePreambleBash` to only output git branch detection (remove update-check, session tracking, config reads, repo-mode sourcing)
- [x] 2.2 Delete `generateUpgradeCheck` function
- [x] 2.3 Delete `generateLakeIntro` function
- [x] 2.4 Delete `generateContributorMode` function
- [x] 2.5 Update `generatePreamble` composition to remove calls to `generateUpgradeCheck`, `generateLakeIntro`, and `generateContributorMode`

## 3. Rewrite Completeness and Branding

- [x] 3.1 Rewrite `generateCompletenessSection` to remove gstack branding — replace "CC+gstack" with "AI-assisted", remove garryslist.org references, rebrand "Boil the Lake" as "Completeness Principle"
- [x] 3.2 Update `generateRepoModeSection` if it references gstack binaries (verify and clean)
- [x] 3.3 Update `generateSearchBeforeBuildingSection` if it references gstack (verify and clean)
- [x] 3.4 Search all remaining generator functions in gen-skill-docs.ts for "CC+gstack", "gstack skills", "garryslist", "gstack team" and replace/remove

## 4. Clean .tmpl Templates

- [x] 4.1 Replace all `gstack-slug` calls in .tmpl files with inline bash: `SLUG=$(basename "$(git remote get-url origin 2>/dev/null)" .git 2>/dev/null || basename "$(pwd)")`
- [x] 4.2 Replace all `gstack-review-read` and `gstack-review-log` calls in .tmpl files with comment: `# Review dashboard: pending OpenSpec integration`
- [x] 4.3 Remove `gstack-global-discover` references from .tmpl files (retro skill)
- [x] 4.4 Replace `gstack-diff-scope` calls in .tmpl files with comment: `# Diff scope detection: pending OpenSpec integration`
- [x] 4.5 Search .tmpl files for remaining "CC+gstack", "garryslist", "gstack team", "gstack skills", contributor mode references and clean

## 5. Remove gstack-upgrade Skill

- [x] 5.1 Delete `src/core/templates/experts/gstack-upgrade.ts`
- [x] 5.2 Remove gstack-upgrade export from `src/core/templates/experts/index.ts`
- [x] 5.3 Remove gstack-upgrade barrel export from `src/core/templates/skill-templates.ts`
- [x] 5.4 Remove gstack-upgrade registration from `src/core/shared/skill-generation.ts` expertSkills array

## 6. Regenerate and Verify

- [x] 6.1 Run `bun scripts/gen-skill-docs.ts` to regenerate all SKILL.md files
- [x] 6.2 Verify no generated SKILL.md contains: `gstack-update-check`, `gstack-config`, `gstack-repo-mode`, `gstack-slug`, `gstack-global-discover`, `_CONTRIB`, `_SESSIONS`, `LAKE_INTRO`, `garryslist.org`, `CC+gstack`, `gstack team`, `contributor-logs`, `completeness-intro-seen`
- [x] 6.3 Verify `gstack-review-read` and `gstack-review-log` references are replaced with placeholder comments
- [x] 6.4 Run `pnpm build` to verify TypeScript compilation passes
- [x] 6.5 Run `openspec init --tools claude --force` in test directory, verify 26 expert skills generated (gstack-upgrade removed), no gstack binary dependencies in output
