## 1. Scheduler Core

- [x] 1.1 Create `src/core/management-api/session-touch-scheduler.ts` with named cadence, cold-gap, scan, backoff, and message constants plus injected clock, timer, logger, and reusable-session client interfaces.
- [x] 1.2 Implement pure candidate classification for status, mode, deadline, touches used/max, recent activity, eligible cadence, cold gap, and deterministic deadline-before-cold precedence.
- [x] 1.3 Implement stable SHA-256 touch message IDs and restart reconstruction from durable touch ordinal/attempt terminal metadata, including pending completed/uncertain accounting and safe next attempts after proven pre-delivery failure.
- [x] 1.4 Implement serialized/coalesced scans, conditional-touch calls with observed activity, benign stale/contention handling, per-session capped exponential backoff, and failure isolation.
- [x] 1.5 Implement coordinator-mediated stop, silent retirement, maximum-exhaustion, and cold-policy actions without reading or writing `sessions.json`.
- [x] 1.6 Implement immediate startup scan, conservative forward/backward wall-clock handling, and idempotent `stop()` that blocks new scans and settles or classifies the current bounded request.

## 2. Daemon Integration

- [x] 2.1 Implement the production authenticated loopback adapter against the frozen `rasen-reusable-session-api/1` schema using the daemon's actual port/token, strict response decoding, and pre- versus post-commit transport classification.
- [x] 2.2 Wire exactly one scheduler into `src/commands/daemon.ts` after the management server starts, and await scheduler shutdown before `stopServer()` for SIGINT/SIGTERM without starting it in UI or foreground server paths.

## 3. Deterministic Verification

- [x] 3.1 Add fake-clock tests for recent/eligible/cold gaps, invalid or missing deadlines, max-touch exhaustion, stop versus silent-retire deadlines, deadline/cold precedence, and backward/forward clock jumps.
- [x] 3.2 Add fake-client tests for interactive races, single-flight stale rejection, completed/duplicate accounting, crash between wake and accounting, delivery uncertainty without replay, pre-delivery retry identity, capped backoff, and per-session isolation.
- [x] 3.3 Add scheduler lifecycle tests for immediate restart scan, terminal metadata reconstruction, non-overlapping/coalesced ticks, no-daemon inactivity, and shutdown before/after request commitment.
- [x] 3.4 Add daemon integration tests with a fake authenticated loopback server to prove one bootstrap instance, exact protocol requests, token use, startup ordering, signal shutdown ordering, and no scheduler in non-daemon management processes.
- [x] 3.5 Run the focused scheduler/daemon suite on Windows plus injected POSIX timer/network cases, record child-local commands, and leave the final native CI and real 50-minute evidence to `session-cache-optimization-acceptance-evidence`.

## 4. Boundary and Package Verification

- [x] 4.1 Run typecheck and all affected focused suites, confirm the diff contains only `session-touch-scheduler.ts`, `src/commands/daemon.ts`, and the two declared scheduler test files, and strictly validate this change package.
- [x] 4.2 Confirm no direct registry I/O, alternate coordinator/supervisor, previous-PID adoption, uncertain-message replay, or edit to CLI, completion, locale, router, server, wire-type, durable-registry, forbidden, package-lock, or acceptance/run-state files.

## 5. Round 1 Review Fixes

- [x] 5.1 Close the scheduler side-effect gate synchronously in `stop()`, recheck it immediately after `listAll()` and before every touch/policy/retire call, add pre-commit cancellation classification, and prove a list pending across stop cannot start any new side effect.
- [x] 5.2 Serialize the snapshot's `expectedLastWakeAt` on every cold-policy request, strictly decode `conditional_wake_stale` as a benign interactive-wins skip with no replacement mutation, assert the complete policy body, and cover the interactive wake → stale cold update race against the CLI-owned seam.
- [x] 5.3 Settle loopback response `aborted`, response-error, and premature-close paths exactly once as post-commit `transport_uncertain`; add a headers-plus-partial-body reset test proving bounded settlement and retry of the exact ordinal/attempt message ID.
- [x] 5.4 Reduce one loopback-operation timeout to 4 seconds, bound total scheduler stop drain to 5 seconds, preserve scheduler-before-server ordering and no post-stop list transition, and add a deterministic composition test for `20s > 5s + 8s + 2s + 1s = 16s` while consuming the CLI-owned daemon-probe grace read-only and never replaying an uncertain exact ID.

## 6. Post-Review Serial Verification

- [x] 6.1 Run the two scheduler-owned focused files strictly serial with one worker: 2 files and 28 tests pass without unhandled errors.
- [x] 6.2 Run the affected daemon lifecycle/probe, reusable-session API/routes, and server-shutdown collection strictly serial with one worker: 5 files and 31 tests pass.
- [x] 6.3 Run ESLint on the four scheduler-owned TypeScript/test files and strictly validate this change package: both pass.
- [x] 6.4 Verify the final integrated-tree build: after the CLI owner minimally narrowed the diagnostic type with scheduler files frozen, its related 1-file/11-test suite and single-file ESLint passed, and the CLI owner ran `pnpm build` to exit 0 with `Build completed successfully`; the scheduler child changed no code and reran no verification command.
