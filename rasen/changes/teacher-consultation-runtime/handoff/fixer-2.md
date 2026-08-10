# B2 fixer attempt 2 handoff

## Status

HANDOFF — the remaining delayed-writer TOCTOU cannot be closed truthfully with the production SessionHost process authority currently wired by the management server.

No runtime, test, spec, planning, run-state, portfolio, or review-report file was changed in this attempt. This handoff is the only added file.

## Blocking evidence

The required ordering is sound in principle:

1. accept one settled Teacher result only when its hosted receipt is bound to the canonical Teacher Action, Invocation, request, and stable Session;
2. retire that exact Session/process authority and require an exact scope-empty receipt;
3. only then perform the final bounded workspace observation;
4. reject advice on retirement timeout, control loss, foreign/lost authority, or observation instability.

The present production construction cannot satisfy step 2:

- `src/core/management-api/router.ts` constructs one `createHostedProcessScope()` and shares it between `createSessionHost()` and `createClaudeSessionBackend()`.
- `src/core/session-host/process-capsule/hosted-process-scope.ts` selects declared best-effort scopes on all production platforms in scope: POSIX best-effort on Linux/macOS and win32 best-effort on Windows.
- `src/core/session-host/process-capsule/posix-best-effort-scope.ts` explicitly records that a descendant can escape the process group with `setsid()`/`setpgid()` and therefore every terminal remains `emptiness: 'unproven'`.
- `src/core/session-host/process-capsule/win32-best-effort-scope.ts` explicitly refuses to promote Job accounting to scope-empty proof and also returns a declared-unproven terminal.
- `src/core/session-host/host.ts` uses `receiptAuthorizesRelease(receipt, declared)` in `closeLive()` / `closeDurableProcess()`. For a declared best-effort scope, `retire` can return `ok: true` after a `declared-unproven` terminal and clears `record.process`.
- Consequently, `host.dispatch({ op: 'retire', sessionId: exactTeacherSessionId, ... })` is identity-exact but not quiescence-exact. A delayed POSIX child that changed session/process group can remain able to write after the Teacher result and after successful retirement.

The repository contains the stronger provider-backed process-authority abstraction (`src/core/session-host/process-authority/process-scope-adapter.ts`), whose adapter releases only an `ExactScopeEmptyReceipt`. However, production SessionHost construction does not register or select those providers. The generic coordinator defaults to an empty provider registry, and provider registries are currently assembled only in tests/fixtures. Production provider assembly, manifest/published-reference storage, platform availability policy, and runtime bridge selection are therefore missing from this consultation path.

## Why a local workaround is unsafe

- Treating successful `retire` as exact would contradict the durable `processTerminal.emptiness === 'unproven'` contract.
- Treating declared-unproven retirement as failure would fail every production Teacher attempt on Windows/Linux/macOS, removing the advertised consultation happy path rather than fixing it.
- Repeating or delaying manifest scans cannot prove absence of an arbitrarily delayed surviving writer.
- Killing by PID, process name, or a freshly enumerated descendant set would abandon the opaque ProcessRef ownership boundary and recreate PID-reuse/TOCTOU hazards.
- Changing `createHostedProcessScope()` globally back to the legacy native capsule would regress the existing honest best-effort semantics and is outside a B2-local fix.
- A file/directory post-validation fence is still required, but it is defense in depth; it cannot replace exact retirement because a writer may remain dormant until after all bounded scans finish.

## Planner rework required

Plan a production-supported exact-retirement tier for consultation Teachers, preferably by integrating the existing provider-backed process-authority seam rather than widening legacy ProcessCapsule claims:

1. Add a frozen executor/SessionHost requirement such as `exactRecursiveRetirement: true` for Teacher Actions. It must be server-derived from canonical consultation authority, never accepted from worker/caller text.
2. Add an exact process-authority capability fact to backend selection. If an exact provider is unavailable on the current platform/host, fail before Teacher activation with typed authority-unavailable; do not fall back to best-effort.
3. Assemble authenticated Windows/Linux production provider registries, durable publication ledgers, exact provider selection, and runtime bridges in the management server. Define the macOS availability policy explicitly (exact provider or typed unavailable).
4. Persist enough provider identity with the Session process facts so restart/reconciliation dispatches the opaque reference to the same exact provider. Do not infer the provider from PID or process name.
5. Extend SessionHost with an exact-retirement result/receipt that distinguishes `exact-scope-empty` from declared-unproven release. Bind retirement at the management executor to the canonical Teacher Action id, Invocation id, deterministic fresh request id, stable Session id, role, workspace instance, backend, and hosted receipt.
6. Require exact retirement before final observation and before returning a successful Teacher dispatch to the consultation driver. Timeout, kill failure, provider loss, already-exited-without-exact-empty, and stale/foreign reference all fail closed as typed Teacher-attempt failures.
7. Then add the manifest stability fence: post-read `fstat` comparison for regular files; post-enumeration/post-children `lstat` comparison for directories; compare identity, type/mode, size, `mtimeNs`, and `ctimeNs`; treat read/permission/path instability as typed failure; retain entry/byte bounds and no-follow link handling. Use bounded whole-observation retry only for an explicitly classified instability, never silent continuation.
8. Add a deterministic process fixture whose contained child waits on an IPC/file barrier, returns Teacher advice, then attempts an early ignored-path write when the final scan reaches a later bounded entry. The test must show that exact retirement prevents the write (or a deliberately injected internal observation race is detected), advice is not committed on any retirement/observation failure, bounded unavailable continuation occurs once, and every sponsored reservation is released.

## Eliminated hypotheses

- **“The settled result closes the Claude process.”** False. SessionHost deliberately keeps a resident hosted Session idle for continuation; a result event is not a process terminal.
- **“SessionHost `retire` already proves process-tree emptiness.”** False on the production scopes selected for Windows/Linux/macOS; it accepts declared-unproven terminals for release.
- **“The ProcessRef is too broad or unbound.”** False. ProcessRef and stable Session identity are already precise control capabilities. The missing property is exact recursive emptiness, not identity precision.
- **“A second manifest scan is sufficient.”** False. A surviving delayed writer can wait until every finite scan completes.
- **“The existing provider-backed exact authority is already production wired.”** False. The adapter and platform provider implementations exist, but management-server construction still uses `createHostedProcessScope()` and no non-empty production `ProcessAuthorityProviderRegistry` is assembled.
- **“Fail every declared-unproven retirement closed after execution.”** Safe but functionally invalid: it makes all supported production Teacher executions incapable of committing advice.
- **“Use PID/name-based kill-tree as a narrow patch.”** Rejected because it violates exact ProcessCapsule ownership and is vulnerable to PID reuse and incomplete descendant enumeration.

## Preserved resolved work

No source or test changes were made, so M6 canonical Record-backed limits and all previously resolved B1/B3/M1–M5/N1 work remain untouched. No verification suite was run because there is no executable change to validate; the blocker is established directly from the production construction and process-lifecycle contracts above.
