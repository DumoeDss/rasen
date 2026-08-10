## Context

The archived host-lifecycle and registry-recovery changes provide a reusable
stream-JSON host and a durable `SessionHostCoordinator`. The coordinator owns
canonical-run validation, registry locking, per-session wake leases, recovery,
idempotency tombstones, uncertainty fencing, retirement, and clean owner
shutdown. It is the only acceptable mutation path for this change.

The current CLI follows a strict presentation split: Commander structure and
code descriptions are empty, while every user-facing string lives under the
English, Japanese, and Simplified Chinese locale trees. Completion metadata is
structural and enum-like flags use `completionValues`, not `acceptedValues`.
The management server is authenticated with a bearer token and already owns the
resident `SessionSupervisor`.

The sibling touch-scheduler change needs an authenticated loopback protocol to
list durable sessions and request a conditional touch. This change owns that
neutral protocol and its coordinator plumbing, but owns no timer, eligibility
policy, daemon bootstrap, or scheduler behavior.

## Goals / Non-Goals

**Goals:**

- Provide `rasen session exec`, `rasen session list`, and
  `rasen session retire` as stable public commands.
- Resolve a caller's run ID to an exact, decoded canonical Run before opening
  its session registry.
- Prove that an exec request is structurally identical to the frozen agent
  action already admitted and granted by that decoded head Record before any
  new dispatch.
- Make every retry use a stable message ID and preserve the coordinator's
  single-flight and fail-closed uncertainty behavior.
- Prefer the resident daemon owner when it is positively identified, while
  preserving correctness through an explicit foreground owner when no daemon
  exists.
- Provide versioned JSON, localized human output and help, typed outcomes, and
  stable exit-code classes.
- Own a narrow authenticated reusable-session protocol that both the public CLI
  and the sibling scheduler can call without either path writing
  `sessions.json` directly.
- Keep the CLI and scheduler implementations file-disjoint.

**Non-Goals:**

- No scheduler, timer, keepalive eligibility decision, or edit to
  `src/commands/daemon.ts`.
- No creation, grant, closure, or other mutation of action admission, no
  pipeline completion or tier routing, and no edits under
  `src/core/change-run/**` or
  `src/core/pipeline-registry/**`.
- No new `src/core/session-host/` subsystem and no alternate registry writer,
  host adopter, or wake lock.
- No automatic daemon installation or startup.
- No handoff-generating final retirement turn.

## Decisions

### D1. The public grammar consumes one admitted agent action from a file or stdin

The command shapes are:

```text
rasen session exec --run <run-id> --session <session-key> \
  --action <file|-> --cwd <path> [--message-id <id>] \
  [--touch <auto|never>] [--touch-deadline <ISO-8601>] \
  [--max-touches <n>] [--deadline-action <stop|retire-silent>] [--json]

rasen session list --run <run-id> [--json]

rasen session retire --run <run-id> --session <session-key> \
  [--reason <text>] [--json]
```

`--action` accepts exactly one decoded `change-run-action/1` value whose
`kind` is `agent`. The implementation may import the existing decoder as a
read-only seam, but does not modify or commit Run state. `--run` must equal the
decoded action's `runId`, and D2 additionally proves the complete decoded value
equals the frozen action already stored in the canonical head Record. `--cwd`
is explicit so a retry cannot silently bind the session to whichever directory
a new launcher happens to occupy; it is canonicalized with Node
path/filesystem APIs and must match the immutable registry value on later
wakes.

The action source is bounded while it is read. A regular file whose stat size
exceeds `MAX_ACTION_BYTES` (1 MiB) is rejected before allocation. Stdin and
other streams read at most `MAX_ACTION_BYTES + 1`, accept exactly the limit, and
settle immediately as invalid input on the first excess byte.

The action's `actionId` is the default message ID because it is already stable
for the admitted unit of work. `--message-id` exists for a driver with a more
specific durable operation identity, but no random retry-time default is
allowed. User content travels through stdin or a file, never a shell-built
command string.

