## Context

The reusable-host implementation now lives inside `src/core/management-api/supervisor.ts`. A host owns a live Claude `stream-json` child, uses a supervisor-lifetime host id, captures the Claude session id during bootstrap, and can resume a lost child in the immutable canonical cwd. Its state is currently memory-only. The existing `src/core/management-api/session-registry.ts` is also memory-only and serves one-shot management sessions; that API must remain compatible.

The next CLI and scheduler children need a stable logical session identity that outlives a daemon process, plus one wake-admission path that remains single-flight when two OS processes race. Recovery cannot adopt another process's stdin/stdout pipes, and a PID is not proof that the current owner can communicate with a child. The canonical Claude transcript is useful corroborating evidence for resume eligibility, but it cannot prove whether an arbitrary stdin message was consumed.

Constraints carried from the host-lifecycle child and parent plan:

- Live and recovering reusable hosts consume the existing supervisor capacity. Idle process loss releases that slot, and resume reacquires it before spawn.
- Recovery uses only the recorded Claude session id, trusted launch facts, and immutable canonical cwd.
- Once stdin accepts a message, loss before a result is `delivery_uncertain`; that message is never replayed automatically.
- Owner shutdown reaps children but is not user retirement, so the durable logical session remains recoverable.
- Bootstrap waits for both the result and init identity in either order.
- Callback and emitted stdin failures remain unified in the supervisor's existing settlement seam.
- NDJSON protocol framing remains separate from bounded diagnostic tails.
- Correctness must not depend on daemon uptime.
- This auto-decomposed child has local delivery only. It cannot produce GitHub
  Windows/POSIX matrix evidence for its uncommitted partial tree without
  violating the portfolio's single parent delivery.
- No parallel `src/core/session-host/` subsystem and no edits to `src/core/change-run/**` or `src/core/pipeline-registry/**`.

## Goals / Non-Goals

**Goals:**

- Define and persist a strict, versioned per-run reusable-session registry.
- Preserve canonical cwd, Claude session identity, launch facts, lifecycle metadata, touch policy, a 64-entry presentation wake ledger, and a bounded non-evicting idempotency tombstone index across process restarts.
- Make each registry mutation atomic and serialized across processes on Windows, macOS, and Linux.
- Provide a per-logical-session wake lease and write-ahead delivery fence so concurrent or interrupted dispatch cannot duplicate a turn.
- Reconcile records using the current supervisor's in-memory host binding plus exact cwd and transcript facts, failing closed when recovery cannot be proved safe.
- Keep one coordinator seam that later CLI routes and the touch scheduler can call.
- Close the child-local platform gate with native Windows focused coverage and
  platform-injected POSIX path/lock/atomic semantics while preserving a
  separate, mandatory exact-tree matrix gate for portfolio acceptance.

**Non-Goals:**

- Public `rasen session` commands, HTTP routes, localization, daemon startup policy, or UI.
- Touch cadence, deadline calculation, message content, retry policy, or automatic scheduling.
- Adopting a child process whose stdio belongs to an earlier owner.
- Persisting prompts, complete results, stdout protocol buffers, or diagnostic tails.
- Changing one-shot session behavior, the canonical Run store, pipeline-registry contracts, or supervisor process-capacity semantics.
- Treating daemon presence, daemon state files, or a bare PID as correctness evidence.
- Claiming that platform-injected POSIX semantics are equivalent to execution
  on a real POSIX GitHub runner.

## Decisions

### 1. Extend the management supervisor seam instead of adding a second host subsystem

`session-registry.ts` will retain its existing one-shot registry exports and add separately named durable reusable-session types and factories. A `SessionHostCoordinator` in the management API layer will compose the durable store with the existing `SessionSupervisor`. Later CLI and scheduler code must use this coordinator; they must not mutate `sessions.json` or call reusable-host wake/recovery primitives independently.

The supervisor will gain only the narrow hook needed to reconstruct an in-memory lost host from trusted durable facts and resume it through the existing host turn path. The resumed process therefore continues to use the same binary resolver, runtime-context injection, `liveCount` capacity reservation, stream parser, bounded tails, timeout settlement, process-tree cleanup, and stdin-failure seam. The durable `sessionKey` is stable across owner restarts; a supervisor `hostId` remains an owner-local binding and may change after restart.

An optional lifecycle observer may record asynchronous process loss promptly, but correctness will not rely on delivery of that observer event. Every durable operation reconciles before acting.

