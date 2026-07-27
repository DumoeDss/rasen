# Review Report — pr88-rf-regressions

**Reviewer**: adversarial code reviewer (verify stage, author != verifier)
**Worktree**: `E:\...\OpenSpec-code-pr88-review` @ `ec28f743` (HEAD; merge commit `a884f5e4` is HEAD~1)
**Date**: 2026-07-27
**Scope**: B2, M3, M4 — restore first-parent (integration side `a884f5e4^1` = `4d05fd77`) semantics lost in merge `a884f5e4` ("merge dev/0.1.5 into integration")

## Verdict: clean (2 Minor documentation findings)

The code-behavior restorations are correct and complete. Both Minor findings are stale doc comments that contradict the restored behavior — worth fixing but not blocking.

## Findings

### Minor 1 — `normalizeChildStatusRaw` doc comment says `pending`, code does `unknown`
- **File:line**: `src/core/pipeline-registry/portfolio-state.ts:118-125`
- **Failure scenario**: The function's own doc comment states "defaulting the typed `status` field to `pending`", but the M4 fix (line 134) correctly sets `child.status = 'unknown'`. A reader debugging portfolio status normalization will be misled by the comment into thinking unknown values degrade to the runnable `pending` state, which is exactly the misbehavior M4 removes.
- **Fix**: Replace "to `pending`" with "to `unknown`" in the doc comment at line 120. The enum-level doc comment (lines 26-34) already explains `unknown` correctly; the function-level comment should agree with it.

### Minor 2 — Orphaned doc comment above `normalizeChildStatusRaw`
- **File:line**: `src/core/pipeline-registry/portfolio-state.ts:113-117`
- **Failure scenario**: The doc comment "Normalize the raw portfolio-state JSON's `planner` record before validation (design D1)..." was originally for `normalizePortfolioStateJson` (now at line 137), but now sits orphaned above `normalizeChildStatusRaw`. Two adjacent doc-comment blocks (113-117 and 118-125) precede the same function, which is confusing. `normalizePortfolioStateJson` at line 137 has no doc comment of its own.
- **Fix**: Move the 113-117 block back above `normalizePortfolioStateJson` (line 137), or delete the orphan.

## Per-fix verification

### B2 (Blocker) — run-state.ts `completedStages()` — CORRECT
- Confirmed against the true first parent of the merge: `git show a884f5e4^1:src/core/pipeline-registry/run-state.ts` (integration side, line 459) had filter `s.status === 'done' || s.status === 'skipped'` with the doc comment "`delegated` is NOT completed".
- The merge picked the dev/0.1.5 side (`a884f5e4^2`), which included `|| s.status === 'delegated'`.
- The fix restores the integration-side body and doc comment exactly.
- A normal resume with all stages `delegated` now yields `completed=[]` and does NOT offer `ship` — verified by the "counts delegated stages as outstanding" test (line 2453) and the new corrupt-portfolio regression guard (line 2485). Both pass.

### M3 — init.ts `reconcileLearnedSkills` — CORRECT
- Confirmed against `a884f5e4^1:src/core/init.ts` and `src/core/update.ts:774-833` (current): the fix mirrors update.ts structure exactly — single outer try with `effective_plan_failed` (and `repair` when available), inner try with `tool_reconcile_failed`, `previousStores` argument restored via `collectProjectLearnedStores`, `execution.globalDataDir` propagated, `const plan` inside the try (not hoisted `let`).
- The display block at line 1186 restores `learnedMaterializationReport(learned)` and the `|| learned.noOp` gate.
- All three imports resolve: `EffectiveLearnedSkillPlanningError` (from `./learned-skills/index.js`, re-exported from `effective.ts:178`), `collectProjectLearnedStores` (from `./project-learned-skill-ledger.js:354`), `learnedMaterializationReport` (from `./learned-materialization-locale.js:45`).
- The M3 merge-regression test mocks `resolveEffectiveLearnedSkillPlan` to throw an `EffectiveLearnedSkillPlanningError`, runs both `InitCommand` and `UpdateCommand`, and asserts both outputs contain the error message. Both pass.

### M4 — portfolio-state.ts out-of-enum normalization — CORRECT
- `'unknown'` is back in `PortfolioChildStatusSchema` (line 41).
- `normalizeChildStatusRaw` sets `child.status = 'unknown'` for unrecognized values (line 134), preserving the raw value in `statusRaw`.
- `runnableChildren` (which filters `c.status === 'pending'`) does NOT surface `'unknown'` children as startable.
- The "still resolves as a portfolio when a child carries an out-of-enum status" test (line 2371) passes: drifted child gets `status='unknown'`, `statusRaw='propose-done'`.

### Pipeline.ts delivery-gating deviation — CORRECT first-parent restoration
The deviation is a correct restoration, not an over-reach.

