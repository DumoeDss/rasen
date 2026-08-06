## 1. Durable Registry Model and Filesystem

- [x] 1.1 Add strict `rasen-session-registry/1` schemas and TypeScript types for the top-level run registry, logical session identity, immutable launch facts, lifecycle/owner state, stored touch policy, in-flight dispatch fence, and compact terminal wake entries while preserving the existing one-shot registry API.
- [x] 1.2 Implement the trusted canonical-run-directory and `sessions.json` path resolver, canonical cwd/attached-root capture with `fs.realpathSync.native`, platform-aware identity comparison, exact run-id checking, and symlink/non-directory rejection using `path.join`/`path.resolve`.
- [x] 1.3 Implement strict registry reads, deterministic serialization, transition/duplicate validation, monotonic revisions, first-registration creation, typed absent/corrupt/unsupported-schema diagnostics, and the 64-entry terminal wake pruning rule.
- [x] 1.4 Implement owner-aware `sessions.json.lock` read-modify-write transactions and same-directory temporary-file replacement with file flush, bounded Windows transient rename retry, best-effort POSIX directory flush, and writer-owned residue cleanup.
- [x] 1.5 Add focused storage tests for valid round trips, unexpected fields, run mismatch, duplicate identities, invalid transitions, unsupported schema, corrupt/truncated JSON, missing registry behavior, bounded pruning, symlink rejection, and fault injection at write/flush/rename/cleanup boundaries.
- [x] 1.6 Add canonical-path tests using `FileSystemUtils`, `path.join`, and `fs.realpathSync.native` for ordinary POSIX paths, Windows drive/case presentation, supported metacharacters, and symlink/junction alias or retarget regressions.

## 2. Cross-Process Admission and Delivery Fencing

- [x] 2.1 Add hashed per-session wake-lock path derivation and owner-aware wake-lease acquisition/release with structured live-owner, dead-owner, malformed-owner, permission, timeout, and Windows sharing diagnostics.
- [x] 2.2 Implement coordinator registration, list/get, storage-only touch-policy update, and user retirement transitions so later callers use typed operations instead of direct JSON access.
- [x] 2.3 Implement wake admission by stable `sessionKey` and caller-supplied `messageId`, including durable `admitted` state, the pre-dispatch write-ahead fence, duplicate terminal-message handling, and lease ownership across final settlement.
- [x] 2.4 Map supervisor completion, proven pre-delivery failure, timeout/write failure, and `delivery_uncertain` into validated durable lifecycle and wake-ledger transitions without storing message bytes, result bodies, protocol buffers, or diagnostic tails.
- [x] 2.5 Add same-process and spawned cross-process contention tests proving exactly one same-session wake is admitted, a rejected contender performs no spawn/write, dead-owner leases are safely reclaimed, ambiguous/live locks fail closed, and different sessions retain independent admission.
- [x] 2.6 Add crash-boundary tests proving `admitted` without a fence reconciles as pre-delivery failure, `dispatching` without a result reconciles as `delivery_uncertain`, and completed or uncertain message ids are never dispatched again.

## 3. Reconciliation and Supervisor Recovery

- [x] 3.1 Implement an injectable exact Claude transcript probe using the recorded canonical cwd and full Claude session id, accepting only a regular non-symlink file and returning bounded identity/existence/size/mtime facts without latest/prefix matching.
- [x] 3.2 Implement deterministic reconciliation for current-owner host bindings, previous-owner idle/waking/retiring records, lost sessions, stale cwd/transcript/session identity, interrupted starts, dispatch fences, and terminal retirement; never adopt or signal a recorded PID by liveness alone.
- [x] 3.3 Add the narrow existing-supervisor recovery/binding operation that reconstructs an owner-local lost host from validated durable launch facts and resumes it through the current host turn path with the same binary resolution, runtime context, capacity counter, protocol parser, timeout, and process-tree cleanup.
- [x] 3.4 Connect coordinator lifecycle settlement to asynchronous idle process loss and clean owner shutdown so owner reaping clears the durable binding/marks loss but never synthesizes user retirement; make next-operation reconciliation the correctness fallback if prompt persistence fails.
- [x] 3.5 Add restart integration tests with two owner instances proving the new owner refuses old PID adoption, resumes only an exact session/transcript in the immutable canonical cwd, binds a replacement host id/PID to the same logical session, and refuses missing identity, missing transcript, changed path, or corrupt state without spawn.
- [x] 3.6 Add mixed-capacity tests proving live/recovering reusable hosts and one-shot sessions share the existing limit, idle loss releases exactly one slot, recovery reserves before spawn, and unrelated durable sessions remain independent.

