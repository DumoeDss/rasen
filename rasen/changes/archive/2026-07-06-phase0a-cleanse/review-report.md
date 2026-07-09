# Review Report — phase0a-cleanse

**Reviewer:** reviewer-0a (isolated; did not author the diff)
**Scope:** working-tree diff vs HEAD — `skills/gstack/**` (`.tmpl` + generated `SKILL.md` + static `review/*.md`) and `scripts/gen-skill-docs.ts`
**Mode:** read-only (no source files modified, no git writes)
**Diff size:** 37 files, +170 / −1620

## Verdict

**DONE_WITH_CONCERNS.** The four capability deltas are faithfully implemented and the mechanical cleansing is thorough — every enumerated residue token greps to zero, generation is verifiably fresh (`bun run skill:check` → EXIT 0, all 28 skills FRESH), over-cleansing guards hold (EUREKA reasoning prose, `**Fixed**`/`**Not a bug.**` detection markers, design-review-lite git-diff fallback, structural `gstack` names, and `src/telemetry/` are all correctly preserved/untouched). **No Blockers.** Two **Major** coherence gaps and two **Minor** residue leftovers should be triaged before landing.

## Findings summary

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 2 |
| Minor | 2 |
| Trivial | 0 |

---

## Contract verification (spec delta → diff)

**branding-migration (MODIFIED + ADDED):** PASS.
- `CC+gstack` → `AI-assisted` in `review/checklist.md:87`; grep for `CC+gstack` = 0 across sources + generated.
- Three Garry Tan founder cards in `office-hours` genericized (`Beat 3: Garry's Personal Plea` → `Beat 3: Closing Encouragement`); the `open https://ycombinator.com/apply?ref=gstack` AskUserQuestion flow removed cleanly (no dangling "If yes →"/"If no →"). `Garry Tan` / `ycombinator` = 0.
- `Powered by gstack` card, `garrytan/gstack` remote-URL + EUREKA example data, and `"Garry Tan"` contributor row in `retro` all neutralized (`Alex Chen`, `owner/myapp`, `src/api`). `garrytan` = 0.
- greptile-triage: "GStack reply" → "prior automated review reply"; `~/.gstack` → `~/.openspec`; `garrytan/myapp` → `owner/myapp`; detection markers preserved. Matches D5.

**ship-portability (ADDED):** PASS. Rails/Vitest harness (`bin/test-lane`, `RAILS_ENV`, `structure.sql`, `db:test:prepare`, `npm run test`) removed from Step 3; eval harness (`*_eval_runner.rb`, `EVAL_JUDGE_TIER`, `config/system_prompts/`, `*_prompt_builder`, tier cost table) removed from Step 3.25 and made project-declared/optional; `Co-Authored-By: Claude Opus 4.6` → `Co-Authored-By: Claude` in both ship and document-release. All named tokens grep to 0. Runtime-agnostic rewrite is consistent with the detection convention: ship Step 2.5 is literally "Test Framework Bootstrap" (`{{TEST_BOOTSTRAP}}` → `generateTestBootstrap`, which detects runtime + test command), and Step 3 references "the command verified by Test Framework Bootstrap (Step 2.5)".

**eureka-telemetry-removal (ADDED):** PASS. jsonl writer removed from `generateSearchBeforeBuildingSection` (EUREKA-naming sentence + Search-Before-Building prose retained per D3); reader ("Eureka Moments" metrics row) removed from `retro`; "Log the eureka moment (see preamble)" clauses stripped from `office-hours` and `design-consultation` while keeping the naming technique. `eureka.jsonl` = 0. `src/telemetry/` untouched (verified via `git diff --name-only`).

**dead-stub-removal (ADDED):** PASS on the literal scenarios. `pending OpenSpec integration` = 0 across `.tmpl` + generator + generated. Whole-passage removals (autoplan "Write Review Logs", codex step-7 persist, plan-* "Review Log", ship/land-and-deploy stubs, `generateAdversarialStep` persist blocks + `OLD_CFG` opt-out) done; working code retained where a stub sat above it (`generateDesignReviewLite` SCOPE_FRONTEND grep kept; land-and-deploy Step 4 classification stub replaced with a real `git diff --name-only | grep` implementation). Retro global-mode halt branch removed. See Major #1 for an incomplete-removal residue in the same file.

---

## Major

