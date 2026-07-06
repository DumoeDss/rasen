## 1. Absorb /ship into the opsx:ship workflow template

- [x] 1.1 In `src/core/templates/workflows/ship.ts`, replace the "Invoke the `/ship` expert skill" block (Step 3, ~lines 52-58) with self-contained steps: merge base branch before tests (stop on unresolvable conflicts), run the detected test command and stop on in-branch failure, review the diff for obvious structural issues.
- [x] 1.2 Add a fresh-verification gate before push (re-run tests if code changed after the test run) and make `git push -u origin <branch>` + `gh pr create` the primary path; fold the former fallback block (~lines 72-76) into this path so no `/ship` delegation remains.
- [x] 1.3 Do NOT absorb gstack shop-ceremony (4-digit VERSION bump, CHANGELOG auto-gen, TODOS.md, Greptile triage, eval tiers) — keep opsx:ship lean per design D1. Keep the existing PR-body-from-proposal, ship-log, and optional land-and-deploy sections intact.
- [x] 1.4 Update the header comment (`ship.ts:4-5`) that names gstack `/ship` and `/land-and-deploy`. Rework the post-ship documentation-sync step (`ship.ts:126`, currently "Run `/document-release`…"): replace the pointer to the now-deleted `/document-release` skill with a minimal inline instruction — "update project documentation (README/architecture/changelog) to match what shipped" — so opsx:ship stays self-contained and references no removed skill.
- [x] 1.5 Confirm `STORE_SELECTION_GUIDANCE` injection is unchanged and the template still exports `getShipCommandSkillTemplate()` and `getOpsxShipCommandTemplate()`.

## 2. Absorb /retro into the opsx:retro workflow template

