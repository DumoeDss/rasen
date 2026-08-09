# Planning context — final acceptance CI proof

## User directive

The user delegated the remaining portfolio work to `rasen-auto`, while
deferring physical/real-machine cache testing for one later coordinated run.
No physical observation, daemon, scheduler, push, or PR is part of this child.

## Parent and dependency

- Parent: `session-cache-optimization`
- Depends on the archived, locally shipped, review-clean
  `session-cache-optimization-acceptance-evidence` child.
- The current frozen candidate must be superseded after this repository
  mutation; no previous physical attempt may be relabelled for the new
  candidate.

## Confirmed defect

`scripts/session-cache-acceptance/protocol.mjs` defines
`localEvidence.nativeLinux` as `z.literal(false)`, and both acceptance
finalization and local-evidence recording preserve that value. This correctly
states that local Windows/injected-POSIX evidence is not native Linux CI.

`assertFinalAcceptanceComplete`, however, also requires
`localEvidence.nativeLinux` to be truthy. The successful CI collector updates
`ciState` and retains the exact five native job records, but does not and
should not rewrite local evidence. E4 is therefore unreachable even after
valid E1, parent delivery, and successful exact-SHA CI.

## Required direction

- Preserve `localEvidence.nativeLinux: false`; never promote CI evidence into
  local evidence.
- Make final acceptance rely on `ciState === "successful"` plus the existing
  exact-SHA CI record validation for native CI completion.
- Add a focused regression that exercises the final acceptance assertion after
  selected physical evidence, local evidence, parent delivery, and successful
  five-job CI collection, while retaining negative coverage for incomplete CI.
- Keep the change acceptance-owned. Do not modify product-owner files,
  pre-existing untracked `packages/ui/package-lock.json`, ECP Direction files,
  raw transcript/prompt/session identity, or external immutable attempts.
- Do not run physical or real-machine tests. Record any unrun verification
  honestly for the user’s later coordinated test pass.
