# Design — phase0d-router

## Context

A router skill is the fork's own prescribed cure (`docs/skill-authoring.md`) for the cognitive load of 29 experts + OPSX. This change builds it, adapting grill `ask-matt`'s shape (main flow + on-ramps + vocabulary layer + standalone) to fork-native skills, and adds the minimal mechanism the fork lacks to install a skill user-invoked. It runs in a working tree shared with sibling `add-context-handoff`, so registration edits are written to be merge-safe.

## Key decisions

### D1. Name: navigator

`navigator` reads as "navigate the map of skills", collides with nothing (checked against the 29 experts, `/opsx:*` commands, and CLI subcommands), and is distinct from grill's own `wayfinder` (a different fog-of-war concept) so it won't be confused with upstream. `guide`/`atlas` are acceptable alternatives; `router` (too networking) and `wayfinder` (upstream collision of meaning) are avoided.

### D2. The router must be user-invoked, and the fork can't express that yet

`generateSkillContent` (src/core/shared/skill-generation.ts) emits a **fixed** frontmatter — `name`, `description`, `license`, `compatibility`, `metadata` — and nothing else; the expert `.ts` strips the source SKILL.md frontmatter before it becomes `instructions`. So `disable-model-invocation: true` placed in the tmpl is dropped at install, and `SkillTemplate` has no field to carry it. A router that stays model-invocable defeats its purpose: it carries description context load every turn and can auto-fire. The minimal, reusable fix (this change's `skill-user-invocation-support` capability):

1. `SkillTemplate` gains `disableModelInvocation?: boolean`.
2. `generateSkillContent` emits `disable-model-invocation: true` when the flag is set (placed in frontmatter; omitted otherwise so no other skill changes).
3. `navigator.ts` sets the flag and supplies the human-facing one-line `description`.

This is flagged in the proposal as a scope reconciliation with a description-only fallback, because the LEAD framed the change as content+registration. The chosen path is faithful to `docs/skill-authoring.md`; the fallback avoids the `.ts` change but yields a weaker (model-invocable) router.

### D3. Description discipline

Per `docs/skill-authoring.md`, a user-invoked skill's `description` is a human-facing one-line summary with trigger lists stripped (it never reaches the model, so trigger phrasing would be dead weight). navigator's description: a plain "A map of this repo's skills and OPSX workflows and when to reach for each" — no "Use when…" branch list. (If the fallback path is taken instead, the description flips to a narrow model-facing trigger that fires only on explicit navigation asks.)

### D4. Map content reflects the post-absorb reality

The body is a map, not a procedure — its "steps" are navigational. It mirrors `ask-matt`'s four parts but populates them with fork skills and, crucially, the **post-0d-absorb** descriptions: `/investigate` "refuses to theorise until it has a red-capable feedback loop" (diagnosing-bugs merged), `/review` is "two-axis — Standards + Spec, reported side by side". It references OPSX by `/opsx:*` command names for the main flow and the experts by `/name`. It does **not** reference grill skills absent from the fork (`/to-prd`, `/to-issues`, `/implement`, `/triage`, `/improve-codebase-architecture`, `/research`, `/teach`, `/grill-*`, `/handoff`, `/setup-matt-pocock-skills`); where `ask-matt` used those, the map substitutes the fork's OPSX equivalents.

### D5. Registration mirror + count is delta-not-absolute

The registration chain is identical to 0c's add (expert `.ts` + index export + skill-templates re-export + `getSkillTemplates` expert entry + AGENTS row). The four `skill-generation.test.ts` assertions get +1 on the **expert** component. Because sibling `add-context-handoff` is mid-flight in the same tree and also touches the total assertion (L13) and `skill-templates.ts`/`skill-generation.ts`, tasks express counts as deltas applied to current committed values and confine edits to navigator-only lines. L89/L95/L70 track expert count (this change's alone); L13 total is co-edited — apply +1 whatever it currently reads.

### D6. Conflict surface with the sibling, enumerated

- Shared files: `skill-templates.ts` (both add a re-export — distinct lines), `skill-generation.ts` (sibling edits `getSkillTemplates` workflow array + generation; this change edits `getSkillTemplates` expert array + `generateSkillContent` — different regions), `skill-generation.test.ts` (L13 total co-edited).
- Not shared: `experts/index.ts` and `experts/navigator.ts` (expert-only, sibling adds a workflow), `profiles.ts`/`profiles.test.ts` (workflow-only, sibling's), `workflows/handoff.ts` (sibling's — never touch).

### D7. MIT attribution

navigator tmpl carries the `adapted from mattpocock/skills (MIT, Copyright Matt Pocock)` NOTICE after the frontmatter (ask-matt pattern).

## Verification strategy

1. `bun run gen:skill-docs` — render `skills/gstack/navigator/SKILL.md` (30 experts total); confirm its frontmatter carries `disable-model-invocation: true` and the map body.
2. TypeScript build (`pnpm build` / `tsc --noEmit`) — the `SkillTemplate`/`generateSkillContent`/`navigator.ts` edits compile.
3. `bun run skill:check` — FRESH.
4. `npm run test` for `test/core/shared/skill-generation.test.ts` — the four bumped count assertions and the new `disable-model-invocation` emission assertion pass; `skill-templates-parity.test.ts` stays green (OPSX-core only). Run targeted to avoid the global-config isolation flakiness and the sibling's in-flight edits.
5. Spot-check: navigator SKILL.md names the four map parts, describes `/investigate` as feedback-loop-first and `/review` as two-axis, carries the MIT NOTICE, and references no fork-absent grill skills.
6. `openspec validate phase0d-router --strict`.