Alternatives considered:

- A new `src/core/session-host/` service would duplicate supervisor ownership and make capacity and shutdown accounting ambiguous.
- Teaching a short-lived CLI to own the pipe would end host reuse when the command exits.
- Reusing the one-shot registry record shape would conflate one-shot process history with durable logical reusable sessions.

### 2. Store one strict `rasen-session-registry/1` file beside canonical Run state

For an already-admitted canonical run directory, the registry path is:

`path.join(canonicalRunDir, 'sessions.json')`

In the current Run layout this is `<globalDataDir>/runs/<canonical-run-directory>/sessions.json`. The coordinator accepts a trusted, absolute canonical Run directory from the existing Run admission path; it does not create a Run or reproduce Run-record selection. It verifies that the directory exists, canonicalizes it with `fs.realpathSync.native`, and derives every registry/lock path with `path.join`.

The top-level schema is:

```text
{
  schema: "rasen-session-registry/1",
  runId,
  revision,
  updatedAt,
  launcherSessionIds,
  sessions
}
```

Each session record contains:

- `sessionKey`: stable logical key within the run.
- `role`, optional `nodeId`, and optional `invocationId`: workflow identity without importing pipeline-registry types.
- `hostKind: "stream-json"`.
- `cwd`, `attachedRoots`, `space`, and `execution`: immutable trusted launch facts; optional resolved `model`/`effort` metadata may be recorded when supplied by a later caller.
- `claudeSessionId` once init identity has been captured.
- `status`: `starting`, `idle`, `waking`, `lost`, `stale`, `retiring`, or `retired`.
- Optional `owner`: `ownerInstanceId`, owner PID, owner-local `hostId`, child PID, and `boundAt`.
- `lifecycle`: `createdAt`, `updatedAt`, and optional wake, loss, recovery, retirement, and reason timestamps/metadata.
- `touchPolicy`: storage-only `mode`, deadline, maximum/used touches, and deadline action. This child does not interpret it.
- Optional `inFlight`: domain-separated SHA-256 message-id digest, admission timestamp, phase (`admitted` or `dispatching`), and dispatch-fence timestamp.
- `wakes`: the newest 64 terminal presentation entries containing the same fixed message-id digest, timestamps, outcome, and optional result reference/digest. Raw message ids, raw messages, and complete results are excluded.
- `idempotencyTombstones`: a strictly sorted, unique array of at most 4096 entries. Each entry contains only the lowercase 64-hex SHA-256 message-id digest and the terminal disposition needed to answer a duplicate.

Before any durable write, the coordinator hashes the caller's UTF-8
`messageId` with a named domain-separated encoding such as
`sha256("rasen-session-message-id/1\0" + byteLength + ":" + messageId)`. The raw
caller id remains process-local: the in-flight fence, presentation wake, and
tombstone all use the digest. A practical SHA-256 collision is treated
fail-closed as an existing id, which can deny a new wake but cannot replay an
old one.

The two retained collections serve different contracts:

- `wakes` is human-facing recent history. It is capped at 64 and prunes only
  its oldest terminal entry.
- `idempotencyTombstones` is never evicted within v1 because eviction would
  reopen replay. It has a per-session hard cap of 4096. Admission checks for an
  existing digest before checking capacity, so a known digest at the cap still
  returns its original disposition. An unseen digest at the cap returns typed
  `idempotency_capacity_exhausted` before admission, recovery, spawn, or stdin
  delivery and performs no mutation.

Tombstones serialize in strict ascending digest order and reject duplicates,
unknown fields, invalid dispositions, or more than 4096 entries. Terminal
settlement inserts the new tombstone and prunes the presentation ledger in the
same locked atomic registry mutation. All arrays and object fields serialize
deterministically, timestamps are ISO-8601 UTC strings, `revision` increases on
every committed mutation, and all schemas are strict. Duplicate session keys,
unexpected fields, run-id mismatch, invalid transitions, or an unsupported
schema are corruption, not defaults.

At roughly 130–160 bytes per pretty-serialized `{ digest, disposition }`
tombstone, 4096 entries budget approximately 0.51–0.63 MiB per fully used
session (conservatively below 0.75 MiB before surrounding session metadata).
The sorted array supports binary-search lookup in O(log n), while insertion and
the already-required whole-file atomic serialization remain O(n). The hard cap
bounds those per-session costs; a run with many sessions still grows
proportionally and is an explicit v1 trade-off.

