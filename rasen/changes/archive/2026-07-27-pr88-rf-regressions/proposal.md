# Proposal — pr88-rf-regressions

Restore three first-parent semantics that the merge commit `a884f5e4`
("merge dev/0.1.5 into integration: resolve 13 conflicts") re-introduced
when resolving conflicts. Each is a pure code-behavior restoration; no
canonical spec requirement changes. Two pre-existing focused tests
(stable, reproducible) will pass once the fix lands; three new tests
cover the merge-regression surface.

Parent: `rasen/changes/pr88-review-fixes/planning-context.md` (C3).

---

## B2 (Blocker) — `completedStages()` must exclude `delegated`

### Defect
`src/core/pipeline-registry/run-state.ts:582-590` `completedStages()`
filters with `s.status === 'done' || s.status === 'skipped' || s.status === 'delegated'`.
The merge resolution re-added `delegated` to the completion set and rewrote
the doc comment to claim "delegated is terminal at the parent stage because
the portfolio children own that work" — the opposite of the first parent's
semantics.

### First-parent semantics (confirmed via `git show HEAD^1`)
The first parent's `completedStages()` body was:
```
.filter(([, s]) => s.status === 'done' || s.status === 'skipped')
```
with the doc comment:
> `delegated` is NOT completed — work handed to children is outstanding
> until the children finish it, so a decomposed parent's stage list can
> never on its own leave delivery as the only thing remaining.

### Why it matters
A parent whose stages are all `delegated` (work handed to portfolio
children) now reports `completed = ['propose','apply','verify']`, leaving
`ship`/delivery as the apparent frontier — exactly the "paused portfolio
offered ship" defect the first parent removed. Whether delegated work is
actually finished is derivable from portfolio child durable state, NOT from
the parent's stage list alone.

### Fix
Restore the first-parent body and doc comment in `completedStages()`:
remove `|| s.status === 'delegated'` from the filter. `delegated` stages
count as OUTSTANDING for normal resume.

### Test that now passes
`test/commands/pipeline.test.ts:2446-2475` — "counts delegated stages as
outstanding and does not offer delivery, with no portfolio record":
a parent with `propose/apply/verify` all `delegated` and no
`portfolio-run.json` now yields `completed=[]`, `next='propose'`,
`ready`/`next` NOT containing `ship`.

### New test
"portfolio record missing/corrupt with delegated stages": a parent with
delegated stages AND a corrupt `portfolio-run.json` reports the invalid
portfolio (path + reason) and does not fall through to a stage-based
resume that could offer delivery.

---

## M3 — `init.ts` `reconcileLearnedSkills()` must mirror `update.ts`

### Defect
`src/core/init.ts:852-897` swallows ALL exceptions from plan resolution
and per-tool reconcile (two bare `catch {}` blocks with no error push).
It also dropped the `previousStores` argument to
`resolveEffectiveLearnedSkillPlan` and the `execution.globalDataDir`
propagation to `reconcileGlobalLearnedSkillsForTool`. The display block
at `init.ts:1164-1173` was simplified to print only `learned.skipped`,
dropping the structured `learnedMaterializationReport` that reports
migrations, conflicts, unavailable stores, deferred items, and errors.

### First-parent semantics (confirmed via `git show HEAD^1` + `update.ts:774-833`)
The first parent's `reconcileLearnedSkills`:
1. Wrapped the plan resolution + per-tool loop in ONE outer try/catch
   that pushed `effective_plan_failed` (with `repair` when available) to
   `aggregate.errors` — REPORTING failures, not swallowing them.
2. Wrapped each per-tool reconcile in an inner try/catch that pushed
   `tool_reconcile_failed` to `aggregate.errors`.
3. Passed `previousStores` to `resolveEffectiveLearnedSkillPlan`:
   `execution.owner.type === 'project' ? collectProjectLearnedStores(execution.evaluationRoot ?? projectPath) : []`.
4. Threaded `execution.globalDataDir` into `reconcileGlobalLearnedSkillsForTool`.
5. Displayed via `learnedMaterializationReport(learned)` (the same helper
   `update.ts` uses), gated on `learnedReconcileHasActivity(learned) || learned.noOp`.

