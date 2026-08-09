# Round-2 review remediation evidence

## Scope and result

All four findings in `review-cycle-report.md` are remediated in the shared ECP
worktree. This pass did not commit, ship, archive, mutate machine run state, or
modify `pipelines/auto-decompose/pipeline.yaml`. Parent task 9.5 remains open
until the portfolio PR has Windows and normal Linux/macOS CI evidence.

## Failure-first evidence

Before the production edits, the new regression tests were run with:

```text
pnpm exec vitest run test/core/change-run/reconciler.test.ts test/core/profiles.test.ts test/core/workflow-registry/selection.test.ts --reporter=dot
```

The run failed as intended: **5 failed, 76 passed**. The failures proved that:

1. the selectable built-in baseline leaked internal dependency-only workflow
   ids;
2. a Gate authored with `fail` emitted `escalate`;
3. the production `core`/`auto-command` selection did not enable every
   capability owner reachable through `review-cycle`/`review-fix`; and
4. a custom `goal-command` selection did not enable the capability owners
   needed to prepare and execute `goal-loop-measure`.

After implementation, that same three-file matrix passed **81/81**.

## Remediation

### Required-pipeline capability closure

- Added an authoritative collector that loads and prepares every pipeline in
  selected workflows' `requires.pipelines` and walks native-v2 roots,
  declarations, bounded-loop strategies, conditional members, v1 stages, and
  decompose children.
- Effective install selection now reaches a deterministic fixed point over
  workflow dependencies, direct skill dependencies, and every pipeline
  capability owner. Required-pipeline load/preparation errors fail closed;
  the existing advisory graph remains tolerant.
- Threaded the project root through init, locked/override profile resolution,
  update/drift/removal, artifact-ledger, and execution-enablement consumers so
  project pipeline overrides cannot produce a different effective set.
- Production tests prepare every pipeline required by the `core`/`auto`
  selection and a custom `goal-command` selection, then prove each reachable
  `skill:` capability is enabled and executable.

### Internal workflow baseline

- The selectable built-in baseline now excludes every member of
  `INTERNAL_BUILTIN_WORKFLOW_IDS`, rather than special-casing only the retention
  runner.
- A future-facing regression iterates the complete internal-id set. Internal
  `review-fix` and `goal-judge` remain installable as dependencies but cannot
  become profile-picker roots.

### Gate dispositions

- `NodeDisposition` now retains the authored terminal disposition.
- `proceed` admits the target stage, `fail` emits a fail action, and `escalate`
  emits an escalate action; both terminal outcomes retain the gate-specific
  rejection code.
- A table regression covers all three authored outcomes.

### Authority comments and artifacts

- Corrected the lowerer comment to identify Gate nodes as the authored control
  contract consumed while lowering their target AtomicStage.
- Corrected the phase-capability comment to describe phase-specific port
  projection and descriptor authority without implying interchangeability.
- Updated proposal, design, ECP and operational-registry specs, and tasks 11.1
  through 11.4 to record the final contracts.

## Verification

- Failure-first three-file matrix after fix: **3 files, 81/81 passed**.
- Reviewer-requested four-file matrix (`loop-phase-capabilities`, workflow
  built-ins, profiles, reconciler): **4 files, 82/82 passed**.
- Install/update matrix (`selection`, dependency graph, review-cycle command,
  init, update): **5 files passed**, exit 0.
- Cross-consumer matrix (artifact ledger, drift, execution validation, expert
  flip plus the reviewer four-file matrix): **8 files, 138 passed, 1 skipped**.
- `pnpm build`: passed.
- `pnpm exec tsc --noEmit`: passed.
- `node bin/rasen.js validate ecp-v2-default-authoring-and-builtins --strict`:
  passed.
- `git diff --check`: passed (only expected Windows LF/CRLF notices).
- `git diff --exit-code -- pipelines/auto-decompose/pipeline.yaml`: passed;
  authored compatibility fixture bytes remain untouched.
- Stale-authority phrase scan found no source/test/spec occurrence. The one
  remaining match is the original finding text in `review-cycle-report.md`,
  retained as historical review evidence.

## Remaining external work

Only task 9.5 remains open: the parent portfolio PR must supply green Windows
and normal Linux/macOS CI lanes. Commit, PR, archive, and run-state ownership
remain with the parent LEAD.
