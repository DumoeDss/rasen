## 1. Match the existing workflow-template shape

- [ ] 1.1 Read `src/core/templates/workflows/ship.ts` and `src/core/templates/workflows/verify-enhanced.ts` to mirror the file shape (module doc comment, `INSTRUCTIONS` const, `getXxxSkillTemplate()` + `getOpsxXxxCommandTemplate()` exports)
- [ ] 1.2 Read `src/core/templates/types.ts` to confirm the `SkillTemplate` and `CommandTemplate` field contracts
- [ ] 1.3 Read `skills/gstack/review/SKILL.md` to confirm how the review engine is invoked, so `review-cycle` delegates to it rather than reimplementing review logic
- [ ] 1.4 Read `src/core/profiles.ts` and `src/core/shared/skill-generation.ts` to confirm `ALL_WORKFLOWS` vs `CORE_WORKFLOWS` and the two registry functions

## 2. Create the review-cycle workflow template

- [ ] 2.1 Create `src/core/templates/workflows/review-cycle.ts` with a `REVIEW_CYCLE_INSTRUCTIONS` const
- [ ] 2.2 Export `getReviewCycleSkillTemplate(): SkillTemplate` — `name: 'openspec-review-cycle'`, description, instructions, license/compatibility/metadata matching the other workflow templates
- [ ] 2.3 Export `getOpsxReviewCycleCommandTemplate(): CommandTemplate` — `name: 'OPSX: Review Cycle'`, Workflow category, appropriate tags, same `content`
- [ ] 2.4 Instruction content MUST cover: the iterative `review → triage → fix → re-review(Δ) → {pass | loop | escalate}` loop; delegating each pass to `openspec-gstack-review`; the author≠verifier invariant (incl. the trivial-fix gate-run + diff-read equivalent and that it MUST be recorded); fix-size triage (trivial=orchestrator / non-trivial=implementing agent / design-level=separate fix agent); the Claude agent-teams resume path via `SendMessage` (lead-only) AND the mandatory tool-agnostic fresh-delta-review fallback via a shared findings file; max-rounds termination (default 3) with escalation to the human on unresolved Blocker/Major findings (never silently pass)

## 3. Re-export from skill-templates.ts

- [ ] 3.1 Add `export { getReviewCycleSkillTemplate, getOpsxReviewCycleCommandTemplate } from './workflows/review-cycle.js';` to `src/core/templates/skill-templates.ts`

## 4. Register in skill-generation.ts

- [ ] 4.1 Import `getReviewCycleSkillTemplate` and `getOpsxReviewCycleCommandTemplate` in `src/core/shared/skill-generation.ts`
- [ ] 4.2 Add `{ template: getReviewCycleSkillTemplate(), dirName: 'openspec-review-cycle', workflowId: 'review-cycle' }` to the `workflowSkills` array in `getSkillTemplates()`
- [ ] 4.3 Add `{ template: getOpsxReviewCycleCommandTemplate(), id: 'review-cycle' }` to the array in `getCommandTemplates()`

## 5. Add to profiles.ts ALL_WORKFLOWS

- [ ] 5.1 Add `'review-cycle'` to the `ALL_WORKFLOWS` tuple in `src/core/profiles.ts` (do NOT add to `CORE_WORKFLOWS`)

## 6. Tests

- [ ] 6.1 Create `test/commands/review-cycle.test.ts`: generation includes `review-cycle` skill + command for the `claude` tool
- [ ] 6.2 Assert `review-cycle` is ABSENT when generating under the `core` profile (present only in the expanded/opt-in set)
- [ ] 6.3 Assert the generated instruction text contains the author≠verifier rule
- [ ] 6.4 Assert the instruction text contains the max-rounds/escalation rule (cap → escalate, never silently pass)
- [ ] 6.5 Assert the instruction text contains BOTH the Claude `SendMessage` resume path AND the tool-agnostic fresh-review fallback
- [ ] 6.6 Add corresponding assertions to the existing skill-generation and profile tests (registry includes the new entry; `ALL_WORKFLOWS` contains `review-cycle`, `CORE_WORKFLOWS` does not)

## 7. Build, test, lint

- [ ] 7.1 Run `pnpm build` (or `npm run build`) and confirm TypeScript compiles
- [ ] 7.2 Run `pnpm test` (or `npm test`) and confirm all tests pass, including the new ones
- [ ] 7.3 Run `pnpm lint` (or `npm run lint`) and fix any issues

## 8. Docs

- [ ] 8.1 Update `docs/commands.md` with `/opsx:review-cycle`
- [ ] 8.2 Update `docs/workflows.md` describing the review-cycle loop, triage, invariant, and termination
- [ ] 8.3 Mirror the doc updates in `docs/zh/` (commands + workflows)
