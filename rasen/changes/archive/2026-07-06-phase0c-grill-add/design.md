# Design — phase0c-grill-add

## Context

Adding an expert skill to this fork is the exact inverse of phase0b's removal chain. phase0b established every wiring point by deleting one; phase0c re-treads them by creating four. The grill sources are small (SKILL.md 30–114 lines each) and MIT-licensed; field verification confirmed they carry no personal-brand or issue-tracker-config content, so adaptation is structural (frontmatter + attribution), not editorial.

## Key decisions

### D1. Frontmatter adaptation, body preserved

Grill SKILL.md use minimal frontmatter (`name` + `description` only). The fork convention (see `investigate.ts` tmpl) is richer: `name`, `version: 1.0.0`, a multi-line `description` with a "Use when …" trigger list and an optional "Proactively suggest when …" line, and `allowed-tools`. Each new tmpl adopts the richer frontmatter, then `{{PREAMBLE}}`, then the grill body **verbatim** (the leading-word vocabulary and checkable criteria are load-bearing and must not be paraphrased away). No `hooks` block — unlike `investigate` (freeze-scoped), these methodology skills need no PreToolUse gating. `allowed-tools` is scoped per skill: domain-modeling/codebase-design/tdd need Read/Grep/Glob/Edit/Write/Bash/AskUserQuestion; prototype additionally runs code, so Bash is central.

### D2. Expert `.ts` mirrors investigate.ts exactly

Each `src/core/templates/experts/<name>.ts` is a copy of `investigate.ts` with the skill name substituted: it resolves `skills/gstack/<name>/SKILL.md`, strips YAML frontmatter, and returns `{ name: 'gstack:<name>', description: '|', instructions, metadata: { author: 'openspec', version: '1.0' } }`. The `description: '|'` sentinel is intentional (the real description lives in the SKILL.md frontmatter) — mirror it, do not "fix" it.

### D3. Registration is four edits per skill, plus the count bump

Per skill: `experts/index.ts` export, `skill-templates.ts` re-export, `skill-generation.ts` import + `getSkillTemplates()` array entry, `AGENTS.md` row. Then, once for all four, the four count assertions in `skill-generation.test.ts` go 25→29 expert (`42→46`, `29→33`, `25→29`, `26→30`). These four assertions are the *only* count constants affected: `profiles.test.ts:23` counts workflows (17, unchanged) and the parity test hashes OPSX-core template functions (no gstack experts). A TypeScript build is a required gate because the four imports must resolve.

### D4. skill-check.ts is deliberately not edited

`SKILL_FILES` in `scripts/skill-check.ts` is the curated set of skills whose bodies contain `$B` browse commands / snapshot flags to validate — `investigate`, `careful`, and the other non-browse experts are absent from it. The four methodology skills issue no browse commands, so they do not belong there. Freshness for the new skills is still enforced: `skill:check` runs `gen-skill-docs --dry-run` across all `.tmpl`. This asymmetry with phase0b (which removed two skills that *were* in `SKILL_FILES`) is expected and correct.

### D5. Sidecar reference files: carried in source, not install-portable

The grill skills reference sibling files by relative path (`[DEEPENING.md](DEEPENING.md)`, `[LOGIC.md](LOGIC.md)`, …). Those files are carried into each `skills/gstack/<name>/` source directory. However, `init.ts` installs only `SKILL.md` per skill (line ~553), so sidecars do not reach the install target — the same limitation the existing review/qa sidecars have. This change accepts the established pattern rather than inventing a one-off inlining scheme for four skills; full sidecar portability is a cross-cutting phase0d decision. Flagged so it is a conscious choice, not an oversight.

### D6. MIT attribution placement

Each new `.tmpl` places an HTML-comment NOTICE immediately after the closing frontmatter `---` and before `{{PREAMBLE}}`:
```
<!-- adapted from mattpocock/skills (MIT, Copyright Matt Pocock) -->
```
This survives the `.ts` frontmatter strip (which keeps everything after the second `---`), so the attribution installs with the instructions. `docs/skill-authoring.md` opens with the same NOTICE. Sidecar files copied largely verbatim from grill also carry a one-line NOTICE at their head.

### D7. skill-authoring.md is a repo doc, not a skill

`docs/skill-authoring.md` (top-level `docs/`, alongside `cli.md`) is adapted from grill `writing-great-skills` (SKILL.md + GLOSSARY.md). It is documentation, not an installable skill — no `.tmpl`, no expert `.ts`, no registration, no count impact. It becomes the referenced writing standard for authoring/editing gstack/elfspec skills.

## Verification strategy

1. `bun run gen:skill-docs` — must render `skills/gstack/{domain-modeling,codebase-design,tdd,prototype}/SKILL.md` (29 expert skills total).
2. TypeScript build (`pnpm build` / `tsc --noEmit`) — must succeed, proving the four new imports/exports resolve.
3. `bun run skill:check` — must exit 0, "All Claude generated files are fresh" (the four new tmpl→md pairs match).
4. `npm run test` for `test/core/shared/skill-generation.test.ts` — the four bumped assertions must pass; `test/core/templates/skill-templates-parity.test.ts` must stay green (unaffected). Targeted run avoids the known global-config isolation flakiness.
5. Residue/spot check: each new SKILL.md contains the MIT NOTICE and the grill leading-word vocabulary (`seam`, `deep module`, `tracer bullet`, `ubiquitous language`); `getSkillTemplates()` returns 29 experts.
6. `openspec validate phase0c-grill-add --strict`.
