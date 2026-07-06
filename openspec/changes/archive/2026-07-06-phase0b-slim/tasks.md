# Tasks — phase0b-slim

> Edit sources (`.tmpl`, `gen-skill-docs.ts`, `src/`, `scripts/skill-check.ts`, `docs/*.md`), never hand-edit generated `SKILL.md`. Registration removals and skill-check list must change together with the deletions or the build / `skill:check` fail. Re-render + rebuild in §5. Line numbers are from the post-0a snapshot (commit 0deed40); confirm before editing.

## 1. Hard-delete the three artifacts

- [x] 1.1 Delete directory `skills/gstack/setup-browser-cookies/` (`SKILL.md` + `SKILL.md.tmpl`)
- [x] 1.2 Delete directory `skills/gstack/gstack-upgrade/` (`SKILL.md` + `SKILL.md.tmpl`)
- [x] 1.3 Delete file `skills/gstack/conductor.json`
- [x] 1.4 Delete file `skills/gstack/docs/ETHOS.md`

## 2. Fully de-register setup-browser-cookies (must compile)

- [x] 2.1 Delete `src/core/templates/experts/setup-browser-cookies.ts`
- [x] 2.2 Remove the export in `src/core/templates/experts/index.ts` (~line 29: `export { getSetupBrowserCookiesSkillTemplate } from './setup-browser-cookies.js';`)
- [x] 2.3 Remove the re-export in `src/core/templates/skill-templates.ts` (~line 54: `getSetupBrowserCookiesSkillTemplate,`)
- [x] 2.4 In `src/core/shared/skill-generation.ts`, remove the import (~line 66) and the `getSkillTemplates()` registry entry (~line 143: `dirName: 'openspec-gstack-setup-browser-cookies'`)
- [x] 2.5 Remove the `setup-browser-cookies/SKILL.md` entry in `scripts/skill-check.ts` (~line 29)
- [x] 2.6 Soften the `/setup-browser-cookies` reference in `gen-skill-docs.ts` design-review auth-detection prose (~line 831) — drop the "Run `/setup-browser-cookies` first" instruction, keeping the auth-detection note

## 3. Finish gstack-upgrade removal (template/registrations already gone)

- [x] 3.1 Remove the `gstack-upgrade/SKILL.md` entry in `scripts/skill-check.ts` (~line 32)
- [x] 3.2 Remove the `/gstack-upgrade` row in `skills/gstack/docs/AGENTS.md` (~line 32)
- [x] 3.3 Remove the `gstack-update-check` reference in `skills/gstack/docs/ARCHITECTURE.md` (~line 215)
- [x] 3.4 Confirm no `src/core/templates/experts/gstack-upgrade.ts` / export / registration remains (already removed by prior change — verify only)

## 4. Remove the ethos preamble content

- [x] 4.1 In `gen-skill-docs.ts` `generatePreamble` (~lines 380–388), drop the `generateCompletenessSection()` (~line 384) and `generateSearchBeforeBuildingSection(ctx)` (~line 386) calls
- [x] 4.2 Delete the `generateCompletenessSection` function (~lines 171–197) and the `generateSearchBeforeBuildingSection` function (~lines 310–327)
- [x] 4.3 Soften the AskUserFormat "(see Completeness Principle)" cross-reference in `generateAskUserFormat` (~line 163) so it does not point at the deleted section
- [x] 4.4 Remove the "Read ETHOS.md for the … Search Before Building framework" reference in `skills/gstack/office-hours/SKILL.md.tmpl` (~line 295)
- [x] 4.5 Remove the "Read ETHOS.md for the Search Before Building framework" reference in `skills/gstack/plan-ceo-review/SKILL.md.tmpl` (~line 210)
- [x] 4.6 Remove the `ETHOS.md` / Search-Before-Building item in `skills/gstack/docs/ARCHITECTURE.md` (~line 219)
- [x] 4.7 Remove the AGENTS.md `/setup-browser-cookies` row in `skills/gstack/docs/AGENTS.md` (~line 27)

## 5. Re-render, rebuild, and verify

- [x] 5.1 Run `bun run gen:skill-docs` to re-render all `skills/gstack/**/SKILL.md` from slimmed sources
- [x] 5.2 Run TypeScript build (`pnpm build`, or `tsc --noEmit`) — must succeed, proving setup-browser-cookies de-registration is complete
- [x] 5.3 Run `bun run skill:check` — must exit 0 (freshness + expected-skill list; deleted skills absent from tree and list)
- [x] 5.4 Residue greps must return nothing across `.tmpl` + `gen-skill-docs.ts` + generated `.md` + `src/`: `ETHOS`, `Boil the Lake`, `Search Before Building`, `Completeness Principle`, `setup-browser-cookies`, `SetupBrowserCookies`, `gstack-upgrade`, `gstack-update-check`; and confirm the deleted dirs/files are absent
- [x] 5.5 Run `npm run test` targeting `test/core/shared/skill-generation.test.ts` and `test/core/templates/skill-templates-parity.test.ts` — must stay green (OPSX-core only; a failure signals core spillover)
- [x] 5.6 Run `openspec validate phase0b-slim --strict` — must pass