### M1 — retro: `global` argument still whitelisted after its handler, usage, and section were all removed
**File:** `skills/gstack/retro/SKILL.md.tmpl:51` (and the FRESH-regenerated `skills/gstack/retro/SKILL.md`)

The change removed (a) the `/retro global` usage lines, (b) the routing line "If the first argument is `global`: Skip the normal repo-scoped retro…", and (c) the entire Global Retrospective Mode section. But the **argument-validation sentence** still reads:

> "If the argument doesn't match a number followed by `d`, `h`, or `w`, the word `compare` (optionally followed by a window), **or the word `global` (optionally followed by a window)**, show this usage and stop"

Consequence: `/retro global` now passes validation (not rejected) but has no handler — it falls through to Step 1's window parser, where `global` matches no window and silently defaults to a 7-day repo-scoped retro. This is behavior *introduced by this change* (pre-change, `global` was both accepted and handled), and it lives in the very file/task (2.5) this change owns. It does not literally violate the "no global-mode branch that tells the user unavailable and halts" scenario (that halt branch is gone), so it is not a Blocker — but it is incoherent cleansed output.
**Fix:** delete "or the word `global` (optionally followed by a window)" from the validation sentence at line 51; re-render.

### M2 — plan-* skills still consume dashboard fields the neutralized `generateReviewDashboard` no longer emits
**Files:** `skills/gstack/plan-ceo-review/SKILL.md.tmpl:747,749`; `skills/gstack/plan-design-review/SKILL.md.tmpl:275`; `skills/gstack/plan-eng-review/SKILL.md.tmpl:242,246` (+ FRESH generated copies)

Task 7.2 rewrote `generateReviewDashboard` from a persisted-log/config model to a **session-based** dashboard, deleting: the `skip_eng_review` config field, the per-entry `commit` field, and the entire commit-hash **staleness detection** ("compare against current HEAD… may be stale — N commits since review"). Three consumer skills were left referencing exactly those removed concepts:
- `plan-ceo-review` / `plan-design-review`: "check the dashboard output for `skip_eng_review`. If it is `true`…" and "if the **commit hash** shows it predates this review, note that it may be stale".
- `plan-eng-review`: "or `skip_eng_review` is `true` in the dashboard config" and "if the **commit hash** shows significant drift".

The neutralized dashboard surfaces neither `skip_eng_review` nor commit hashes, so these instructions now dereference non-existent output. The commit-staleness references in particular describe dashboard behavior this change removed (the old `generateReviewDashboard` genuinely documented HEAD-comparison staleness), so this is coherence drift *introduced by* task 7.2's blast radius, not purely pre-existing.

**Caveat for the LEAD:** the `skip_eng_review` half was already partially dangling pre-change (the old dashboard was a dead `pending OpenSpec integration` stub that emitted nothing), and none of these five lines were enumerated in phase0a's task list. So this is legitimately either (a) a small in-scope follow-up (genericize the five clauses to session terms: "if the user opted out of eng review this session… note it may be stale if the plan changed since"), or (b) an explicit deferral with a boundary note. Flagged Major so it gets a decision rather than passing silently.

---

## Minor

### m1 — `GStack recommends` product-brand voice survives in ship
**File:** `skills/gstack/ship/SKILL.md.tmpl:296` (+ generated `ship/SKILL.md`)

> Message: "**GStack recommends** maintaining a TODOS.md organized by skill/component…"

This is the only surviving product-voice `GStack` string in the cleansed skill bodies (the sweep otherwise found `GStack` only in `docs/ETHOS.md`, a phase0b concern). It is the same residue class the change exists to remove, but it is neither founder-endorsement prose nor a listed branding-migration scenario, and it was not enumerated in the ship task list — hence Minor, not a contract violation. Trivial genericize ("We recommend" / "OpenSpec recommends"). Recommend folding into this pass since it is one line in a file already being edited.

### m2 — `~/.gstack-dev/evals/…` private-harness paths survive in land-and-deploy
**Files:** `skills/gstack/land-and-deploy/SKILL.md.tmpl:143,158` (+ generated); `skills/gstack/docs/ARCHITECTURE.md:312,331,341`

The land-and-deploy "Test results" step reads `~/.gstack-dev/evals/*-e2e-*` and `*-llm-judge-*` — the same private-harness pollution class as ship's Rails harness (author-specific eval-output dir), just not enumerated in phase0a scope. Out of scope as written (consistent with browse fixtures being deferred), but worth logging as a follow-up so the private-harness cleanse is tracked to completion rather than forgotten.

