## Why

Store v2 workspace plans for an existing Change already carry its verified Change instance identity, but applying those plans stops at `prepared` and omits the workspace pair identity. This deterministic incomplete binding prevents otherwise valid workspaces from reaching finalization because archive reports `workspace_pair_unavailable`.

## What Changes

- Complete an existing-Change workspace binding after both planned worktrees and their local binding documents exist, using the same canonical binding completion path used after Change creation.
- Return and persist a verified `WorkspacePairId` with binding state `bound` when both worktree identities are available.
- Preserve fail-closed behavior: a missing execution worktree leaves the binding `prepared`, while worktree identity or target-line disagreement refuses completion.
- Keep repeated application idempotent and keep cleanup able to remove the resulting completed pair.
- Add focused Store v2 regression coverage spanning apply, workspace inspection, archive dry-run eligibility, retries, drift refusal, incomplete execution state, and cleanup.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `store-planning-worktree-bindings`: Clarify that applying a workspace plan for an already-created Change completes and verifies the pair when both worktrees are available, while preserving prepared, drift, idempotence, and cleanup guarantees.

## Impact

- Affects Store v2 workspace apply/binding orchestration and its returned machine-readable result.
- Affects workspace unit, CLI, and Store v2 journey regression coverage, including the finalization preflight that consumes a verified pair.
- Introduces no breaking CLI changes or new dependencies.
