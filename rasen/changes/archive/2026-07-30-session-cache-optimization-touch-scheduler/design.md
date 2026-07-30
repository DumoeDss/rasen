## Context

The archived reusable-session coordinator persists host identity, lifecycle,
touch policy, wake fences, and bounded idempotency history beside each
canonical Run. Probe evidence established that a live stream-JSON host is warm
at 55 minutes and cold at 65 minutes, so an approximately 50-minute refresh is
the safe mechanical cadence. Correctness never depends on that refresh: without
the daemon, the next real wake may pay one bounded cache miss and recover.

The scheduler must not become a second registry writer or supervisor. The
sibling CLI-surface change uniquely owns an authenticated
`rasen-reusable-session-api/1` loopback service backed by the resident
`SessionHostCoordinator`. It supports all-run public projections, conditional
wake with touch ordinal/attempt metadata, coordinator-mediated touch-policy
updates with optional observed-activity preconditions, and silent retirement.
This change is a client of that fixed contract.

## Goals / Non-Goals

**Goals:**

- Start one scheduler only inside `rasen daemon run`.
- Refresh eligible idle sessions at the named 50-minute cadence without
  touching already-cold sessions.
- Recheck exact durable state at admission and share the coordinator's
  per-session single-flight lease with interactive execution.
- Respect `mode`, `deadlineAt`, `maxTouches`, `touchesUsed`, and
  `deadlineAction` for every decision.
- Give every touch attempt a deterministic message ID and make completion,
  uncertainty, crash recovery, backoff, shutdown, and clock movement explicit.
- Make all policy tests deterministic with injected clocks, timers, and a fake
  reusable-session client.

**Non-Goals:**

- No CLI commands, command registration, completion metadata, locale catalogs,
  management router, wire types, server shutdown code, or coordinator schema
  edits.
- No direct read or write of `sessions.json`, no direct host supervision, and
  no alternate wake mutex.
- No scheduler in foreground CLI or UI server processes.
- No automatic daemon startup and no correctness dependency on daemon uptime.
- No edits under `src/core/session-host/`, `src/core/change-run/**`, or
  `src/core/pipeline-registry/**`.

## Decisions

### D1. One injected scheduler core and one loopback adapter

Create `src/core/management-api/session-touch-scheduler.ts` with:

- a pure candidate classifier;
- an injected wall clock and timer interface;
- an injected `ReusableSessionTouchClient` with list, conditional-touch,
  policy-update, and retire methods;
- a production Node loopback adapter that sends the daemon's own port and
  bearer token to the fixed sibling protocol.

`src/commands/daemon.ts` is the only bootstrap owner. It starts the scheduler
after the management server is listening and has provided its actual port and
token. It does not discover itself through the daemon state file. UI and
foreground management servers do not start this scheduler.

The scheduler has no import from a CLI-owned implementation file, so both
children compile independently. Its private protocol types and schema constant
must exactly match the frozen contract in the CLI design. The downstream
acceptance child owns a merged real-server contract test.

Alternative considered: construct a coordinator or supervisor in the
scheduler. That would create a second resident owner and could bypass the
single-flight and owner-shutdown contracts.

### D2. Named constants define timing, policy defines permission

The module exports named defaults:

```text
SESSION_TOUCH_CADENCE_MS       = 50 minutes
SESSION_TOUCH_COLD_GAP_MS      = 60 minutes
SESSION_TOUCH_SCAN_INTERVAL_MS = 1 minute
SESSION_TOUCH_BACKOFF_BASE_MS  = 1 minute
SESSION_TOUCH_BACKOFF_MAX_MS   = 10 minutes
SESSION_TOUCH_REQUEST_TIMEOUT_MS = 4 seconds
SESSION_TOUCH_STOP_DRAIN_MS      = 5 seconds
SESSION_TOUCH_MESSAGE          =
  "Keepalive touch. Reply with exactly: OK. Do not use any tools."
```

Tests may inject alternatives; production uses the constants. A scan is
eligible only when all of these are true:

1. the session is `idle`;
2. `touchPolicy.mode === auto`;
3. `deadlineAt` is present, valid, and strictly later than `now`;
4. `touchesUsed < maxTouches`;
5. `now - lastWakeAt` is at least the touch cadence and no greater than the
   cold-gap limit;
6. no per-session backoff is still active.

`lastWakeAt` is the authoritative activity clock because successful
interactive and scheduler turns update the same durable field. Missing or
invalid timestamps and incomplete auto policies are ineligible and reported
diagnostically; the scheduler fails closed.

The one-minute scan creates at most a one-minute lateness window around the
50-minute target. It is intentionally much smaller than the 55-to-65-minute
probe boundary, while avoiding a timer per session.

The request timeout bounds one list, touch, policy, or retire operation
individually. The stop budget bounds the entire remaining scheduler drain; it
is one second larger so a committed operation can classify timeout/uncertainty
and release scan bookkeeping before `stop()` returns.

