## Why

An interrupted machine-coordination write can retain a claim that its own retry cannot safely resume, while filesystems that do not support directory synchronization can reject every otherwise valid workspace write. Together these defects can permanently wedge workspace planning, binding, locking, or cleanup on healthy state, so their recovery and portability contract must be made explicit now.

## What Changes

- Make a retry of the same coordination write resume a retained, self-verifying claim only when its target, intended bytes, directory, prior target, and intent still match exactly.
- Keep corrupt, disagreeing, foreign, or replaced carriers intact and fail with `workspace_atomic_write_conflict`; retained state never authorizes clobbering a changed target or deleting an unproven file.
- Ensure unjournaled coordination writes do not create a carrier state that the same write can never recover from after an interruption.
- Treat only demonstrably unsupported directory-synchronization outcomes as a portability limitation, while continuing to surface permission, device, capacity, file-sync, close, and other genuine I/O failures.
- Add focused interruption and filesystem fault coverage for claim adoption, carrier replacement, no-clobber publication, and supported versus unsupported directory-sync behavior across Windows and POSIX expectations.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `store-planning-worktree-bindings`: Strengthens interrupted workspace-coordination recovery and defines portable durability behavior when the host filesystem does not support directory synchronization.

## Impact

- Affects the atomic workspace coordination writer in `src/core/store/workspace/dependencies.ts` and the plan, index, lock, binding, and cleanup state that uses it.
- Requires focused workspace coordination, fault-injection, and Git-verb guard regression tests and helpers under `test/core/store/`.
- Preserves existing error codes, carrier naming, no-clobber behavior, exact filesystem identities, and public command surfaces; adds no dependency or storage outside the existing machine coordination root.