## 4. Shared Caller Boundary and Host Non-Regressions

- [x] 4.1 Export one internal management-layer coordinator factory and typed results for register/get/list/reconcile/wake/retire/policy update plus owner shutdown, with injectable supervisor, owner id, clock, filesystem, and transcript probe for later CLI and scheduler children.
- [x] 4.2 Document and enforce at the type boundary that later CLI/HTTP and scheduler code supplies trusted canonical Run admission and calls the same coordinator; add no public route, command, localization, scheduling cadence, or touch-message policy in this change.
- [x] 4.3 Extend focused fake-Claude coverage so durable registration still waits for bootstrap result plus init identity in either order, recovery continues to separate NDJSON framing from bounded tails, and callback/emitted stdin errors settle through the single existing supervisor seam.
- [x] 4.4 Add regression tests proving existing one-shot registry/session behavior, reusable live-host wake/retire behavior, owner drain semantics, Windows shim safety, and structured host error codes remain compatible.

## 5. Verification

- [x] 5.1 Run the focused registry suites with `pnpm vitest run test/core/management-api/session-registry.test.ts test/core/management-api/session-registry-concurrency.test.ts test/core/management-api/session-registry-recovery.test.ts`.
- [x] 5.2 Run `pnpm vitest run test/core/management-api/supervisor-host-lifecycle.test.ts` and the existing focused one-shot supervisor/router suites affected by the narrow management seam.
- [x] 5.3 Run `pnpm build`, then rerun any focused compiled CLI/daemon test required by a touched integration entry point.
- [x] 5.4 Run the focused path, atomic-replacement, dead/live lock, and restart coverage natively on the current Windows tree plus platform-injected POSIX path/lock/atomic semantics; record that this closes only the child-local gate and is not equivalent to real POSIX CI. The mandatory Windows/POSIX matrix on the final exact SHA remains owned by `session-cache-optimization-acceptance-evidence` and the parent delivery.
- [x] 5.5 Inspect the final diff to confirm there is no `src/core/session-host/` subsystem, no public CLI/scheduler implementation, no dependency addition, and no edits under `src/core/change-run/**` or `src/core/pipeline-registry/**`.

## 6. Round 2 Bounded Idempotency Tombstones

- [x] 6.1 Replace the raw-id `messageIdempotency` persistence shape with strict digest-only durable identity: use the named domain-separated SHA-256 digest in `inFlight`, the 64-entry presentation `wakes`, and a renamed `idempotencyTombstones` array whose entries contain only digest plus terminal disposition.
- [x] 6.2 Enforce a per-session hard cap of 4096 tombstones with strict unique ascending digest order and deterministic serialization; look up an existing digest before capacity so it returns its original disposition, while an unseen digest at capacity returns typed `idempotency_capacity_exhausted` before admission, recovery, spawn, stdin write, or registry mutation.
- [x] 6.3 Insert the terminal tombstone and append/prune the 64-entry presentation wake in one locked atomic settlement mutation, preserve every prior tombstone on failures, and keep v1 lookup O(log n) with bounded O(n) insertion/full-file serialization.
- [x] 6.4 Add schema and coordinator regressions for raw-id rejection/no raw id at rest, unknown/duplicate/unsorted/over-cap tombstones, deterministic round trips, atomic replacement failure, a completed and delivery-uncertain duplicate after presentation pruning, full-cap rejection of a new digest, and successful idempotent lookup of an existing digest at the cap.
- [x] 6.5 Run the focused registry/recovery/concurrency suites and `pnpm build`, record the checked-in 4096-entry serialized-size and lookup/mutation budget, and confirm the existing 64-wake presentation, Windows local-platform gate, host lifecycle, and forbidden-directory scope checks remain green.
