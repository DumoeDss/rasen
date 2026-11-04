# Round-3 review remediation evidence

## Input and classification

The post-remediation clean-root report was parsed directly from:

```text
E:\OpenSpec-code-ecp6-post-review-root-temp-adc5b0dd992844a8ba3fe9b6b7a9c27b\ecp6-post-review-root-vitest.json
```

It contained **6,840 total tests, 46 failures in 12 files**. The failures were
classified by contract before editing production code:

| Area | Failed assertions | Classification |
| --- | ---: | --- |
| artifact workflow + workflow chain | 2 | public `nextWorkflows` incorrectly consumed execution/install closure |
| config/profile/profile-editor | 29 | internal dependency-only workflows leaked into public picker metadata; one synced fixture omitted newly required install closure |
| bug-fix + complex E2E + ack-loss | 5 | native-v2 fixtures sent legacy `approve` although the package Gate authors `approved` |
| pipeline command fixtures | 2 | stale native-v2 `execution.gate: false` input after Gate became sole authority |
| lowerer | 4 | three v1 compatibility gate identity regressions plus one stale native ReviewCycle phase fixture |
| skill generation | 1 | expected count/coverage omitted the two deliberate internal templates |
| local-version runtime | 3 | shared TEMP/concurrency environment failure, not a product-code failure |

## Production remediation

### Public roots are separate from executable installation

- Added `resolvePublicWorkflowSelection`, which resolves authored public profile
  roots and ordinary workflow dependencies without widening the result to
  pipeline capability owners.
- `resolveInstalledWorkflowIds` keeps its compatibility name but now consumes
  the public selection for workflow-chain suggestions. Effective installation,
  removal, drift, and execution preflight continue to consume
  `resolveDesiredWorkflowSelection` and its full required-pipeline capability
  closure.
- The profile picker and available-workflow list generically exclude every
  `INTERNAL_BUILTIN_WORKFLOW_IDS` member. `retain-command`, `review-fix`, and
  `goal-judge` remain installable/executable dependencies and are never public
  checkboxes or suggestions.
- Added regressions proving internal ids remain absent even if they appear in a
  caller-provided current-state list. Existing core semantics remain intact:
  core skips unselected verify/ship suggestions and advances to archive.

### Native and compatibility Gate authority remain distinct

- Native-v2 continues to derive gate id, decisions, and dispositions solely
  from authored Gate nodes.
- V1 normalization now preserves the historical flat-lowerer identity
  `stage:<id>-gate` and decision vocabulary `approve | reject`, with the same
  `proceed | escalate` meaning. This restores durable wait/control compatibility
  for v1 ReviewCycle/parallel shapes and `auto-decompose` without reintroducing
  `execution.gate`.
- Native package E2E/ack-loss fixtures now submit the package-authored
  `approved` decision. In-process legacy fixtures intentionally retain
  `approve`, proving the two source-version contracts do not collapse.

### Contract-faithful fixtures and internal templates

- Removed retired `execution.gate: false` from two native-v2 pipeline command
  fixtures; no Gate node is authored where no gate is intended.
- The native ReviewCycle lowerer fixture now advertises explicit per-phase
  contracts, including the distinct write-capable fix capability, while
  review/triage/re-review remain read-oriented phase capabilities.
- The fully-synced core fixture now derives its installed skills from the
  production effective resolver, so pipeline capability owners are present
  without becoming public profile roots.
- Skill generation now expects 38 templates and explicitly covers
  `rasen-review-fix` and `rasen-goal-judge`.

## Exact Round-3 implementation files

Production:

- `src/core/profiles.ts`
- `src/core/workflow-chain.ts`
- `src/commands/profile-editor.ts`
- `src/core/pipeline-registry/definition.ts`

Tests/fixtures:

- `test/commands/config-profile.test.ts`
- `test/commands/pipeline-bugfix-e2e.test.ts`
- `test/commands/pipeline-complex-e2e.test.ts`
- `test/commands/pipeline.test.ts`
- `test/commands/profile-editor.test.ts`
- `test/core/change-run/ack-loss-journeys.test.ts`
- `test/core/change-run/lowerer.test.ts`
- `test/core/shared/skill-generation.test.ts`

No proposal/design/spec/task contract changed: existing D3 and the operational
registry spec already require capability owners to be installed while internal
units remain non-selectable. External task 9.5 remains open.

## Verification

- Required 11-file non-local-version aggregate: **11 files, 360/360 passed**.
- Local-version before product edits, fresh dedicated TEMP and one worker:
  **7/7 passed** at
  `E:\rasen-ecp6-local-version-round3-8182e6f818e34751b09deb50680226f4`.
- Local-version final rerun, a second fresh dedicated TEMP and one worker:
  **7/7 passed** at
  `E:\rasen-ecp6-local-version-round3-rerun-0455f8f1db424273ab2305512377aa00`.
  Both directories were retained. This classifies the clean-root report's
  three failures as shared TEMP/concurrency interference.
- V1 preparation/resolution/view/lowering adjacency matrix: **6 files,
  203/203 passed**.
- Public editor/workflow-chain/skill-generation matrix: **3 files, 54/54
  passed**.
- Focused pipeline native-v2 failures: **2/2 passed** (the other 102 tests had
  already passed in the clean-root report; a standalone all-104 rerun exceeded
  the 240-second local cap without emitting a failure).
- ACK-loss: **12/12 passed**.
- Bug-fix fresh-process E2E: **2/2 passed**.
- Complex ReviewCycle fresh-process E2E: **3/3 passed**.
- `pnpm build`: passed.
- `pnpm exec tsc --noEmit`: passed.
- strict Change validation: passed.
- `git diff --check`: passed, with only expected Windows LF/CRLF notices.
- `git diff --exit-code -- pipelines/auto-decompose/pipeline.yaml`: passed;
  authored compatibility bytes remain untouched.

Per LEAD instruction, this fixer did not run the final full root suite. The
LEAD owns that long clean-root confirmation.

## Boundaries

This pass did not commit, ship, archive, mutate machine run state, touch the
stash, delete a worktree/temp directory, or modify `auto-decompose`. Parent PR
Windows plus normal Linux/macOS CI evidence remains task 9.5.