Alternative considered: touch every session every fixed interval. That ignores
real activity and spends model calls on active, expired, or exhausted sessions.

### D3. Eligibility is rechecked by a conditional coordinator wake

The all-run list is a candidate snapshot, not admission authority. A touch
request includes the observed `lastWakeAt`, `touchOrdinal`, and `touchAttempt`.
The resident service passes the expected timestamp to the same coordinator used
by interactive `session exec`. The coordinator acquires its existing durable
wake lease, re-reads the session, and rejects a stale candidate before
dispatch.

Therefore:

- an interactive wake that acquires the lease first refreshes `lastWakeAt`, so
  the queued touch becomes stale or contended and is skipped;
- a touch that acquires the lease first is a legitimate admitted wake, and the
  interactive request observes the same single-flight behavior;
- no second stdin path or best-effort in-memory mutex exists.

Busy, changed, retired, non-idle, or missing candidates are benign skips, not
scheduler errors.

Alternative considered: re-read the list immediately before an ordinary wake.
There is still a race between that read and durable lease admission.

### D4. Stable touch identities close response-loss and restart windows

For touch ordinal `touchesUsed + 1`, attempt numbers begin at one and are
derived from durable terminal touch entries for that ordinal. The raw ID is:

```text
"rasen-touch-v1-" +
sha256(canonical UTF-8 JSON of { runId, sessionKey, ordinal, attempt })
```

The same logical attempt always regenerates the same ID across scan, transport
retry, and daemon restart. Only its existing coordinator digest is persisted.
The terminal ledger's optional `kind`, ordinal, and attempt fields let a
restarted scheduler distinguish:

- a completed touch awaiting counter reconciliation;
- a delivery-uncertain touch that must not be replayed;
- a pre-delivery failure for which the next numbered attempt is safe.

`completed` and `delivery_uncertain` consume one touch ordinal because model
work may have occurred. `pre_delivery_failed` keeps the ordinal available but
advances the attempt number after backoff. A duplicate response reconciles the
durable counter and never dispatches the same message again.

If an HTTP connection fails after request bytes were committed, the scheduler
does not invent a foreground owner or a new attempt. It retries the exact same
ID after backoff until the durable endpoint reports its disposition.

Alternative considered: random UUIDs or IDs derived only from current time.
Both can replay an uncertain touch after a crash.

### D5. Deadline, exhaustion, and cold-gap actions are explicit

Each scan applies terminal policy before ordinary eligibility:

1. If `now >= deadlineAt`, `deadlineAction: retire-silent` invokes the
   coordinator retirement endpoint without a final model turn.
2. If `now >= deadlineAt`, `deadlineAction: stop` updates the same policy
   through the coordinator with `mode: never`, preserving its limits and
   counters.
3. If `touchesUsed >= maxTouches`, the session is classified exhausted and no
   wake occurs. The persisted equality is already restart-stable.
4. If activity gap is greater than 60 minutes, the cache is treated as cold;
   the scheduler sets `mode: never` through the coordinator and leaves the next
   real execution or policy author to decide whether a cold rebase is worth
   paying.

Deadline handling precedes cold-gap handling, so the authored retirement action
is not lost during a long machine sleep. All mutations still flow through the
resident coordinator service.

Every cold-derived policy update includes the exact snapshot
`expectedLastWakeAt`. The CLI-owned service acquires the wake lease, reconciles,
and rejects a mismatch as `conditional_wake_stale` before mutation. The
scheduler treats that code as a benign interactive-wins race, clears stale
volatile failure state, and starts no replacement side effect. Deadline-stop
may also carry the optional observation, but cold policy is never unconditional.

### D6. Backoff is per session and never blocks the scan

Expected contention and stale-candidate results are skipped until the next
normal scan. Pre-delivery failures, protocol failures known not to be admitted,
and unavailable service responses use deterministic exponential backoff:

```text
min(SESSION_TOUCH_BACKOFF_BASE_MS * 2^(failures - 1),
    SESSION_TOUCH_BACKOFF_MAX_MS)
```

One session's failure does not delay other candidates. A success, duplicate
terminal reconciliation, benign stale result, or observed newer interactive
activity clears that session's failure count. The backoff map is optimization
state only; durable wake metadata ensures a daemon restart cannot cause replay.

No jitter is used because the scheduler is single-daemon and deterministic
fake-clock behavior is more valuable than fleet spreading.

The production response reader has one settle gate shared by `end`, timeout,
size overflow, response `aborted`, response `error`, and premature `close`.
Headers followed by partial JSON and socket reset classify exactly once as
post-commit `transport_uncertain`; the retry retains the exact touch
ordinal/attempt message ID. A response at the configured limit is accepted and
the first excess byte settles before socket destruction.

### D7. Restart, shutdown, and wall-clock movement are conservative

The scheduler runs an immediate scan at daemon startup, rebuilding decisions
from durable projections and terminal touch metadata. It never tries to adopt
or signal a previous owner PID; the reusable service performs normal
coordinator reconciliation.

