# Tasks — phase0c-grill-add

> Additions only — the inverse of phase0b's removal chain. Grill sources: `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\skills\skills\engineering\<name>\`. Adapt frontmatter to the fork convention (mirror `investigate` tmpl), keep the grill body verbatim, add the MIT NOTICE after frontmatter. Re-render + build + verify in §7.

## 1. domain-modeling skill

- [x] 1.1 Create `skills/gstack/domain-modeling/SKILL.md.tmpl`: fork frontmatter (name/version/description with "Use when …"/allowed-tools), then `<!-- adapted from mattpocock/skills (MIT, Copyright Matt Pocock) -->`, then `{{PREAMBLE}}`, then the grill body verbatim (challenge-against-glossary, sharpen fuzzy language, concrete scenarios, cross-reference code, inline CONTEXT.md updates, the 3-part ADR test)
- [x] 1.2 Copy `ADR-FORMAT.md` and `CONTEXT-FORMAT.md` into `skills/gstack/domain-modeling/` (add a one-line MIT NOTICE at each head)

## 2. codebase-design skill

- [x] 2.1 Create `skills/gstack/codebase-design/SKILL.md.tmpl`: fork frontmatter + MIT NOTICE + `{{PREAMBLE}}` + grill body verbatim (glossary: module/interface/implementation/depth/seam/adapter/leverage/locality; deep-vs-shallow; principles incl. deletion test; design-for-testability; rejected framings)
- [x] 2.2 Copy `DEEPENING.md` and `DESIGN-IT-TWICE.md` into `skills/gstack/codebase-design/` (MIT NOTICE at head)

## 3. tdd skill

- [x] 3.1 Create `skills/gstack/tdd/SKILL.md.tmpl`: fork frontmatter + MIT NOTICE + `{{PREAMBLE}}` + grill body verbatim (what a good test is; seams; three anti-patterns; rules of the loop — red before green, one vertical slice, refactor is not in the loop)
- [x] 3.2 Copy `tests.md` and `mocking.md` into `skills/gstack/tdd/` (MIT NOTICE at head)

## 4. prototype skill

- [x] 4.1 Create `skills/gstack/prototype/SKILL.md.tmpl`: fork frontmatter (allowed-tools centred on Bash — it runs code) + MIT NOTICE + `{{PREAMBLE}}` + grill body verbatim (pick LOGIC vs UI branch; six shared rules; capture the answer when done)
- [x] 4.2 Copy `LOGIC.md` and `UI.md` into `skills/gstack/prototype/` (MIT NOTICE at head)

## 5. Registration wiring (mirror of phase0b removal)

- [x] 5.1 Create four expert templates `src/core/templates/experts/{domain-modeling,codebase-design,tdd,prototype}.ts`, each mirroring `investigate.ts` with the name substituted (resolves `skills/gstack/<name>/SKILL.md`, strips frontmatter, returns `name: 'gstack:<name>'`, `description: '|'`, `metadata: { author: 'openspec', version: '1.0' }`)
- [x] 5.2 Add four exports to `src/core/templates/experts/index.ts` (`export { getDomainModelingSkillTemplate } from './domain-modeling.js';` etc.)
- [x] 5.3 Add four re-exports to `src/core/templates/skill-templates.ts` (in the `from './experts/index.js'` block)
- [x] 5.4 Add four imports + four `getSkillTemplates()` entries in `src/core/shared/skill-generation.ts`: `{ template: getDomainModelingSkillTemplate(), dirName: 'openspec-gstack-domain-modeling', workflowId: 'domain-modeling' }` and the three siblings
- [x] 5.5 Add four rows to the `skills/gstack/docs/AGENTS.md` "Available skills" table (`/domain-modeling`, `/codebase-design`, `/tdd`, `/prototype` with one-line descriptions)
- [x] 5.6 Do NOT edit `scripts/skill-check.ts` — the four methodology skills have no `$B` browse commands, so they do not belong in the `SKILL_FILES` command-validation subset (freshness is covered by the dry-run over all `.tmpl`)

## 6. Count constants + skill-authoring doc

- [x] 6.1 Update the four count assertions in `test/core/shared/skill-generation.test.ts`: `toHaveLength(42)`→`(46)` (comment "17 workflow + 29 expert"), `toHaveLength(29)`→`(33)` ("4 workflow + 29 expert"), `toHaveLength(25)`→`(29)` ("0 workflow + 29 expert"), `toHaveLength(26)`→`(30)` ("1 workflow + 29 expert")
- [x] 6.2 Create `docs/skill-authoring.md` adapted from grill `writing-great-skills` (`SKILL.md` + `GLOSSARY.md`): leading-words, checkable completion criteria, failure-mode clinic, no-op deletion; open with the MIT NOTICE; note it as the skill-writing standard for this repo

## 7. Re-render, rebuild, verify

- [x] 7.1 Run `bun run gen:skill-docs` — must render `skills/gstack/{domain-modeling,codebase-design,tdd,prototype}/SKILL.md` (29 expert skills total)
- [x] 7.2 Run TypeScript build (`pnpm build` / `tsc --noEmit`) — must succeed (four new imports resolve)
- [x] 7.3 Run `bun run skill:check` — must exit 0, "All Claude generated files are fresh"
- [x] 7.4 Run `npm run test` targeting `test/core/shared/skill-generation.test.ts` (four bumped assertions pass) and `test/core/templates/skill-templates-parity.test.ts` (must stay green — OPSX-core only, unaffected)
- [x] 7.5 Spot-check: each new SKILL.md carries the MIT NOTICE and grill leading-words (`seam`, `deep module`, `tracer bullet`, `ubiquitous language`); AGENTS.md lists all four
- [x] 7.6 Run `openspec validate phase0c-grill-add --strict` — must pass