---

## Correctly-scoped items (verified NOT over-cleansed / correctly deferred — no action)

- EUREKA reasoning technique retained in `office-hours` and `design-consultation` (only the "log to file" clause removed).
- greptile detection markers `**Fixed**` / `**Not a bug.**` / `**Already fixed**` preserved verbatim.
- `generateDesignReviewLite` SCOPE_FRONTEND `git diff --name-only | grep -qE` fallback retained; only the dead comment/log removed.
- Structural `skills/gstack/` dir and `openspec-gstack-*` skill names unchanged (out of scope per proposal §1).
- `src/telemetry/` PostHog module untouched (eureka-telemetry-removal scenario satisfied).
- `office-hours/SKILL.md.tmpl:295` "Read ETHOS.md…" reference left intact — correctly deferred to phase0b (ETHOS removal), per task 1.4.
- `docs/ETHOS.md` "gstack thinks" — phase0b concern, not phase0a.
- ship co-author trailer and Test Framework Bootstrap wiring internally consistent.

## Evidence
- `bun run skill:check` → `EXIT=0`, all 28 skills `FRESH` (committed SKILL.md render from cleansed sources).
- Residue greps (sources + generated, excluding `gstack-upgrade/` + `browse/test` exemptions): `Garry Tan`, `ycombinator`, `Powered by gstack`, `eureka.jsonl`, `RAILS_ENV`, `bin/test-lane`, `test-lane`, `structure.sql`, `eval_runner`, `EVAL_JUDGE_TIER`, `Claude Opus 4.6`, `pending OpenSpec integration`, `garrytan/gstack`, `garrytan`, `CC+gstack`, `~/.gstack` (greptile), `EVAL_VERBOSE`, `PROMPT_SOURCE_FILES`, `prompt_builder` → all **0**.
- `git diff --name-only | grep src/telemetry` → none.

---

## Fix Round 1 (implementer-0a, 2026-07-06)

LEAD ruled all four findings in-change. Fixes (each = file:line + method):

### M1 — retro `global` still whitelisted → FIXED
- `skills/gstack/retro/SKILL.md.tmpl:51` — deleted `, or the word \`global\` (optionally followed by a window)` from the Argument-validation sentence. Now `/retro global` is rejected with the usage message instead of silently falling through to a 7-day repo-scoped retro. Re-rendered `retro/SKILL.md` (FRESH).

### M2 — plan-* consume dashboard fields the neutralized dashboard no longer emits → FIXED
Genericized the consumer clauses to session terms (dashboard is now session-based; no `skip_eng_review` config, no per-entry `commit`/HEAD-staleness):
- `plan-eng-review/SKILL.md.tmpl` Next Steps (was :240,242,246,248) — "Read the dashboard output … whether they are stale" → "Use the dashboard to see which reviews have run this session"; commit-hash staleness → "if the plan has changed substantially since"; `skip_eng_review is true in the dashboard config` → "the user opted out of eng review this session".
- `plan-ceo-review/SKILL.md.tmpl` Next Steps (was :745,747,749) — `check the dashboard output for skip_eng_review` → "unless the user opted out of eng review this session"; "commit hash shows it predates / commit hash drift" → "the plan has changed substantially since".
- `plan-design-review/SKILL.md.tmpl` Next Steps (was :273,275) — same two genericizations as ceo-review.
- All three generated `SKILL.md` re-rendered (FRESH). `skip_eng_review` and `commit hash shows` now grep to 0.

### m1 — `GStack recommends` product voice in ship → FIXED
- `skills/gstack/ship/SKILL.md.tmpl:296` — `GStack recommends` → `We recommend` (TODOS.md creation prompt). `GStack recommends` greps to 0; `ship/SKILL.md` FRESH.

### m2 — `~/.gstack-dev/evals/` private-harness paths → FIXED (extended to the ARCHITECTURE.md lines the report listed)
- `skills/gstack/land-and-deploy/SKILL.md.tmpl` Step 3.5a — the E2E + LLM-judge `ls ~/.gstack-dev/evals/*` reads rewritten to a project-declared `<eval-output-dir>` (optional; "skip this sub-step" when the project declares no eval-output location), matching the ship-portability project-declared pattern.
- `skills/gstack/docs/ARCHITECTURE.md:312,331,341` — `~/.gstack-dev/` → `~/.openspec-dev/`. Verified no source code uses the `gstack-dev` path (`grep -rn gstack-dev --include=*.ts/js/json` outside skills/docs = 0), so these are stale author-harness docs; normalization follows D5's `~/.gstack`→`~/.openspec` state-dir convention and does not desync docs from code. `.gstack-dev` now greps to 0.