On first use, `exec` derives the register input from the trusted committed agent
action, canonical Record, explicit cwd, and CLI touch-policy options.
`touchesUsed` always starts at zero. `--touch auto` requires a future deadline
and a positive maximum; `reuse: never` is conservatively registered with
`mode: never`. The historical action values `handoffTokenLimit` and
`reuseRoundLimit` remain placeholders and are not treated as authoritative
policy. On an existing session, immutable role, complete planning/execution
binding, action identity, and cwd facts must match before wake.

Alternative considered: accept a free-form prompt or inline JSON. That would
lose the canonical action identity used by later pipeline integration and
would reintroduce shell quoting and unstable retry IDs.

### D2. Run and action lookup are exact and produce trusted execution facts

A focused reusable-session service opens the machine RunStore rooted with
`path.join(getGlobalDataDir(), 'runs')`, loads the head through the existing
immutable RunStore decoder, and verifies `record.runId === requestedRunId`.
It retains that decoded Record alongside `TrustedCanonicalRunRef`; a raw run
directory is never accepted from CLI or HTTP input.

Before coordinator lookup, the service reads
`record.actions[request.action.actionId]`, requires it to exist, and compares
the complete decoded request action with `committed.action` using canonical
structural equality. Matching only `runId`, `actionId`, role, input, or model is
insufficient. A new dispatch is permitted only while the committed action is
`state: active` and `deliveryState: granted`; `admitted_undelivered`,
`closed`, blocked, or otherwise non-deliverable entries reject new work.

Duplicate lookup is the sole exception to the new-dispatch delivery gate, not
to exact action equality. After proving the request is the exact frozen action,
the service may query the durable digest tombstone for the same message ID and
return its terminal disposition even if the committed action has since closed.
If no matching tombstone exists, a closed or non-deliverable action cannot
register, recover, or wake a host.

Registration derives and persists the complete immutable session binding from
trusted Record/action facts and the canonical cwd: planning space/project
identity, `RuntimeExecutionRef`, role, node, invocation, model, effort, and
path facts. Every later action is independently proved against the current
decoded head, including its workspace binding, and its derived execution
binding must equal the durable session binding before wake.

This exact Record check is important because filesystem directory names
sanitize punctuation and two textual run IDs can otherwise collide. Session
keys are strict bounded identifiers, never path fragments, and are looked up
only inside the selected coordinator. Path comparisons use the existing
cross-platform durable path helpers; tests inject Windows and POSIX forms.

Alternative considered: decode caller JSON and compare only embedded
identities, or concatenate the requested ID into a path. The first permits a
fabricated never-admitted action; the second cannot distinguish sanitization
collisions.

### D3. One reusable-session service fronts the durable coordinator

`reusable-session-api.ts` owns a cache of coordinators keyed by canonical run
directory. In daemon mode every coordinator shares the management server's one
resident `SessionSupervisor` and one owner instance identity. In foreground
mode the command creates the same service and coordinator locally.

The authenticated loopback contract is versioned
`rasen-reusable-session-api/1` and has these operations:

- `POST /api/v1/reusable-sessions/wake` for register-or-wake and conditional
  wake requests;
- `GET /api/v1/reusable-sessions?runId=<exact>` for the CLI and
  `scope=all` for the daemon scheduler;
- `POST /api/v1/reusable-sessions/retire`;
- `POST /api/v1/reusable-sessions/touch-policy` for coordinator-mediated
  policy changes used by the scheduler.

All bodies are strict decoded envelopes. Responses project public run/session
facts and typed outcomes; they do not expose the bearer token, raw prompts,
owner instance IDs, lock paths, or raw message IDs. Existing `/api/v1/sessions`
one-shot endpoints keep their meaning.

Client responses use one shared strict runtime union discriminated by
`schema`, `ok`, and `operation`. Each success and failure arm validates its
complete projection/disposition and rejects unknown keys before human rendering
or JSON forwarding. Response collection accepts at most
`MAX_RESPONSE_BYTES` (2 MiB): exactly 2 MiB is valid, the first excess byte
settles once before destroying the response, and `aborted`, response `error`,
truncation, or premature `close` also settle once as the appropriate bounded
transport/protocol outcome. No undecoded network object reaches stdout.