If no file exists, registration may atomically create the first registry. A read/wake for an expected session treats absence as not found and never silently creates a replacement logical session. Existing pre-feature runs need no migration until their first reusable session is registered.

Alternatives considered:

- Machine-global `sessions.json` creates one contention and corruption domain for every run.
- Project work directories are enhancement state and can move or be absent; they are not canonical Run truth.
- Per-session JSON files make multi-session listing and cross-record uniqueness non-atomic.

### 3. Canonical path identity is recorded once and re-proved before resume

At registration, cwd and attached roots must be absolute existing directories and are stored from `fs.realpathSync.native`. The stored cwd is immutable. Recovery resolves that exact stored path again and compares a platform-aware identity key: separator-normalized and case-folded only on Windows. The canonical string retained in the record is the value used as the spawn cwd.

A missing directory, a symlink/junction retarget, or a physical path that no longer resolves to the recorded identity makes the record `stale` and blocks spawn. A caller cannot supply a replacement cwd during wake or recovery. Tests use `FileSystemUtils`, `path.join`, and `fs.realpathSync.native`, including alias-path coverage required by `test/AGENTS.md`.

Registry and transcript candidates are checked with `lstat`; a symlink in place of the expected state/transcript file is rejected. Windows drive-letter/case presentation differences are compared as Windows identities without lowercasing the stored spawn path.

Alternative considered: `path.resolve` alone is lexical and would allow a symlink or junction alias to change the physical session identity.

### 4. Registry mutation and wake ownership use two different owner-aware locks

Short read-modify-write transactions use:

`path.join(canonicalRunDir, 'sessions.json.lock')`

A wake spanning process recovery and a Claude turn uses:

`path.join(canonicalRunDir, 'session-wake-locks', sha256(sessionKey) + '.lock')`

Both use the existing owner-aware lock primitive: `wx` acquisition, PID-plus-nonce ownership, bounded retry, provably-dead-owner stealing, and token/identity-safe release. Raw session keys never become path components. A live same-session lease returns a typed busy outcome without a stdin write or recovery spawn. Windows sharing violations are retried only within the same bounded deadline; unreadable, malformed, or ambiguously owned locks are never stolen. Different session keys have independent leases and remain subject to the supervisor's shared process capacity.

The registry mutation lock is held only while parsing, validating, transitioning, and atomically replacing `sessions.json`. It is never held while resolving Claude, spawning, writing stdin, or waiting for a result. The wake lease is held across admission, any recovery, result settlement, and the final durable transition.

Alternative considered: holding the single registry lock for an entire Claude turn would serialize unrelated sessions and turn an ordinary long request into global contention.

### 5. Mutable registry replacement is crash-safe on Windows and POSIX

While holding the mutation lock, a writer re-reads the current revision, validates the expected transition, writes deterministic JSON plus a final newline to a uniquely named sibling temporary file, flushes the file, and renames it over `sessions.json`. POSIX parent-directory flush is best effort. Windows `EPERM`, `EACCES`, and `EBUSY` replacement failures receive bounded retry while the lock remains held. Failure cleans only the writer's named temporary file and leaves the prior registry untouched.

Readers therefore observe either the complete old revision or complete new revision. Leftover named temporary files are never considered registry candidates. The implementation exposes filesystem plumbing to focused fault-injection tests for write, flush, rename, and cleanup boundaries.

Alternative considered: direct overwrite can expose truncated JSON after process death and would turn a recoverable host into corrupt state.

### 6. Every dispatch has durable admission and a conservative write-ahead delivery fence

The coordinator's wake sequence is:

1. Acquire the session wake lease.
2. Hash the caller-supplied stable `messageId` in memory, then under the
   registry lock strictly read and reconcile the target. Return the recorded
   disposition for an existing digest; otherwise reject retired, stale,
   corrupt, busy, or full-idempotency-capacity state.
3. Persist `inFlight.phase = "admitted"` and a wake-ledger admission using only
   the message-id digest.
4. Before invoking any supervisor operation that can write the message, persist `inFlight.phase = "dispatching"` and `dispatchFenceAt`.
5. Call the existing live wake path or the narrow resume path.
6. Under the registry lock, atomically insert the sorted digest/disposition
   tombstone, append/prune the 64-entry presentation wake, record `completed`,
   a proven pre-delivery failure, or `delivery_uncertain`, update
   owner/status, and then release the wake lease.

