## Why

The generated `rasen-goal` and `rasen-review-cycle` skills currently carry the entire orchestration playbook, including large sections they cannot execute. This duplicates prompt text across the installed workflow corpus and consumes eager context without improving either workflow's behavior.

## What Changes

- Split the shared orchestration source into stable semantic modules while retaining one canonical source for each rule.
- Compose three workflow-specific, selectively inlined bundles for `rasen-auto`, `rasen-goal`, and `rasen-review-cycle`.
- Keep `rasen-auto`'s full playbook because it can execute arbitrary registered pipeline shapes, while omitting inapplicable modules from the two narrower entry workflows.
- Preserve the selected modules' original relative order and all existing runtime behavior.
- Add composition, parity, regression, and generated-size tests for the three bundles.
- Do not introduce sidecars or change workflow digest, initialization, or update propagation in this change.

## Capabilities

### New Capabilities

- `selective-orchestration-bundles`: Defines which orchestration modules each generated workflow skill receives, the behavior-preservation contract, and bounded generated-size expectations.

### Modified Capabilities

None. Existing orchestration behavior and workflow contracts remain unchanged.

## Impact

- Affects `src/core/templates/workflows/_orchestration.ts` and the auto, goal-command, and review-cycle template consumers.
- Affects workflow-template tests and parity golden hashes for templates whose generated content changes.
- Reduces the generated `rasen-goal` and `rasen-review-cycle` skill bodies; `rasen-auto` is expected to remain near its current size.
- Adds no runtime dependency, storage format, installation lifecycle, or public CLI change.
