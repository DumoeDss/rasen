# Tasks — phase0d-sidecar-install

> Pure TS. Fix the install loop (`init.ts` ~552, `update.ts` ~200) so expert-skill sidecars install alongside `SKILL.md`. Line numbers from HEAD 3a70bd4; confirm before editing. Don't break the currently-green suites.

## 1. Shared copy helper

- [x] 1.1 In `src/core/shared/skill-generation.ts`, add `copySkillSidecars(workflowId: string, targetSkillDir: string): Promise<void>` (or sync): resolve the source dir as `resolve(<packaged skills root>, 'skills', 'gstack', workflowId)` using the same `import.meta.url`/`__dirname` relative resolution the expert templates use for `SKILL.md`
- [x] 1.2 Apply the allowlist: recurse the source dir; copy files ending `.md` (except `SKILL.md`) and `.sh`, preserving relative subpaths; skip `*.tmpl`; create target subdirs as needed
- [x] 1.3 Skip the `browse` skill dir entirely (early return when `workflowId === 'browse'`)
- [x] 1.4 No-op gracefully (no throw) if the source dir does not exist (match the expert-template `readFileSync` try/catch behavior)

## 2. Wire into init and update

- [x] 2.1 `src/core/init.ts` skill-install loop (~552): destructure `workflowId` from the registry entry; after `writeFile(skillFile, …)`, call `await copySkillSidecars(workflowId, skillDir)`
- [x] 2.2 `src/core/update.ts` skill-install loop (~200): same — destructure `workflowId`, call the helper after writing `SKILL.md`
- [x] 2.3 Confirm `removeSkillDirs` / `removeUnselectedSkillDirs` already delete the whole skill dir (so sidecars are removed with it) — no change needed, just verify

## 3. Tests

- [x] 3.1 Unit test for `copySkillSidecars`: fixture skill dir with `.md` (root + `references/` subdir), `.sh` (`scripts/`), a `SKILL.md`, a `.tmpl`, and a `.ts` → assert `.md`/`.sh` copied (incl. subdirs), `SKILL.md`/`.tmpl`/`.ts` not copied; a `browse` workflowId → no copy
- [x] 3.2 Real-run test (temp dir): `openspec init` (non-interactive, Claude tool) then assert `.claude/skills/openspec-gstack-investigate/scripts/hitl-loop.template.sh` and `openspec-gstack-review/checklist.md` exist and `openspec-gstack-browse/src/` does not; run `openspec update` and assert idempotent (no error, same files)

## 4. Verify

- [x] 4.1 `bun run gen:skill-docs` (content unchanged — sanity)
- [x] 4.2 TypeScript build (`pnpm build` / `tsc --noEmit`) — helper + init/update edits compile
- [x] 4.3 `bun run skill:check` — FRESH
- [x] 4.4 `npm run test` — new sidecar unit + real-run tests pass; existing suites (`skill-generation.test.ts`, `skill-templates-parity.test.ts`, init/update tests) stay green
- [x] 4.5 Manual real run in a scratch dir: `node bin/openspec.js init` then `node bin/openspec.js update`; eyeball the installed `.claude/skills/openspec-gstack-*/` for sidecars present and browse `src/` absent
- [x] 4.6 `openspec validate phase0d-sidecar-install --strict`