Strict response decoding is request-contextual, not shape-only. For an
exact-run request, every top-level `runId` and optional `sessionKey`, plus every
nested session projection, must agree with the requested identity. An exact-run
list may contain only sessions from that run; the explicit `scope=all` operation
is the only response arm allowed to contain multiple runs. Any cross-field or
request-identity mismatch is a protocol failure before `commandEnvelope()`,
human rendering, or JSON forwarding.

The first bootstrap turn is not an idempotency exception. Registration accepts
the same stable message ID, writes its dispatch fence as part of reservation,
and settles a terminal wake/tombstone plus `lastWakeAt` with the host result.
If the response is lost, a retry of the same register-or-wake request returns
that terminal disposition; it must not reinterpret the bootstrap action as a
new wake. A different message may use the ordinary wake path only after
immutable registration facts match. This closes the otherwise unsafe gap
between initial host creation and all later idempotent wakes.

The wake request supports neutral durable metadata:

- `kind: interactive | touch`;
- an exact `expectedLastWakeAt` precondition;
- for touch only, positive `touchOrdinal` and `touchAttempt`.

The touch-policy request independently accepts optional
`expectedLastWakeAt`. `updateTouchPolicy` acquires the same per-session wake
lease, reconciles the session, and compares persisted `lastWakeAt` with the
observation before any policy mutation. A mismatch returns
`conditional_wake_stale`; it never installs the stale policy. The sibling
scheduler treats this as a benign interactive-wins race.

The coordinator checks the precondition after acquiring its existing
per-session wake lease and before creating the dispatch fence. Terminal wake
entries may carry optional kind/ordinal/attempt metadata. This is a
backward-compatible addition to `rasen-session-registry/1`: old entries decode,
new entries remain bounded, and raw message IDs still never persist.

For bootstrap and ordinary interactive outcomes, the same terminal semantics
and digest-only identity apply. For a terminal touch outcome, `completed` and
`delivery_uncertain` consume the ordinal because model work may have occurred;
`pre_delivery_failed` does not. A duplicate touch request reconciles an
unaccounted terminal ordinal instead of replaying it. These semantics close
the crash window between host settlement and policy accounting and give the
sibling scheduler a stable, read-only way to derive the next attempt. This
change provides only the seam; it never decides when a touch is due.

Two callers that both first observed an absent session remain a contention
case. After one reserves/registers, the raced caller with the same message ID
performs duplicate lookup; a distinct message with matching immutable facts
returns `wake_busy` rather than `session_conflict` or an immediate second wake.
A later request whose initial observation finds the session already present may
use the ordinary wake path. True immutable mismatch remains
`session_conflict`.

Alternative considered: let the scheduler read or update `sessions.json`, or
give it a second coordinator/supervisor. Both would create competing mutation
and single-flight paths.

### D4. Daemon selection is positive, and fallback ends before request admission

`exec`, `list`, and `retire` inspect the existing daemon state and probe the
loopback endpoint. A live daemon is usable only when its PID/version headers
and recorded state positively identify this Rasen installation. The command
then sends the bearer-authenticated request to the resident service.

`src/core/management-api/daemon-probe.ts` distinguishes affirmative loopback
`ECONNREFUSED`/no-listener from timeout, non-response, and every other network
ambiguity. Foreground is allowed only when every probed port affirmatively has
no listener and any recorded daemon PID is proved dead/stale. A live recorded
PID with a temporarily refusing port, timeout, non-response, or unclassified
network error is `daemon_identity_ambiguous`, not absence.

Only after that proof, and before any request has been attempted, the command
uses a foreground owner. It prints/projects `ownerMode: foreground` and
explains that correctness is preserved but the live host is reaped when the
command exits, so cache residency is not. Foreground cleanup calls
`coordinator.ownerShutdown()` in `finally`; it never leaves a child for the
next process to adopt.

