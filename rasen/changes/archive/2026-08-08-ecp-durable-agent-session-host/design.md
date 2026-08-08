## Context

ECP-6 already owns the deterministic Run, frozen Action, immutable execution profile, EvidenceStore, and signed-completion verification boundary. Its remaining execution gap is not another Run state machine: it is a process host that can keep one real agent Session alive, accept later turns, survive driver replacement, and recover conservatively after daemon/process failure.

The current code has two useful but separate foundations:

- `management-api/supervisor.ts` launches a one-shot `claude -p` long runner with ignored stdin, bounded stdout/stderr tails, watchdogs, process-tree kill, and an in-memory `Map` registry. The Management Session routes and daemon lifecycle are already compatible user surfaces, but server restart intentionally forgets every Session.
- `agent dispatch --runtime claude` builds one print/resume invocation per turn. `claude/session-state.ts` already provides canonical-cwd binding, atomic cross-process single-writer claims, worker-tree ownership, serialized stale-claim recovery, and fail-closed ambiguity. It does not retain a bidirectional process or a durable host lifecycle.
- `daemon.ts` owns the Management server beyond any caller terminal and cleanly reaps supervised process trees, but it reconstructs a new in-memory supervisor/registry on every start.

`docs/session-execution-layer-design.md` establishes the supported real-backend premise: a live `--input-format stream-json --output-format stream-json` process is the normal host, while exact `--resume` is the recovery path. The document's older Run-keyed registry and policy/touch sections are inputs, not authority for this child. This Change is deliberately narrower: durable host lifecycle only.

The implementation must run on Node.js 20.19+ on Windows, Linux, and macOS; preserve existing Management Session behavior; remain usable from a replacement CLI driver; and provide deterministic verification without requiring a live account or network. This child proves real process behavior on its current host and exercises every defined Windows/POSIX branch through injected deterministic fixtures; ECP-8 owns the final actual Windows/Linux/macOS remote CI matrix.

## Goals / Non-Goals

**Goals:**

- Provide one deep, backend-neutral Session host module that hides process ownership, protocol framing, durable lifecycle mutation, recovery, and cleanup behind a small command interface.
- Ship a production Claude adapter using a resident stream-json transport for create/wake and an exact-session resume transport for recovery.
- Bind every Session permanently to one canonical cwd and allow at most one active request/writer for the exact Session across processes.
- Persist host lifecycle atomically so a new daemon or driver can inspect, reattach logically to a live daemon, restart a recoverable Session, or report an ambiguous interrupted turn without replaying it.
- Preserve the existing `/api/v1/sessions` launch/list/detail/kill contract and its current `state` values while adding hosted lifecycle facts and CLI control additively.
- Verify protocol and fault behavior through deterministic replay fixtures plus real OS processes and process trees.

**Non-Goals:**

- Claiming, granting, executing, completing, or mutating a canonical Run/Action/Record.
- Creating or holding Ed25519 signing private keys, trusted-completion authority, evidence verification, or producer credentials.
- Defining Session reuse, handoff, touch cadence, backend-capacity, cost, model, permission, workspace-access, or retirement policy. Callers supply already-resolved typed launch facts; policy is a later ECP-7 child.
- Canvas/Operations UI, public policy configuration, Run projection parity, audit economics, or ECP self-hosting.
- ECP-8 release work or any 0.3.0 Issue, Execution Plan, portfolio runtime, Dispatch, or `auto-decompose` migration.

## Decisions

### 1. Put the deep module at the lifecycle seam, not at the HTTP or Claude seam

The external module interface is command-shaped:

```ts
type SessionHostCommand =
  | { op: 'execute'; requestId: string; sessionId?: string; backend: BackendRef; cwd: string; input: string; limits: TurnLimits }
  | { op: 'cancel'; sessionId: string; reason: string }
  | { op: 'restart'; sessionId: string }
  | { op: 'retire'; sessionId: string; reason: string };

interface SessionHost {
  dispatch(command: SessionHostCommand): Promise<SessionHostOutcome>;
  inspect(sessionId: string): SessionHostView | undefined;
  list(filter?: SessionHostFilter): SessionHostView[];
  reconcileOnStart(): Promise<SessionRecoveryReport>;
  shutdown(reason: 'daemon-stop' | 'server-shutdown'): Promise<void>;
}
```

