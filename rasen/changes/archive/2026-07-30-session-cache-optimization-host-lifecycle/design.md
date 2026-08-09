## Context

`src/core/management-api/supervisor.ts` currently owns the reusable process-management primitives this change needs: trusted Claude binary resolution, argv-only spawning, Windows `.cmd` escaping, process-tree termination, capacity reservation, runtime-context injection, bounded output tails, and shutdown draining. Its `launch()` path is intentionally one-shot: the prompt is an argv token, stdin is ignored, and the child is finalized when it exits.

The cache probes establish a different contract for reusable workers:

- a live `claude -p --input-format stream-json --output-format stream-json` process in the original cwd retained a cache hit through 55 minutes, including repository changes;
- the same cache was cold at 65 minutes, so process residency is valuable even though it does not override the one-hour cache ceiling;
- one-shot `--resume` in a repository cwd can re-render a changing prefix, but remains the correctness-preserving recovery path after process loss;
- concurrent resumes can both report success and incur cost while one turn is silently lost.

This child is the first node in the portfolio DAG. It must establish a narrow in-memory host contract for later registry, CLI, scheduler, and acceptance children without implementing those consumers or their durable data.

## Goals / Non-Goals

**Goals:**

- Add a reusable-host lifecycle to the existing supervisor: create with a bootstrap turn, wake repeatedly, retire cleanly, and recover a known lost host by Claude session id.
- Keep one accepted turn per host at a time and reject overlap before any stdin write or recovery spawn.
- Preserve a stable supervisor-lifetime host reference while a replacement process receives a new pid.
- Make turn completion observable from complete `stream-json` result events, including chunk-split NDJSON.
- Retain the existing process-safety, capacity, shutdown, runtime-context, and cross-platform spawn guarantees.
- Define explicit behavior for loss before delivery versus loss after delivery becomes uncertain.

**Non-Goals:**

- Persisting `rasen-session-registry/1`, wake ledgers, touch policy, lockfiles, or reconciliation state.
- Adding `rasen session exec|list|retire`, HTTP routes, locale/catalog entries, or completion metadata.
- Adding the daemon touch scheduler or deciding its cadence/deadline policy.
- Executing change-run actions, changing pipeline contracts, or editing `src/core/change-run/**` or `src/core/pipeline-registry/**`.
- P2 ReviewCycle wiring, P3 audit/economic analysis, or real 50–65 minute acceptance probes.
- Automatically replaying a turn whose delivery may already have reached Claude.

## Decisions

### D1. Add a reusable-host mode inside `createSessionSupervisor`

The returned supervisor gains a focused internal API equivalent to:

- `createHost(input)` — reserve capacity, spawn a live stream-json child, deliver the bootstrap message, and return only after its result event establishes an idle host;
- `wakeHost(hostId, input)` — deliver one message to the live host or first recover a host already known lost;
- `retireHost(hostId)` — prevent new wakes, settle an accepted wake, close stdin, and await/reap the child;
- `getHost(hostId)` — expose a copy of the minimal supervisor-lifetime host snapshot needed by tests and the next child.

Reusable hosts live in a dedicated host-entry map rather than being forced into today's `SessionRecord` states. The minimal host state is `starting | idle | waking | lost | retiring | retired`; its reference is stable for the supervisor lifetime, while `pid` may change and the captured Claude `sessionId` is the recovery identity. This avoids prematurely defining the durable registry schema while keeping all child processes under the existing supervisor owner.

Alternative considered: create `src/core/session-host/` as a parallel subsystem. Rejected because it would duplicate binary discovery, Windows handling, tree-kill, capacity, and shutdown logic, contrary to the established P1 module boundary.

### D2. Use one long-lived stream-json process and scope watchdogs to turns

Create and recovered-host spawns use the existing trusted argv builder with:

```text
claude -p --input-format stream-json --output-format stream-json --verbose
```

plus the existing permission, model/effort, attached-root, cwd, and runtime-context facts supplied by trusted callers. A recovery spawn adds `--resume <captured-session-id>` and uses the original immutable cwd and launch facts. stdin is `pipe`, not `ignore`; each message is encoded by one helper as one Claude stream-json user-event NDJSON line. Prompt contents never enter the shell or command line.

The existing overall/no-output timers cannot remain armed while a reusable host is idle: they would destroy the very 55-minute residency being preserved. Reusable-host timers are per accepted turn, reset by output activity, and cleared when that turn's result arrives. Idle hosts remain alive until retirement, owner shutdown, process loss, or a later scheduler policy.

Alternative considered: one `--resume` process per wake. Rejected as the primary path because the probe demonstrates repository-cwd prefix churn and loss of the warm cache. It is retained only for recovery.

### D3. Parse NDJSON incrementally and resolve exactly one pending turn

Each host entry owns a small incomplete-line buffer and a single pending-turn resolver. stdout chunks are split only at complete newline boundaries so partial JSON and multiple events per chunk are handled correctly. Opaque output still feeds bounded tails and the active turn's no-output watchdog. Complete events are inspected only for:

- `system/init` with `session_id`, which captures or refreshes recovery identity; and
- `result`, which is retained as the turn result envelope and moves a healthy host from `waking` to `idle`.

Malformed or unknown events remain diagnostic output and do not crash the host. A turn that never yields a valid result is bounded by its turn timers.