`stop()` synchronously closes a side-effect admission gate and clears the
timer. `scanOnce()` rechecks that gate immediately after a pending `listAll()`
settles and `processSession()` rechecks it before every touch, policy mutation,
or retirement call. Sessions returned by a list that was pending when stop
began cannot start any new side effect.

An operation already committed before stop is awaited through its four-second
client deadline. Before request bytes are committed it may abort safely;
afterward timeout is classified as transport-uncertain and retains the exact
message ID. `stop()` itself returns within five seconds. Daemon shutdown awaits
`scheduler.stop()` before `managementServer.stopServer()`, so a timer or late
list cannot enqueue work into a draining owner.

The existing server then has an 8-second session/coordinator graceful guard and
a 2-second server/socket-close guard. The CLI sibling uniquely owns
`daemon-probe.ts` and sets the identified-daemon outer kill grace to 20 seconds
with at least a 25-second port-free observation window. Production constants
and deterministic tests preserve:

```text
20_000ms > 5_000ms + 8_000ms + 2_000ms + 1_000ms = 16_000ms
```

The scheduler never edits `daemon-probe.ts`; it exports/uses its own 4-second
operation and 5-second drain budgets and verifies the composed inequality
against the sibling-owned constants.

Persisted timestamps use wall-clock UTC:

- a backward clock jump yields a negative/smaller gap and cannot make a touch
  early;
- a forward jump that remains within the cold limit can make one touch due;
- a forward jump beyond 60 minutes follows cold handling and spends no touch;
- a forward jump past the deadline applies the deadline action first;
- repeated ticks at one timestamp remain idempotent through ordinal/attempt
  identity and in-process scan exclusion.

The scheduler never overlaps two scans; a tick arriving during a scan coalesces
into one follow-up evaluation.

### D8. Positive file ownership proves Tier-A parallelism

| Area | Touch-scheduler owner | CLI-surface owner / seam |
|---|---|---|
| Scheduler logic | new `src/core/management-api/session-touch-scheduler.ts` | no edits |
| Daemon bootstrap | `src/commands/daemon.ts` | no edits |
| Scheduler tests | new `test/core/management-api/session-touch-scheduler.test.ts` and `test/commands/daemon-touch-scheduler.test.ts` | no edits |
| CLI root, commands, completion, locale | no edits, including `src/cli/index.ts` and `src/locales/index.ts` | unique CLI owner |
| Router, server, wire protocol | no edits | unique CLI owner; scheduler calls fixed loopback contract |
| Durable coordinator/registry | no edits and no direct file I/O | unique CLI owner for narrow conditional-touch seam; otherwise archived prerequisite |
| Daemon probe and outer kill grace | no edits | unique CLI owner of `src/core/management-api/daemon-probe.ts` and its focused test; scheduler consumes constants read-only |
| Forbidden areas | no edits | no edits |

The scheduler's production adapter uses only the fixed authenticated HTTP
contract; its unit tests use a fake client/server. If an implementer needs to
edit router, wire types, server, coordinator, CLI root, completion, or a locale
file, the positive independence proof fails and the two children must be
serialized.

## Risks / Trade-offs

- **[One-minute scan is not exactly 50 minutes]** → The bound is explicit and
  remains comfortably before the observed 55/65-minute edge.
- **[A touch response is lost]** → Stable IDs plus durable touch metadata
  reconcile the terminal result; no uncertain message is replayed.
- **[Long sleep makes a session cold]** → Spend no catch-up touch; disable auto
  policy and leave an explicit cold rebase decision to real execution.
- **[Sibling protocol drifts]** → Freeze the schema and fields in both designs;
  downstream acceptance owns a real merged contract test.
- **[Daemon shutdown races a tick]** → Stop and drain the scheduler before the
  server/coordinator shutdown hook, and gate again after list plus before every
  side effect.
- **[Partial response never settles]** → One exact-once response settle gate
  classifies aborted/error/premature-close as post-commit uncertainty.
- **[Nested shutdown budget exceeds outer grace]** → Keep the D7 inequality
  executable and `daemon-probe.ts` under the CLI sibling's unique ownership.
- **[Repeated failures cause noise]** → Per-session capped backoff and
  diagnostic deduplication keep other candidates moving.

## Migration Plan

1. Land after the archived registry prerequisite and alongside the independent
   CLI-surface implementation.
2. Verify pure classification and lifecycle behavior with fake time and a fake
   protocol client.
3. Merge both children and let the acceptance slice prove real
   create/wake/touch/retire, race, restart, deadline, and daemon-off behavior.
4. Rollback removes scheduler bootstrap and its module. Durable sessions remain
   correct; they simply stop receiving optimization touches.

## Open Questions

None. The 50-minute and 60-minute constants come from the completed probe and
can be changed in a future measured optimization without changing the policy or
idempotency contract.
