# FIXER round 1 handoff

## Why this handoff exists

The FIXER context was automatically compacted while round-1 verification was still in progress. Per the review-cycle handoff rule, the remaining verification and evidence work must continue in a fresh FIXER context.

## Scope and constraints

- Change: `add-task-loop-pipeline`
- Review findings in scope: F1-F9 from `evidence/review-report.md`
- Do not self-review/certify, commit, ship, or archive.
- Do not edit `.rasen/.../auto-run.json` or `evidence/review-report.md`.
- Preserve unrelated user work, especially `rasen/config.yaml`, `.rasen/`, `rasen/changes/add-thing/`, `rasen/changes/ecp-v2-default-authoring-and-builtins/`, and `rasen/specs/billing/`.
- Use `apply_patch` for edits.

## Completed implementation work

### F1: stale or unrelated evidence could authorize delivery

- Strengthened Task Loop judge validation so every declared criterion evidence digest must resolve to a raw `EvidenceRef` from the current judge result.
- Bound evidence to the current change, run, action, result schema, and observed workspace tree.
- Revalidated all work/judge rounds and the live workspace before ship/archive and terminal delivery.
- Work results now validate expected action identity, before/after tree chaining, delta schema/tree, and actor attestation.

Primary file: `src/core/change-run/internal/task-loop.ts`.

### F2: physical path containment for input/artifacts

- The safe-path implementation rejects symlink/reparse roots and walks physical components.
- Input reads use `lstat`/open/`fstat` identity checks, `O_NOFOLLOW` where available, bounded reads, growth detection, post-read identity checks, and a second safe-path check.
- Task Loop hidden input is accepted only from the resolved ephemera root.
- Added outside-root, symlink/junction, directory-leaf, and oversize tests.

Primary files: `src/core/change-run/internal/safe-path.ts`, `src/core/change-run/internal/input-reader.ts`, `src/commands/pipeline.ts`, `test/commands/pipeline-start-input.test.ts`.

### F4: critic freshness was not role/session bound

- Critic admission requires the reviewer role/runtime.
- Critic sessions must differ from the builder and every previous critic session.
- Added same-builder-session, wrong-role, and wrong-runtime negative tests.

Primary files: `src/core/change-run/internal/task-loop.ts`, `test/core/change-run/task-loop.test.ts`.

### F5: launch idempotency trusted caller digest and broke legacy empty inputs

- The runtime derives launch identity from normalized pipeline, engine, and inputs.
- A caller-supplied digest is only a consistency assertion and cannot override the derived identity.
- Existing and initial records are compared using record-derived intent.
- Legacy records with empty inputs remain compatible only through the narrow empty-input path.
- Added changed-pipeline, spoofed-old-digest/changed-input, normalized-key-order, and legacy coverage.

Primary files: `src/core/change-run/internal/facade-runtime.ts`, `test/core/change-run/facade-runtime.test.ts`.

### F6: Task Loop selected by name rather than exact built-in identity

- CLI execution refuses `task-loop` unless resolution provenance is the package built-in.
- Runtime validation checks the exact lowered built-in plan shape, node identities/profiles/dependencies/access/loop variant/outcomes, absence of gates, and the implicit completion condition.
- Added project and user same-name shadowing tests plus malformed-plan negatives.

Primary files: `src/commands/pipeline.ts`, `src/core/change-run/internal/task-loop.ts`, `test/commands/pipeline.test.ts`, `test/core/change-run/task-loop.test.ts`.

### F7: generic evaluate schema was widened

- Generic Goal Cycle evaluate results remain strict.
- Task-only fields are projected only in Task Loop mode.
- Added strict-generic and Task-Loop projection tests.

Primary file: `test/core/change-run/goal-cycle.test.ts` plus the associated implementation already in the working tree.

### F8: report lacked raw references and robust regeneration

- The report includes criterion evidence digests, raw reference/action/tree binding, pass/gap state, and deterministically sorted raw evidence.
- The facade regenerates the report on start/reuse/resume/inspect and after every successful Task Loop completion.
- Report write failures surface as `run_store_unavailable` without undoing the canonical run-store commit.
- Added missing/stale/edited report regeneration and write-failure tests.

Primary files: `src/core/change-run/internal/task-loop.ts`, `src/core/change-run/internal/facade-runtime.ts`, `test/core/change-run/task-loop.test.ts`.

### F9: README was stale

- Documented `/rasen-auto task-loop <task>` and `--pipeline task-loop`.
- Clarified explicit-only selection, no classifier routing, frozen ephemera input, resume semantics, no conversion/fallback to spec workflow, and no planning artifacts.

