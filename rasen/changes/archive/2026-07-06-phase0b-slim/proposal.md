## Why

With the personal-brand/telemetry/dead-stub residue removed in phase0a, the gstack skill suite still carries dead weight that should be dropped before elfspec vendors this content:

- **Three skills that do not belong** — `setup-browser-cookies` (macOS-Keychain-oriented; Elftia's native chrome-use already covers login-state capture), `gstack-upgrade` (hardcoded `garrytan/gstack` update source; elfspec updates ride Elftia's plugin mechanism), and the orphan `conductor.json` (a Conductor multi-worktree hook with no accompanying script and no code reference in this tree).
- **The gstack "Builder Ethos" preamble** — `skills/gstack/docs/ETHOS.md` ("gstack Builder Ethos": Boil the Lake + Search Before Building). Despite the file's own claim that it is "injected into every workflow skill's preamble automatically", the current generator does **not** read the file; its content was inlined into two `gen-skill-docs.ts` sub-generators, `generateCompletenessSection` (ETHOS §1 "Boil the Lake") and `generateSearchBeforeBuildingSection` (ETHOS §2). The user has approved removing this builder-creed content, leaving the functional preamble sections intact.

Prior work already minimized the preamble (`preamble-migration`) and de-registered the `gstack-upgrade` expert template (`remove-gstack-upgrade-skill`), but left the ethos sub-generators, `ETHOS.md`, and the `gstack-upgrade` source directory and references behind. This change finishes the slim.

This change performs **only deletion/slimming** — no content is added (phase0c). The deploy trio (`land-and-deploy`, `setup-deploy`, `canary`) and the plan quad (`autoplan`, `plan-ceo-review`, `plan-eng-review`, `plan-design-review`) are explicitly retained as project-type coverage.

## What Changes

### 1. Hard-delete three artifacts

Delete the skill source directories `skills/gstack/setup-browser-cookies/` and `skills/gstack/gstack-upgrade/`, and the orphan `skills/gstack/conductor.json`.

### 2. Fully de-register setup-browser-cookies

Unlike `gstack-upgrade` (whose expert template was already removed), `setup-browser-cookies` is still a live registered expert. Remove its template file `src/core/templates/experts/setup-browser-cookies.ts`, the export in `experts/index.ts`, the re-export in `skill-templates.ts`, the import + registry entry in `skill-generation.ts` (`getSkillTemplates()`), the `scripts/skill-check.ts` expected-skill entry, and soften the `/setup-browser-cookies` reference in the `gen-skill-docs.ts` design-review auth-detection prose. Remove the AGENTS.md directory-table row.

### 3. Finish gstack-upgrade removal

Remove the lingering `scripts/skill-check.ts` entry, the AGENTS.md `/gstack-upgrade` row, and the `gstack-update-check`/ETHOS ARCHITECTURE.md references left by the earlier partial removal.

### 4. Remove the ethos preamble content

Delete `skills/gstack/docs/ETHOS.md`. Drop `generateCompletenessSection` and `generateSearchBeforeBuildingSection` from the `generatePreamble` composition and delete the two functions. Soften the AskUserFormat "(see Completeness Principle)" cross-reference so it does not dangle. Clean the now-dangling "Read ETHOS.md for the Search Before Building framework" references in `office-hours`, `plan-ceo-review`, and `docs/ARCHITECTURE.md`. The `{{PREAMBLE}}` placeholder itself is retained; it continues to emit the functional sections (branch detection, AskUserQuestion format, Repo mode, Completion status).

### 5. Re-render, rebuild, and verify

Re-render all `SKILL.md` via `bun run gen:skill-docs`; confirm `bun run skill:check` (freshness + expected-skill list) is clean; confirm a TypeScript build succeeds after the `src/` registration removals; grep for residue; run the OPSX-core vitest guard suites.

### Scope reconciliation (flagged for review)

- **ETHOS is inlined, not file-injected.** "Remove the ETHOS preamble injection" resolves in the current codebase to removing the two inlined ethos sub-generators (`generateCompletenessSection`, `generateSearchBeforeBuildingSection`) + deleting the redundant `ETHOS.md` doc + cleaning textual refs. The `{{PREAMBLE}}` mechanism is not removed wholesale (it was already minimized by `preamble-migration`).
- **Ethos section vs. status protocol.** The two ethos sections are `generateCompletenessSection` (Boil the Lake) and `generateSearchBeforeBuildingSection`. `generateCompletionStatus` (the DONE/BLOCKED/NEEDS_CONTEXT status protocol) is a functional convention, not builder-creed, and is **retained**. If the intent is a barer preamble that also drops the status protocol and/or AskUserQuestion format, that is a follow-up decision to confirm.

### Explicitly out of scope

- Deploy trio and plan quad — retained.
- `skills/gstack/browse/` and its `test/gstack-update-check.test.ts` — browse is a productization-era adapter rewrite; its internal update-check module is distinct from the `gstack-upgrade` expert skill and is left untouched.

## Capabilities

### Modified Capabilities

- `preamble-migration`: Remove the inlined ethos sub-generators from the preamble composition; delete `ETHOS.md`; clean dangling ethos references.
- `remove-gstack-upgrade-skill`: Extend removal to the lingering `gstack-upgrade` source directory and residual references.

### New Capabilities

- `remove-setup-browser-cookies-skill`: Full removal of the `setup-browser-cookies` expert skill (source, template, registrations, references).
- `remove-conductor-config`: Deletion of the orphan `conductor.json`.

## Impact

Deleted:
- `skills/gstack/setup-browser-cookies/` (SKILL.md + SKILL.md.tmpl)
- `skills/gstack/gstack-upgrade/` (SKILL.md + SKILL.md.tmpl)
- `skills/gstack/conductor.json`
- `skills/gstack/docs/ETHOS.md`
- `src/core/templates/experts/setup-browser-cookies.ts`

Edited (source of truth):
- `scripts/gen-skill-docs.ts` — delete `generateCompletenessSection` (~171–197) and `generateSearchBeforeBuildingSection` (~310–327); drop their calls in `generatePreamble` (~384, ~386); soften AskUserFormat cross-ref (~163); soften design-review `/setup-browser-cookies` prose (~831)
- `src/core/templates/experts/index.ts` (~29), `src/core/templates/skill-templates.ts` (~54), `src/core/shared/skill-generation.ts` (~66 import, ~143 registration) — remove setup-browser-cookies wiring
- `scripts/skill-check.ts` — remove `setup-browser-cookies/SKILL.md` (~29) and `gstack-upgrade/SKILL.md` (~32) entries
- `skills/gstack/office-hours/SKILL.md.tmpl` (~295), `skills/gstack/plan-ceo-review/SKILL.md.tmpl` (~210) — remove "Read ETHOS.md" refs
- `skills/gstack/docs/AGENTS.md` — remove setup-browser-cookies (~27) and gstack-upgrade (~32) rows
- `skills/gstack/docs/ARCHITECTURE.md` — remove gstack-update-check (~215) and ETHOS (~219) refs

Re-rendered:
- All `skills/gstack/**/SKILL.md`

Verification:
- `bun run gen:skill-docs`, `bun run skill:check`, TypeScript build (`pnpm build` / `tsc`), residue greps, `test/core/shared/skill-generation.test.ts` + `test/core/templates/skill-templates-parity.test.ts`
