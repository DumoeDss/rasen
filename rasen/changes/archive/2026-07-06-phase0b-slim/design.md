# Design — phase0b-slim

## Context

phase0b deletes skills and preamble content. Two prior changes already touched this surface and their synced specs constrain phase0b:
- `preamble-migration` minimized `generatePreamble` and lists its six sub-generators (SSOT for the composition).
- `remove-gstack-upgrade-skill` deleted the `gstack-upgrade` **expert template + registrations**, but not its source directory or references.

Field verification (post-0a, commit `0deed40`) established the true current state, which diverges from the original planning model in two load-bearing ways (see D1, D2).

## Key decisions

### D1. ETHOS is inlined, not file-injected

`skills/gstack/docs/ETHOS.md` declares itself "injected into every workflow skill's preamble automatically". This is stale: `gen-skill-docs.ts` contains **no** reference to `ETHOS.md`. The ethos content was inlined into two sub-generators:
- `generateCompletenessSection` → ETHOS §1 "Boil the Lake" / Completeness Principle
- `generateSearchBeforeBuildingSection` → ETHOS §2 "Search Before Building" / three layers / eureka

Therefore "remove the ETHOS preamble injection" resolves to: drop these two sub-generators from `generatePreamble`, delete them, delete the now-redundant `ETHOS.md` doc, and clean the textual "Read ETHOS.md" pointers in `office-hours`, `plan-ceo-review`, and `docs/ARCHITECTURE.md`. The `{{PREAMBLE}}` placeholder and mechanism are **not** removed — they were already minimized by `preamble-migration` and still carry functional sections.

### D2. Ethos sections vs. functional status protocol (naming reconciliation)

The `phase0b` tasking named `generateCompletionStatus` for removal. That function is the **Completion Status Protocol** (DONE / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT + Plan Status Footer) — a functional reporting convention, not builder-creed. The ethos section with the confusingly similar name is `generateCompletenessSection` ("Boil the Lake"). This design removes the two genuine ethos sections (`generateCompletenessSection` + `generateSearchBeforeBuildingSection`) and **retains** `generateCompletionStatus`, `generateAskUserFormat`, `generatePreambleBash`, and `generateRepoModeSection` as functional. Flagged for review confirmation; if a barer preamble is desired, dropping the status protocol / AskUserQuestion format is a follow-up.

### D3. Two skills, two removal states

`gstack-upgrade` is half-removed: expert template `.ts` and registrations are already gone (per `remove-gstack-upgrade-skill`), but the source dir, a `skill-check.ts` entry, and doc rows linger — phase0b MODIFIES that capability to finish the job. `setup-browser-cookies` is fully live: it needs the complete removal treatment (dir + template + four wiring points + skill-check + design-review prose + AGENTS row), modeled as a NEW capability mirroring the `remove-gstack-upgrade-skill` shape.

### D4. Registration removal must compile; skill-check list must match tree

Because `setup-browser-cookies.ts` is imported in four `src/` locations, all four imports/exports plus the file must be removed together or TypeScript compilation fails — so a build check (`pnpm build` / `tsc`) is a required gate, additional to the skill-render checks. `scripts/skill-check.ts` carries an explicit expected-skill list; deleting a skill dir without removing its list entry makes `skill:check` fail, so the two must change together.

### D5. Deletion by explicit lookup, not glob

Per the repo rule "if we generate artifacts, specify deletion/modification by explicit list lookup". Every deletion and reference edit in tasks.md names the exact file and the exact wiring point; no pattern-matched sweep. The residue greps in verification are a safety net, not the removal mechanism.

### D6. AGENTS.md / ARCHITECTURE.md handling

`docs/AGENTS.md` is the actively-consumed skill directory table — its rows for deleted skills are removed so it stays accurate. `docs/ARCHITECTURE.md` is browse's architecture doc (slated for a productization-era rewrite); its stale `gstack-update-check` and `ETHOS` mentions are cleaned opportunistically here since they would otherwise dangle, but the file is not otherwise reworked.

## Verification strategy

1. `bun run gen:skill-docs` — re-render all SKILL.md from the slimmed sources.
2. `bun run skill:check` — freshness + expected-skill-list; must exit 0 (proves the deleted skills are gone from both tree and list, and remaining SKILL.md match sources).
3. TypeScript build (`pnpm build` or `tsc --noEmit`) — must succeed, proving the `setup-browser-cookies` de-registration is complete.
4. Residue greps must return nothing in `.tmpl` + generators + generated `.md` + `src/`: `ETHOS`, `Boil the Lake`, `Search Before Building`, `setup-browser-cookies`, `SetupBrowserCookies`, `gstack-upgrade`; and the deleted dirs/files must be absent.
5. `npm run test` for `test/core/shared/skill-generation.test.ts` and `test/core/templates/skill-templates-parity.test.ts` — these cover only OPSX-core templates (no gstack experts), so they must stay green; a failure signals accidental core spillover. Targeted run avoids the known global-config isolation flakiness.
