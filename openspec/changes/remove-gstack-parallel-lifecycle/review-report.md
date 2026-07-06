# Review Report — remove-gstack-parallel-lifecycle

**Reviewer:** independent verifier (did not author the code)
**Date:** 2026-07-07
**Branch:** dev-harness
**Scope:** uncommitted working-tree diff (~56 tracked files + change artifacts)

## Verdict

**APPROVE.** The change is a faithful, complete removal of the ten gstack parallel-lifecycle
experts with a correct absorb-then-remove of `/ship` and `/retro` into the OPSX workflow
templates. All build/lint/spec gates pass. The only test failures are the pre-declared
Windows temp-dir/subprocess timeout flakes, which pass green when re-run in isolation. No
Blocker or Major findings. A few Trivial observations are recorded below; none needs to be
fixed before ship.

## Findings

### Blockers
None.

### Majors
None.

### Minors
None.

### Trivial

1. **[Trivial] `src/core/templates/workflows/ship.ts:87`** — the fresh-verification gate reads
   "If any code changed after step (c)'s test run — for example from review fixes in step (d)".
   Step (d) is now only "review the diff for obvious structural issues" and does not itself apply
   fixes (the gstack expert's Fix-First auto-fix loop was intentionally not absorbed). The gate is
   still a correct, harmless safety guard, but the "review fixes in step (d)" example is slightly
   vestigial. Suggested fix (optional): reword the example to "for example from a manual fix before
   push" or drop the parenthetical. Not blocking.

2. **[Trivial] `skills/gstack/SKILL.md.tmpl:9-12`** — the gstack index adjacent-skills description
   drops the "shipping" stage entirely when purging the removed `/ship`/`/document-release`/`/retro`
   pointers, whereas the planning/design stages were re-pointed to OPSX equivalents (`/opsx:propose`,
   etc.) elsewhere in the diff. Leaving shipping unlisted in the *expert-layer* catalog is defensible
   (shipping is now OPSX-only), so this is a consistency nit, not a defect. Optional: add
   "shipping /opsx:ship" for parity. Not blocking.

## Priority-scrutiny results

### 1. Absorption fidelity — PASS

**opsx:ship (`src/core/templates/workflows/ship.ts`) vs deleted `HEAD:skills/gstack/ship/SKILL.md.tmpl`:**
The load-bearing execution contract was faithfully distilled:
- Base-branch detection (PR base → repo default → `main`) — present (step a).
- Merge base branch BEFORE tests, STOP on unresolvable conflicts — present (step b), matches deleted Step 2.
- Run detected test command on merged code, STOP on in-branch failure — present (step c), matches deleted Step 3.
- Diff review for structural issues — present (step d) as a light scan; the heavy Fix-First checklist is delegated to the retained `/review` expert, not lost.
- Fresh-verification gate (re-run tests if code changed) — present (step e), matches deleted Step 6.5.
- `git push -u origin <branch>` (never force) — present (step f), matches deleted Step 7.
- `gh pr create --base <base>` with PR-body-from-proposal — present (step g), matches deleted Step 8.

Intended shop-ceremony correctly dropped per design D1: 4-digit VERSION bump (Step 4), CHANGELOG
auto-gen (Step 5), TODOS.md reconciliation (Step 5.5), eval tiers (Step 3.25), Greptile triage
(Step 3.75), bisectable-commit machinery (Step 6). The deleted expert's Step 8.5 auto-invoke of
`/document-release` is correctly replaced by the inline post-ship doc-sync instruction
(`ship.ts:146`), so opsx:ship references no removed skill. Header comment (`ship.ts:1-7`) no longer
names gstack `/ship` or `/land-and-deploy`. Exports `getShipCommandSkillTemplate` /
`getOpsxShipCommandTemplate` and `STORE_SELECTION_GUIDANCE` injection intact.

*Behavioral note (not a finding):* the deleted `/ship` was fully-automated and auto-committed
uncommitted work; opsx:ship's pre-flight instead requires a clean git status and prompts to
commit/stash. This is the pre-existing OPSX ship envelope (predates this change), not a regression
introduced by the absorption.

**opsx:retro (`src/core/templates/workflows/retro.ts`) vs deleted `HEAD:skills/gstack/retro/SKILL.md.tmpl`:**
General (2B) and global (2C) scopes now carry a self-contained git-analysis contract — commit/
author/LOC/hotspot/streak gathering, metrics table, per-author leaderboard — writing to OPSX's own
paths (general → `openspec/retro-latest.md`, global → `openspec/retro-global-latest.md`). The
gstack `.context/retros/*.json` snapshot/history machinery is explicitly excluded (retro.ts:80).
Change-scoped scope (2A) and both report structures are unchanged. Exports and STORE_SELECTION
injection intact. No `/retro` expert delegation remains.

### 2. Removal completeness — PASS

All ten experts (autoplan, plan-ceo-review, plan-eng-review, plan-design-review, land-and-deploy,
setup-deploy, canary, ship, retro, document-release) removed at all four wiring points:
`experts/<name>.ts` deleted, `experts/index.ts` export removed, `skill-templates.ts` re-export
removed, `skill-generation.ts` import + `getSkillTemplates()` roster entry removed. Ten
`skills/gstack/<name>/` source dirs deleted. Remaining expert roster is exactly 20. `pnpm build`
(tsc) compiles clean — no unresolved import/export.

### 3. Dangling references — PASS

Independent re-grep across `src/`, `skills/`, `docs/`, `scripts/` (excluding archive/):
- The 8 unambiguous removed names (autoplan, plan-ceo-review, plan-eng-review, plan-design-review,
  land-and-deploy, setup-deploy, canary, document-release): 0 hits.
- `/ship` / `/retro` expert-invocation/delegation patterns: 0 hits.
- Generated `skills/gstack/navigator/SKILL.md`: 0 hits of any removed name.
- ship.ts / retro.ts: 0 hits of removed-skill references.
Remaining bare `/ship` `/retro` occurrences are legitimate OPSX references (opsx:ship/opsx:retro
modules, output paths). `openspec/specs/` history hits are past-change scenario text (per task 7.5),
not live requirements — the one live `/autoplan` mandate is rewritten by the opsx-auto-command delta.

### 4. Collateral damage — PASS

All 20 kept experts regenerate (build GENERATED list) and skill:check reports FRESH for each. The
section-7 dead-pointer purges in kept-expert templates (review, benchmark, office-hours,
design-review, design-consultation, qa, qa-only, gstack index) and sidecars/docs are surgical: each
edit only removes/re-points a reference to a deleted skill (e.g. review.tmpl `/ship` → `/opsx:ship`;
benchmark "Same as /canary" → self-contained wording; office-hours next-step → `/opsx:propose`). No
live content was cut. `scripts/gen-skill-docs.ts` plan-status-footer and review-report tables
re-point `/plan-*-review` / `/autoplan` rows to OPSX equivalents (`/opsx:verify`,
`/opsx:verify-enhanced`, `/opsx:review-cycle`), keeping the Codex row. Navigator still routes the
retained set (main flow, on-ramps, vocabulary layer, standalone specialists).

### 5. Delta specs — accurate, no file corruption

Five deltas reviewed against the implementation:
- `remove-parallel-lifecycle-skills` (ADDED): matches wiring/source/skill-check/AGENTS/count/orphan/
  grep reality.
- `opsx-ship-command` (MODIFIED): merge-before-tests, stop-on-failure, fresh-verification gate,
  push+PR, inline doc-sync-not-delegated — all match ship.ts.
- `opsx-retro-command` (MODIFIED): three scopes, self-contained git analysis, no expert delegation
  — matches retro.ts.
- `navigator-router-skill` (MODIFIED): no Deploy/Plan family, no standalone `/retro` or
  `/document-release`, main-flow opsx:ship/opsx:retro retained — matches navigator tmpl + generated.
- `opsx-auto-command` (MODIFIED): rewrites the live `/autoplan` mandate to "SHALL NOT invoke a
  standalone /autoplan skill; planning from propose + pipeline-registry expert-review stages" —
  matches the auto template (grep-confirmed no /autoplan in auto.ts or pipeline-registry).

**Mojibake check:** scanned the actual file bytes of all five delta specs — no corrupted characters
(no `鈫`, no replacement chars, no stray CJK). The navigator and opsx-auto deltas contain proper
UTF-8 `→` (U+2192). The mojibake seen upstream was console-rendering only; the files are clean.

## Gate results

| Gate | Result |
|------|--------|
| `pnpm build` (tsc) | PASS — clean compile, 20 gstack docs regenerated |
| `bun run skill:check` | PASS — FRESH for all 20 generated SKILL.md |
| `openspec validate remove-gstack-parallel-lifecycle --strict --json` | PASS — 1/1 valid, 0 issues |
| `openspec config list` (pollution) | PASS — 18 workflows, no removed-skill residue |
| Install-side orphan check (`.claude/skills/`) | PASS — 0 orphans, 20 gstack dirs |
| Targeted tests (skill-generation, parity, profiles) | PASS — 53/53 (parity 6 unchanged, confirming design D3) |
| `pnpm test` (full suite) | PASS after isolation — only known Windows env flakes fail (see below) |
| Whole-repo dangling grep | PASS — clean (see Priority 3) |

**Full-suite flake detail (two runs + isolation — conclusive):**
- **Run 1:** 12 tests / 5 files failed, all `Test timed out in 10000ms`; the failing set included
  `test/commands/store-references.test.ts`.
- **Run 2 (fresh re-run):** only 2 tests / 2 files failed —
  `test/commands/context.test.ts` and `test/cli-e2e/capstone-journeys.test.ts` — both
  `Test timed out in 10000ms` + `EPERM, Permission denied` on `%TEMP%\openspec-*` dirs. In this run
  `store-references` **passed**.
- **Isolation re-runs (green):** `store-references.test.ts` → **8/8 PASS** (32s); `context.test.ts`
  + `capstone-journeys.test.ts` → **7/7 PASS** (16s).

The failure set is **non-deterministic across runs** and every failing file passes in isolation.
Combined with the temp-dir `EPERM`/10s-timeout signature (subprocess-spawning CLI e2e tests
starved under full-suite parallel load on Windows), these are exactly the pre-declared env flakes
in the task brief — not real failures, and not touched by this change (it removes skill templates
and wiring, no CLI/temp-dir code). The suite is effectively green.