Primary file: `README.md`.

### Workspace observation and Windows E2E corrections

- Task Loop workspace observation is dynamic per admission/completion rather than frozen at launch.
- Runtime projections (`task-loop-report.md` and the current change ephemera directory) are excluded from the material workspace manifest so they cannot create false deltas or invalidate the final tree.
- The Task Loop E2E now uses a real nested Git repository, performs an actual target mutation, observes real before/after trees, and emits schema/tree/action-bound evidence and attestations.

Primary files: `src/core/change-run/internal/runtime-context.ts`, `test/commands/pipeline-bugfix-e2e.test.ts`.

## Verification already completed

- `pnpm run build`: passed repeatedly before the last two small report-regeneration/sort edits. It must be rerun once more.
- `git diff --check`: passed; only line-ending warnings were printed.
- `pnpm exec vitest run test/commands/pipeline-bugfix-e2e.test.ts -t "drives a spec-free Task Loop"`: passed (1 selected test, about 47 seconds) in a fresh-process Windows-safe E2E.
- `pnpm exec vitest run test/commands/pipeline.test.ts -t "refuses a same-name"`: passed (2 selected tests: project and user shadowing).
- Earlier focused runs passed:
  - `test/core/change-run/task-loop.test.ts`: 24/24 before the final negative/report tests were added.
  - `test/core/change-run/facade-runtime.test.ts`: 3/3.
  - Input-bridge focused coverage: 6/6.
- Latest combined focused run:
  - Command: `pnpm exec vitest run test/core/change-run/task-loop.test.ts test/core/change-run/facade-runtime.test.ts test/core/change-run/goal-cycle.test.ts test/commands/pipeline-start-input.test.ts`
  - Result: 68 passed, 1 failed.
  - The only failure was an assertion expecting the Task Loop-specific missing-attestation code, while the generic Goal Cycle validator correctly rejected it first as `malformed_goal_cycle_result`.
  - The assertion has been patched to `malformed_goal_cycle_result`; rerun is still required.

## Remaining required work

1. Rerun `pnpm run build` after the final facade/report patches.
2. Run `pnpm run lint`.
3. Rerun the combined focused command above and confirm all tests pass.
4. Rerun the two selected CLI/E2E commands if needed after build/focused verification; the implementation paths have not materially changed since their passing runs except report regeneration/sorting.
5. Resolve F3 conclusively:
   - Prior whole-suite attempts timed out around 15 minutes without a final summary.
   - A previous `--shard 1/4` completed with 31 failures, apparently dominated by process/mock/timing interference, but those failures were not individually triaged.
   - Run a deterministic low-concurrency full-suite matrix, preferably Vitest shards with `--maxWorkers=1 --minWorkers=1` (confirm flags with Vitest help first). Eight or sixteen sequential shards should keep each invocation bounded while covering every test file exactly once.
   - If any shard fails, isolate the failing file(s), rerun them individually, and either fix a real regression or record concrete evidence that the failure is an existing/environmental instability. Do not claim F3 is closed without a complete passing matrix or explicit, evidence-backed classification of every failure.
6. Write `rasen/changes/add-task-loop-pipeline/evidence/review-fix-round-1.md` with an F1-F9 disposition table, code/test evidence, exact commands/results, and any residual limitations.
7. Return `DONE` to the LEAD only after the deterministic full-suite gate and evidence file are complete. Otherwise create the next handoff and return `HANDOFF`.

## Useful implementation details and eliminated dead ends

- The actual lowered Task Loop plan uses `root:stage:iterate`, `root:stage:ship`, and `root:stage:archive`, with iterate profiles under `declaration:goal-cycle-body`; older unit fixtures use `root/iterate` and `declaration:task-loop`. Validation currently accepts these two fully enumerated exact shapes, not arbitrary name matching.
- Actual outcomes are `clean` and `goal_cycle_exhausted`; legacy unit fixtures use `satisfied` and `task_loop_exhausted`.
- A bad PowerShell attempt to group the prior 31 failures using `Join-String` timed out and produced no useful artifact or file changes. Do not rely on it.
- `safe-path.ts` has an import near the bottom from prior edits; it compiles, so this is stylistic rather than functional.
- Pure Node path checking cannot make all filesystem mutation races mathematically impossible, but the implementation now performs the relevant pre-open, descriptor, bounded-read, post-read, and post-path checks.

## Dirty-worktree reminder

The workspace contains unrelated user changes. Inspect with `git status --short`, preserve them, and do not clean/reset the repository.
