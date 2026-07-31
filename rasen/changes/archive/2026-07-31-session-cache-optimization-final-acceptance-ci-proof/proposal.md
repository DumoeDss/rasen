## Why

Final session-cache acceptance is currently unreachable: local evidence
correctly records that injected POSIX coverage is not native Linux, but the
final gate incorrectly requires that local record to claim native Linux even
after successful exact-SHA native CI has been collected. The final gate must
honor the existing separation between local proof and remote CI proof.

## What Changes

- Preserve `localEvidence.nativeLinux: false` as the truthful local-evidence
  contract.
- Make final acceptance obtain native Linux proof exclusively from successful,
  current, exact-delivered-SHA CI evidence and its five required job records.
- Keep pending, failed, incomplete, stale, or provenance-mismatched CI unable
  to close final acceptance.
- Add focused positive and incomplete-CI regression coverage around the final
  acceptance assertion.
- Supersede and re-freeze the repository candidate after this repository-local
  repair; do not relabel prior physical attempts or mutate remote state.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `session-host-lifecycle`: Clarify that native Linux final-acceptance proof
  comes from successful exact-SHA CI state/evidence while local evidence
  remains explicitly non-native-Linux.

## Impact

- Changes the acceptance-owned final assertion in
  `scripts/session-cache-acceptance/protocol.mjs`.
- Extends focused acceptance protocol coverage in
  `test/acceptance/session-cache/protocol.test.ts`.
- Adds no runtime API, dependency, product-owner edit, physical test, daemon
  action, push, PR, or remote mutation.
- Requires a new frozen candidate and later fresh physical evidence because
  the tested repository tree changes.
