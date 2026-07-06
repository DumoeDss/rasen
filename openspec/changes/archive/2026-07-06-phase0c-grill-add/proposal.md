## Why

phase0a/0b cleansed and slimmed the gstack expert suite. It has strong workflow/pipeline skills but **no method-level design primitives** — the reusable engineering disciplines that the workflow skills lean on but never spell out. Matt Pocock's grill skills ("Skills For Real Engineers", MIT) fill exactly that gap with four small, high-signal skills:

- **domain-modeling** — actively build and sharpen the project's ubiquitous language (CONTEXT.md glossary, ADRs, edge-case scenario stress-testing).
- **codebase-design** — the deep-module vocabulary (seam / depth / adapter / leverage / locality) plus the deletion test and design-for-testability rules.
- **tdd** — what a test worth keeping is: seams, red→green loop discipline, and the three anti-patterns (implementation-coupled / tautological / horizontal-slicing).
- **prototype** — throwaway code that answers one design question, with a LOGIC branch (terminal state-machine probe) and a UI branch (variant switcher).

These are pure methodology, cleanly licensed, and complement (not duplicate) the existing skills. This change is **additions only** — merge/absorb work (e.g. folding grill `diagnosing-bugs` into `investigate`, the review double-axis) is deferred to phase0d.

The registration chain for adding an expert is the exact mirror of the removal chain phase0b exercised (expert `.ts` + `experts/index.ts` + `skill-templates.ts` re-export + `getSkillTemplates()` entry + `skill-generation.test.ts` count constants + `AGENTS.md` row). This proposal reuses that map in reverse.

## What Changes

### 1. Add four grill expert skills

For each of `domain-modeling`, `codebase-design`, `tdd`, `prototype`, create `skills/gstack/<name>/SKILL.md.tmpl` adapted from the grill source, carrying its reference files as sidecars in the same directory (`domain-modeling`: ADR-FORMAT.md, CONTEXT-FORMAT.md; `codebase-design`: DEEPENING.md, DESIGN-IT-TWICE.md; `tdd`: tests.md, mocking.md; `prototype`: LOGIC.md, UI.md). Adaptation: preserve the original substance verbatim where possible (the leading-word vocabulary — tracer bullet, seam, fog-of-war — and the checkable completion criteria are the whole value); align the frontmatter to the fork convention (name / version / expanded `description` with "Use when …" + proactive-suggest line / `allowed-tools`) and place `{{PREAMBLE}}` after the frontmatter. The grill sources contain no Matt-Pocock-personal or issue-tracker-config references to strip (verified), so no de-personalization edits are needed beyond frontmatter shaping.

### 2. Register the four skills (mirror of phase0b removal)

For each skill: create `src/core/templates/experts/<name>.ts` (mirrors `investigate.ts`: reads the generated SKILL.md, strips frontmatter, returns `name: 'gstack:<name>'`), add the export to `experts/index.ts`, add the re-export to `skill-templates.ts`, add the import + `getSkillTemplates()` entry (`dirName: 'openspec-gstack-<name>'`, `workflowId: '<name>'`) to `skill-generation.ts`, and add a directory-table row to `skills/gstack/docs/AGENTS.md`.

### 3. Bump the four expert-count assertions

In `test/core/shared/skill-generation.test.ts`, update the four expert/total count assertions from 25 experts to 29: `toHaveLength(42→46)`, `(29→33)`, `(25→29)`, `(26→30)`, with their comment strings.

### 4. Add the skill-authoring guide

Create `docs/skill-authoring.md` (a repository doc, **not** an installable skill) adapted from grill `writing-great-skills` (SKILL.md + GLOSSARY.md): leading-words, checkable completion criteria, the failure-mode clinic, and no-op deletion. Note it as the writing standard for elfspec/gstack skills.

### 5. MIT attribution

Each of the four new `.tmpl` bodies carries an HTML-comment NOTICE immediately after the frontmatter (`adapted from mattpocock/skills (MIT, Copyright Matt Pocock)`), so the attribution travels with the installed instructions. `docs/skill-authoring.md` carries the same NOTICE.

### 6. Re-render and verify

`bun run gen:skill-docs` (must render 29 expert SKILL.md), TypeScript build, `bun run skill:check` FRESH, the four updated count assertions green, `openspec validate --strict`.

### Scope notes (flagged)

- **skill-check.ts is not touched.** Its `SKILL_FILES` list is the curated `$B`-browse-command validation subset; the four methodology skills issue no browse commands (like `investigate`/`careful`, they are absent from that list). Freshness is covered automatically because `skill:check` dry-runs `gen-skill-docs` over all `.tmpl`. This is the one place where the add mirror is *not* symmetric with phase0b (which removed two skills that *were* in `SKILL_FILES`).
- **Sidecar reference files are not auto-installed.** `init.ts` copies only `SKILL.md` to the target, so the sidecar `.md` files live in the source skill directory and are referenced by relative path (matching the grill source and the existing review/qa sidecar pattern), but do not land at the install target. This is a pre-existing fork limitation shared by review/qa; making sidecars install-portable (e.g. by inlining) is a cross-cutting decision left to phase0d, not solved for only these four skills here.
- **Only additions.** No existing skill, generator, or workflow is modified.

## Capabilities

### New Capabilities

- `add-grill-expert-skills`: The four new expert skills — source templates + sidecars, `.ts` templates, registrations, AGENTS row, count-constant updates, MIT attribution.
- `skill-authoring-guide`: The `docs/skill-authoring.md` writing standard adapted from grill `writing-great-skills`.

## Impact

New source files:
- `skills/gstack/domain-modeling/{SKILL.md.tmpl, ADR-FORMAT.md, CONTEXT-FORMAT.md}`
- `skills/gstack/codebase-design/{SKILL.md.tmpl, DEEPENING.md, DESIGN-IT-TWICE.md}`
- `skills/gstack/tdd/{SKILL.md.tmpl, tests.md, mocking.md}`
- `skills/gstack/prototype/{SKILL.md.tmpl, LOGIC.md, UI.md}`
- `src/core/templates/experts/{domain-modeling,codebase-design,tdd,prototype}.ts`
- `docs/skill-authoring.md`

Edited (registration mirror):
- `src/core/templates/experts/index.ts` — 4 exports
- `src/core/templates/skill-templates.ts` — 4 re-exports
- `src/core/shared/skill-generation.ts` — 4 imports + 4 `getSkillTemplates()` entries
- `test/core/shared/skill-generation.test.ts` — 4 count assertions (25→29 expert)
- `skills/gstack/docs/AGENTS.md` — 4 directory-table rows

Generated (re-rendered): `skills/gstack/{domain-modeling,codebase-design,tdd,prototype}/SKILL.md`

Verification: `bun run gen:skill-docs`, TypeScript build, `bun run skill:check`, `test/core/shared/skill-generation.test.ts` (+ parity guard `test/core/templates/skill-templates-parity.test.ts`, unaffected)
