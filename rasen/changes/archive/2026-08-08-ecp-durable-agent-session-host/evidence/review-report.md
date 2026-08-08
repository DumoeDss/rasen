# Independent code/spec review report

## Review identity and scope

- Mode: dispatched, report-only, independent non-author review
- Change: `ecp-durable-agent-session-host`
- Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`
- Base: `origin/dev/0.2.0`
- Reviewed product scope: `src/core/session-host/**`, the Claude ownership extension,
  hosted Management adapters/router/server/wire changes, `rasen session` CLI,
  daemon integration, focused tests, docs, and this Change's artifacts/evidence.
- Cumulative ECP-6 files in the shared dirty worktree were treated as predecessor
  context, not as child-1 scope.
- Reviewer made no production, test, task, run-state, commit, push, ship, or
  archive mutation.

## Scope check

**Scope Check: DRIFT DETECTED**

- Intent: deliver only the durable backend-neutral Session host lifecycle seam.
- Delivered: the intended host, registry, process/protocol, daemon, Management,
  CLI, tests, and docs, plus one unrelated config-editor bug fix.
- Drift: `src/commands/config.ts:362-368` and
  `test/commands/config-editor.test.ts:202` fix machine-data/project-root
  detection. The defect is real, but it is not a durable Session-host concern.

## Gates and independent probes

| Command / probe | Result |
| --- | --- |
| `pnpm run build` | PASS |
| `pnpm run lint` | PASS |
| `pnpm exec tsc --noEmit` | PASS |
| `node bin/rasen.js validate ecp-durable-agent-session-host --strict` | PASS (`valid`) |
| `pnpm exec vitest run test/core/session-host test/core/management-api/hosted-sessions-api.test.ts test/core/management-api/hosted-session-recovery.test.ts test/commands/daemon-half-started.test.ts test/commands/daemon-spawn-convergence.test.ts test/cli-e2e/session-host.test.ts --maxWorkers=1 --minWorkers=1` | PASS: 13 files, 71/71 tests |
| Inline built-product probe: two distinct simultaneous wakes on one idle live Session | REPRODUCED: winner succeeds; loser is `backend-spawn-failed` / `session has multiple unfinished requests`, not required `session-busy`; no duplicate stdin observed |
| Inline built-product probe: simultaneous `retire` and `cancel` on one idle live Session | REPRODUCED: retire receipt says `retired`, then cancel writes `idle`; final durable state is `idle` with the retirement reason still present |
| Inline built-product probe: replacement daemon reconciles a durable `retiring` record | REPRODUCED: record becomes `idle` / `daemon-restart-exact-resume` instead of completing or preserving retirement |
| Inline built-product probe: resident transport closes while idle, then caller wakes | REPRODUCED: no exact-resume transport opens; unsent new input becomes `ambiguous` and returns `backend-protocol-failed` |
| Built CLI probe with nonexistent `--prompt-file` and `--json` | REPRODUCED: receipt code is `session-command-failed`, not required typed `invalid-input` |

The focused suite is green but does not exercise the reproduced interleavings.

## Findings

Pre-Landing Review: 11 issues (8 critical-category correctness issues, 3 informational issues)

### 1. Concurrent lifecycle commands can undo terminal retirement

- **Canonical severity:** Major
- **Native review severity:** CRITICAL (Race Conditions & Concurrency)
- **Axis:** Standards and Spec
- **Location:** `src/core/session-host/host.ts:652`,
  `src/core/session-host/host.ts:786`, `src/core/session-host/registry.ts:664`
- **Problem:** Session registry updates compare only the backend process
  `generation`, which does not change for cancel/retire or live wakes. Final
  control writes assign `hostState` directly without checking the current
  state. In the reproduced `retire + cancel` interleaving, retire durably writes
  `retired`, then cancel overwrites it with `idle`. A later execute can therefore
  wake a Session after a successful terminal-retirement receipt. The same
  missing per-Session admission fence makes two distinct wakes race; the loser
  falls through as `backend-spawn-failed` instead of the required `session-busy`.
- **Recommendation:** serialize all operations per stable Session and add a
  monotonic record revision/state precondition distinct from backend process
  generation. Every mutation must validate the exact prior lifecycle/request
  state, and terminal `retired` must be unwriteable except idempotently.
- **Dispatch classification:** ASK / non-author fixer (cross-cutting concurrency design).

### 2. `sent` is persisted before stdin accepts the request

- **Canonical severity:** Major
- **Native review severity:** CRITICAL (Race Conditions & Data Safety)
- **Axis:** Standards and Spec
- **Location:** `src/core/session-host/host.ts:482`,
  `src/core/session-host/host.ts:498`, `src/core/session-host/host.ts:499`
- **Problem:** the durable request is changed from `prepared` to `sent` before
  `collectTurnEvents()` calls `transport.send()`. A bridge crash or already-dead
  transport in this interval leaves an input that never reached stdin recorded
  as possibly executed. The idle-death probe demonstrated exactly that: the
  backend received no new input, but recovery returned `turn-outcome-unknown`
  with request state `ambiguous`.
- **Recommendation:** make transport admission expose a bounded, awaitable
  write-accepted fence. Persist `prepared`, begin the exact send, persist `sent`
  only after the transport confirms acceptance, and retain a separately
  recoverable pre-acceptance classification if the fence fails.
- **Dispatch classification:** ASK / non-author fixer (backend-port contract change).

### 3. Idle resident-process death is not observed or exact-resumed

- **Canonical severity:** Major
- **Native review severity:** CRITICAL (Conditional Side Effects / Completeness)
- **Axis:** Standards and Spec
- **Location:** `src/core/session-host/host.ts:216`,
  `src/core/session-host/host.ts:407`, `src/core/session-host/host.ts:421`
- **Problem:** `AgentSessionTransport.closed` is never consumed by the host.
  A transport that dies after a settled turn remains in `transports`; the next
  wake blindly selects it rather than opening `--resume <backendSessionId>`.
  The reproduced wake returned `backend-protocol-failed`, marked an unsent input
  ambiguous, kept generation 1, and opened no recovery transport. This
  contradicts the dead-idle-generation and exact-resume tasks and the operator
  documentation at `docs/session-host.md:21-24`.
- **Recommendation:** attach one close observer when a transport is admitted,
  atomically remove/release the exact live entry, publish recoverable idle or
  interrupted state, and make wake re-check liveness under the Session fence
  before choosing live reuse versus exact resume.
- **Dispatch classification:** ASK / non-author fixer.

### 4. Startup reconciliation discards durable retirement intent

- **Canonical severity:** Major
- **Native review severity:** CRITICAL (State-machine correctness)
- **Axis:** Standards and Spec
- **Location:** `src/core/session-host/host.ts:907`
- **Problem:** every non-failed record without a current request is normalized
  to `idle`. A daemon crash after intent-before-signal publishes `retiring` but
  before final `retired` therefore re-enables the Session. The independent
  replacement probe reproduced `retiring -> idle` with the retirement reason
  still present.
- **Recommendation:** reconcile `retiring` as an outstanding terminal control:
  positively clean the exact tree when possible and finish `retired`, or retain
  `retiring`/typed uncertainty while refusing execute/restart. Never normalize
  retirement intent to an executable state.
- **Dispatch classification:** ASK / non-author fixer.

### 5. A crash between worker binding and registry publication can strand a privileged orphan

- **Canonical severity:** Major
- **Native review severity:** CRITICAL (Process ownership / failure atomicity)
- **Axis:** Standards and Spec
- **Location:** `src/core/session-host/host.ts:302`,
  `src/core/session-host/host.ts:303`, `src/core/session-host/host.ts:482`
- **Problem:** `openTransport()` spawns and binds the worker token, then returns
  and adds the transport to memory; durable `process` facts are published only
  in a later registry update. If the bridge dies in that window, the ownership
  record knows the worker but the registry has no owner token/root PID.
  `reconcileOnStart()` calls `reapStaleOwner()` only when `record.process`
  exists, and retire/restart also gate ownership checks on that field. The
  replacement host cannot positively reap the worker and can even mark the
  Session retired while the old process tree remains alive.
- **Recommendation:** make process admission recoverably atomic: persist a
  discoverable spawning/bound owner fact before the host can lose the worker,
  or let reconciliation safely recover exact owner/root facts from the
  ownership record using a nonce bound into the registry before spawn.
- **Dispatch classification:** ASK / non-author fixer (security-sensitive ownership protocol).

### 6. The server shutdown guard can return before all hosted trees are reaped

- **Canonical severity:** Major
- **Native review severity:** CRITICAL (Process cleanup correctness)
- **Axis:** Standards and Spec
- **Location:** `src/core/management-api/server.ts:181`,
  `src/core/management-api/server.ts:188`, `src/core/session-host/host.ts:930`
- **Problem:** `SessionHost.shutdown()` terminates transports serially, with a
  production 5-second graceful/forced wait per transport, while `stopServer()`
  abandons the combined shutdown wait after 8 seconds. Two resistant hosted
  Sessions exceed the outer guard. `daemon.ts:131-133` then deletes daemon state
  and exits, despite the spec requiring every exact hosted tree to close and
  publish classification before clean exit.
- **Recommendation:** drain exact hosted transports concurrently (with bounded
  per-tree cleanup) and make the daemon's outer bound cover the proven total
  cleanup contract. If a hard outer bound remains, persist explicit unfinished
  ownership for every unclosed tree before returning and do not describe the
  stop as clean.
- **Dispatch classification:** ASK / non-author fixer.

### 7. Missing prompt/cwd paths do not produce the required typed CLI receipt

- **Canonical severity:** Major
- **Native review severity:** CRITICAL (Spec completeness)
- **Axis:** Spec
- **Location:** `src/commands/session.ts:218`, `src/commands/session.ts:226`
- **Problem:** raw `fs.statSync()` errors escape to the generic `fail()` fallback.
  The built CLI probe returned `{"ok":false,"code":"session-command-failed",...}`
  for a missing prompt file. The spec requires missing prompt files and
  unavailable cwd to emit exactly one typed `invalid-input` receipt and start no
  backend.
- **Recommendation:** wrap prompt/cwd stat, realpath, and read failures in
  `SessionCommandError('invalid-input', ...)`, then add built CLI tests for
  missing prompt, unreadable/oversized prompt, missing/non-directory cwd, and
  invalid timeout/backend.
- **Dispatch classification:** AUTO-FIX candidate for a non-author fixer.

### 8. The promised init/no-output/overall timeout matrix is only one wall-clock timer

- **Canonical severity:** Major
- **Native review severity:** CRITICAL (Missing required failure handling)
- **Axis:** Standards and Spec
- **Location:** `src/core/session-host/contracts.ts:113`,
  `src/core/session-host/host.ts:174`
- **Problem:** `TurnLimits` contains only `timeoutMs`, and
  `collectTurnEvents()` starts one timer that never distinguishes time to init,
  inactivity after output, or overall wall-clock time. Tasks 7.5/7.6 explicitly
  require init timeout, no-output timeout, and overall timeout fault paths with
  bounded timer cleanup; the focused test labelled no-output merely uses the
  same 25ms overall timer.
- **Recommendation:** define server-owned init, inactivity, and overall limits;
  reset only the inactivity timer on valid events; clear every timer exactly
  once on settle/close/cancel; add discriminating tests that prove each clock
  independently fires and is cancelled.
- **Dispatch classification:** ASK / non-author fixer (public/internal limit contract).

### 9. Production Claude transport suppresses duplicate init events

- **Canonical severity:** Minor
- **Native review severity:** INFORMATIONAL (Protocol completeness)
- **Axis:** Standards and Spec
- **Location:** `src/core/session-host/claude-backend.ts:335`
- **Problem:** after the first backend identity is known, a second same-identity
  init is silently ignored. The generic reducer rejects duplicate init, but the
  production adapter prevents that event from reaching it. This weakens the
  stated one-init ordering check and leaves the real adapter less strict than
  its unit-level reducer evidence.
- **Recommendation:** distinguish the synthetic per-turn identity from backend
  init events and reject an unexpected duplicate init for one active turn;
  cover the production adapter path, not only `reduceBackendTurnEvents()`.
- **Dispatch classification:** AUTO-FIX candidate.

### 10. Parent planning context contains stale child-1 facts

- **Canonical severity:** Minor
- **Native review severity:** INFORMATIONAL (Documentation consistency)
- **Axis:** Spec / Coherence
- **Location:** `rasen/changes/ecp-session-execution-and-self-hosting/planning-context.md:370`,
  `rasen/changes/ecp-session-execution-and-self-hosting/planning-context.md:379`
- **Problem:** the parent still says pruned request ids are not retained and
  full root tests are pending, while the final implementation added the Bloom
  tombstone and records a green 6,947-test root run. Later children consume this
  file as portfolio context.
- **Recommendation:** after fixes/re-review, replace those two stale bullets
  with the final reviewed child facts and exact deferred obligations.
- **Dispatch classification:** AUTO-FIX candidate.

### 11. The config-editor change is unrelated child scope

- **Canonical severity:** Minor
- **Native review severity:** INFORMATIONAL (Scope drift)
- **Axis:** Spec
- **Location:** `src/commands/config.ts:362`
- **Problem:** the machine-data `rasen` ancestor fix is valid but independent of
  Session hosting. Keeping it in this child weakens the promised isolated fault
  domain and makes child delivery evidence claim more than its artifacts define.
- **Recommendation:** move the fix/test to its own Change/commit or document an
  explicit parent-approved coupling before child ship.
- **Dispatch classification:** ASK (scope ownership decision belongs to LEAD).

## Standards axis

- Result: **CHANGES_REQUIRED**
- Findings: Major 7, Minor 1
- Worst issue: concurrent lifecycle writes can reverse terminal retirement.
- Positive evidence: lint/typecheck/build pass; process launches use the shared
  escaped argv-array adapter with `shell:false`, prompt over stdin, and bounded
  protocol parsing; the host has no canonical Run/trust imports.

## Spec axis

- Result: **CHANGES_REQUIRED**
- Findings: Major 8, Minor 3 (some overlap Standards; counts are axis-local).
- Worst issue: the exact terminal-control and recovery invariants are not
  preserved under real concurrent control and crash boundaries.
- Tasks 9.8/9.9 are not satisfied because open Major findings require a
  non-author fix and fresh re-review. Tasks 9.10 and 10.2-10.6 remain legitimate
  post-review/delivery tail work, not missing apply implementation.

## Code-path and user-flow coverage

```text
CODE PATH COVERAGE
==================
[+] contracts / registry / protocol / Claude adapter
    [TESTED] validation, atomic fault points, contention fixture, UTF-8 NDJSON,
             malformed/oversized/duplicate result, argv/stdin injection matrix
    [GAP]    duplicate init through the production adapter
[+] SessionHost execute / control / recovery
    [TESTED] sequential create/wake, duplicate same request, restart, cancel,
             retire, late-result fences, startup sent ambiguity
    [GAP]    two distinct simultaneous wakes
    [GAP]    simultaneous cancel/retire and terminal-state CAS
    [GAP]    bridge crash after worker bind but before process-fact publication
    [GAP]    idle resident death while the daemon remains alive
    [GAP]    daemon crash after durable retiring intent
    [GAP]    independent init/no-output/overall clocks
[+] Management / daemon / CLI
    [TESTED] bearer auth, body/method/UUID rejection, real two-driver daemon E2E,
             exact restart, active cancel, retire, corrupt-registry readiness
    [GAP]    missing/unreadable prompt and cwd typed CLI receipts
    [GAP]    two or more resistant hosted trees under the 8-second shutdown guard
```

```text
USER FLOW COVERAGE
==================
[TESTED] create -> settle -> caller exits -> second caller wakes same resident
[TESTED] active cancel -> ambiguous -> exact restart -> terminal retire
[TESTED] daemon replacement of ordinary idle and already-retired records
[GAP]    retire racing another control -> terminal state can reopen
[GAP]    backend dies while idle -> next wake does not exact-resume
[GAP]    clean daemon stop with multiple resistant workers -> early return
[GAP]    invalid filesystem CLI input -> wrong typed recovery contract
```

## Round 0 historical verdict

Round 0 found Blocker:0 Major:8 Minor:3 Trivial:0 and triggered the Round 1
fixer pass. The current verdict follows; the historical count is not the
current open-finding count.

## Round 1 delta re-review

Reviewer: `/root/ecp7_host_verifier_1`\
Reviewed product-scope diff fingerprint:
`b9aee13004e745fb84536cd35443988d3f34d756`\
HEAD/tree: `050fc84332b26a75a07f441efd6b235842f89e1e` /
`58489c46633a209d2c1761c2a4b684ad8b95cb48`

Fresh gates passed: build; lint; `tsc --noEmit`; strict Change validation;
scoped `git diff --check`; and the focused 14-file Session-host/Management/
daemon/CLI suite with 86/86 tests. The new regressions resolve the ordinary
distinct-wake, cancel/retire, idle-close, startup-retiring, known-live
concurrent-shutdown, typed CLI, three-event-clock, duplicate-init, planning,
and config-scope cases. Independent adversarial ordering still found the
following open defects.

### Major — V1 terminal retirement can still be reopened by shutdown

- **Location:** `src/core/session-host/host.ts:1123-1134`.
- **Problem:** the shutdown tail protects `retired` but not `retiring`. If
  retire has durably published terminal intent and shutdown's second
  termination finishes first, shutdown retries against the latest revision and
  assigns `idle`/`interrupted`. Retire then reports `session-busy`; the record
  remains executable with its retirement reason still attached.
- **Independent discriminator:** `RETIRE_SHUTDOWN_RACE` observed
  `retiring -> idle`, `clean-shutdown-exact-resume`, and a failed retirement
  receipt. This is distinct from the now-fixed cancel/retire ordering.
- **Required correction:** every shutdown/control/observer tail must treat both
  `retiring` and `retired` as terminal fences; add the exact two-terminator
  ordering as a regression.

### Major — V2 transport acceptance remains optional at the neutral port

- **Location:** `src/core/session-host/backend.ts:25-28` and
  `src/core/session-host/host.ts:631-635`.
- **Problem:** `BackendTurnStream.accepted?` permits a conforming adapter to
  omit the only acceptance fact. The host then immediately persists `sent`,
  recreating the original crash-boundary misclassification outside the Claude
  adapter.
- **Independent discriminator:** a backend stream without the optional field
  was durably `sent` while its event generator was blocked and no acceptance
  fact existed.
- **Required correction:** make the acceptance fence mandatory at the port and
  update every adapter/fake; omission must fail closed before `sent`.

### Major — V5 nonce-first authority still has pre-bind orphan/fake-owner gaps

- **Location:** `src/core/session-host/host.ts:358-379` and
  `src/core/claude/session-state.ts:273-279,673-675`.
- **Problem:** registry nonce publication closes the old post-bind/root-
  publication gap, but a crash before spawn leaves a dead claim that is
  permanently `live-or-uncertain`, while a crash after spawn and before
  `bindWorker` leaves a real worker with no durable root PID. The reaper
  deliberately cannot signal either case.
- **Independent discriminator:** a child bridge claimed authority, spawned a
  detached worker, and exited before binding it. Exact reaping returned
  `live-or-uncertain`, signalled no PID, and the worker was still alive until
  the verifier explicitly killed the exact probe PID.
- **Required correction:** move worker-token publication into an atomic spawn
  handshake/supervisor boundary, and distinguish a provably pre-spawn claim
  from an unbound spawned worker without guessing a PID.

### Major — V6 shutdown misses an execute already inside backend open

- **Location:** `src/core/session-host/host.ts:367-395,1105-1138`.
- **Problem:** `draining` blocks new dispatches, but shutdown snapshots only
  the current `transports` map and does not await in-flight opens/operations.
  An execute admitted just before draining can publish its transport after
  shutdown has returned and then complete without any termination attempt.
- **Independent discriminator:** an open-gated execute remained
  prepared/starting while shutdown returned; releasing open produced a
  successful live Session with a PID and `terminations:0`.
- **Required correction:** register/await all admitted operations before their
  first await, or repeatedly drain under a closed admission gate until no open
  or live operation remains.

### Major — V8 the overall clock does not bound stdin acceptance

- **Location:** `src/core/session-host/host.ts:176-245,631`.
- **Problem:** all three timers are created only after the host has awaited
  `stream.accepted`. A never-settling acceptance promise stays `prepared`
  beyond initialization, inactivity, and overall limits and receives no
  bounded termination.
- **Independent discriminator:** with a 30 ms overall deadline, the operation
  was still unsettled/prepared with zero termination after 100 ms. Rejecting
  the promise only for cleanup then released it.
- **Required correction:** start the overall deadline before send/acceptance
  and race the acceptance fence against it; settlement/termination must remain
  exactly once.

### Minor — V3 a close-observer CAS loser leaves a stale durable PID

- **Location:** `src/core/session-host/host.ts:436-465`.
- **Problem:** the observer detaches/releases before its single CAS. If a valid
  terminal settlement wins that revision, the observer's stale update is
  swallowed and the settled idle record retains the closed transport PID.
- **Independent discriminator:** forced observer-read/settlement-write ordering
  returned a valid result but left `hostState: idle`, a settled request, and
  `pid:7373` after the transport was detached.
- **Required correction:** terminal-aware retry must at least clear matching
  process facts without overwriting a valid settlement.

### Resolved dispositions

- V1 distinct concurrent wake and cancel/retire subcases: resolved.
- V3 ordinary idle-close exact resume: resolved; residual race retained above.
- V4 startup `retiring` normalization: resolved.
- V6 concurrent drain of already-known transports/short outer guard: resolved;
  in-flight-open gap retained above.
- V7, V9, V10, V11: resolved.

Durable findings for LEAD: tasks 9.8 and 9.9 must remain unchecked. Route V1,
V2, V5, V6, and V8 plus Minor V3 to a new non-author fixer, preserve the exact
probe orderings as regression tests, and request a delta-only re-review. Task
9.10 remains pending until a clean independent review.

REVIEW VERDICT: CHANGES_REQUIRED — Blocker:0 Major:5 Minor:1 Trivial:0

## Round 2 independent confirmation

Reviewer: `/root/ecp7_host_verifier_1`\
Exact Round 2 delta-state SHA-256:
`1c24cfcdb1d2b6e5506b72df7a878f1101abf12c991961cb1e6f6bbaa8cc9527`\
HEAD/tree: `050fc84332b26a75a07f441efd6b235842f89e1e` /
`58489c46633a209d2c1761c2a4b684ad8b95cb48`

Fresh gates passed: build; lint; `tsc --noEmit`; strict Change validation;
and the exact focused 16-file Session-host/agent-process/Management/daemon/CLI
command with 118/118 tests. No full root or UI suite was run; that remains task
9.10 after independent review closure.

### Major - V5 admitted supervisor still lacks durable process-instance and descendant containment

- **Locations:** `src/core/claude/session-state.ts:114-122,661-699` and
  `src/core/agent-cli-process.ts:140-229`.
- **Problem:** the supervised activation handshake fixes Round 1's pre-spawn
  and pre-bind windows, but the durable worker token still contains only nonce,
  root PID, and timestamp. Recovery validates the nonce/PID values and then
  signals that numeric PID without comparing an OS process-start fingerprint.
  A reused root PID can therefore target an unrelated process, contrary to the
  Change design and the named daemon-recovery PID-reuse scenario.
- **Independent PID-reuse discriminator:** a dead-bridge, exact-nonce worker
  token was made to represent a stale generation whose root PID had been
  reused by the verifier process. With signalling replaced by a safe spy,
  `reapClaudeSessionStaleOwner()` called the spy with that unrelated live PID
  and returned `live-or-uncertain`. The same probe confirmed that a legacy
  missing-worker claim stayed fail-closed and a supervised pre-spawn claim was
  reclaimed without signalling.
- **Independent Windows descendant discriminator:** after activating the real
  inert supervisor, the backend launched a detached grandchild. Killing the
  exact supervisor left the supervisor and backend dead but the grandchild
  alive. Calling the production `killProcessTree(supervisorPid)` still left
  that grandchild alive. The verifier then killed the exact probe PID and
  removed its temp root. Plain Node and PowerShell backend probes without a
  detached descendant did close after supervisor death, so the retained gap is
  specifically descendant containment, not activation ordering.
- **Required correction:** bind recovery authority to an OS-observable process
  instance (or fail closed on reuse uncertainty), and make the admitted root a
  containment boundary that still reaches every admitted descendant after the
  supervisor itself has crashed. Add deterministic reused-matching-PID and
  supervisor-crash-with-descendant regressions.

### Major - V6 late-open cleanup releases ownership without observed close

- **Location:** `src/core/session-host/host.ts:420-480`.
- **Problem:** shutdown now registers and awaits in-flight opens. If an open
  returns after draining starts, however, the host ignores both a
  `{closed:false}` termination result and a termination exception, clears its
  local transport, releases the exact claim, and removes the durable process
  authority. Shutdown can therefore return while a live privileged process is
  both unowned and unrecorded. This violates the observed-close ownership rule
  in the Change spec.
- **Independent discriminator:** both `closed:false` and throwing late
  transports returned `session-busy`; each had one termination attempt and one
  claim release, while the injected process remained alive and the resulting
  record exposed neither a PID nor retained process authority.
- **Required correction:** treat late-open termination exactly like other live
  transport cleanup: retain the claim and durable process facts until close is
  positively observed, and persist interrupted/uncertain state when it is not.
  Add both `closed:false` and throw regressions.

### Resolved Round 2 dispositions

- **V1 resolved:** the independent retirement/shutdown ordering stayed
  `retiring` until the retirement tail persisted `retired`.
- **V2 resolved:** omission of the mandatory acceptance fence failed as
  `backend-protocol-failed`, remained pre-acceptance, and terminated once.
- **V3 resolved:** forced close-observer CAS loss preserved settlement and
  cleared the exact stale PID.
- **V8 resolved:** never-settling acceptance timed out once; resolving the
  fence later caused no second state change or termination. Acceptance and the
  explicitly independent event-phase timers are each bounded as authored.
- No new Blocker, Minor, or Trivial regression was found in the reviewed delta.

Tasks 9.8 and 9.9 must remain unchecked because V5 and V6 are still Major.
Task 9.10 remains pending. Route only these two retained findings to a fresh
non-author fixer and require another delta-only independent confirmation.

REVIEW VERDICT: CHANGES_REQUIRED - Blocker:0 Major:2 Minor:0 Trivial:0

## Strategy attempt 1 — fresh non-author review (2026-08-04)

Review pin: branch `wip/ecp-shared-bounded-loop-lifecycle-resume`, HEAD
`050fc84332b26a75a07f441efd6b235842f89e1e`, HEAD tree
`58489c46633a209d2c1761c2a4b684ad8b95cb48`. This pass reviewed the shared
dirty-worktree implementation in place and changed evidence only.

### Historical disposition

- **R3-V5-A is resolved.** The Windows controller is the unique holder of an
  unnamed, non-inherited kill-on-close Job; the supervisor is created suspended
  with Job membership at creation. The real Windows controller-death oracle
  killed the root and detached descendant while leaving an unrelated process
  alive. Both the duplicate-Job-handle and early-activation mutations were
  detected.
- **R3-V5-B is not resolved.** Linux no longer relies on second-resolution
  `ps lstart`, but the implemented macOS exact-birth source has an incorrect ABI
  and therefore cannot establish the advertised identity on a real macOS host.

### Findings introduced or still open in this strategy delta

#### [Major] A backend-root EXIT is misreported as closure of the whole scope

`native/process-capsule/src/main.rs:285-294` waits only for the backend root and
emits `EXIT`; the supervisor continues serving control frames. The Node client
nevertheless sets the scope to `closed` and resolves `closed` immediately at
`src/core/session-host/process-capsule/native-process-scope.ts:224-229`.
`observeTransportClose` then clears the durable process authority at
`src/core/session-host/host.ts:640-679`.

A fresh real-Windows probe used a backend root that spawned a detached child and
then exited. It observed:

```json
{"closed":{"code":0,"signal":null},"observation":{"state":"live","controllable":true},"controllerAlive":true,"rootAlive":false,"descendantAlive":true}
```

The same retained ref then terminated the controller/scope and left all three
processes dead, proving the original authority was still valid when the host
would have discarded it. This violates the selected death-matrix invariant
"backend root dies with descendants: scope remains live" and the spec rule that
unobserved authority is never released. Split backend exit from scope-empty /
controller-terminal closure and add this exact real-process regression.

#### [Major] POSIX replacement cleanup kills only the controller and can orphan the contained group

Linux/macOS one-shot termination validates and signals `pid`, the controller,
at `native/process-capsule/src/main.rs:1011-1111` and `:1115-1159`, then merely
waits for the supervisor to disappear. Unlike the Windows Job, POSIX controller
death has no kernel kill-on-close effect. `PosixContainment::drop` only closes a
pidfd (`:832-844`), and the forwarding thread can terminate the controller with
`process::exit(73)` (`:1246-1256`), which skips destructors. Consequently a
replacement daemon cannot reliably reap a positively identified supervisor /
process group after controller loss and returns uncertainty while the worker
tree remains live.

Make replacement control validate the exact controller and supervisor native
birth identities and terminate the exact reserved group (or use an equivalent
kernel-enforced parent-death containment). Add real Linux and macOS daemon-death,
controller-death, resistant-descendant, and PID-reuse discriminators.

#### [Major] The macOS unique-birth structure is 40 bytes but the Apple ABI is 56 bytes

`mac_birth` defines a 40-byte `UniqueInfo` at
`native/process-capsule/src/main.rs:910-950` and requires `proc_pidinfo` to return
exactly that size. Apple's XNU declaration includes two further `uint64_t`
reserve fields and statically asserts a size of 56 bytes:
https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_info_private.h#L41-L51

The cross-target compiler cannot detect this runtime ABI mismatch. On macOS the
call is therefore expected to fail closed instead of furnishing the required
kernel unique-birth capability. Mirror the full ABI (prefer generated/system
bindings where practical), assert its size, and run the real collision /
foreign-identity / unavailable-source oracles on macOS.

#### [Major] Post-PREPARED activation and abort have no control deadline

Preparation and one-shot probes use `controlTimeoutMs`, but `activate()` awaits
`client.activated.promise` without a timer and `abort()` awaits termination /
close without a timer at
`src/core/session-host/process-capsule/native-process-scope.ts:361-382`. A live
but wedged controller or pipe can therefore block publication recovery or
shutdown indefinitely. This contradicts task 7.6's requirement that every
fault path have a bounded timer and one typed outcome. Apply deadlines to every
control phase, retain exact authority on unobserved close, and add a hung-
controller mutation for activate and abort.

#### [Minor] Source-identical helper builds are not byte reproducible

`scripts/build-process-capsule.mjs:18,68-71` builds under a fresh random Cargo
target directory. Repeated source-identical Windows builds produced distinct
helper SHA-256 values (including `ccbc9d96...`, `e4099027...`, `fa2ae9a3...`,
and the later pack build `e174ef95...`). Each generated manifest correctly
matches its adjacent binary, so runtime integrity verification works, but the
claimed source/compiler/binary provenance is not reproducible from the same
tree/toolchain. Use a reproducible linker/build configuration and add a
two-clean-build equality gate, or explicitly narrow the provenance claim.

### Fresh gates

- focused host/native/daemon/CLI suite: **21 files, 140 tests passed**;
  the CLI bridge alone was 3/3
- native contract/package/migration/real-host subset: **4 files, 17 tests
  passed**
- `pnpm run build`, `pnpm run lint`, `pnpm exec tsc --noEmit`, `git diff
  --check`: passed (diff-check emitted only the pre-existing line-ending
  warnings)
- `cargo +stable fmt --check` and `cargo +stable clippy --locked --all-targets
  -- -D warnings`: passed; active pinned-toolchain Linux and macOS target checks
  passed
- strict Change validation: passed
- `npm pack --dry-run --json`: passed, 936 entries; it contained the manifest
  and the current Windows helper. Independent length/SHA verification matched
  `262144` bytes and `e174ef956d3b8c103672c9d3916cc61127f92627400a653826d8a199cbb551fd`
- no live `rasen-process-capsule.exe` or replay helper remained. Four native-test
  temp directories dated before this fresh run remain under `%TEMP%`; they were
  observed but not removed by this report-only reviewer.

This pass does not mark tasks 9.8 or 9.9 complete. Task 9.10 remains ineligible
until all Major findings are fixed and freshly re-reviewed.

REVIEW VERDICT: CHANGES_REQUIRED - Blocker:0 Major:4 Minor:1 Trivial:0

## Round 3 independent confirmation

Reviewed at `2026-08-04T16:56:29.8108347+08:00` as a fresh non-author
reviewer against branch `wip/ecp-shared-bounded-loop-lifecycle-resume`, HEAD
`050fc84332b26a75a07f441efd6b235842f89e1e`, tree
`58489c46633a209d2c1761c2a4b684ad8b95cb48`.

The exact 20-file Round 3 manifest was independently reconstructed with LF
separators and a trailing LF; its SHA-256 is
`df1d7bf6ac444a334969dac7e68c4e4ab3df0f8bf448fb00a4801512164ceaca`,
matching the fixer handoff. The fixer-recorded HEAD-to-current delta-state hash
is `8742602b1918e17c73d49ccf74833a14901bce5c08ad5dc218498fca9e498202`
and content hash is
`335cc0b265014bd96ce6efc6e3d0c558aabc418b5a4bfa77b2dc27842a55fe89`.
No scoped product or test file changed during this review.

### Fresh gates

- `pnpm run build`: PASS (22.3 s).
- Exact focused 16-file Vitest command recorded below: PASS, 16 files and
  125/125 tests (204.83 s; 207.6 s wall).
- `pnpm run lint`: PASS.
- `pnpm exec tsc --noEmit`: PASS.
- `node bin/rasen.js validate ecp-durable-agent-session-host --strict`: PASS.
- `git diff --check`: PASS; cumulative line-ending notices only.
- Forbidden-authority scan: PASS; no Run/Action/Record/EvidenceStore,
  completion signing, trusted-state, or private-key custody match.
- Post-probe audit: PASS; no matching replay/session-host/controller process or
  reviewer temporary root remained.

```text
pnpm exec vitest run test/core/session-host test/core/agent-cli-process.test.ts test/core/claude/runner.test.ts test/core/management-api/hosted-sessions-api.test.ts test/core/management-api/hosted-session-recovery.test.ts test/core/management-api/server-shutdown.test.ts test/commands/daemon-half-started.test.ts test/commands/daemon-spawn-convergence.test.ts test/cli-e2e/session-host.test.ts --maxWorkers=1 --minWorkers=1
```

### Round 3 findings

#### R3-V5-A - Major - Killing the Windows Job controller does not contain the admitted tree

- **Locations:** `src/core/agent-cli-process.ts:223-310`, especially the Job
  handle lifetime and final `CloseHandle` calls at lines 308-309.
- **Evidence:** two real probes used the built production adapter and the
  `descendant-process-survival` fixture. In the stronger probe the admitted
  root PID was 12028, the direct PowerShell controller child was PID 24972,
  and a detached descendant was PID 23232. CIM inspection proved the
  controller command was the production encoded controller. After exact
  termination of PID 24972, the controller was dead while both root and
  detached descendant remained alive at 0 ms, 250 ms, 1 s, 3 s, and 6 s.
  The first independent run showed the same result with root 45120,
  controller 15476, and descendant 12376.
- **Contract impact:** the required invariant is not merely that supervisor
  death closes the tree; controller death itself must not let an admitted
  backend escape kernel containment. The existing regression kills the
  supervisor, not this controller, so it does not discriminate the failure.
- **Required correction:** make the containment handle lifetime robust to
  controller death and prove it with a real Windows regression that kills the
  controller and observes the root plus detached descendants die. Include
  controller pipe-close and daemon-crash variants where the chosen design
  distinguishes them.

#### R3-V5-B - Major - Remaining-POSIX identity is not an exact process instance

- **Locations:** `src/core/claude/session-state.ts:751-783` and
  `test/core/session-host/ownership.test.ts:102-157`.
- **Evidence:** the remaining-POSIX path hashes only
  `ps -p PID -o lstart=`, whose textual value has one-second resolution.
  Distinct processes started in the same second therefore have the same
  identity. If the numeric PID is reused within that second, inspection can
  return `same` and authorize a signal to an unrelated process. The new reuse
  test is parameterized only for `win32` and `linux`; it never exercises this
  production fallback.
- **Contract impact:** this violates the authored exact process-start identity
  requirement for Windows, Linux, and remaining POSIX. Deferring macOS remote
  CI does not make the deterministic fallback identity exact.
- **Required correction:** capture a truly collision-resistant OS process
  birth identity on supported remaining-POSIX hosts, or fail closed when an
  exact identity cannot be obtained. Add a regression that drives the actual
  fallback capture/inspect path through a same-second collision or equivalent
  PID-reuse discriminator.

### Retained and resolved dispositions

- **V6 resolved:** late-open `closed:false` and throw paths retain transport,
  claim, and exact process facts; retry closes and releases once. Host
  shutdown, management-server stop, and daemon cleanup all remain retryable
  instead of reporting a clean stop.
- The new Job setup occurs before activation, passes only a numeric root PID
  through the overwritten controller environment, and uses an encoded constant
  command. No prompt/secret interpolation or client-controlled binary/argv
  path was found.
- Product timeout/deadline semantics were not relaxed. The larger margins are
  test-harness polling or outer test timeouts only.
- No Blocker, Minor, or Trivial regression was found in the Round 3 delta.

Tasks 9.8 and 9.9 must remain unchecked because V5 is still Major. Task 9.10
remains pending and the full root/UI suite is intentionally reserved for that
post-review gate.

REVIEW VERDICT: CHANGES_REQUIRED - Blocker:0 Major:2 Minor:0 Trivial:0

## Current authoritative review verdict (strategy attempt 1)

The fresh non-author strategy review supersedes the historical Round 3 tail:
R3-V5-A is closed, R3-V5-B remains open, and three new Major lifecycle gaps
plus one Minor reproducibility gap are recorded above.

REVIEW VERDICT: CHANGES_REQUIRED - Blocker:0 Major:4 Minor:1 Trivial:0