Alternative considered: rescan the 64 KiB tail as the one-shot path does for init. Rejected because a long-lived multi-turn stream can prune old bytes, split an event across chunks, and contain many result events; a per-turn parser is required to associate completion with the accepted wake.

### D4. Make the single-flight transition synchronous

`wakeHost` checks the host state and changes `idle` or recoverable `lost` to `waking` before its first `await`. A second wake observing `starting`, `waking`, or `retiring` returns structured `host_busy` immediately. It does not queue, write stdin, or spawn a recovery process. A wake after `retired` returns `host_retired`.

This gate is deliberately above the Claude CLI. The live process may serialize bytes written to stdin, but it cannot provide the caller-visible rejection contract, and the recovery CLI is proven unsafe under concurrency. Future public CLI and scheduler paths must route through the same owning supervisor seam; cross-process persistence/locking belongs to the registry-recovery child.

Alternative considered: queue concurrent wakes. Rejected because callers need to know which message was admitted, and silent queuing obscures scheduler-versus-real-wake races.

### D5. Recover only loss known before delivery

An unexpected `error` or `close` while no turn is active marks the host `lost`, releases its live-process capacity, and preserves its supervisor-lifetime reference, original cwd/launch facts, and captured Claude session id. The next wake holds the single-flight gate, reserves capacity, spawns a replacement live stream-json process with `--resume`, and sends the new message only to that replacement. A successful result returns the same host to `idle` with a new pid.

If no Claude session id was captured, recovery returns structured `host_unrecoverable` and never creates an unrelated fresh session.

If stdin accepted a message and the process then closes before a result event, the accepted wake returns structured `delivery_uncertain`. It is not automatically replayed because the turn may already exist in Claude's transcript; replay could duplicate side effects. The host becomes `lost`, and a later explicit wake may recover it. The registry-recovery child will later reconcile this boundary against durable transcript/registry facts.

Alternative considered: retry the in-flight message on every close. Rejected because at-most-once side effects cannot be guaranteed after the write boundary.

### D6. Retire is terminal, idempotent, and does not discard an accepted turn

Retirement synchronously blocks new wakes. If a turn is active, retirement waits for that turn's result or bounded failure, then closes stdin. For an idle live host, stdin closes immediately. If the child does not close within the existing grace window, retirement uses the existing process-tree kill escalation and resolves only after `close`. A lost host retires without spawning or resuming. Repeated retirement shares/returns the terminal outcome, and later wakes are rejected without I/O.

Owner shutdown still reaps every reusable-host process through the same tree-kill discipline, but owner shutdown is not treated as a user-requested durable retirement; the later persistence child must leave such sessions recoverable.

Alternative considered: kill immediately during an accepted turn. Rejected because that would manufacture an avoidable ambiguous-delivery result and discard useful work during an otherwise clean lifecycle transition.

### D7. Share existing safety and capacity seams without changing one-shot behavior

Reusable hosts use `spawnAgentCli`, `killProcessTree`, the cached CLI resolver, runtime-context files, bounded tails, and the supervisor's synchronous drain/capacity reservation discipline. A live reusable process consumes one existing concurrent-process slot, including while idle; loss releases it and recovery reserves it again. `shutdownAll()` includes both one-shot sessions and reusable hosts.

The existing `launch`, `kill`, session registry, HTTP routes, and their argv shapes remain unchanged. On Windows, `.cmd`/`.bat` launch arguments continue through the vetted escaper, while multi-line/metacharacter-bearing wake messages travel over stdin and therefore bypass `cmd.exe` parsing entirely. Tests follow `test/AGENTS.md`: path identities use canonical/native helpers and focused Vitest files run serially with build when CLI output could be stale.

## Risks / Trade-offs

- [Claude stream-json protocol drift] → Keep parsing limited to complete `system/init` and `result` discriminators, retain raw result envelopes, tolerate unknown events, and cover chunking/malformed-event fixtures.
- [Host process closes after delivery but before result] → Return `delivery_uncertain`, never replay automatically, and leave durable reconciliation to the next child.
- [No session id before process loss] → Return `host_unrecoverable`; do not substitute a fresh session that would falsely claim continuity.
- [Long-lived idle processes consume process slots] → Count them under the existing supervisor cap; later scheduler/registry policy decides which hosts merit residency.
- [Retirement waits on a long accepted turn] → Bound the turn with its per-turn timers, then reuse graceful/forced tree termination.
- [In-memory single-flight does not coordinate independent owners] → Require all current callers to use the one owner; the registry-recovery child adds durable ownership/reconciliation before public CLI fan-out.
- [Windows shim behavior differs from native spawn] → Exercise the real `.cmd` fixture, verify fixed argv and literal stdin delivery, and preserve `windowsHide`/tree-kill behavior.

## Migration Plan

1. Add host types and reusable-host methods without changing current one-shot interfaces.
2. Add a stdin-aware fake Claude fixture and focused lifecycle tests, including Windows shim coverage.
3. Implement create/wake parsing and synchronous single-flight.
4. Add loss classification, resume recovery, retirement, shared shutdown, and capacity accounting.
5. Run the focused supervisor/injection/session-context suites, then build and the full test suite in the repository-prescribed order.

Rollback is removal of the additive host API and its tests; the existing one-shot supervisor and HTTP behavior remain the compatibility baseline throughout.

## Open Questions

None block this child. Durable host identity, cross-process ownership/locking, registry reconciliation, public command transport, touch policy, and executor result normalization are intentionally decided by their dependent portfolio children.
