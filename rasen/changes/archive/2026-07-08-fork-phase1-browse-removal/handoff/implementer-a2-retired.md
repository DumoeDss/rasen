# Handoff: fork-phase1-browse-removal — implementer #a2-retired

**Reason:** `retired-between-children`. I implemented and shipped A1 (chrome-use-core) and A2 (expert-templates); both are review-clean and archived. This document is a KNOWLEDGE transfer, not unfinished work — the **Remaining** section is intentionally empty. It carries what only someone who had hands in these files knows, on top of what A3's proposal/design/tasks already state (which I do not repeat).

## Original intent
Fork Phase 1, batch A: replace the vendored bun-compiled `browse` tool with the CDP-based `chrome-use`. A1 vendored chrome-use + added 4 endpoints + registered the expert. A2 rewrote `_shared.ts` and the consumer templates to drive chrome-use, and **decoupled `browse.ts`** so A3 can delete browse wholesale. A3 = the deletion.

## Position
A-chain child 3 of 3. A1 and A2 are DONE + archived. A3 (this change) is the last A-chain step; C (release-prep) depends on it (package.json + npm-pack need browse gone).

## Done / Remaining
Done: A1 + A2, fully (see their archived tasks.md). Remaining (for A3): **none of mine** — A3's own tasks.md is the work list. Nothing I did is unfinished.

## Key decisions (and why) — the state A3 inherits

**browse.ts is now FULLY SELF-CONTAINED.** A2 (decision D1) moved byte-identical inline copies of `BROWSE_SETUP`, `SNAPSHOT_FLAGS`, `COMMAND_REFERENCE` into `src/core/templates/experts/browse.ts` as file-local consts and dropped their imports from `_shared.ts`. `browse.ts` now imports ONLY `PREAMBLE` from `_shared.js` (+ `STORE_SELECTION_GUIDANCE`, `SkillTemplate` type). Consequence for A3: **deleting `browse.ts` requires ZERO `_shared.ts` cleanup** — no browse-branded constant remains in `_shared.ts`; those blocks were renamed to `CHROME_USE_SETUP`/`CHROME_USE_SNAPSHOT`/`CHROME_USE_ENDPOINTS` and are consumed only by chrome-use-driving experts. Do NOT hunt for browse constants in `_shared.ts`; there are none.

**The browse registration is a 4-hop + top-import chain. Exact current lines (verified now, post-A1/A2 — planning-doc numbers have shifted):**
1. `src/core/templates/experts/index.ts:8` — `export { getBrowseSkillTemplate } from './browse.js';`
2. `src/core/templates/skill-templates.ts:38` — `getBrowseSkillTemplate,` inside the `export { ... } from './experts/index.js';` re-export block.
3. `src/core/shared/skill-generation.ts:56` — `getBrowseSkillTemplate,` in the top-of-file import block.
4. `src/core/shared/skill-generation.ts:195` — `{ template: getBrowseSkillTemplate(), dirName: 'openspec-browse', workflowId: 'browse' },` in `expertSkills`.
Plus the sidecar skip: `src/core/shared/skill-generation.ts:151` — `if (workflowId === 'browse') return;` in `copySkillSidecars` (and its explaining doc-comment at :143 and the subtree comment at :125). Once `skills/experts/browse/` is deleted, this skip is dead but harmless; A3's design likely removes it — if so, also drop the `:143` doc-comment paragraph so the comment doesn't describe a vanished branch.

**package.json browse surface (current lines):** `:31` bin `"browse": "./browse/dist/browse"`; `:60` `"build:browse": "bun build --compile ..."` (compiles both `cli.ts` AND `find-browse.ts`, but `find-browse` is NOT a registered bin — only `browse` is); `:88` `"playwright": "^1.58.2"` in optionalDependencies/dependencies. After removing these, **regenerate the lockfile** (`pnpm install` → updates `pnpm-lock.yaml`); do not hand-edit the lock. C (release-prep) runs `npm pack`/pack verification and will fail if playwright is still pulled.

## Dead ends & gotchas — traps that cost me time

**Byte-identical freeze: DON'T retype, EXTRACT.** For A2's browse.ts freeze I did NOT retype the three ~600–4000-char template literals (guaranteed to drift on some escaped backtick). I wrote a throwaway node script that read `_shared.ts`, sliced each `export const NAME = ` \`…\` `;` by scanning for the first UNESCAPED backtick (internal ones are `\``), stripped `export `, and injected them into browse.ts. That produced provably byte-identical output — browse's two parity hashes stayed green WITHOUT being edited. If A3 ever needs a similar copy-verbatim move, use extraction, never retyping. (Script pattern is simple; ask if you want it — it's gone with my scratchpad.)