The interface includes ordering and failure semantics: `requestId` is idempotent within retained request history; `cwd` is canonical and immutable after create; `retired` is terminal; and `dispatch` returns typed failures rather than throwing protocol/process details through CLI or HTTP. Management handlers and the Session CLI are shallow adapters over this interface. Tests exercise the same interface.

Internally, a narrow backend port varies only what truly varies:

```ts
interface AgentSessionBackend {
  readonly id: string;
  open(input: BackendOpenInput): Promise<AgentSessionTransport>;
}

interface BackendProcessAdmission {
  readonly signal: AbortSignal;
  readonly rootPid?: number;
  commit(rootPid: number): void;
}

interface BackendTurnStream extends AsyncIterable<BackendEvent> {
  readonly accepted: Promise<void>;
}

interface AgentSessionTransport {
  send(turn: BackendTurn): BackendTurnStream;
  terminate(reason: string): Promise<BackendTermination>;
}
```

The production Claude adapter and deterministic replay adapter are two real adapters at this seam. Process claims, lifecycle transitions, result correlation, time/output bounds, and registry writes stay inside `SessionHost`, not reimplemented by each caller or backend.

Alternatives considered:

- Extending every caller with `create/wake/resume/kill` primitives was rejected as a shallow interface that would duplicate lifecycle ordering and recovery rules.
- Putting persistence directly in HTTP handlers was rejected because CLI, daemon restart, and future internal Action execution need the same behavior without HTTP ownership.
- A Claude-only host was rejected because protocol details would leak into lifecycle state and make deterministic replay test a second implementation rather than an adapter.

### 2. Keep a Rasen Session identity stable across backend process generations

Rasen mints one UUID `sessionId`; a separate `backendSessionId` records the Claude identity discovered from the init/result stream. `generation` increments whenever the host opens a replacement process. PID and process-group facts belong to one generation and are never treated as durable proof that a later OS process is the same worker. Writer and worker tokens therefore bind their PID to a captured OS process-start identity; every liveness, signal, and stale-reap decision compares the current instance first and treats PID reuse or probe failure as non-authority.

Hosted lifecycle states are:

```text
starting -> idle -> active -> idle
                 -> cancelling -> interrupted
idle|interrupted -> recovering -> idle
starting|recovering -> failed
idle|active|interrupted|failed -> retiring -> retired
```

Only one request may be `prepared`, `sent`, or `awaiting-result` for a Session. `retired` is terminal. `failed` means no safe automatic recovery exists; `interrupted` means the exact backend identity is recoverable but the last turn outcome may be unknown.

For wire compatibility, existing `SessionRecordWire.state` remains `starting | running | exiting | exited`. Hosted records add `hostState`, `backend`, `backendSessionId`, `generation`, and current-request/recovery diagnostics. The compatibility projection maps `idle|active|recovering|interrupted` to `running`, `cancelling|retiring` to `exiting`, and `retired|failed` to `exited`. Existing auto/goal one-shot launches retain their current lifecycle and response shapes.

Alternative considered: using the backend Session id as the public key was rejected because restart generations, backend replacement, and future adapters must not change user-visible identity or registry addressing.

### 3. Persist only host lifecycle in an owner-restricted atomic registry

The machine-local registry lives below the existing Rasen data home, resolved with `path.join`, under a named `session-host` directory. Its schema is versioned as `rasen-session-host-registry/1`. It contains:

- stable Rasen Session id, backend id/version premise, canonical cwd and its identity digest;
- lifecycle state, generation, backend Session id, current/last known process-tree root, owner generation, and timestamps;
- a monotonic per-Session lifecycle revision used for exact command CAS independently of backend process generation;
- bounded request metadata: request id, input digest, generation, state (`prepared | sent | settled | cancelled | ambiguous`), result digest/reference, and bounded sanitized diagnostics;
- recovery/retirement reason and the existing compatible planning/execution attribution when present.

