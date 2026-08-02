# Planning Context

## User intent

Add a built-in `task-loop` Pipeline that is invoked through `rasen-auto`; do not add a `rasen loop` command. The Pipeline is a separate, spec-free execution path and must never convert or upgrade to a spec-driven Pipeline. This implementation run uses `small-feature`, but the resulting `task-loop` runtime must not create `proposal.md`, `design.md`, `specs/`, or `tasks.md`.

The user requested no-gate execution for this implementation run.

## Quality model

Use the local `gauntlet-loop` skill as the behavioral reference:

- Fix the outcome, inspectable quality bar, constraints, and stop authority; leave the implementation route to the builder.
- Keep builder and critic roles separate.
- Give each critic fresh context containing the goal, bar, relevant rules, references, and real artifact, without the builder's reasoning history.
- Inspect real files, commands, test output, runtime behavior, or rendered artifacts rather than summaries.
- Return the largest material remaining gap and an explicit next-round pass condition.
- Stop only on satisfied, explicit stop, budget/exhaustion, material-value floor, or a genuine blocker; never convert to a spec Pipeline.

## Current architecture findings

- Built-in Pipeline definitions live under `pipelines/<name>/pipeline.yaml` and are loaded through the Pipeline Registry.
- `goal-loop-evaluate` already provides `define-goal -> iterate (evaluate) -> ship -> retain -> archive`, with fresh reviewer judgment through the goal-cycle runtime.
- `task-loop` should be optimized for direct task completion, not general code-quality optimization; it should avoid the retention tail unless design evidence proves retention is required.
- Existing `rasen-review` can operate without spec artifacts, but its Spec axis is skipped. A task-loop judge therefore needs the task goal and bar explicitly, not an inferred proposal/tasks contract.
- `rasen new change --goal` persists the user goal in change metadata. A Pipeline may remain change-backed for canonical run state while being artifact-independent.
- `ship` handles a missing proposal; `archive` handles missing tasks and missing delta specs.

## Design constraints

- Preserve one public entry: `rasen-auto [--pipeline task-loop] <task>` or leading selector `rasen-auto task-loop <task>`.
- Make Pipeline selection immutable after initialization; exhausted/blocked/cancelled are terminal outcomes, not conversion triggers.
- Reuse the deepest existing execution Module and place new behavior behind the smallest practical Interface.
- Validate through Pipeline Registry/execution preflight, CLI listing/showing, localization, resume, profile/workflow dependency, and end-to-end goal-cycle tests.
- Preserve unrelated user work already present in `rasen/config.yaml`, `rasen/changes/add-thing/`, `rasen/changes/ecp-v2-default-authoring-and-builtins/`, and `rasen/specs/billing/`.

## Pending design comparison

Three read-only architecture workers are comparing a minimal Interface, an extensible Interface, and a default-caller-optimized Interface. The propose-stage planner must incorporate their strongest conclusions and record the selected seam and rejected alternatives in `design.md`.