No raw message id or message bytes are persisted. A crash after step 4 is conservatively reconciled as `delivery_uncertain`, even if the process may have failed before accepting stdin. This may produce a false-positive uncertainty, but it cannot produce a duplicate Claude charge. A known supervisor failure before stdin acceptance may be recorded as a safe failed attempt. A result event is completion proof. The same `messageId` digest can never be dispatched again after completion or uncertainty, including after its presentation wake is pruned.

The coordinator consumes the supervisor's typed settlement result. It does not add a second callback/error handler around stdin, and it does not infer protocol completion from bounded stdout tails.

Alternative considered: setting an “accepted” flag after `Writable.write` leaves an unavoidable crash window in which stdin may have accepted the bytes but disk still says replay is safe.

### 7. Reconciliation trusts current-owner handles and exact transcript facts, never PID alone

Each coordinator/supervisor instance has an opaque random `ownerInstanceId`. A durable owner binding is considered live only when:

- its instance id matches the current coordinator,
- `supervisor.getHost(owner.hostId)` returns an in-memory host,
- the returned Claude session id and canonical cwd match the durable record, and
- the returned process/state facts are compatible with the durable status.

Any binding from a previous owner is non-adoptable because the new process lacks its stdin/stdout handles. Reconciliation marks it lost and never signals or adopts the recorded PID, even when that PID is live.

A lost record is resume-eligible only when it has a Claude session id, its canonical cwd still matches, and the exact main transcript is a regular non-symlink file at:

`path.join(claudeProjectsDir(record.cwd), record.claudeSessionId + '.jsonl')`

The transcript probe records existence, size, and modification time as evidence. It never chooses “latest,” scans for a prefix, or treats transcript timing as proof that a particular message was delivered. Missing or conflicting identity evidence makes the record `stale` and returns a typed unrecoverable result without spawning.

On eligible recovery, the supervisor creates a new owner-local lost-host entry and resumes the captured session through its existing host path. The durable record enters `waking`, then binds the replacement host id/PID and returns to `idle` after a result. Capacity is reserved by the supervisor, not the registry.

Reconciliation of interrupted state is deterministic:

- `admitted` without a dispatch fence becomes a proven pre-delivery failed wake.
- `dispatching` without a terminal result becomes `delivery_uncertain` and lost.
- `starting` without captured Claude identity becomes stale/unrecoverable.
- A previous-owner `idle`, `waking`, or `retiring` record becomes lost before any new action.
- A user-retired record remains terminal.
- Clean owner shutdown reaps the process and records loss/clears the binding; it does not synthesize user retirement.

Corrupt JSON, unsupported schema, inconsistent duplicates, a run mismatch, or ambiguous lock ownership returns a typed diagnostic and causes no rewrite, spawn, stdin write, or retirement. Recovery is available on demand in any resident or foreground owner; daemon startup reconciliation is an optimization only.

Alternatives considered:

- PID liveness cannot establish pipe ownership and is vulnerable to PID reuse.
- Automatically replaying a transcript-unconfirmed message violates the accepted-stdin uncertainty contract.
- Treating every shutdown as retirement would silently discard reusable logical sessions during upgrades or daemon restarts.

### 8. CLI and scheduler integration share the coordinator but remain separate children

This child exposes internal operations for register/create binding, list/get, reconcile, wake by `sessionKey` plus `messageId`, retire, and storage-only touch-policy update. It does not define CLI spelling, HTTP wire contracts, localized presentation, scheduler intervals, touch prompts, or deadline behavior.

The CLI integration child will route user operations to the resident management owner (or an explicitly constructed foreground owner) and surface the coordinator's typed outcomes. The scheduler child will call the same wake operation and message-id discipline; it receives no privileged JSON or supervisor bypass. Thus daemon availability affects convenience and liveness, not registry consistency or replay safety.

### 9. Platform evidence is split between the local child gate and final portfolio delivery

This registry child closes only evidence that can be reproduced on its local
delivery tree:

- run the focused registry path, atomic-replacement, owner-lock, and restart
  suites natively on Windows;
- exercise platform-injected POSIX path comparison, separator, lock-error, and
  atomic replacement/fsync semantics in focused tests; and
- retain the results as child review evidence.

Injected POSIX semantics validate deterministic branches but do not execute
real POSIX filesystem/process behavior. They therefore do not satisfy or waive
the repository's Windows + POSIX CI requirement.

