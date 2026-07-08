## 1. Remove browse template + registration (src/)

- [x] 1.1 Delete `src/core/templates/experts/browse.ts`.
- [x] 1.2 `src/core/templates/experts/index.ts`: remove the `export { getBrowseSkillTemplate } from './browse.js';` line.
- [x] 1.3 `src/core/templates/skill-templates.ts`: remove `getBrowseSkillTemplate,` from the `./experts/index.js` re-export block.
- [x] 1.4 `src/core/shared/skill-generation.ts`: remove the `getBrowseSkillTemplate` import (:56), the `expertSkills` browse entry (:195), and the dead `if (workflowId === 'browse') return;` skip in `copySkillSidecars` (:151); update the `copySkillSidecars` doc comment that references the browse skip (~:135-137).
- [x] 1.5 Sweep: `grep -rnE "getBrowseSkillTemplate|workflowId === 'browse'|openspec-browse" src/` returns nothing.

## 2. Delete the vendored browse trees

- [x] 2.1 Delete the top-level `browse/` directory (includes `bin/remote-slug`, `scripts/build-node-server.sh`, `src/`, `test/`).
- [x] 2.2 Delete `skills/experts/browse/` (the skill mirror).

## 3. Update tests

- [x] 3.1 `test/core/shared/skill-generation.test.ts`: decrement expert counts by one — `toHaveLength(24)`→`23`, `toHaveLength(20)`→`19`, `toHaveLength(21)`→`20`, and the total/comment at ~:15 (20 expert → 19). Delete the `it('skips the browse skill entirely ...')` test at ~:283 (its `copySkillSidecars('browse')` skip logic no longer exists).
- [x] 3.2 `test/core/templates/skill-templates-parity.test.ts`: remove the `getBrowseSkillTemplate` import (:31), its entry in `EXPECTED_FUNCTION_HASHES` (:83), the `'openspec-browse'` entry in `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` (:117), the `['openspec-browse', getBrowseSkillTemplate]` row in `GENERATED_SKILL_FACTORIES` (:152), and `getBrowseSkillTemplate` from the `functionFactories` object (:219).
- [x] 3.3 `test/core/shared/skill-sidecar-install.test.ts`: remove the browse-specific assertions (`browseSrc()`, `openspec-browse` SKILL.md existence at :37,61,67-76). If the test needs a subject skill to prove sidecar install + `.ts`-tree exclusion + idempotency, retarget it to a surviving skill that ships sidecars (chrome-use ships `scripts/*.mjs` + `references/cdp-api.md`); otherwise keep the generic assertions and drop only the browse ones.
- [x] 3.4 Run `pnpm build` and the affected suites (`skill-generation`, `skill-sidecar-install`, `skill-templates-parity`); confirm green. package.json is still untouched at this point.

## 4. package.json + lockfile (GATED — do not start until B2 has shipped)

- [x] 4.1 GATE CHECK: verify sibling `fork-phase1-telemetry-client` (B2) has SHIPPED its package.json change and that `git status` shows `package.json` clean (no uncommitted overlap). If not, STOP and do not edit package.json.
- [x] 4.2 `package.json`: remove the `"browse": "./browse/dist/browse"` bin entry (:31), the `build:browse` script (:60), and the `playwright` optionalDependency (:88).
- [x] 4.3 Run `pnpm install` to regenerate `pnpm-lock.yaml`; review the diff to confirm only playwright (and its transitive deps) drop. Run `pnpm build` and confirm it works without `build:browse`.
- [x] 4.4 Sweep: `grep -rnE "browse/dist|build:browse|playwright" package.json` returns nothing.

## 5. Docs + spec + validate

- [x] 5.1 `docs/grill-gstack-absorption.md` and `docs/zh/grill-gstack-absorption.md`: update the lines that present browse as a current vendored tool / current expert (the §5 tool description ~:190/:189 and the expert-layer mapping ~:117/:120 and ~:116/:119) to note browse was replaced by chrome-use in the fork. Keep edits minimal (history-aware); do NOT touch English-verb "browse" text in `README.md`/`docs/cli.md` or INSTALL/fork-declaration README (batch C).
- [x] 5.2 Confirm the `browse-integration` REMOVED delta in this change lists all four requirements by name (Browse Directory Inclusion, Browse Binary Availability, Playwright as Optional Dependency, Skill Browser Path Resolution) with Reason + Migration.
- [x] 5.3 Final sweep: `grep -rniE "getBrowseSkillTemplate|openspec-browse|browse/dist|build:browse" src test package.json` is empty; `pnpm build` + affected suites green.
- [x] 5.4 Run `openspec validate fork-phase1-browse-removal`; confirm valid.
