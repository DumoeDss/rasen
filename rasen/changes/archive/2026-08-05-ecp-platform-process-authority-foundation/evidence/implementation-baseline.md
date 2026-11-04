# Implementation baseline

Captured before product edits for the `ecp-platform-process-authority-foundation` apply stage.

## Existing authority seam

- `src/core/session-host/process-scope.ts` owns the public legacy `ProcessScope` seam. `ProcessRef` is a branded string validated only as `rasen-process-scope/1:<base64url>`. The public API is `prepare`, `inspect`, and `terminate`; a prepared scope exposes `activate` and `abort`. Existing observations are `prepared | live | root-exited | closed | foreign | uncertain`, and only `LiveProcessScope.closed -> { state: 'scope-empty' }` is intended to prove exact release.
- `src/core/session-host/process-capsule/native-process-scope.ts` is the current production implementation. It launches the native helper, converts its native reference to a legacy `ProcessRef`, retains local `CapsuleClient` entries, and performs one-shot recovery by exact legacy reference. This implementation is not a `ProcessAuthorityProvider` and is not eligible for registration or conformance claims in this Change.
- `src/core/session-host/process-capsule/resolver.ts` owns the existing private ProcessCapsule resolver contract: protocol version `2`, capability `root-exit-scope-empty-v2`, manifest schema `rasen-process-capsule-manifest/1`, and platform/architecture artifact lookup. `scripts/build-process-capsule.mjs` emits that manifest. Both files are outside the additive foundation edit boundary.

## Durable registry and release sites

- `src/core/session-host/contracts.ts` persists `process.runtimeRef` as a string. `src/core/session-host/registry.ts` admits only the legacy `rasen-process-scope/1` lexical form and does not decode the payload.
- `src/core/session-host/host.ts` publishes `prepared.runtimeRef` under registry CAS before the single `prepared.activate()` call. Prepared abort, live termination, local close observation, stale-owner reaping, and shutdown are the authority-release paths. Writer claims and process facts are intended to remain until a `closed`/scope-empty receipt, but the still-open control-loss finding below disproves that at the transport boundary.
- `src/core/session-host/claude-backend.ts`, `src/core/session-host/backend.ts`, and `src/core/session-host/host.ts` pass the opaque legacy reference; native PID/PGID/Job material is not a control input at that seam. `displayPid` is observation-only legacy display metadata.

## Exact additive edit boundary

- Add platform-neutral production code only below `src/core/session-host/process-authority/`.
- Add public-seam tests below `test/core/session-host/` and reusable deterministic support below `test/helpers/`.
- Later in this Change, add only the opt-in `createProviderBackedProcessScope(...)` compatibility seam needed by the specification. Do not change the Management/Session default, register or wrap ProcessCapsule, edit the native helper protocol/manifest/resolver, or translate legacy PID/PGID facts.
- Preserve existing `rasen-process-scope/1` parsing, persistence, and production selection behavior byte-for-byte. No Linux, Windows, macOS, broker, installer, signing, entitlement, VM, Action, Run, signer, EvidenceStore, UI, or support-claim implementation belongs here.

## Retained ProcessCapsule closure findings

The following findings remain open historical blockers for `ecp-native-process-capsule-closure`; this foundation records but does not fix or conceal them:

- RC-001 Blocker: POSIX descendants can escape the process-group boundary.
- RC-002 Blocker: a supervisor zombie can prevent natural POSIX scope-empty.
- RC-003 Blocker: replacement inspection can report closed while the exact controller remains live.
- RC-004 Major: one-shot protocol parsing can crash instead of producing typed uncertainty.
- RC-005 Minor: exact-closed local clients remain retained.
- SEC-001 Blocker: control loss is converted into clean host detachment.
- SEC-002 Major: an ancestor junction can move the helper trust root outside the package.
- SEC-003 Major: the backend cwd is re-resolved after durable publication and can retarget activation.

Those findings require provider implementations and resumed closure integration; no result from this deterministic common Change is actual operating-system authority evidence.