It does not persist prompt text, arbitrary result bodies, executable Actions, completion claims, Run/Record state, environment values, credentials, or signing material. Full backend transcripts remain owned by the backend; returned turn results flow to the caller and later ECP layers.

All mutation happens under an owner-aware O_EXCL lease. The writer rereads and validates the current schema, process generation, and lifecycle revision, writes a same-directory candidate with owner-only permissions, flushes it, and atomically replaces the registry; Windows sharing/antivirus rename failures receive bounded retry. Readers observe either the old complete document or the new complete document. Unknown schema, invalid canonical paths, digest mismatch, or malformed JSON fails closed and preserves the original bytes for diagnosis; the host never silently resets to an empty registry.

Settled request metadata is bounded per Session, but an unfinished/ambiguous request is never pruned. Reusing a retained `requestId` returns its recorded outcome or current state and never writes the input twice.

Alternatives considered:

- Reusing the canonical Run directory was rejected because this child must work without a Run and must not imply that host facts are execution truth.
- One append-only NDJSON journal was rejected as the primary record because truncated tail recovery complicates Windows locking and makes current-state reads replay an unbounded log. Deterministic protocol captures remain separate test/evidence artifacts.
- Replacing the existing Claude writer-claim logic was rejected; its canonical cwd, hard-link election, worker-token, tombstone, and fail-closed stale recovery semantics are generalized/reused rather than forked.

### 4. Use a resident stream-json process for normal turns and exact resume for recovery

The Claude adapter starts an inert local admission supervisor through
`spawnAgentCli` with an argv array, `shell: false`, `windowsHide: true`, piped
stdin/stdout/stderr, and the existing resolved/canonical cwd. The supervisor is
the exact process-tree root: it cannot spawn the Claude child until the host
commits that root to the nonce-bound worker token and releases a private
activation pipe. If admission fails or the bridge dies first, the inert
supervisor exits without starting Claude. Prompt content is encoded as the
documented stream-json user message on stdin, never placed in argv or the
registry. The fixed backend argv includes print mode, `--input-format
stream-json`, `--output-format stream-json`, verbose protocol output, and typed
backend launch facts selected before they reach this module.

On Windows, the inert supervisor is assigned before activation to a kill-on-close Job Object held by a separate controller. Backend descendants inherit that Job even when they create a detached process group, so direct supervisor death closes the Job and reaps the descendants. POSIX uses the admitted supervisor's process group, whose identifier remains reserved while descendants survive. The adapter owns a stateful UTF-8 NDJSON decoder. It accepts fragmented chunks, bounds each line/turn/tail, validates init/result event shape, captures the exact backend Session id, and correlates one terminal result to the single active request. Unknown well-formed events are retained only as bounded diagnostics; malformed, oversized, duplicated-terminal, missing-init, or out-of-order events produce typed failures and terminate the affected generation.

Create opens a fresh resident transport and sends the first turn. Wake writes one later turn to the same transport only after the durable claim and `prepared` record exist. Recovery opens a new resident stream-json transport with `--resume <backendSessionId>` in the same canonical cwd; the first recovery opening may pay the backend rebase cost but subsequent turns use the live transport again.

Alternative considered: spawning `claude -p --resume` for every wake was rejected because the verified repo-cwd prefix can re-render and lose the live-process cache benefit. A socket broker/Agent SDK dependency was rejected as unnecessary for the supported CLI protocol.

### 5. Recovery never replays an ambiguous turn

Before a turn reaches stdin, the host atomically records `prepared`; after the write is accepted, it records `sent`; after one validated terminal result, it records `settled` and returns to `idle`. A daemon/bridge failure at any boundary is classified from the durable request state and positively identified process-tree facts:

The transport exposes a mandatory stdin-acceptance promise, so a missing or
failed write fence leaves the request pre-acceptance rather than ambiguous. The
turn overall deadline starts before awaiting that fence. Initialization,
output-inactivity, and overall event timers are independent;
initialization/output events clear or reset only their own clock and all clocks
are cleared exactly once on settlement, close, cancellation, or failure.

