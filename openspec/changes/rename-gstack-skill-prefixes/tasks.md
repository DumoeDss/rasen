## 1. Expert Skill Name Prefixing

- [x] 1.1 Update all 28 expert template files in `src/core/templates/experts/*.ts`: change `name` field from `'<name>'` to `'gstack:<base-name>'` and `metadata.author` from `'gstack'` to `'openspec'`. Special case: `gstack-upgrade` → `gstack:upgrade`
- [x] 1.2 Update `src/core/shared/skill-generation.ts` expertSkills array: change all 28 `dirName` values from `'openspec-<name>'` to `'openspec-gstack-<base-name>'`. Special case: `openspec-gstack-upgrade` stays unchanged
- [x] 1.3 Update `src/core/shared/tool-detection.ts` `SKILL_NAMES` if any expert skills are tracked there (verify — currently only workflow skills)

## 2. gen-skill-docs.ts Path Migration

- [x] 2.1 Update `HOST_PATHS.claude` in `scripts/gen-skill-docs.ts`: `skillRoot` → `~/.openspec/skills`, `localSkillRoot` → `.openspec/skills`, `binDir` → `~/.openspec/bin`, `browseDir` → `~/.openspec/browse/dist`
- [x] 2.2 Update `HOST_PATHS.codex`: `skillRoot` → `$OPENSPEC_ROOT`, `localSkillRoot` → `.agents/skills/openspec`, `binDir` → `$OPENSPEC_BIN`, `browseDir` → `$OPENSPEC_BROWSE`
- [x] 2.3 Update codex `generatePreambleBash` runtime root computation: rename `GSTACK_ROOT` → `OPENSPEC_ROOT`, `GSTACK_BIN` → `OPENSPEC_BIN`, `GSTACK_BROWSE` → `OPENSPEC_BROWSE`, update directory check from `.agents/skills/gstack` to `.agents/skills/openspec`
- [x] 2.4 Replace all hardcoded `~/.gstack/` paths in generator functions: `~/.gstack/sessions` → `~/.openspec/sessions`, `~/.gstack/.completeness-intro-seen` → `~/.openspec/.completeness-intro-seen`, `~/.gstack/analytics/` → `~/.openspec/analytics/`, `~/.gstack/contributor-logs/` → `~/.openspec/contributor-logs/`
- [x] 2.5 Update codex post-processing regex (lines ~2324-2327): change source patterns from `~/.claude/skills/gstack` to `~/.openspec/skills` and `.claude/skills/gstack` to `.openspec/skills`
- [x] 2.6 Update `generateUpgradeCheck` function: change skill path reference from `gstack-upgrade` directory to use `ctx.paths.skillRoot` with the correct new skill directory name
- [x] 2.7 Scan all remaining generator functions for any `gstack` string references (e.g., `gstack-config`, `gstack-repo-mode`, `gstack_contributor`) and update path prefixes (binary names like `gstack-config` keep their names but path prefix changes from `~/.claude/skills/gstack/bin/` to `~/.openspec/bin/`)

## 3. Regenerate SKILL.md Files

- [x] 3.1 Run `bun scripts/gen-skill-docs.ts` to regenerate all `skills/gstack/*/SKILL.md` files with updated paths
- [x] 3.2 Verify no generated SKILL.md contains `~/.gstack/` or `~/.claude/skills/gstack/` references

## 4. Build and Verification

- [x] 4.1 Run `pnpm build` to verify TypeScript compilation passes
- [x] 4.2 Run `openspec init --tools claude --force` in test directory, verify expert skills are generated with `gstack:` prefixed names in `openspec-gstack-*` directories
- [x] 4.3 Verify generated SKILL.md frontmatter contains `name: gstack:<skill>` and `author: openspec`
- [x] 4.4 Verify no generated file contains stale `~/.gstack/` or `~/.claude/skills/gstack/` path references
