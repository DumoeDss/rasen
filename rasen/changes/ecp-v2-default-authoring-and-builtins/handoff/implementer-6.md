# Implementer 6 handoff: Round-3 cap remediation

## Result

All 43 non-local-version failures from the clean-root report are remediated;
the required 11-file aggregate passes **360/360**. The three local-version
failures were classified as shared TEMP/concurrency interference and pass
**7/7** twice under separate fresh dedicated `E:\` TEMP directories.

Detailed evidence:
`evidence/review-remediation-round-3.md`.

## Delivered boundaries

- Public profile roots/workflow suggestions are separate from effective
  install/execution closure. Pipeline capability owners remain installed and
  enabled, but internal dependency units never become picker choices,
  user-authored roots, or `nextWorkflows` suggestions.
- Native-v2 Gate nodes remain sole authored authority. Compatibility-normalized
  v1 retains historical `stage:<id>-gate` plus `approve | reject` decisions.
- Stale native fixtures now use explicit Gate semantics and phase-compatible
  ReviewCycle capabilities.
- Skill-generation coverage includes both deliberate internal templates.

## Exact Round-3 files

Production:

- `src/core/profiles.ts`
- `src/core/workflow-chain.ts`
- `src/commands/profile-editor.ts`
- `src/core/pipeline-registry/definition.ts`

Tests:

- `test/commands/config-profile.test.ts`
- `test/commands/pipeline-bugfix-e2e.test.ts`
- `test/commands/pipeline-complex-e2e.test.ts`
- `test/commands/pipeline.test.ts`
- `test/commands/profile-editor.test.ts`
- `test/core/change-run/ack-loss-journeys.test.ts`
- `test/core/change-run/lowerer.test.ts`
- `test/core/shared/skill-generation.test.ts`

## Verification and ownership

- 11-file aggregate: 360/360.
- V1 adjacency: 203/203.
- Local-version dedicated serial: 7/7 before and 7/7 after.
- Build, no-emit TypeScript, strict validation, diff check, and
  auto-decompose zero-diff check: passed.
- Final full root suite was intentionally not run; the LEAD owns it.
- No commit/run-state/stash/worktree/temp deletion/ship/archive occurred.
- Keep task 9.5 open for parent PR Windows and normal Linux/macOS CI.