- [x] 2.1 In `src/core/templates/workflows/retro.ts`, replace the general-scope "Invoke the `/retro` expert skill" (Step 2B, ~line 62) with a self-contained git-analysis contract: gather commit/author/LOC/hotspot/streak data, compute the metrics table and a per-author leaderboard.
- [x] 2.2 Replace the global-scope delegation (Step 2C, ~line 66) with a self-contained cross-project analysis using the same git-analysis contract; write general → `openspec/retro-latest.md`, global → `openspec/retro-global-latest.md` (OPSX's own paths). Do NOT adopt gstack's `.context/retros/*.json` snapshot/history machinery.
- [x] 2.3 Leave the change-scoped scope (2A) and the existing report structures unchanged; confirm exports `getRetroCommandSkillTemplate()` and `getOpsxRetroCommandTemplate()` and `STORE_SELECTION_GUIDANCE` injection are intact.

## 3. Remove the ten experts' wiring and sources

- [x] 3.1 Delete the ten expert template files `src/core/templates/experts/{autoplan,plan-ceo-review,plan-eng-review,plan-design-review,land-and-deploy,setup-deploy,canary,ship,retro,document-release}.ts`.
- [x] 3.2 Remove the ten `export { get...SkillTemplate }` lines from `src/core/templates/experts/index.ts` (including `getDocumentReleaseSkillTemplate`).
- [x] 3.3 Remove the ten names from the expert re-export block in `src/core/templates/skill-templates.ts` (lines ~32-63, including `getDocumentReleaseSkillTemplate`).
- [x] 3.4 In `src/core/shared/skill-generation.ts`, remove the ten imports from the expert import block (lines ~49-78) AND the ten `getSkillTemplates()` roster entries (lines ~185-214), including the `openspec-gstack-document-release` entry.
- [x] 3.5 Delete the ten source directories `skills/gstack/{autoplan,plan-ceo-review,plan-eng-review,plan-design-review,land-and-deploy,setup-deploy,canary,ship,retro,document-release}/` (tmpl + generated SKILL.md + any sidecars).

## 4. Navigator, AGENTS, and catalog cleanup

- [x] 4.1 In `skills/gstack/navigator/SKILL.md.tmpl`, delete the `/document-release` standalone bullet (~line 57), the standalone `/retro` bullet (~line 58), the entire "Deploy family" block (~lines 60-64), and the entire "Plan family" block (~lines 66-71). Keep the main-flow `/opsx:retro` (item 7).
- [x] 4.2 In `skills/gstack/docs/AGENTS.md`, remove the table rows for `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/ship`, `/retro`, and `/document-release`.
- [x] 4.3 Re-render generated docs: `bun run gen:skill-docs` (and `--host codex` if applicable) so `skills/gstack/navigator/SKILL.md` reflects the tmpl edits.

## 5. Counts, curated skill-check list, and parity

- [x] 5.1 In `scripts/skill-check.ts`, remove the 9 `SKILL_FILES` entries: `ship/SKILL.md`, `retro/SKILL.md`, `plan-ceo-review/SKILL.md`, `plan-eng-review/SKILL.md`, `plan-design-review/SKILL.md`, `canary/SKILL.md`, `land-and-deploy/SKILL.md`, `setup-deploy/SKILL.md`, `document-release/SKILL.md` (autoplan is not in the list).
- [x] 5.2 In `test/core/shared/skill-generation.test.ts`, reduce the four expert-count assertions by ten and update inline comments: full roster 48→38 (18 wf + 20 exp), four-filter 34→24, no-match 30→20, single-filter 31→21.
- [x] 5.3 Do NOT edit `test/core/templates/skill-templates-parity.test.ts` — it hashes only the base workflow allowlist, not ship/retro or experts (design D3). If it goes red, the wrong template set was touched.

## 6. Build, test, render, install, and guard

- [x] 6.1 `pnpm build` — tsc must compile clean (catches any missed wiring reference).
- [x] 6.2 `bun run gen:skill-docs` then `bun run skill:check` — freshness and curated-list checks must be FRESH/green.
- [x] 6.3 `pnpm test` — all green (isolate-rerun known Windows flakes: spec.test.ts timeout, artifact-workflow EBUSY; record if isolated rerun is green). Confirm `test/core/profiles.test.ts` and the parity test stay green untouched.
- [x] 6.4 `openspec update --force`, then remove the orphaned installed directories `openspec-gstack-{autoplan,plan-ceo-review,plan-eng-review,plan-design-review,land-and-deploy,setup-deploy,canary,ship,retro,document-release}` from every configured tool's skills directory (e.g. `.claude/skills/`); confirm the generated opsx:ship / opsx:retro SKILL.md are self-contained (no "Invoke the `/ship` expert skill" / "Invoke the `/retro` expert skill" text, and no `/document-release` pointer in opsx:ship).
- [x] 6.5 `openspec config list` — confirm the real global config was not polluted by the test run.
- [x] 6.6 Whole-repo dangling-reference grep over `src/`, `skills/`, `docs/`, `skills/gstack/docs/AGENTS.md` for `/autoplan`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/land-and-deploy`, `/setup-deploy`, `/canary`, `/document-release`, the `/ship` expert invocation, and the `/retro` expert delegation — no match outside `openspec/changes/archive/`.
  - CLEAN: the 8 unambiguous removed names = 0 hits across `src/`, `skills/`, `docs/`, `scripts/` (excl. archive/ + `openspec/specs/` history). Bare `/ship` `/retro` remaining are all legitimate OPSX references (opsx:ship/opsx:retro workflow modules, `ship-log.md` / `retro.md` / `retro-latest.md` / `retro-global-latest.md` output paths, `opsx/ship-command.md`, OPSX phase/mode names in slash-lists). Generated opsx:ship/opsx:retro self-contained (no expert delegation, no `/document-release`).

## 7. LEAD-directed dead-pointer cleanup extension (2026-07-07)

Apply-stage extension per LEAD verdict (deferral rejected: dead pointers to removed commands fall under THIS change's no-dangling-reference standard; mechanical cleanup, not change-2 methodology rework). Surgical replace/drop only — NO plan-review methodology absorbed.

- [x] 7.1 `scripts/gen-skill-docs.ts`: Plan Status Footer (`generateCompletionStatus`) + `generatePlanFileReviewReport` tables — replaced the `/plan-ceo-review /plan-eng-review /plan-design-review` rows + `/autoplan` verdict with OPSX equivalents (`/opsx:verify`, `/opsx:verify-enhanced`, `/opsx:review-cycle`); kept the Codex row. Reworded the verdict prose to match. Dropped `/setup-deploy` prose (dead `DEPLOY_BOOTSTRAP` resolver). Dropped `/plan-eng-review`/`/ship` test-plan attributions → "Generated on {date}". Dropped `/plan-design-review` from the wireframe pointer. Reworded the dead `TEST_FAILURE_TRIAGE` "/ship" attribution.
- [x] 7.2 Tmpl stragglers: `office-hours.tmpl` (desc + next-steps → `/opsx:propose`), `benchmark.tmpl` ("/canary" dropped), `design-review.tmpl`/`design-consultation.tmpl` ("/plan-design-review" dropped), `qa.tmpl`/`qa-only.tmpl` (plan-review test-plan refs → neutral), `review.tmpl` ("/ship" → "/opsx:ship"), gstack index `SKILL.md.tmpl` (adjacent-skills list pruned of removed commands).
- [x] 7.3 Sidecars + docs: `review/checklist.md`, `review/greptile-triage.md`, `review/TODOS-format.md` ("/ship" refs dropped/neutralized); `skills/gstack/docs/ARCHITECTURE.md` ("/plan-design-review", "/ship" dropped from placeholder descriptions); `docs/opsx-workflow-guide.md` (removed-command list pruned); `docs/zh/gen-skill-docs.md` (autoplan example filename → benchmark).
- [x] 7.4 Regenerated (`bun run gen:skill-docs`), skill:check FRESH, `pnpm build` clean, `openspec update --force`. Re-grep of generated skills + installed `.claude/skills`: ZERO hits of the 10 removed names outside legitimate OPSX output-path references. Affected tests green (skill-generation 37, parity 6 UNCHANGED, profiles 10). Config unpolluted (18 workflows). No install-side orphans (20 gstack dirs).
- [x] 7.5 Main-spec check (LEAD point 5 — did NOT edit `openspec/specs/`): the `openspec/specs/*` hits (`dead-stub-removal`, `ship-portability`, `preamble-migration`, `instruction-loader`, `schema-enhance-field`, `opsx-auto-command`) are historical scenario text describing PAST changes (e.g. "WHEN `skills/gstack/autoplan/SKILL.md.tmpl` is inspected"). NONE is a live requirement/scenario mandating that a removed command EXIST. `opsx-auto-command/spec.md` says the auto pipeline "SHALL invoke /autoplan for planning" — this is the ONE that names a removed command as a behavioral requirement; flagged for LEAD/planner (delta-spec territory, not mine to edit).
- [x] 6.7 `openspec validate remove-gstack-parallel-lifecycle --strict` — must pass.
