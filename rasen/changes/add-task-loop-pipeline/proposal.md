## Why

Small, direct implementation tasks currently enter a spec-driven lifecycle whose proposal, design, specs, and task-list artifacts can cost more than the work itself. Rasen needs an explicitly selected autonomous loop that preserves independent, evidence-based review without converting the task into a spec workflow.

## What Changes

- Add a built-in `task-loop` Pipeline selected only through `rasen-auto task-loop <task>` or `rasen-auto --pipeline task-loop <task>`; no `rasen loop` command is added.
- Capture a frozen, inspectable task contract containing the goal, real artifact targets, constraints, and evidence-based quality bar, without producing runtime `proposal.md`, `design.md`, `specs/`, `tasks.md`, or `goal-plan.md` artifacts.
- Repeatedly assign a builder to improve the real artifacts and a fresh, role-separated critic to inspect those artifacts against the frozen bar, returning at most the largest material remaining gap and its explicit pass condition.
- Reuse the canonical Pipeline Run, reconciler, and bounded goal-cycle semantics while adding task-specific contract and judgment validation behind a small internal interface.
- Permit `ship` and `archive` only after a mechanically valid `satisfied` judgment; report exhaustion, blockage, cancellation, and explicit stop honestly without converting to another Pipeline.
- Integrate the Pipeline with registry inspection and preflight, auto workflow dependencies and guidance, localization, resume/observability, generated skill parity, no-gate behavior, and cross-platform tests.

## Capabilities

### New Capabilities

- `task-loop-pipeline`: Defines explicit selection, frozen task inputs, builder/critic iteration over real artifacts, terminal outcome guards, and spec-free shipping behavior for the built-in task loop.

### Modified Capabilities

None.

## Impact

The change affects the built-in Pipeline catalog, `rasen-auto` orchestration text and dependencies, Pipeline lowering/preflight, canonical Run launch inputs and resume semantics, goal-cycle reconciliation, internal workflow templates, generated skill parity, localization, and focused CLI/runtime tests. It adds no public command, no new external dependency, and no automatic classifier route into `task-loop`.
