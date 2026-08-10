# Ship Log: teacher-advisor-workflow

**Date:** 2026-08-10
**Mode:** local
**Branch:** feat/teacher-advisor-workflow
**Commit:** 3899aa893a1a264027625e0482893e6c11abab78
**Tree:** 9ba81cf68d32dc027f7a7f835dce91878c19dc3e
**Status:** Committed (delivery deferred to portfolio level)

The commit and tree above are the exact product delivery commit. This log is
carried by a follow-up evidence-only commit so that its recorded product SHA
and tree are exact and non-self-referential. No push, pull request, or archive
was performed for this child change; per portfolio rules children ship local
and the portfolio delivers once at the parent level.

## Pre-Flight Results

- Verification: passed. Independent non-author review (Claude Code subagent,
  fresh context) returned CLEAN; see `evidence/review-report.md`.
- Tasks: 27/27 complete.
- Branch: attached `feat/teacher-advisor-workflow` at the product commit
  `3899aa89` (on top of the integration merge `c7221341`).
- Archive timing: deferred to the portfolio archive step.

## Staged Scope

- Product commit: 13 paths — pipeline YAML consultation schema
  (`pipeline-registry/types.ts`), profile resolver consultation wiring
  (`pipeline-registry/profile-resolver.ts`, `prepared-execution-view.ts`),
  launch threading (`commands/pipeline.ts`), Teacher Advisor skill template
  (`templates/experts/teacher-advisor.ts` + barrel re-exports), expert
  registration (`workflow-registry/experts.ts`), sidecar
  (`skills/experts/teacher-advisor/contracts.md`), and focused tests
  (`teacher-advisor-workflow.test.ts`, `builtins.test.ts`,
  `builtins-v1.json`).
- Evidence follow-up: only this `evidence/ship-log.md`.
- Excluded: `.rasen/**`, `rasen/changes/teacher-advisor-consultation/**`,
  `rasen/changes/teacher-consultation-canvas/**`.

## Test Gate

Commands and results (independently re-run by the reviewer):

- `pnpm exec vitest run test/core/pipeline-registry/ test/core/workflow-registry/ --reporter=dot` — 691 passed, 1 skipped, 34 files (no regression).
- `pnpm exec vitest run test/core/pipeline-registry/teacher-advisor-workflow.test.ts test/core/workflow-registry/builtins.test.ts` — 30 passed, 2 files.
- `pnpm exec tsc --noEmit` — clean.
- `node ./bin/rasen.js validate teacher-advisor-workflow --strict --json` — `valid: true`, 0 issues.
- `git diff --check` — clean (no trailing whitespace or BOM introduced).

Tree: `9ba81cf68d32dc027f7a7f835dce91878c19dc3e`.

## Accepted-known findings (non-blocking)

- Minor-1: the `superRefine` `kind === 'standard'` filter branch in
  `types.ts` is not exercised by a dedicated test (the existing test uses a
  nonexistent stage id). The invalid binding is still rejected downstream at
  `findSourceStageNodeId`, less gracefully.
- Nit-1: the secondary sort by `teacherProfilePath` in `profile-resolver.ts`
  is dead for valid inputs (the runtime rejects duplicate source paths).

## Notes for downstream children

- Task 3.1/3.2 deviated from literal text: the Teacher Advisor is registered
  via `getExpertSkillDefinitions()` in `experts.ts` (not `BUILT_IN_ADAPTERS` /
  `BUILT_IN_WORKFLOW_IDS`), matching how all experts register and satisfying
  the existing assertion that experts must not appear in BUILT_IN_WORKFLOW_IDS.
- The runtime requires BOTH a Teacher capability binding AND a Teacher policy
  stage; the resolver synthesizes both.
- A consultation source stage must have `sessionReuse: 'same-invocation'` or
  profile sealing fails.

## Delivery

Status: committed locally. Delivery is deferred to the portfolio/parent level.

## Archive
**Date:** 2026-08-10T11:50:27.573Z
**Ship commit:** 3899aa893a1a264027625e0482893e6c11abab78
**Outcome:** archived at E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-teacher-advisor\rasen\changes\archive\2026-08-10-teacher-advisor-workflow
**Transaction:** 6acd2d1c-5e1b-4ee8-923e-d95f68ac1592