**(a) Incomplete children → delivery fields absent (undefined)**:
The spread `...(childrenComplete ? { childrenComplete, delivery, next, remaining } : {})` omits the keys entirely when children are incomplete. Before the fix, `next` was `null` and `remaining` was `['portfolio-delivery']` (because `deliveryTerminal` does not depend on `childrenComplete`). The M4 test at line 2404-2406 asserts `json.next === undefined`, `json.remaining === undefined`, `json.ready === undefined` — these pass because the gating removes the keys.

**(b) Complete portfolio → delivery preserved**:
The "resumes portfolio-level delivery after every child has completed" test (line 2283) asserts `childrenComplete: true`, `delivery: { status: 'pending' }`, `next: 'portfolio-delivery'`, `remaining: ['portfolio-delivery']`. These pass because the gating includes the keys when `childrenComplete` is true.

**Assessment**: the first parent (integration side) did NOT have the delivery feature in the portfolio resume output at all — no `childrenComplete`, `delivery`, `next`, or `remaining` keys. The dev/0.1.5 side added the delivery feature and surfaced it unconditionally; the merge kept that. The fix's gating is the correct middle ground: it preserves the intentional delivery feature for complete portfolios while restoring the first-parent guarantee that a portfolio with outstanding children never frames delivery as the frontier. The `portfolioDelivery`/`nextStage` text output is likewise gated on `childrenComplete`.

### Open question — `isPortfolioComplete` requires delivery terminal — CONSISTENT, NOT A LATENT ISSUE
The first parent's `isPortfolioComplete` checked only children because the delivery feature did not exist on the integration side. The dev/0.1.5 side added `PortfolioDeliverySchema`, the `delivery` field, and the one-time parent delivery step. Requiring `state.delivery.status === 'done' || state.delivery.status === 'skipped'` in `isPortfolioComplete` is a necessary and intentional consequence: a portfolio with all children done but delivery still pending is NOT complete — there is a delivery step yet to run. The proposal's scope boundaries explicitly list `PortfolioDeliverySchema`/`delivery` as intentional non-regressions. The `portfolio-finished` test was correctly updated to include `delivery: { status: 'done' }` so `isPortfolioComplete` returns true.

### `'proposed'` enum member not restored — ACCEPTABLE
The first-parent enum had `['pending', 'in_progress', 'proposed', 'done', 'skipped', 'escalated', 'unknown']`. The fix restores all members except `'proposed'`. A codebase-wide grep shows `'proposed'` is never used as a child status value, never compared against, and never set anywhere. It was dead vocabulary in the first parent. Not restoring it has no behavioral impact. Acceptable.

### Updated existing tests — MEANINGFUL, NOT WEAKENED
1. **invalid-portfolio test** (line 2231): changed from `status: 'propose-done'` to `status: 'done', prerequisites: 'not-an-array'`. Necessary because M4 now tolerates out-of-enum statuses (they normalize to `unknown`); the test needed a different kind of genuine invalidity to keep exercising the invalid-portfolio reporting path. The assertion changed from `note` contains `'propose-done'` to `note` contains `'prerequisites'` — still a meaningful end-to-end check of the invalid-portfolio path.
2. **portfolio-unreadable test** (line 2440): `expect(json.pipeline).toBeUndefined()` → `expect(json.pipeline).toBeNull()`. More precise, not weaker — the code at line 631 explicitly sets `pipeline: null`.
3. **portfolio-finished test** (line 2554): added `delivery: { status: 'done' }`. Necessary because `isPortfolioComplete` now (intentionally) requires delivery terminal. The test still asserts `json.complete === true`.

## Scope check — clean

This child touched exactly its assigned files and nothing else:

| File | Scope |
|---|---|
| `src/core/pipeline-registry/run-state.ts` | B2 ✓ |
| `src/core/pipeline-registry/portfolio-state.ts` | M4 ✓ |
| `src/core/init.ts` | M3 ✓ |
| `src/commands/pipeline.ts` | delivery gating ✓ |
| `test/commands/pipeline.test.ts` | B2/M4 tests ✓ |
| `test/core/init-update-learned.test.ts` | M3 test ✓ |

No touches to C1 (`bootstrap.ts`, `operations.ts`, `foundation.ts`) or C2 (`file-state.ts`, `import.ts`, `membership.ts`, `project-config.ts`) files.

## Independent verification

| Check | Result |
|---|---|
| `pnpm vitest run test/commands/pipeline.test.ts` | **88/88 passed** (309.7s) |
| `pnpm vitest run test/core/init-update-learned.test.ts` | **5/5 passed** (17.5s) |
| `pnpm exec tsc --noEmit` | **PASS** (no output) |

Key tests confirmed green:
- "still resolves as a portfolio when a child carries an out-of-enum status, and offers no delivery" (M4)
- "counts delegated stages as outstanding and does not offer delivery, with no portfolio record" (B2)
- "reports an invalid portfolio and offers no delivery when delegated stages meet a corrupt portfolio record" (new B2 guard)
- "resumes portfolio-level delivery after every child has completed" (delivery-feature preserved)
- "init and update both report a learned-skill planning failure (M3 merge regression)"
