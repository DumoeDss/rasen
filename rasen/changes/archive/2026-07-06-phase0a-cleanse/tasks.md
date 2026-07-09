# Tasks — phase0a-cleanse

> Edit `.tmpl` and `gen-skill-docs.ts` (sources) and `review/*.md` (static) — never hand-edit generated `SKILL.md`. Re-render at the end (§8). Line numbers are from the dev-harness snapshot; confirm before editing.

## 1. office-hours (personal brand + eureka clause)

- [x] 1.1 Remove the three "A personal note from me, Garry Tan, the creator of GStack" founder cards in `skills/gstack/office-hours/SKILL.md.tmpl` (~lines 574, 587, 597); replace each with neutral closing wording or delete
- [x] 1.2 Remove the `ycombinator.com/apply?ref=gstack` link and the two `**ycombinator.com/apply?ref=gstack**` call-to-action lines (~lines 580, 591, 601), including the `open https://ycombinator.com/...` instruction
- [x] 1.3 In the Eureka check (~lines 322, 324), keep the "name the EUREKA insight" sentence but strip the "Log the eureka moment (see preamble)" clause
- [x] 1.4 Leave the "Read ETHOS.md for the full Search Before Building framework" reference (~line 295) untouched — it is a phase0b (ETHOS removal) concern, not phase0a

## 2. retro (brand card + example data + eureka reader + global-mode + stub)

- [x] 2.1 Remove the `Powered by gstack · github.com/garrytan/gstack` card line (~line 619) from the personal-card ASCII block
- [x] 2.2 Remove the entire "Eureka Moments" metrics section that reads `~/.openspec/analytics/eureka.jsonl` (~lines 170–183), including the two `garrytan/...` EUREKA example lines
- [x] 2.3 Genericize the `"remote": "https://github.com/garrytan/gstack"` and `"name": "gstack"` example JSON (~line 748) to a neutral placeholder (e.g. `owner/myapp`)
- [x] 2.4 Change the `"Garry Tan": { ... }` example contributor row (~line 364) to a neutral name
- [x] 2.5 Remove the global-mode section (Global Step 1 onward, ~line 505+) whose Step 2 declares "Global retro discovery is not yet available … and stop" (`pending OpenSpec integration`, ~line 512)
- [x] 2.6 (Optional/low) Neutralize illustrative `app/services/` paths in the histogram/focus-score examples (~lines 148, 247, 365) if convenient — not required

## 3. ship (Rails/Vitest → runtime-agnostic; co-author; stub)

- [x] 3.1 Rewrite Step 3 "Run tests" (~lines 108–118) to run the project's detected test command (per the existing Test Framework Bootstrap convention); remove `RAILS_ENV=test bin/rails db:migrate`, `bin/test-lane`, `db:test:prepare`, `structure.sql`, and the hardcoded `npm run test`
- [x] 3.2 Rewrite Step 3.25 "Eval Suites" (~lines 130–193) into an optional, project-declared prompt/eval regression step; remove `test/evals/*_eval_runner.rb`, `EVAL_JUDGE_TIER`, `config/system_prompts/*.txt`, `app/services/*_prompt_builder.rb` globs, and the tier cost table
- [x] 3.3 De-hardcode the commit co-author trailer (~line 408): replace `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>` with a non-model-pinned trailer or omit
- [x] 3.4 Fix the broken inline `# Diff scope detection: pending OpenSpec integration` sentence in the Step 3.5 design-review note (~line 75)

## 4. document-release (co-author)

- [x] 4.1 De-hardcode the co-author trailer (~line 282): replace `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>` with a non-model-pinned trailer or omit

## 5. design-consultation (eureka clause)

- [x] 5.1 In the Eureka check (~line 120), keep the "name the EUREKA insight" sentence but strip the "Log the eureka moment (see preamble)" clause

## 6. pending-stub removal in remaining tmpl files

- [x] 6.1 `autoplan/SKILL.md.tmpl`: remove the "Completion: Write Review Logs" passage built around the three `pending OpenSpec integration` blocks (~lines 393, 395, 400)
- [x] 6.2 `codex/SKILL.md.tmpl`: remove the step-7 "Persist the review result" passage and its stub (~line 129), plus the now-orphaned substitution note
- [x] 6.3 `land-and-deploy/SKILL.md.tmpl`: remove the "3.5a Review staleness check" stub passage (~line 130) and the dead diff-scope block whose `echo` references unset vars (~line 335)
- [x] 6.4 `plan-ceo-review/SKILL.md.tmpl` (~line 750), `plan-design-review/SKILL.md.tmpl` (~line 278), `plan-eng-review/SKILL.md.tmpl` (~line 245): remove each "Review Log" persistence passage; in plan-eng-review also drop the sentence claiming the preamble "already writes to `~/.openspec/sessions/` and `~/.openspec/analytics/`"

## 7. gen-skill-docs.ts generator functions