A foreign listener, version mismatch, or identity ambiguity is a typed failure,
not a fallback. Once request bytes may have reached the daemon, a broken
connection is `transport_uncertain`; the command never retries through a
foreground owner. The caller may repeat the exact command with the same
message ID and let the durable tombstone report the terminal disposition.

Alternative considered: start a daemon automatically or fall back on every
HTTP error. Both make ownership ambiguous, and the latter can replay a message
that already crossed the dispatch fence.

### D5. Shutdown is typed, aggregate, and fits one composed budget

The management router handle exposes a reusable-session shutdown hook. Server
shutdown first prevents new reusable-session admission, then invokes
`ownerShutdown()` for every cached coordinator and shuts down the path chooser
within the existing bounded server guard. If no coordinator was created, the
hook still drains the shared supervisor so current one-shot behavior is
preserved.

The service attempts every cached coordinator and returns a bounded typed
aggregate rather than `Promise<void>`. A failure to reap a supervisor host or
settle durable lost state appears as `owner_shutdown_failed` with safe
per-run diagnostics after all owners have been attempted. Foreground mode
converts cleanup failure into exit 1 and exactly one requested human/JSON
result document; server mode surfaces the aggregate to its bounded stop path
instead of reporting false success. Both owner adapters preserve the aggregate's
bounded public-safe `failures[]`; they may summarize it, but must not discard
the per-run diagnostics or replace them with only the aggregate message.

This replaces the server's direct reusable-host cleanup with coordinator-aware
cleanup so each registry records owned live sessions as recoverable `lost`.
Previous PIDs are never adopted or signalled on the next owner.

The sibling scheduler owns a 4-second maximum for one loopback operation and a
5-second total `stop()` drain. Existing server guards remain 8 seconds for
session/coordinator drain plus 2 seconds for server/socket close. This
CLI-owned child updates `daemon-probe.ts` so positively identified daemon
tree-kill grace is 20 seconds and port-free observation is at least 25 seconds.
The constants and a deterministic test SHALL preserve:

```text
20_000ms
  > 5_000ms scheduler drain
  + 8_000ms session/coordinator guard
  + 2_000ms server close guard
  + 1_000ms declared process/signal overhead
  = 16_000ms
```

The outer grace therefore cannot force-kill a normal shutdown before scheduler
uncertainty classification and coordinator-aware drain complete.

### D6. Output envelopes and exit codes are stable and uncertainty-aware

JSON emits one document and no human notices:

```json
{
  "schema": "rasen-session-command/1",
  "command": "exec",
  "ok": true,
  "ownerMode": "daemon",
  "runId": "run-1",
  "sessionKey": "reviewer",
  "outcome": { "code": "completed", "disposition": "completed" }
}
```

Public session projection includes role, status, canonical cwd, lifecycle
timestamps, touch policy, and safe terminal summaries. Human output presents
the same facts compactly. Static labels, help, validation text, and outcome
messages come from the locale catalog.

Exit-code classes are:

| Exit | Meaning |
|---:|---|
| 0 | completed success, duplicate-completed success, list success, or retire success |
| 1 | pre-delivery/infrastructure/transport failure known not to be admitted |
| 2 | CLI usage, malformed action/policy, or untrusted run/session selection |
| 3 | registry/wake contention or host capacity |
| 4 | session not found, retired, stale, or unrecoverable |
| 5 | delivery or transport uncertainty, including a duplicate whose terminal disposition is uncertain |

Every failure also has a stable string outcome code; scripts must key on it,
not localized text.

Session-command required operands are validated inside the session result
adapter (or an equivalent command-local Commander error adapter). Therefore
missing `--run`, `--session`, `--action`, or `--cwd` with `--json` still emits
exactly one `rasen-session-command/1` failure and exit 2; Commander must not
bypass the public envelope with its generic human usage error.

### D7. Commander presentation and completion retain repository conventions

