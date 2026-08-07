## Context

Locked decision 13 (Target State) and Architecture Replan 6 (slice plan.md) charter this change: converge the 0.2.0 hosted tier to declared best-effort on all three OSes. The macOS provider change (`ecp-macos-process-authority-provider`, commit 254e2ad9) built the entire vocabulary and host machinery this change generalises; that implementation is the verification baseline, already wired in production for darwin.

Verified current-state facts this design rests on (checked 2026-08-07 in this worktree at HEAD 753edc7d; the charter's line numbers had drifted and were corrected here):

- All three construction sites call `createHostedProcessScope()`: `src/core/management-api/router.ts:639`, `src/core/session-host/host.ts:306`, `src/core/session-host/claude-backend.ts:423` (charter said host.ts:299 / claude-backend.ts:395). Platform selection is centralised in `src/core/session-host/process-capsule/hosted-process-scope.ts:17-23`: darwin returns `createDarwinBestEffortProcessScope()`, every other platform returns `createNativeProcessScope(...)` (the legacy capsule). The "three construction sites" therefore collapse to one selection-point edit plus three consumer verifications. Host-native Tier A dispatch never enters ProcessScope.
- `darwin-best-effort-scope.ts` (517 lines) is mechanically POSIX-generic: detached spawn (POSIX `setsid()`; group id equals leader pid), group signals via `process.kill(-groupId, sig)`, ESRCH-keyed whole-group emptiness poll, bounded phases, frozen `DARWIN_BEST_EFFORT_DECLARATION`, `DeclaredUnprovenReceipt` terminals. Only the module name, export names, and error strings ("macOS best-effort scope ...") are darwin-flavoured.
- The seam (`src/core/session-host/process-scope.ts`) already carries the whole honest vocabulary: `BestEffortScopeDeclaration` (both flags literal `false`), `DeclaredUnprovenReceipt`, `declaredUnprovenTerminalLabel`, and `receiptAuthorizesRelease(receipt, declared)` (`process-scope.ts:204-210`).
- The host release machinery is tier-agnostic and live. `closeDurableProcess` (`src/core/session-host/host.ts:696-721`) has TWO release paths that must both stay honest: the observation path (inspect returns a `declared-unproven` observation, host.ts:711-714) and the receipt path (terminate returns a receipt whose `unproven` is recorded, host.ts:716-720). Prepared-abort release gates also call `receiptAuthorizesRelease` at host.ts:490, host.ts:573, and host.ts:1446. The declaration is persisted into the hosted-session record at prepare time (host.ts:449-464, keys `tier`/`exactCancel`/`scopeEmptyProof` only) and activation fails typed if it did not land (host.ts:471-479). The registry has a strict key allowlist; this change adds no record keys.
- The legacy capsule's Windows side is a Job-object implementation: `native/process-capsule/src/main.rs:672-677` (`CreateJobObjectW`, `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`), `main.rs:592` (`TerminateJobObject` with code 137). Its TypeScript adapter `native-process-scope.ts` returns exact vocabulary: `{ state: 'closed' }` receipts and a `closed` promise resolving `ScopeEmptyReceipt` - the disproven-on-POSIX exact claim that decision 13 retires from the hosted seam on every platform.
- Byte-hash pin lists guard the legacy capsule. `test/core/session-host/linux-process-authority-boundary-guards.test.ts:14-29` pins seven files (`native/process-capsule/src/main.rs`, `native/process-capsule/Cargo.lock`, `scripts/build-process-capsule.mjs`, `src/core/session-host/process-capsule/resolver.ts`, `src/core/session-host/process-capsule/native-process-scope.ts`, `test/core/session-host/process-capsule-package.test.ts`, `test/core/session-host/process-capsule-posix-replacement.test.ts`); `test/core/session-host/windows-process-authority-package-ci.test.ts:36-47` pins the first five again. `hosted-process-scope.ts`, `process-scope.ts`, and `darwin-best-effort-scope.ts` are NOT pinned.
- Two source-scan guards read the darwin module's source text directly: `test/core/session-host/darwin-best-effort-scope.test.ts:392-404` (no `state: 'closed'`, no `'scope-empty'`, no proven emptiness in code) and `:484-491` (no reattach/revalidate). The platform-selection guard (`:497` onward) currently asserts linux and win32 route to the exact tier - that assertion inverts under this change.
- SEC-001 (closure review, Blocker): "transport loss can become a clean host detach" (`rasen/changes/ecp-native-process-capsule-closure/evidence/architecture-replan.md:19`). The closure's contract for closing it: transport/controller loss returns retained uncertainty or independently proven termination, never clean detach (closure tasks.md 12.2, fix-round-1.md finding table).

## Goals / Non-Goals

**Goals:**

- Linux hosted sessions run under the declared POSIX best-effort tier with the declaration visible before start and `cancelled / emptiness-unproven` terminals.
- Windows hosted sessions keep the legacy capsule's Job kill mechanics while the hosted seam speaks only the declared-unproven vocabulary; transport loss stays retained uncertainty.
- The `KILL_ON_JOB_CLOSE` daemon-death teardown property is retained and receipted on a real Windows host.
- Real production-path receipts on Linux (WSL) and Windows (this host), with mutation receipts for every new guard.

**Non-Goals:**

- Any modification to the frozen crates (`native/linux-process-authority/**`, `native/windows-process-authority/**`) or to any byte-pinned legacy-capsule file. No guard rebaseline is planned; if one becomes unavoidable it is a STOP-and-escalate, not a task.
- Kernel-enforced exact cancel, exact scope-empty proof, or Linux namespace zero-orphan teardown (upgrade path per decision 13).
- Registry/manifest changes for the recursive capability (subset providers are rejected index-exact; the tier lives at the ProcessScope seam).
- Reattach, identity revalidation, or cross-daemon recovery (decision 11); the typed `execution-lost` outcome belongs to the executor change.
- Closing SEC-001 by fiat: this change builds the structure expected to close its shape; the closure re-grade verifies it.
- macOS receipts (Section 7 of the macOS change stays owed to ECP-8; darwin behaviour must be preserved, not re-proven here).

## Decisions

### D1: One selection point, three verified consumers

All production construction flows through `createHostedProcessScope()`. The platform cutover is therefore a single edit in `hosted-process-scope.ts`; the three construction sites are verified (not edited) as consumers. This also means no change to `router.ts`, `host.ts`, or `claude-backend.ts` is needed at all: the declaration persistence, activation gate, both release paths, and API projection are already tier-agnostic on declaration presence. A baseline task re-verifies this and stops if drift is found.

### D2: POSIX generalisation is a module move, not a shim

The darwin implementation moves to `posix-best-effort-scope.ts` (`createPosixBestEffortProcessScope`, `POSIX_BEST_EFFORT_DECLARATION`, platform-neutral error strings); `darwin-best-effort-scope.ts` is deleted and its importers updated (one src file, three test files). A compatibility re-export shim was considered and rejected for one decisive reason: the two source-scan guards read the module file's source text, and against a two-line shim they would pass vacuously - exactly the verification-theater failure mode this repo has caught repeatedly. The guards are repointed at the moved module so they keep discriminating. Test filenames are kept (`darwin-*.test.ts`) to avoid churning the macOS change's evidence trail; a header comment notes the module they exercise is now shared POSIX.

The declaration constant stays frozen with both flags literal `false`. `DARWIN_BEST_EFFORT_DECLARATION` is not kept as an alias; the macOS change's historical evidence references stay valid as history (receipts are records of what was, not live bindings).

### D3: win32 = a thin new scope wrapping the unmodified legacy capsule (the owned decision)

Three alternatives were considered for giving win32 honest terminals while keeping Job kill mechanics:

- (a) Modify `native-process-scope.ts` (and/or `main.rs`) in place to emit declared-unproven vocabulary on win32: trips BOTH byte-pin lists, forces a rebaseline of files that decision 13 just parked as frozen upgrade-path assets, and breaks the pinned capsule test files that assert the exact vocabulary the capsule itself legitimately keeps (it is the hosted seam that must stop repeating the claim, not the capsule that must stop making it internally). Rejected.
- (b) A from-scratch Job-object scope (TS + new native code): discards the measured-working kill path, reopens the native-assembly work that was correctly refused a runtime bridge (stdout multiplexing = receipt forgery surface), and adds build surface for zero honesty gain. Rejected.
- (c) Chosen: a thin new `win32-best-effort-scope.ts` that delegates `prepare/activate/inspect/terminate` to an unmodified `createNativeProcessScope()` and translates at the seam. Zero pinned bytes change; the capsule's kill mechanics (group of Job members, TerminateJobObject 137, KILL_ON_JOB_CLOSE) are retained bit-for-bit; the hosted seam speaks only the honest vocabulary.

Translation rules (the wrapper owns a per-ref state map for scopes it prepared, mirroring the POSIX scope's daemon-lifetime posture):

| Capsule outcome | Wrapper result |
| --- | --- |
| `prepare` succeeds | prepared scope with `declaration: WIN32_BEST_EFFORT_DECLARATION` attached |
| terminate/abort acknowledges `SCOPE_EMPTY` (receipt `state: 'closed'`) | `declared-unproven` receipt, outcome `cancelled`, `forced: true`, `groupObservedEmpty: true` (Job accounting observed empty - diagnostic, never proof) |
| live `closed` promise resolves `ScopeEmptyReceipt` without a cancel in flight | `declared-unproven` terminal, outcome `completed`, same diagnostic honesty |
| transport/controller loss, protocol violation, or control timeout | `uncertain` with the typed failure, authority retained - NEVER a declared-unproven terminal |
| `retained` receipt | passed through unchanged |
| abort before activate | `never-activated / emptiness-unproven`, nothing signalled |

The invariant that carries SEC-001's expected structural closure: a declared-unproven terminal is mintable only from an actual capsule protocol outcome (`SCOPE_EMPTY` acknowledged end-to-end). Loss of the control channel can only produce `uncertain`, and `receiptAuthorizesRelease` refuses `uncertain` regardless of declaration, so transport loss can never become a clean detach or a release.

### D4: Foreign and stale win32 refs translate conservatively but do not wedge

For refs the wrapper did not prepare (prior daemon lifetime), it delegates to the capsule's one-shot probe and translates: probe `live` stays live (controllable); probe `foreign`/`uncertain` pass through (no release; honest loss per decision 11); probe `closed` - the Job observed empty and gone - becomes a `declared-unproven` observation/receipt (outcome `completed` on inspect, `cancelled` on terminate, diagnostic naming the one-shot observation). Rationale: `closeDurableProcess` must be able to reap stale records after daemon restart (returning only uncertainty would wedge sessions as `session-busy` forever), and the Record's language must stay emptiness-unproven rather than repeating the capsule's exact claim. The declaration needed for release is read from the persisted record, which carries it from prepare time.

### D5: Additive win32 semantics vocabulary; no persisted-record change

`process-scope.ts` (not pinned) gains `WIN32_BEST_EFFORT_SCOPE_SEMANTICS` - descriptive tokens `own-job-object`, `job-kill-cancel`, `kill-on-job-close-teardown`, plus the shared `exact-root-exit`, `bounded-controls`, `honest-unproven-terminal` - and the `BestEffortScopeDeclaration.semantics` element type widens additively to the union. `BEST_EFFORT_SCOPE_SEMANTICS` (the POSIX list) is renamed nowhere and its members change nowhere; nothing is added to the frozen `RECURSIVE_PROCESS_SCOPE_SEMANTICS`. The hosted-session record continues to persist only `tier`/`exactCancel`/`scopeEmptyProof` - the strict-allowlist registry sees no new keys, and the win32 declaration is visible pre-start through exactly the same record fields and API projection as darwin's today.

### D6: KILL_ON_JOB_CLOSE teardown is claimed as a chain and proven as a receipt

The claimed mechanism: daemon death closes the controller's stdin pipe; the controller/supervisor processes exit on EOF (`main.rs` frame readers error on `UnexpectedEof`); the last Job handle closes; `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (`main.rs:677`) makes the kernel terminate remaining Job members. This chain is plausible from source but is NOT assumed: the Windows receipt task kills a real daemon with a live hosted workload on this host and verifies the workload tree died, with the stale record reported honestly on the next daemon. If the receipt disproves any link of the chain, that is a finding to surface, not a reason to widen the declaration.

### D7: Platform coverage is exactly darwin+linux (POSIX) and win32 (Job wrapper)

`hosted-process-scope.ts` selects: `darwin` and `linux` to the POSIX best-effort scope; `win32` to the win32 best-effort scope; every other platform keeps the legacy path unchanged. Other POSIX platforms (freebsd, etc.) are unsupported hosts this Direction makes no claims about; widening them silently would be an undeclared support claim. Rollback is reverting the selection edit, which restores today's routing exactly.

### D8: What this change says about SEC-001

The proposal and evidence phrase it as: the win32 honest re-declaration is expected to structurally close SEC-001's shape (transport loss can only yield retained uncertainty; only protocol outcomes mint terminals; `uncertain` never releases). The closure change re-grades SEC-001 by reading the finding in full against this structure. This change ships the structure and a dedicated transport-loss guard with a mutation receipt; it does not mark the finding closed.

## Risks / Trade-offs

- [The wrapper reuses `groupObservedEmpty` for Job-accounting observation] -> the field's meaning is "the containment primitive observed empty; diagnostic only, never proof", which holds for both POSIX groups and Windows Jobs; renaming the field would ripple through the frozen darwin vocabulary for zero honesty gain. The wrapper's diagnostics name the Job explicitly.
- [Probe `closed` translated to declared-unproven `completed` could mislabel a scope that was actually cancelled by a prior daemon] -> the outcome field is a lifecycle summary, not a proof; the diagnostic names the one-shot observation; and the alternative (uncertainty forever) wedges stale sessions. Flagged for reviewer attention.
- [Job breakaway: a workload could escape the Job if breakaway flags were ever granted] -> the capsule sets only `KILL_ON_JOB_CLOSE` and the tier declares `exactCancel: false` / `scopeEmptyProof: false` anyway; escape does not falsify the Record. This is why win32 is best-effort too, not a re-assertion of exactness.
- [Renaming the POSIX module invalidates the macOS change's file references] -> historical evidence stays valid as history; live guards are repointed in the same commit; darwin routing itself is covered by the selection guard, so a macOS behavioural regression would be caught at the seam.
- [Pinned capsule tests might interact with the new selection] -> they exercise `createNativeProcessScope` directly, not the selection; a task runs them unchanged and receipts the digests of both pin lists against the COMMIT (not the shared dirty worktree).
- [WSL receipts taken in the repo tree would hit the vitest dist-wipe and Windows-node_modules hazards] -> Linux receipt tasks mandate an external ext4 run tree with its own node_modules; evidence records the tree provenance.
- [Two release paths in `closeDurableProcess` could drift apart] -> guard tasks must exercise BOTH the observation path and the receipt path for linux and win32, with mutations that break each path individually; a single-path-green result is not acceptance.

## Migration Plan

Additive plus one routing change. Linux hosted sessions switch from the legacy capsule (exact claims the review disproved) to the declared POSIX tier; win32 hosted sessions keep their kill mechanics and change only the vocabulary their Record speaks. No stored record migrates: records created before the cutover carry no declaration and keep the exact-tier release rule; records created after carry the declaration from prepare time. Rollback is reverting the `hosted-process-scope.ts` selection edit.

## Open Questions

- None blocking. Two items are deliberately delegated to review rather than settled by fiat here: (1) whether the D4 probe-`closed` translation's `completed` outcome is acceptable Record language for a stale scope whose true history is unknown, and (2) confirmation that the SEC-001 shape is structurally closed by the D3 invariant (the closure re-grade owns that verdict).