- [x] 7.1 `generateSearchBeforeBuildingSection` (~lines 323–327): remove only the "Log eureka moments" jq-append block writing to `~/.openspec/analytics/eureka.jsonl`; keep the surrounding Search-Before-Building prose and the EUREKA-naming sentence (preamble wholesale removal is phase0b)
- [x] 7.2 `generateReviewDashboard` (~line 1108): remove/neutralize the dead review-dashboard output built on the non-existent review-log backend so no stub reaches generated files (consumed by plan-* and ship via `{{REVIEW_DASHBOARD}}`)
- [x] 7.3 `generateDesignReviewLite` (~lines 736, 761): remove the two dead `pending OpenSpec integration` comment/log lines; retain the working `git diff --name-only | grep -qE '\.(tsx|jsx|css|...)$'` frontend-detection fallback
- [x] 7.4 `generateCompletionStatus`'s Plan Status Footer stub (~line 363): surgically remove the dead `pending OpenSpec integration` bash block and the now-unreachable "if output contains review entries" branch, keeping the placeholder-table write. **(LEAD ruling 2026-07-06: pulled forward into phase0a — was originally deferred to phase0b, but leaving it propagated the stub into all 24 generated skills via `{{PREAMBLE}}` and made §9.3 / the dead-stub-removal scenario unsatisfiable within phase0a. Surgical removal mirrors the eureka-jsonl precedent and does not conflict with phase0b's wholesale preamble removal.)**
- [x] 7.5 `generateAdversarialStep` (~lines 1907, 1963, 2006): remove three `pending OpenSpec integration` dead stubs (a dead `OLD_CFG` opt-out check + two "persist the review result" blocks) not enumerated by the original planner sweep. This function is a standalone `{{ADVERSARIAL_STEP}}`/`{{CODEX_REVIEW_STEP}}` placeholder (non-preamble), so it is not phase0b's responsibility and its stubs reached generated codex/ship/qa skills — phase0a's responsibility per the dead-stub-removal capability.

## 8. Static review checklists

- [x] 8.1 `review/checklist.md` (~line 89): replace `CC+gstack` with `AI-assisted`
- [x] 8.2 `review/greptile-triage.md`: genericize "GStack reply" / "prior GStack reply" prose (~lines 137, 158, 160, 162, 164, 166) to "prior automated review reply", keeping the `**Fixed**` / `**Not a bug.**` / `**Already fixed**` markers
- [x] 8.3 `review/greptile-triage.md`: normalize `~/.gstack` (~line 188) to `~/.openspec`; change `garrytan/myapp` example rows (~lines 202–204) to `owner/myapp`
- [x] 8.4 Confirm `design-checklist.md` `gstack-diff-scope` / `~/.claude/skills/gstack/bin/...` and `browse/bin/remote-slug` references are left as-is (structural tool names, out of scope)

## 9. Re-render + verify

- [x] 9.1 Run `bun run gen:skill-docs` to re-render all `skills/gstack/**/SKILL.md` from cleansed sources
- [x] 9.2 Run `bun run skill:check` (dry-run freshness) — must exit 0, proving committed SKILL.md matches sources
- [x] 9.3 Residue greps must return nothing across `.tmpl` + `gen-skill-docs.ts` + generated `.md`: `Garry Tan`, `ycombinator.com/apply`, `Powered by gstack`, `garrytan/gstack`, `eureka.jsonl`, `pending OpenSpec integration`, `RAILS_ENV`, `bin/test-lane`, `Claude Opus 4.6`; and no `CC+gstack`/`garrytan`/`~/.gstack` in `review/*.md`
- [x] 9.4 Run `npm run test` targeting `test/core/shared/skill-generation.test.ts` and `test/core/templates/skill-templates-parity.test.ts` — must stay green (they cover only OPSX-core templates; a failure signals spillover into core)
- [x] 9.5 Run `openspec validate phase0a-cleanse --strict` — must pass

## 10. Review Round 1 fixes (LEAD-routed 2026-07-06)

- [x] 10.1 (M1) `retro/SKILL.md.tmpl:51`: delete the stale `or the word \`global\` (optionally followed by a window)` clause from the Argument-validation sentence — the global usage/routing/section were already removed, so this clause let `/retro global` pass validation and silently fall through to a 7-day repo-scoped retro. Removes the silent fallthrough.
- [x] 10.2 (M2) `plan-eng-review` (Next Steps §), `plan-ceo-review` (Next Steps §), `plan-design-review` (Next Steps §): genericize the consumer clauses that dereferenced fields the neutralized session-based `generateReviewDashboard` no longer emits — `skip_eng_review` config → "the user opted out of eng review this session"; commit-hash staleness ("commit hash shows it predates / significant drift") → "the plan changed substantially since". Keeps consumers coherent with the session dashboard.
- [x] 10.3 (m1) `ship/SKILL.md.tmpl:296`: `GStack recommends` → `We recommend` (last surviving product-voice GStack string in cleansed skill bodies).
- [x] 10.4 (m2) `land-and-deploy/SKILL.md.tmpl` (Step 3.5a Test results) + `docs/ARCHITECTURE.md`: generalize author-private eval-harness paths. land-and-deploy `~/.gstack-dev/evals/*` E2E + LLM-judge reads → project-declared `<eval-output-dir>` (optional, skip if undeclared), consistent with ship-portability. `docs/ARCHITECTURE.md` `~/.gstack-dev/` → `~/.openspec-dev/` (stale author-harness docs; no code uses the path, verified via grep — same state-dir normalization convention as D5's `~/.gstack`→`~/.openspec`).