`src/cli/index.ts` registers a `session` group whose code descriptions remain
empty. `src/core/completions/command-registry.ts` mirrors the exact command
shape and uses `completionValues` for `auto|never` and
`stop|retire-silent`. English, Japanese, and Simplified Chinese locale trees
contain every group, command, argument, option, example, static output, and
error leaf. `src/locales/index.ts` remains read-only because the three catalogs
already participate in presentation resolution.

### D8. Positive file ownership proves parallel implementation

| Area | CLI-surface owner | Touch-scheduler owner | Shared seam |
|---|---|---|---|
| CLI root and command | `src/cli/index.ts`, new `src/commands/session.ts` | no edits | none |
| Presentation/completion | `src/core/completions/command-registry.ts`, `src/locales/en.json`, `ja.json`, `zh-cn.json`; `src/locales/index.ts` read-only | no edits | none |
| Reusable protocol | new `src/core/management-api/reusable-session-api.ts`, `router.ts`, `server.ts`, `wire-types.ts` | no edits; protocol client only | fixed HTTP schema described in D3 |
| Durable conditional-wake seam | narrow additive edits to `durable-session-registry.ts` and its CLI-owned focused tests | no edits | coordinator remains sole writer |
| Daemon classification and outer grace | `src/core/management-api/daemon-probe.ts` and `test/core/management-api/daemon-probe.test.ts` | no edits; constants/results are read-only | affirmative absence and shutdown inequality in D4/D5 |
| Daemon bootstrap | no edits to `src/commands/daemon.ts` | unique owner | server handle and loopback protocol are read-only |
| Scheduler | no scheduler files | new `session-touch-scheduler.ts` and focused tests | injected client matches D3 |
| Forbidden areas | no edits to `session-host/`, `change-run/**`, or `pipeline-registry/**` | same | existing decoded types may be read-only imports |

No implementation file, locale catalog, CLI root, or daemon bootstrap file has
two owners. If implementation requires a scheduler edit to a CLI-owned route
or a CLI edit to `daemon.ts`, the work is no longer Tier-A parallel and must be
serialized.

## Risks / Trade-offs

- **[Foreground mode loses residency]** → Make `ownerMode` explicit and always
  reap through `ownerShutdown`; correctness remains independent of the daemon.
- **[HTTP response loss obscures admission]** → Never cross-fallback after a
  request attempt; reuse the stable message ID to query durable disposition.
- **[Sanitized Run directory collision]** → Decode the head Record and compare
  the exact run ID before constructing the trusted reference.
- **[Caller fabricates a structurally valid action]** → Compare the complete
  decoded value with the exact frozen committed action and its deliverability
  before coordinator access.
- **[Slow probe looks absent]** → Only affirmative no-listener plus a proved
  stale/dead recorded owner permits foreground; every ambiguous transport
  fails closed.
- **[Protocol drift between parallel children]** → Freeze the D3 schema string,
  operation names, and touch metadata in both designs; scheduler unit tests use
  a fake server, and the downstream acceptance child owns the merged contract
  test.
- **[Nested shutdown guards force-kill too early]** → Test the D5 numeric
  inequality and keep `daemon-probe.ts` under one CLI owner.
- **[Backward-compatible ledger growth]** → Keep touch metadata optional and
  bounded by the existing wake/tombstone limits; never persist raw message IDs.
- **[Localization drift]** → Extend existing structural presentation and
  catalog parity tests for all three locales.

## Migration Plan

1. Land the CLI/service/coordinator seam after the archived host and registry
   prerequisites.
2. Exercise route and command tests with injected daemon, foreground,
   uncertainty, Windows, and POSIX cases.
3. Merge the independently implemented scheduler only after both children are
   review-clean; the acceptance child proves their real protocol integration.
4. Rollback removes the command registration and route group. Existing
   registries remain readable because new wake metadata is optional.

## Open Questions

None. Pipeline completion and authored tier-policy integration remain assigned
to later slices and do not block this public P1 surface.
