## 1. Freeze the migration root contract

- [x] 1.1 Add failing core tests for an explicit
  `WorkMigrationRootContext` covering in-repo ownership, Store planning plus a
  member execution root, a distinct legacy-home owner lookup, and additive
  compatibility fields on `WorkMigrationPlan`.
- [x] 1.2 Introduce the typed root context and update only the root-input and
  report-projection seams in `src/core/work-migration.ts`: planning paths from
  `planningRoot`, active run-state/probes from `executionRoot`, legacy sources
  from `legacyHomeOwnerRoot`, and no downstream cwd/Store re-inference.
- [x] 1.3 Preserve a narrow in-repo compatibility adapter for existing
  `planWorkMigration`/`runWorkMigration` callers while requiring Store-capable
  callers to pass the complete context; keep existing plan/report fields and
  failure reasons compatible.
- [x] 1.4 Add deterministic core tests using both foundation
  `PathIdentityFlavor` values for Windows case/separator identity and POSIX
  case-sensitive scope, with all expected paths built through the platform path
  APIs.
- [x] 1.5 Re-run the foundation focused cases that prove scope filtering before
  inspection, complete-plan blocking, source fingerprints, no-clobber
  conflicts, cross-device fallback bounds, and fail-closed filesystem errors
  are unchanged by root routing.

## 2. Make the work command plan and apply once

- [x] 2.1 Add `--store <id>` and `--project <id>` to `rasen work migrate`, pass
  them to `resolveRootForCommand`, and freeze planning, execution,
  legacy-home-owner, and native path-flavor values once at the command
  boundary.
- [x] 2.2 Refactor preview/report projection so dry-run, JSON, and interactive
  modes each create one `WorkMigrationPlan`; pass the exact interactive or
  `--json --yes` plan to `applyWorkMigration` and project outcomes against that
  same plan without calling the planner again.
- [x] 2.3 Add command tests that capture the previewed plan, mutate cwd/root or
  filesystem state before confirmation, and prove apply receives the same plan
  while foundation preconditions report drift rather than reclassifying it.
- [x] 2.4 Add Store command tests proving reports/handoff/design docs stay under
  the selected Store while run-state/probes and legacy-home lookup use only the
  invocation member checkout/worktree.
- [x] 2.5 Lock existing human and JSON keys, summaries, failure payloads,
  `--change`, `--dry-run`, `--json`, `--yes`,
  `--discard-absorbed-conclusions`, no-op, cancellation, mutual-exclusion, and
  no-mint preview behavior with compatibility assertions; treat any root fields
  as additive.

## 3. Route session terminal reads from frozen execution

- [x] 3.1 Add focused Sessions API tests with planning and execution roots that
  contain competing run-state, proving filtering and `changeDir` remain
  planning-space-owned while ephemera and legacy-home lookup use
  `record.execution.root`.
- [x] 3.2 Update `handleListSessions` to require a usable frozen project
  execution record before building the sticky-legacy join, use the execution
  root for `ephemeraDir` and read-only home resolution, and retain the planning
  change directory only as the final oldest-legacy candidate.
- [x] 3.3 Add registry/API tests proving the copied frozen execution record
  remains authoritative after Store membership, pointer, or registration
  changes and the listing never retargets through the daemon launch project.
- [x] 3.4 Add missing-execution, explicit planning-only, and removed/stale
  execution-checkout tests that return the existing `{kind: "absent"}` session
  join without inspecting the planning root as terminal state; verify
  unexpected inspection errors fail closed through the existing per-entry error
  projection.

## 4. Store and two-worktree integration

- [x] 4.1 Build an integration fixture with one Store, one registered member Git
  repository, main plus linked worktrees, and same-named migration/session state
  in competing planning and execution locations.
- [x] 4.2 From each worktree in turn, verify work migration freezes that exact
  checkout for ephemera/probes and legacy-home ownership, never writes another
  worktree, and continues to place planning-owned files in the Store.
- [x] 4.3 Launch/list a Store-planned session bound to the linked worktree and
  verify its frozen execution run-state wins over Store, main-worktree, and
  server-launch-project decoys.

## 5. Focused verification and closure handoff

- [x] 5.1 Run formatting/typecheck/lint for the touched TypeScript and the
  focused `test/commands/work.test.ts`,
  `test/core/work-migration.test.ts`,
  `test/core/management-api/sessions-api.test.ts`, and
  `test/core/management-api/sessions-space.test.ts` suites.
- [x] 5.2 Run the deterministic `win32` and `posix` identity cases on the
  current host, record the exact focused commands and results in change
  evidence, and hand them to `file-placement-hardening-closure` for its required
  real Windows/macOS/Linux CI matrix.
- [x] 5.3 Review the implementation diff to confirm this child changed only
  work-migration root/caller threading and session-management routing, with no
  archive/accounting, workflow-template, or final documentation sweep.