**Emoji in Edit `old_string` fails.** Editing lines containing emoji (e.g. `check-deps.mjs`'s ⚠️/❌ log lines) fails with codepoint mismatch. Avoid emoji in match strings; anchor on adjacent ASCII text instead.

**Windows ESM import needs `file://`.** A helper `.mjs` that imports from `dist/` via a bare `E:/...` path throws `ERR_UNSUPPORTED_ESM_URL_SCHEME`. Use `await import('file:///E:/.../dist/....js')`.

**Shared working tree + shared dist/ + shared test runner.** Other implementers (B-chain: src/telemetry, package.json telemetry bits) edit concurrently. `pnpm build` compiles the whole repo — if it fails on a file you didn't touch, it may be a sibling mid-edit; re-run before assuming your regression. On Windows, CLI-spawning tests (cli-e2e, spec, artifact-workflow, validate) occasionally flake with EBUSY rmdir + 10s timeouts — re-run the single file in isolation before treating as a real failure; clear stray temp dirs if it repeats. Note: C depends on package.json which A3 also edits — coordinate via the LEAD, not by touching telemetry's package.json lines.

## Eliminated hypotheses
Not a fixer/debugger handoff — none.

## Working set — files A3 must touch and the test mechanics

**Deletion targets (from my knowledge, cross-check A3 tasks):** `src/core/templates/experts/browse.ts`; `skills/experts/browse/` (the vendored bun `.ts` tree — already skipped by copySkillSidecars, never installed); `browse/` (source + `dist/`); the 5 registration lines above; package.json `:31`, `:60`, `:88`.

**Test files that WILL break on browse removal and must be updated in the same change:**
- `test/core/shared/skill-generation.test.ts` — the FOUR expert-count assertions (A1/A2 kept them at 20; removing browse → 19). Current values to decrement: `toHaveLength(42)` "all templates" (→41), `toHaveLength(24)` "4 workflow + 20 expert" (→23), `toHaveLength(20)` "0 workflow + 20 expert" (→19), `toHaveLength(21)` "1 workflow + 20 expert" (→20). Update the `// N workflow + 20 expert` comments too. Command-count assertions (19) are SEPARATE and unaffected.
- `test/core/shared/skill-generation.test.ts:283-284` — the `it('skips the browse skill entirely...')` test calling `copySkillSidecars('browse', target)`. Once browse is unregistered and its dir gone this test is obsolete — DELETE it (don't leave it asserting on a nonexistent skill).
- `test/core/shared/skill-sidecar-install.test.ts` — the real-run init/update test references `browseSrc()` (helper ~:37) and asserts `openspec-browse/SKILL.md` EXISTS (~:69) and `openspec-browse/src` does NOT (~:68, :76). After removal, `openspec-browse` is no longer generated, so the SKILL.md-exists assertion breaks. Remove the browse-specific assertions/helper; keep the investigate/review sidecar assertions.
- `test/core/templates/skill-templates-parity.test.ts` — browse appears in FIVE places, remove ALL: import in the `functionFactories` list (`:219`), `EXPECTED_FUNCTION_HASHES` entry (`:83` `getBrowseSkillTemplate: '87a78432…'`), `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` entry (`:117` `'openspec-browse': '3a98221c…'`), `GENERATED_SKILL_FACTORIES` array entry (`:152` `['openspec-browse', getBrowseSkillTemplate]`), and the top import of `getBrowseSkillTemplate` from skill-templates (`:31`). **How the two maps work:** they are MANUALLY-pinned `Record<string,string>` — no env auto-update. `EXPECTED_FUNCTION_HASHES` is keyed by FUNCTION name = `hash(stableStringify(fn()))`; `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` is keyed by DIR name = `hash(generateSkillContent(fn(),'PARITY-BASELINE'))`. Removing browse means DELETING its rows, not re-pinning. After removal the two maps must have exactly the remaining skills — if any OTHER skill's hash shows up changed, that's an unintended regression, not a paste target.

**IMPORTANT — do NOT re-pin the other experts.** A2 already regenerated qa/qa-only/design-review/design-consultation/benchmark/office-hours/navigator hashes to their chrome-use versions. A3 should see ZERO hash changes for those (deleting browse doesn't touch them). If it does, something coupled leaked — investigate, don't paste.

## Verification recipes that worked
- Build: `pnpm build` (tsc; ~fast). Green = "✅ Build completed successfully!".
- Targeted test sweep (the affected trio): `pnpm vitest run test/core/templates/skill-templates-parity.test.ts test/core/shared/skill-generation.test.ts test/core/shared/skill-sidecar-install.test.ts` — this is the exact set that guards template registration + counts + sidecar install. All three were green after A2.
- Regenerate/inspect a hash without eyeballing test output: build first, then a tiny `.mjs` that `await import('file:///…/dist/core/templates/skill-templates.js')` + `.../dist/core/shared/skill-generation.js`, replicate the test's `stableStringify` + sha256. (For A3 you mostly DELETE rows, so you may not need this — but it's how I got clean hashes without transcription errors.)
- Change validity: `node bin/openspec.js validate fork-phase1-browse-removal` → "is valid".
- Real install smoke (optional): `node bin/openspec.js init <scratch> --tools claude --force` then confirm NO `.claude/skills/openspec-browse/` is produced (proves deregistration), while `openspec-chrome-use/scripts/*.mjs` still installs.
- Discipline: no git commits (LEAD ships), no subagents, work in the shared tree.

## Next action
Read A3's `proposal.md` / `design.md` / `tasks.md`, then start with the registration-hop deletions (the 5 lines above) + `browse.ts` deletion, rebuild, and run the targeted test trio — fixing the count assertions (20→19) and removing the browse parity rows in the SAME pass so the build+tests stay green at each step.