The exact-tree matrix gate belongs to
`session-cache-optimization-acceptance-evidence` and the parent portfolio
delivery. After all children are integrated, the parent makes the portfolio's
single commit/push or PR delivery. The acceptance evidence must bind the final
commit SHA to successful existing CI jobs `linux-bash`,
`linux-bash-node24`, and every Windows PowerShell shard, and retain the run
URLs. Registry review cannot mark that final gate complete from local
emulation, from a different SHA, or by independently pushing this partial
child.

Alternative considered: independently pushing the registry child would make
CI runnable sooner, but it would test a partial tree and violate the declared
local-child/single-parent-delivery policy.

## Risks / Trade-offs

- [A dispatch crash can be classified uncertain even before stdin accepted bytes] → Prefer a conservative false positive to duplicate delivery; surface the terminal wake outcome and allow a later wake with a new message id.
- [A live PID reused after a crash can leave an owner-aware lock conservatively busy] → Fail closed with the exact lock path and owner diagnostic; never steal without kernel proof of death.
- [Mutable replacement behaves differently under Windows sharing/antivirus interference] → Use same-directory temp files, bounded transient retry, ownership-safe locks, and fault-injected Windows-code tests.
- [Transcript layout can change in a future Claude release] → Reuse `claudeProjectsDir`, require an exact session-id filename, keep the probe narrow, and return stale/unrecoverable rather than guessing.
- [Caller message ids can contain sensitive or correlatable text] → Hash ids
  before the first durable transition and persist only domain-separated
  SHA-256 digests. Digests are pseudonymous, not encryption; low-entropy ids
  remain guessable, so callers should generate high-entropy stable ids.
- [Never-evict replay protection conflicts with unbounded session lifetime] →
  Cap tombstones at 4096 per session and fail a new digest closed with
  `idempotency_capacity_exhausted`; check existing digests first so duplicate
  answers remain available at capacity.
- [A single per-run JSON file can grow and costs O(n) to rewrite] → Keep
  presentation wakes at 64, keep tombstones fixed-size and sorted, cap them at
  4096 (about 0.51–0.63 MiB per full session), use binary lookup, and accept
  bounded O(n) insertion/atomic serialization in v1.
- [Lifecycle observers can fail after a child exits] → Treat observers as prompt metadata updates only; reconcile from current-owner handles and durable fences before every operation.
- [Injected POSIX branches can hide a real runner/filesystem difference] →
  Keep them as the child-local gate only; require the existing Windows/POSIX
  matrix on the final exact SHA at acceptance before portfolio delivery is
  considered complete.

## Migration Plan

1. Add strict v1 types, path validation, owner-aware locks, atomic replacement, and a standalone durable store beside the existing one-shot registry API.
2. Add the 64-entry digest-only presentation ledger and sorted, unique,
   digest-only 4096-entry tombstone index. The earlier raw-id
   `messageIdempotency` shape existed only in this unshipped child and is not a
   released v1 compatibility contract; strict readers reject that obsolete
   shape rather than silently retaining or converting caller ids.
3. Add coordinator transitions and deterministic reconciliation with injectable clock/filesystem/transcript probes.
4. Add the narrow supervisor recovery/binding hook and lifecycle observer without changing existing one-shot or reusable-host call behavior.
5. Verify focused registry, cross-process, restart, uncertainty, path-alias,
   and supervisor integration cases natively on Windows plus injected POSIX
   semantics; do not label this as real POSIX CI evidence.
6. Later CLI and scheduler children consume the coordinator. No existing run receives a registry until a reusable session is registered.
7. At the acceptance merge node, the parent delivers the final integrated
   exact tree once and records the successful Windows/POSIX CI matrix SHA and
   run URLs before portfolio completion.

Rollback removes the new coordinator calls and leaves `sessions.json` as inert machine-local state. Readers of v1 never downgrade, reset, or rewrite an unknown future schema.

Any future schema version that raises the cap or changes the index
representation must use an explicit atomic migration. It must preserve every
v1 digest and disposition, fail closed if the target cannot represent all
tombstones, and publish the new version only after complete validation. A
migration may compact encoding or shard the index, but it may not evict a v1
tombstone or reconstruct/store a raw caller id.

## Open Questions

None. CLI naming, scheduler policy, and touch message content are intentionally delegated to their dependent changes rather than left as registry design questions.