- An idle Session with a backend Session id becomes recoverable. The next wake or explicit restart opens the exact backend identity and increments the generation.
- A replacement driver talking to the same live daemon simply reattaches to the stable Rasen Session id; no process or prompt is restarted.
- A dead generation with a `prepared`, `sent`, or `awaiting-result` request and no settled result becomes `interrupted` with that request `ambiguous`. Startup reconciliation or retry never resends its input. The caller receives `turn-outcome-unknown` and must supply a new explicit recovery instruction or let a later authoritative execution layer reconcile evidence.
- A generation that died before any backend Session id was captured becomes `failed`; the host cannot invent a resume identity.
- A surviving but unattachable process tree from an old daemon generation is positively matched from its owner token, terminated, awaited, and then classified by the same rules. No new process opens until cleanup is observed.

This is deliberately weaker than Action exactly-once execution and deliberately honest: the host can prevent duplicate dispatch but cannot decide whether arbitrary agent work committed canonical effects. The next child adds that authority.

Alternative considered: automatically replaying the last prompt after restart was rejected because backend success may have occurred after the last durable host write, duplicating file edits or external effects.

### 6. Cancel, restart, logical reattach, and retire operate on exact generations

Cancel first records intent against the current request/generation, then uses the existing graceful-then-forced process-tree termination and waits for observed close before releasing capacity or ownership. A cancelled active request is recorded `cancelled` only when the backend result proves cancellation before work; otherwise it is `ambiguous` and the Session is `interrupted`.

Restart is permitted only when no live owner claim exists. It cleans any positively identified stale tree, requires a backend Session id and the original canonical cwd, increments generation, and opens the exact resume transport. It never replays the prior input.

Reattach means a new CLI/driver resumes control through the resident daemon using the stable Rasen Session id. OS stdin/stdout handles are never claimed to be transferable across daemon processes.

Retire records terminal intent before cleanup, kills/awaits the exact live tree if present, clears its writer claim, and writes `retired`. Future execute/restart requests receive `session-retired` without spawn. A final handoff turn or automatic touch is policy and is not part of this Change.

Every lifecycle mutation uses the monotonic Session revision CAS. A concurrent
loser returns `session-busy`; no same-generation cancel, wake, close observer,
shutdown tail, or late settlement can overwrite `retiring` or `retired`.
Close-observer CAS loss is retried only while the same owner/root facts remain,
so it clears a closed PID without corrupting a valid settlement. Startup
completes a durable `retiring` intent after exact cleanup, or retains that
terminal intent while ownership is uncertain; it never normalizes retirement
back to `idle`. Shutdown closes admission before snapshotting, aborts/awaits
in-flight opens, and drains already-live trees concurrently. A transport
returned after shutdown began is first published with its exact claim, PID,
and process-start identity. If terminate throws or returns `closed:false`, the
claim and registry authority remain durable, shutdown rejects, and a later
close observer, shutdown retry, or next-start reconciliation continues the
same exact reap without duplicate signalling or settlement.

### 7. Preserve Management Sessions and add a narrow local Session CLI

`POST /api/v1/sessions`, list/detail, and DELETE remain valid for existing `auto|goal` clients, including planning/execution resolution, run-state read-only join, bounded tails, status codes, UUID addressing, and concurrency semantics. The registry implementation gains durable hosted records without converting the Management server into pipeline truth.

The new CLI surface is machine-oriented and emits exactly one JSON receipt:

- `rasen session exec --backend claude --prompt-file <file> --cwd <dir> [--session <id>] --request-id <uuid>` creates or wakes;
- `rasen session list [--json]` and `rasen session inspect <id> --json` expose lifecycle/recovery facts;
- `rasen session cancel|restart|retire <id> --json` perform exact lifecycle control.

Commands resolve/adopt the same-version local daemon (and start it when absent), authenticate through the existing daemon state, and refuse foreign/different ownership according to daemon-residency rules. The daemon alone holds live transports. CLI validation bounds prompt size, ids, cwd, timeouts, and backend names before any process starts; backend binaries and argv remain server-resolved, never client-provided.

