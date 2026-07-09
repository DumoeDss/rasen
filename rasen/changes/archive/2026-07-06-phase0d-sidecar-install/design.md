# Design — phase0d-sidecar-install

## Context

`init.ts` (~line 552) and `update.ts` (~line 200) share an identical skill-install loop: `for (const { template, dirName } of skillTemplates) { … generateSkillContent … writeFile(SKILL.md) }`. Nothing copies the source skill directory's other files. The registry entry (`SkillTemplateEntry`) already carries `workflowId`, which is the source directory name under `skills/gstack/`. Sibling `add-context-handoff` (which also edited `init.ts`) is already archived, so there is no live conflict.

## Sidecar inventory (what must land)

- `review/`: `checklist.md`, `design-checklist.md`, `greptile-triage.md`, `TODOS-format.md`
- `qa/`: `references/issue-taxonomy.md`, `templates/qa-report-template.md`
- 0c methodology: `codebase-design/{DEEPENING,DESIGN-IT-TWICE}.md`, `domain-modeling/{ADR-FORMAT,CONTEXT-FORMAT}.md`, `prototype/{LOGIC,UI}.md`, `tdd/{tests,mocking}.md`
- 0d-absorb: `investigate/scripts/hitl-loop.template.sh`
- hooks: `careful/bin/check-careful.sh`, `freeze/bin/check-freeze.sh`
- **the outlier:** `browse/` — a vendored bun package: `src/` 205 KB, `test/` 252 KB of `.ts`, plus `bin/`, `scripts/`. Must NOT be copied into every user's `.claude/skills/`.

## Key decisions

### D1. Copy rule: `.md`/`.sh` allowlist, skip browse

Three approaches were on the table:

- **(a) Copy the whole dir minus an exclude-list.** Fragile: the exclude-list must enumerate browse's `src`/`test`/`bin`/`scripts`/`dist` and stay updated as browse (or any future heavy skill) grows.
- **(b) Allowlist by extension (`.md`, `.sh`) + preserve subdirs.** Lightest and self-maintaining — a new `.md`/`.sh` sidecar is picked up automatically. Excludes browse's `.ts` trees *by construction*. Chosen.
- **(c) Per-skill sidecar manifest on `SkillTemplate`.** Most explicit but imposes authoring burden (every skill with sidecars must declare them; every new sidecar edits a manifest) — heavier than the payoff.

Chosen: **(b)**. Copy files ending `.md` (except `SKILL.md`) and `.sh`, recursively, preserving relative subpaths; exclude `*.tmpl`. Additionally **skip the `browse` skill dir entirely** — belt-and-suspenders (the extension allowlist already drops its `.ts`, but browse also has `scripts/*.sh` build scripts that are pointless to install, and browse's runtime binary ships via `{{BROWSE_SETUP}}`, not sidecars).

This rule copies every real sidecar above and, as a bonus, lands the `careful`/`freeze` hook `.sh` files (their hook path uses a `../<skill>/bin/` reference — note that reference uses the *unprefixed* skill name while installed dirs are `openspec-gstack-<name>`, a pre-existing path-naming mismatch this change does not fix; it only ensures the file is present under the real dir).

### D2. One helper, resolved like the templates

Add `copySkillSidecars(workflowId, targetSkillDir)` to `skill-generation.ts` (where `getSkillTemplates` lives). It resolves the source dir as `resolve(<packaged skills root>, workflowId)` using the same `import.meta.url`/`__dirname` relative resolution the expert templates use for their `SKILL.md`, then applies the D1 allowlist. `init.ts` and `update.ts` both call it, destructuring `workflowId` from the registry entry. Centralizing avoids drift between the two call sites and keeps the resolution logic in one place.

### D3. Graceful when the source is absent

`copySkillSidecars` no-ops (no throw) if the source skill dir doesn't exist — matching the expert templates' existing `readFileSync` try/catch. This matters because of D5 (the source tree isn't always present).

### D4. Idempotency and uninstall

`init`/`update` overwrite sidecars in place (idempotent re-run). Stale sidecars (a file deleted from source) are **not** pruned in v1 — acceptable and noted; a full mirror-with-prune risks deleting user edits. `removeSkillDirs` deletes the whole installed skill directory, so uninstall/commands-only paths remove sidecars with it. Upgrading adds the new files on next update (documented behavior change).

### D5. Flagged: `skills/` isn't shipped to npm

`build.js` runs gen-skill-docs + tsc only; package.json `files` lists `dist`, `bin`, `schemas`, `pipelines` — **not `skills/`**. So the source tree exists at runtime only in a **checkout**, which is how this fork is actually used (`node bin/openspec.js …` from the repo). The existing expert-template `readFileSync` already depends on this — in a published package it would hit its catch and emit "Skill file not found". This change is therefore consistent: it works wherever `SKILL.md` content already works, and graceful-skips otherwise. Fixing published distribution is a **separate** decision — naively adding `skills/` to `files` would ship browse's 450 KB `.ts` tree; the right fix ships `skills/**/*.{md,sh}` (+ generated `SKILL.md`) selectively. Surfaced, not done here.

## Verification strategy

1. Unit test for `copySkillSidecars`: given a fixture skill dir, it copies `.md`/`.sh` (incl. subdirs), skips `SKILL.md`/`*.tmpl`, and a browse-shaped dir yields no `.ts`.
2. TypeScript build — the init/update/helper edits compile.
3. `bun run skill:check` FRESH; existing vitest suites stay green (no content/count change).
4. **Real run:** in a temp dir, `node bin/openspec.js init` (non-interactive, Claude tool) then `openspec update`; assert `.claude/skills/openspec-gstack-investigate/scripts/hitl-loop.template.sh` and `.claude/skills/openspec-gstack-review/checklist.md` exist, and `.claude/skills/openspec-gstack-browse/src/` does not; re-run `update` and confirm no error and same result (idempotent).
5. `openspec validate phase0d-sidecar-install --strict`.
