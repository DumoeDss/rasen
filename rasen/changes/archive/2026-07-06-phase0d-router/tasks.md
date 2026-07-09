# Tasks — phase0d-router

> Adds one user-invoked expert skill (`navigator`) + the minimal mechanism to install it user-invoked. Shared working tree with sibling `add-context-handoff` — edit only navigator-only lines; see §3 for the count/shared-file guidance. Follow `docs/skill-authoring.md`. Grill source: `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\skills\skills\engineering\ask-matt\SKILL.md`. Re-render + build + verify in §4.

## 1. navigator skill content

- [x] 1.1 Create `skills/gstack/navigator/SKILL.md.tmpl`: fork frontmatter with `name: navigator`, `version`, `disable-model-invocation: true`, and a **human-facing one-line `description`** (no "Use when …" trigger list, e.g. "A map of this repo's skills and OPSX workflows and when to reach for each"); then `<!-- adapted from mattpocock/skills (MIT, Copyright Matt Pocock) -->`; then `{{PREAMBLE}}`
- [x] 1.2 Write the four-part map body (adapt ask-matt's shape to fork skills):
  - **Main flow (idea → ship):** `/opsx:explore` (or `/opsx:office-hours` to validate demand first) → `/opsx:propose` → `/opsx:apply` → `/opsx:review-cycle` (or `/opsx:verify` / `/opsx:verify-enhanced`) → `/opsx:ship` → `/opsx:archive` → `/opsx:retro`; note `/opsx:auto` drives the whole flow
  - **On-ramps:** "something's broken" → `/investigate` (**refuses to hypothesise until it has a red-capable feedback loop** — reflects 0d-absorb); "is this worth building" → `/opsx:office-hours`
  - **Vocabulary layer (runs underneath):** `/domain-modeling`, `/codebase-design`
  - **Standalone:** `/tdd`, `/prototype`, `/review` (**two-axis: Standards + Spec** — reflects 0d-absorb), `/qa`, `/qa-only`, `/design-review`, `/design-consultation`, `/benchmark`, `/cso`, `/codex`, `/browse`, `/document-release`, `/retro`; deploy family (`/land-and-deploy`, `/setup-deploy`, `/canary`); plan family (`/autoplan`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`); security family (`/careful`, `/freeze`, `/guard`, `/unfreeze`)
  - each named skill gets a one-line "when to reach for it"
- [x] 1.3 Do NOT reference fork-absent grill skills (`/to-prd`, `/to-issues`, `/implement`, `/triage`, `/improve-codebase-architecture`, `/research`, `/teach`, `/grill-*`, `/setup-matt-pocock-skills`); substitute the OPSX equivalents

## 2. user-invocation mechanism (minimal .ts)

- [x] 2.1 `src/core/templates/types.ts`: add `disableModelInvocation?: boolean;` to `SkillTemplate`
- [x] 2.2 `src/core/shared/skill-generation.ts` `generateSkillContent`: when `template.disableModelInvocation` is set, emit a `disable-model-invocation: true` line in the frontmatter; omit it otherwise (all other frontmatter fields unchanged)
- [x] 2.3 Add a test in `test/core/shared/skill-generation.test.ts`: a template with `disableModelInvocation: true` emits the frontmatter line; without it, the line is absent

## 3. Registration (mirror of the expert chain) — merge-safe with sibling

- [x] 3.1 Create `src/core/templates/experts/navigator.ts`: mirror `investigate.ts` (readFileSync `skills/gstack/navigator/SKILL.md`, strip frontmatter, `name: 'gstack:navigator'`, `metadata { author: 'openspec', version: '1.0' }`), and additionally set `disableModelInvocation: true` and the human-facing router `description`
- [x] 3.2 `src/core/templates/experts/index.ts`: add `export { getNavigatorSkillTemplate } from './navigator.js';` (navigator-only line; do not touch sibling lines)
- [x] 3.3 `src/core/templates/skill-templates.ts`: add the navigator re-export in the `./experts/index.js` block (navigator-only line; **never edit the sibling's `handoff` line**)
- [x] 3.4 `src/core/shared/skill-generation.ts`: add the import + a `getSkillTemplates()` **expertSkills** entry `{ template: getNavigatorSkillTemplate(), dirName: 'openspec-gstack-navigator', workflowId: 'navigator' }` (expert array — distinct from the sibling's workflow-array edit)
- [x] 3.5 `skills/gstack/docs/AGENTS.md`: add a `/navigator` row to the directory table
- [x] 3.6 `test/core/shared/skill-generation.test.ts` count assertions — apply **+1 to the expert component on the current committed value** (do NOT hardcode assuming base 46; the sibling may have bumped the total first): total assertion (L13) +1; `4 workflow + N expert` (L70) +1; `0 workflow + N expert` (L89) +1; `1 workflow + N expert` (L95) +1; update the "29 expert" comments to "30 expert". L89/L95/L70 are this change's alone; L13 total is co-edited with the sibling — apply +1 to whatever it reads
- [x] 3.7 Do NOT touch `profiles.ts`, `profiles.test.ts`, or `workflows/handoff.ts` (sibling territory — navigator is an expert, not a workflow)

## 4. Re-render, rebuild, verify

- [x] 4.1 Run `bun run gen:skill-docs` — render `skills/gstack/navigator/SKILL.md` (30 experts); confirm its frontmatter carries `disable-model-invocation: true`
- [x] 4.2 Run TypeScript build (`pnpm build` / `tsc --noEmit`) — the type + generateSkillContent + navigator.ts edits compile
- [x] 4.3 Run `bun run skill:check` — must exit 0, FRESH
- [x] 4.4 Run `npm run test` targeting `test/core/shared/skill-generation.test.ts` (bumped counts + new `disable-model-invocation` assertion pass) and `test/core/templates/skill-templates-parity.test.ts` (stays green — OPSX-core only)
- [x] 4.5 Spot-check: navigator SKILL.md has the four map parts, describes `/investigate` as feedback-loop-first and `/review` as two-axis, carries the MIT NOTICE, references no fork-absent grill skills, and its frontmatter is user-invoked
- [x] 4.6 Run `openspec validate phase0d-router --strict` — must pass