Alternative considered: running the host inside each CLI command was rejected because CLI exit closes stdin and destroys the resident transport. Exposing arbitrary argv or binary paths was rejected as an injection and trust-boundary regression.

### 8. Deterministic replay is the primary protocol gate; a real adapter is still shipped

Add a cross-platform executable fixture that accepts the same stream-json stdin protocol and can replay named scripts for: normal init and multiple wakes, split multibyte/NDJSON chunks, delayed and duplicate results, malformed/oversized lines, crash before/after init, crash after input acceptance, backend Session-id mismatch, SIGTERM resistance, and a descendant process. Each script records argv, cwd, received request digests, PID tree, and emitted events to an isolated temp directory.

Host-interface tests run the real registry, locks, parser, supervisor, daemon bridge, and current-host OS child processes against this replay adapter. Injected platform adapters deterministically exercise every defined Windows shim/rename/path branch and POSIX process-group branch even when the corresponding OS is unavailable locally; those results are branch-behavior evidence, not a claim that the code ran on that OS. Existing one-shot supervisor, agent-dispatch, Windows shim injection, daemon lifecycle, and kill-tree tests remain regression gates. A real Claude adapter command-shape test uses the fixture binary; an optional credentialed smoke may supplement evidence but is never the only correctness gate. Actual Windows/Linux/macOS remote execution is recorded as deferred ECP-8 evidence rather than blocking this child's local ship/archive terminal.

### 9. Security and truth boundaries are explicit

- Registry directories/files use owner-restricted permissions where the platform supports them; paths are constructed with `path.join` and canonicalized before identity comparison.
- Prompt text travels only over the authenticated local request and child stdin. Secrets, environment dumps, prompt/result bodies, signing keys, and arbitrary argv never enter registry, logs, diagnostics, or wire projections.
- Diagnostic captures are bounded and pass the existing redaction rules.
- Every process launch is an argv-array launch with no general shell; Windows shim handling reuses the existing injection-tested spawn adapter and every background process sets `windowsHide`.
- The host returns lifecycle outcomes only. It imports no canonical Run mutation or trusted-completion producer and exposes no private-key parameter.

### 10. Strategy attempt 1 supersedes PID authority and the PowerShell Job controller

Round 3 independent review proved that the implementation described in
Decisions 2, 4, and 6 does not yet satisfy the authored containment boundary:
the direct Windows PowerShell Job controller can die while the admitted root
and detached descendant remain live, and the generic POSIX identity hashes
second-resolution `ps lstart` output. The following selected design supersedes
those decisions only where they describe process birth identity, containment,
activation, inspection, and termination. Backend protocol, durable request
ambiguity, Session identity, registry CAS, and Run/trust separation remain
unchanged.

Session host SHALL use a minimal opaque `ProcessScope` interface. It receives a
bounded/versioned `ProcessRef`, durably publishes it under the current
generation/revision, activates it exactly once, and later passes it back to the
same module for inspection or termination. PID remains optional observability
and SHALL NOT be a control argument. Job handles, PIDFDs, process groups,
platform birth identities, controllers, supervisors, OS signals, and helper
protocol details remain hidden behind the internal ProcessCapsule adapter seam.

Production SHALL use a packaged native helper plus platform adapters; tests
SHALL use a deterministic adapter at the same seam. The helper is resolved
adjacent to the installed package, verified against an exact protocol/version/
platform/architecture/hash manifest, and is never downloaded or compiled at
runtime. Missing capability or failed helper validation fails closed before
activation; there is no production fallback to the existing PowerShell
controller or generic `ps lstart` authority.

Every generation uses one native controller outside containment and one inert
supervisor inside containment. Prepare establishes containment and returns an
opaque ref while the supervisor remains incapable; registry CAS/fsync precedes
activation. Controller, daemon, supervisor, control-pipe, root, and descendant
death have distinct observations, and cleanup is complete only when the whole
scope is observed empty.