### Fix Round 1 verification
- `bun run gen:skill-docs` → re-rendered; `bun run skill:check` → **EXIT 0, 28 FRESH**.
- Residue greps (sources + generated, excl. gstack-upgrade/browse-test/changes): `GStack recommends`, `.gstack-dev`, `skip_eng_review`, `commit hash shows`, `global (optionally` → all **0**.
- vitest sentinel (`skill-generation` + `skill-templates-parity`) → **31 passed**.
- `openspec validate phase0a-cleanse --strict` → **valid**.
- Delta touched **6 `.tmpl` + 1 static doc** (retro, plan-eng-review, plan-ceo-review, plan-design-review, ship, land-and-deploy `.tmpl`; docs/ARCHITECTURE.md) plus their FRESH-regenerated `SKILL.md`. No changes outside the flagged files.

## Re-review Round 1

**Reviewer:** reviewer-0a (isolated). Scope: fix delta only, each item verified against my original finding by reading the current source region + independent greps.

**Verdict: CLEAN — all 4 findings RESOLVED, 0 new issues, delta in bounds.**

### M1 — retro `global` whitelist → RESOLVED
`retro/SKILL.md.tmpl:51` validation sentence now reads "…a number followed by `d`, `h`, or `w`, or the word `compare` (optionally followed by a window)…" — the `global` clause is gone, and the usage block already lists no `global`. `/retro global` now fails validation and prints usage + stops, instead of silently defaulting to a 7d repo retro. `compare` still both whitelisted and handled — no new dead branch. Grep for `global` across `retro/SKILL.md.tmpl` + generated `retro/SKILL.md` = 0.

### M2 — plan-* consume removed dashboard fields → RESOLVED (decision trees stay self-coherent)
All three Next Steps sections now open with "Use the dashboard to see which reviews have already been run this session" (session-based, matches the neutralized `generateReviewDashboard`). Both dead field references are genericized consistently:
- `skip_eng_review` config → "unless the user opted out of eng review this session" (ceo/design) / "the user opted out of eng review this session" (eng).
- commit-hash staleness → "if the plan has changed substantially since".

Decision-tree self-coherence verified end-to-end: eng-review still gates design/ceo suggestions on "no design/CEO review exists"; ceo-review recommends eng-first-then-design; design-review recommends eng-unless-opted-out plus selective ceo. No clause references a dashboard field the generator no longer emits. `skip_eng_review` and `commit hash shows` grep to 0 across sources + generated.

### m1 — `GStack recommends` in ship → RESOLVED
`ship/SKILL.md.tmpl:296` now "We recommend maintaining a TODOS.md…". Grep `GStack recommends` = 0. Only surviving `GStack` product-voice string eliminated.

### m2 — `~/.gstack-dev/evals/` private-harness paths → RESOLVED (skip semantics complete)
- `land-and-deploy/SKILL.md.tmpl` Step 3.5a: both the E2E and LLM-judge `ls` reads now use a `<eval-output-dir>` placeholder gated on the project declaring an eval-output location. Skip semantics are complete for **both** sub-blocks: E2E → "If the project declares no eval-output location, skip this sub-step."; LLM-judge → "If not found or not declared, note 'No LLM evals run today.'" No unguarded read remains.
- `docs/ARCHITECTURE.md:312,331,341`: `~/.gstack-dev/` → `~/.openspec-dev/`, consistent with the D5 `~/.gstack`→`~/.openspec` state-dir convention; no source code references the `gstack-dev` path, so docs stay in sync. `.gstack-dev` greps to 0.

### Independent verification (read-only)
- Residue greps (sources + generated, excl. gstack-upgrade/browse-test): `GStack recommends`, `.gstack-dev`, `skip_eng_review`, `commit hash shows`, `global (optionally`, `garrytan`, `Garry Tan` → all **0**.
- `bun run skill:check` → **EXIT 0** (all SKILL.md FRESH — fixed sources render to committed generated files).
- Scope: 38 tracked-file changes total (round-0 37 + `docs/ARCHITECTURE.md`); nothing modified outside `skills/gstack/` + `scripts/gen-skill-docs.ts`. No out-of-bounds edits.
