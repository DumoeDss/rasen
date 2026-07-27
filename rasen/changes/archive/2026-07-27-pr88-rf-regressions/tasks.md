# Tasks — pr88-rf-regressions

Fix merge-resolution regressions B2, M3, M4. Each task names the exact
file, the first-parent semantics to restore, and the test that proves it.

---

## B2 — run-state.ts completedStages() excludes delegated

- [ ] 1. **Restore first-parent `completedStages()` body and doc comment**
  in `src/core/pipeline-registry/run-state.ts` (current lines 576-590).
  - Remove `|| s.status === 'delegated'` from the filter so the body is
    `.filter(([, s]) => s.status === 'done' || s.status === 'skipped')`.
  - Restore the doc comment to the first-parent text:
    "Stages that count as completed for resume purposes: when `stages` is
    present, those with status done|skipped; otherwise the `completed`
    convenience array. `delegated` is NOT completed — work handed to
    children is outstanding until the children finish it, so a decomposed
    parent's stage list can never on its own leave delivery as the only
    thing remaining."
  - Do NOT change the `StageStatusSchema` enum ordering — the reorder is
    cosmetic and not a regression.

- [ ] 2. **Confirm existing test passes**
  `test/commands/pipeline.test.ts:2446-2475` ("counts delegated stages as
  outstanding..."). After the fix: `completed=[]`, `next='propose'`,
  `remaining` contains `propose`, `ready`/`next` NOT `ship`.
  Run: `pnpm vitest run test/commands/pipeline.test.ts -t "counts delegated"`

- [ ] 3. **Add "portfolio record corrupt + delegated stages" test**
  in `test/commands/pipeline.test.ts` within the resume-portfolio describe
  block (near the existing `portfolio-unreadable` test at line 2405).
  Scenario: a parent change directory contains `auto-run.json` with all
  stages `delegated` AND a `portfolio-run.json` with invalid JSON
  (`{ not valid json`). Expect:
  - `json.invalidPortfolioState === true`
  - `json.portfolioStatePath` contains `portfolio-run.json`
  - `json.note` contains `could not be read`
  - `json.next` is null, `json.ready === []`, `json.remaining === []`
  - `json.pipeline` is undefined (no fallthrough to stage-based resume)
  This proves delegated stages + corrupt portfolio does NOT offer delivery.

## M3 — init.ts reconcileLearnedSkills mirrors update.ts

- [ ] 4. **Restore imports** in `src/core/init.ts` (current lines 62-74).
  Add back the three imports the merge removed:
  - `EffectiveLearnedSkillPlanningError` alongside
    `resolveEffectiveLearnedSkillPlan` in the `./learned-skills/index.js`
    import (keep `type EffectiveLearnedSkillPlan` too).
  - `collectProjectLearnedStores` from
    `./project-learned-skill-ledger.js`.
  - `learnedMaterializationReport` from
    `./learned-materialization-locale.js`.

- [ ] 5. **Restore `reconcileLearnedSkills` method** in
  `src/core/init.ts` (current lines 852-897) to mirror
  `src/core/update.ts:774-833`:
  - Outer try wraps plan resolution + per-tool loop; outer catch pushes
    `{ code: error instanceof EffectiveLearnedSkillPlanningError ? error.code : 'effective_plan_failed', message, ...(repair when available) }`
    to `aggregate.errors` (NOT a bare `catch { return aggregate; }`).
  - Inner try wraps per-tool reconcile; inner catch pushes
    `{ code: 'tool_reconcile_failed', message: \`${tool.name}: ${error.message}\` }`
    to `aggregate.errors` (NOT a bare `catch {}`).
  - Restore `previousStores` argument in `resolveEffectiveLearnedSkillPlan`:
    `execution.owner.type === 'project' ? collectProjectLearnedStores(execution.evaluationRoot ?? projectPath) : []`.
  - Restore `globalDataDir` propagation in
    `reconcileGlobalLearnedSkillsForTool`:
    `...(execution.globalDataDir ? { globalDataDir: execution.globalDataDir } : {})`.
  - Keep init.ts's per-tool iteration shape (it receives the full tool
    object array, not just IDs; the lookup `AI_TOOLS.find(...)` stays).

- [ ] 6. **Restore display block** in `src/core/init.ts` (current lines
  1164-1173):
  - Gate: `if (learnedReconcileHasActivity(learned) || learned.noOp)`.
  - Replace the `for (const skip of learned.skipped)` loop with:
    `for (const line of learnedMaterializationReport(learned)) {
       console.log(line.tone === 'warn' ? chalk.yellow(\`  ⚠ \${line.text}\`) : chalk.dim(line.text));
     }`
  - Keep the `materialized` count line above it.

- [ ] 7. **Add merge-regression test** in
  `test/core/init-update-learned.test.ts`:
  - Mock `resolveEffectiveLearnedSkillPlan` to throw an
    `EffectiveLearnedSkillPlanningError` with a known message + repair.
  - Run `new InitCommand({ tools: 'claude', force: true }).execute(testDir)`.
  - Assert the console output contains the error message (not empty).
  - Parallel: run `new UpdateCommand(...)` with the same mock and assert
    the SAME message appears — proving init and update report identically.
  - Use `vi.mock` to replace `resolveEffectiveLearnedSkillPlan` and
    restore via `vi.restoreAllMocks()` in afterEach.

## M4 — portfolio-state.ts normalizes out-of-enum to unknown

- [ ] 8. **Restore `'unknown'` in PortfolioChildStatusSchema** in
  `src/core/pipeline-registry/portfolio-state.ts` (current lines 27-33).
  Add `'unknown'` as the last enum member.
  `PortfolioDeliveryStatusSchema` inherits via `= PortfolioChildStatusSchema`
  so it gains `'unknown'` automatically — no separate change needed.

- [ ] 9. **Restore `normalizeChildStatusRaw` to set `'unknown'`** in
  `src/core/pipeline-registry/portfolio-state.ts` (current lines 117-126).
  Change `child.status = 'pending'` to `child.status = 'unknown'`.
  Restore the doc comment to explain:
  - `unknown` is the normalized landing place for unrecognized status.
  - It is non-terminal (does not satisfy `isSatisfied`).
  - It is NOT runnable (excluded from `runnableChildren`'s `pending` filter).
  - The raw value is preserved in `statusRaw` so drift is visible.

- [ ] 10. **Confirm existing test passes**
  `test/commands/pipeline.test.ts:2361-2403` ("still resolves as a
  portfolio when a child carries an out-of-enum status..."). After the
  fix: `drifted.status === 'unknown'`, `drifted.statusRaw === 'propose-done'`,
  clean children have `statusRaw` undefined.
  Run: `pnpm vitest run test/commands/pipeline.test.ts -t "out-of-enum"`

## Verification cluster

- [ ] 11. **Run the focused pipeline test file**
  `pnpm vitest run test/commands/pipeline.test.ts`
  Both pre-existing failures (lines 2361 and 2446) now pass, plus the new
  corrupt-portfolio test. No new failures in this file.

- [ ] 12. **Run the init-update-learned test file**
  `pnpm vitest run test/core/init-update-learned.test.ts`
  Existing tests still pass; the new merge-regression test passes.

- [ ] 13. **TypeScript build check**
  `pnpm build` — confirms the restored imports resolve and types align.

- [ ] 14. **Lint check**
  `pnpm run lint` — confirms no lint regressions from the changes.