On Windows, the controller creates an unnamed kill-on-close Job and creates the
inner supervisor suspended with the Job assigned at process creation. The
controller uniquely owns the non-inherited Job handle: it is neither named,
inherited, duplicated into the daemon, nor passed to the backend. Therefore
controller death closes the last handle and must kernel-kill the root plus
detached descendants. On Linux the adapter uses a PIDFD with exact boot/start
facts and process-group containment. On macOS it uses a native process unique
identifier or another adapter-proven exact process birth source; if exact
identity is unavailable it fails closed before activation. Generic
second-resolution `ps lstart` signalling authority is removed.

Registry schema v2 stores the opaque runtime ref rather than host-visible
process-instance authority. A v1 record with live or uncertain PID facts is not
upgraded into a strong ref; it remains `legacy-containment-uncertain` until
exact absence or manual retirement is established. Older binaries encountering
v2 preserve the bytes and refuse hosted mutation.

The complete interface, failure taxonomy, supply-chain contract, failure
matrix, migration/deletion list, RED tests, and actual Windows/Linux/macOS
oracles are recorded in `evidence/strategy-attempt-1.md`. The selected design
has now landed in the strategy-attempt-1 implementation delta and its local
evidence, but that is author evidence only: both Round 3 Major dispositions
remain pending until fresh non-author review/CSO confirmation.

## Risks / Trade-offs

- **[Claude protocol/version drift]** → Keep parsing strict but forward-compatible for unknown events, pin all generated flag/event names as constants, exercise deterministic replay, and return `backend-protocol-unsupported` instead of guessing.
- **[Daemon death during a turn leaves outcome ambiguity]** → Persist request phases before/after stdin and never replay an unfinished request automatically; report `turn-outcome-unknown` for later authoritative reconciliation.
- **[A live process cannot transfer its pipes to a replacement daemon]** → Define reattach as driver-to-daemon identity reuse; positively kill an unattachable old generation and resume the exact backend Session in a new stream transport.
- **[Atomic rename/locks behave differently on Windows]** → Reuse hard-link/O_EXCL ownership patterns, same-directory candidates, bounded sharing-violation retry, canonical case-insensitive cwd identity, injected deterministic Windows process-tree tests, and current-host process execution; ECP-8 closes the residual portability risk with the actual Windows/Linux/macOS remote CI matrix.
- **[Registry growth]** → Bound settled request metadata and diagnostics while never pruning active/ambiguous entries or terminal Session identity required for safety.
- **[Compatibility projection hides richer hosted states]** → Keep additive `hostState` and typed diagnostics; old `state` remains stable for existing clients, while new CLI consumers read the richer fields.
- **[One production backend can tempt Claude leakage into the host]** → Keep protocol flags/events in the Claude adapter and test the host through a second deterministic adapter at the same internal seam.
- **[Clean daemon stop cancels hosted workers]** → Record terminal cleanup/recovery facts before exit and wait for tree close; idle Sessions remain recoverable from backend identity, while active unknown turns are reported honestly.

## Migration Plan

1. Add the opaque ProcessScope port, registry/parser/adapter types, and deterministic RED tests without changing existing one-shot Management Session construction.
2. Publish `rasen-session-host-registry/2` under the machine data home. Read owner-free v1 documents without rewriting them until the next mutation; fail closed and preserve bytes when v1 contains live/uncertain PID authority.
3. Wire the new host beside the legacy one-shot supervisor, then project hosted records additively through the existing list/detail surfaces.
4. Add authenticated daemon control routes and the `rasen session` CLI; keep existing `agent dispatch` behavior intact as a compatible one-turn bridge and reuse only its cwd/single-writer primitive internally.
5. On rollback, a v1-only binary fails closed on v2 bytes and preserves them. Operators may return to the new binary to inspect/retire them; no project or Run artifact migration is involved.

## Open Questions

There are no scope-blocking product questions. Apply must record the exact Claude CLI version/flag premise exercised by the production adapter and the deterministic fixture. If the installed CLI rejects persistent stream-json resume, the adapter must fail with `backend-protocol-unsupported`; it must not silently fall back to prompt replay or a different cwd.