### Why it matters
- Swallowed errors: a user debugging a missing skill gets no explanation
  from `rasen init` (while `rasen update` correctly reports the same
  failure). Violates "the result SHALL report what was written, what was
  left alone, and anything deferred or blocked" (learned-skill-effective-
  materialization spec, Requirement: "The knowledge a project receives").
- Missing `previousStores`: Stores that previously owned records but are
  not currently declared may not be considered, risking "treat as absent"
  instead of "report as unavailable" (same spec, Requirement: "A Store is
  relevant to a project when... a previous ownership record names it as a
  source").
- Missing `globalDataDir`: global-scope reconciliation may write to the
  wrong data directory.

### Fix
Mirror `src/core/update.ts:774-833` structure exactly:
1. Restore imports: `EffectiveLearnedSkillPlanningError`,
   `collectProjectLearnedStores`, `learnedMaterializationReport`.
2. In `reconcileLearnedSkills`: restore the outer try/catch that reports
   `effective_plan_failed` with repair info; restore the inner try/catch
   that reports `tool_reconcile_failed`; restore `previousStores` and
   `globalDataDir` propagation.
3. In the display block: restore `|| learned.noOp` and replace the raw
   `learned.skipped` loop with `learnedMaterializationReport(learned)`.

### New test
Merge regression test in `test/core/init-update-learned.test.ts`:
when `resolveEffectiveLearnedSkillPlan` throws an
`EffectiveLearnedSkillPlanningError`, `InitCommand.execute` produces
output containing the error message (not silently empty), matching
`UpdateCommand`'s behavior for the same failure.

---

## M4 — Portfolio child out-of-enum status must normalize to `unknown`, not `pending`

### Defect
`src/core/pipeline-registry/portfolio-state.ts:27-33` removed `'unknown'`
from `PortfolioChildStatusSchema`. `normalizeChildStatusRaw` (lines 117-126)
sets `child.status = 'pending'` for unrecognized values. The first parent
set it to `'unknown'` and had `'unknown'` in the enum.

### First-parent semantics (confirmed via `git diff HEAD^1..HEAD`)
The first parent's enum:
```
['pending', 'in_progress', 'proposed', 'done', 'skipped', 'escalated', 'unknown']
```
The first parent's normalizer set `child.status = 'unknown'` and preserved
the raw value in `child.statusRaw`.

### Why it matters
Setting an unrecognized status to `'pending'` makes an unknown-status child
appear in `runnableChildren` (which filters `c.status === 'pending'`),
offering it as "start fresh" — dangerous for a child whose actual state is
unknown. `'unknown'` is non-terminal but NOT runnable: it appears in
`remainingChildren` only, flagging it for human attention. This also
violates the "drift is visible" guarantee: the whole point of `statusRaw`
is to surface unrecognized values, not to disguise them as the most
actionable terminal-adjacent state.

### Fix
1. Add `'unknown'` back to `PortfolioChildStatusSchema`.
2. Change `child.status = 'pending'` to `child.status = 'unknown'` in
   `normalizeChildStatusRaw`.
3. Restore the doc comment explaining `unknown` as the normalized landing
   place for unrecognized status (non-terminal, NOT runnable, drift
   visible via `statusRaw`).

### Test that now passes
`test/commands/pipeline.test.ts:2361-2403` — "still resolves as a portfolio
when a child carries an out-of-enum status, and offers no delivery":
a child with `status: 'propose-done'` now yields `status='unknown'` and
`statusRaw='propose-done'`.

---

## Scope boundaries
- These three fixes are PURE code-behavior restorations. No canonical spec
  requirement changes. The relevant semantics live in code comments and
  function bodies, not in `rasen/specs/**`.
- The merge's intentional additions (PortfolioDeliverySchema, delivery
  field, dependsOn/prerequisites migration in normalizePortfolioStateJson,
  RunStateDispatchMode/inferWorkerDispatchMode, initializeRunState,
  pointer-tool-only selection) are NOT regressions and are left in place.
- Init.ts intentional changes (pointerToolOnlySelection flow) are NOT
  regressions and are left in place.
