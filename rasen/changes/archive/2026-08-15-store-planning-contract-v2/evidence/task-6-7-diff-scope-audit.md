# Task 6.7 — diff-scope audit

## Full file list (src/ + test/)

Modified:

- `src/core/change-metadata/schema.ts` — adds the optional v2 `identity` block + `implementation`
  enum + `.strict()` with an `ArchiveQualitySummarySchema` passthrough for the engine-owned
  `quality` field (tasks 3.4, 3.5). Pure schema change, no I/O, no command wiring.
- `src/core/index.ts` — adds `change-metadata` to the public barrel (task 5.1) and one explicit
  disambiguating re-export (`export type { ChangeInstanceId } from './store/planning-identity.js';`)
  resolving a genuine TS2308 export collision against the pre-existing, unrelated
  `change-run/contracts.ts` `ChangeInstanceId` brand. Pure export-surface change; confirmed via
  grep that nothing currently imports the bare barrel name, so no caller is affected.
- `src/core/store/foundation.ts` — adds the optional `layoutVersion: 2` field to both metadata
  schema forms, parser, and serializer (task 2.1). Purely additive, never inferred from disk.
- `src/core/store/index.ts` — one line, re-exports the new `planning-foundation.js` barrel
  (task 5.1).
- `src/core/store/project-records.ts` — moves `WINDOWS_RESERVED_DEVICE_NAMES` into
  `planning-validation.ts` and re-exports/consumes it (task 1.3). No behavior change; the existing
  exported name and call site stay intact.
- `src/core/workflow-package/canonical.ts` — now re-exports `canonicalJson`/`canonicalBytes` from
  the new shared `../canonical-json.js` instead of duplicating the `canonicalize` wrapper (task
  1.1). `canonicalize` was already a project dependency (used elsewhere, e.g.
  `workflow-registry/digest.ts`, `expert-digest.ts`) — no new dependency added, one is deduplicated.
- `test/utils/change-metadata.test.ts` — two new cases (task 3.7): a misspelled-field rejection and
  a real archived-record round trip.

New (all under the Layer-0 boundary or its tests):

- `src/core/canonical-json.ts` (task 1.1)
- `src/core/store/planning-validation.ts` (tasks 1.2-1.4)
- `src/core/store/planning-catalogs.ts` (tasks 2.2-2.3)
- `src/core/store/planning-layout-v2.ts` (tasks 2.4-2.6)
- `src/core/store/planning-identity.ts` (tasks 3.1-3.3)
- `src/core/store/finalization-v2.ts` (tasks 4.1-4.5)
- `src/core/store/planning-foundation.ts` (task 5.1 barrel)
- `test/core/store/planning-validation-v2.test.ts` (task 1.5)
- `test/core/store/planning-layout-v2.test.ts` (task 2.7)
- `test/core/store/planning-identity-v2.test.ts` (task 3.6)
- `test/core/store/finalization-v2.test.ts` (task 4.6)
- `test/core/store/planning-foundation-consumer.test.ts` (task 5.2)
- `test/core/store/planning-foundation-purity.test.ts` (task 5.3)

## Checks performed

- **No dependency addition**: `git diff --stat -- package.json pnpm-lock.yaml` is empty.
  `canonicalize` was already a dependency before this change.
- **No selector/command routing**: grepped `src/commands/`, `src/cli/` — zero files in the diff.
- **No Store/migration mutation**: `foundation.ts` and `project-records.ts` diffs reviewed line by
  line above — additive declaration fields and a pure rename/re-export, no write-path logic
  touched. `layout-migration/`, `store-planning/`, `membership-layout.ts`, `target-lines.ts`,
  `workspace/`, `issues/`, `query/`, and the `finalization/` directory are untouched (confirmed:
  none of those paths appear in `git status --short -- src test`).
- **No Git worktree operation**: no file in the diff imports `node:child_process`, `simple-git`, or
  any worktree/branch-manipulation module — this is also independently proven for the five Layer-0
  modules by the mutation-verified purity guard (task 5.3/5.4, `planning-foundation-purity.test.ts`,
  15/15 green with a recorded RED/GREEN mutation cycle).
- **No archive-apply logic, management-API, or UI**: none of `archive-engine.ts`,
  `management-api/`, `packages/ui/` appear in the diff.
- **No unrelated formatting change**: every diff hunk reviewed above is narrowly scoped to the
  specific addition/move described; no incidental whitespace/reflow churn in unrelated regions.
- **S3-owned surfaces absent**: grepped `src/core/store/` for
  `IssueId|ExecutionPlanRevisionId|issue-record|execution-plan|invalid_issue_record|invalid_execution_plan`
  — zero matches. Design Decision 2's Issue/ExecutionPlan brands and layout addresses are not
  present anywhere in this child's diff.

## Non-diff artifacts explicitly excluded from scope and from the commit

- `.rasen/changes/store-planning-contract-v2/ephemera/auto-run.json` — modified by the
  orchestration/dispatch system when this session was spawned (worker/gate bookkeeping), not
  authored by this implementer. Per the leaf-worker constraint against writing run-state, this file
  is left untouched and excluded from the commit via an explicit pathspec.
- `.rasen-scratch/s1ref/` — working reference material (fetched 0.1.7 ship-commit file snapshots and
  diffs used while porting) — deleted before commit; it was never staged.

## Conclusion

The diff is exactly what design Decision 2 and the task list scope to this child: pure contracts,
validation, layout addressing, identity derivation, finalization/Archive-v2 shape, schema/export
surface, and their tests. No command routing, no mutation, no worktree operation, no archive-apply
logic, no management-API/UI, no new dependency, no unrelated formatting, and no S3-owned surface.
