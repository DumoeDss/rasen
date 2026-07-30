## 1. Host Contract and Test Harness

- [x] 1.1 Add additive reusable-host input, snapshot, result, and structured-error types plus `createHost`, `wakeHost`, `retireHost`, and `getHost` methods to the existing supervisor contract without changing the one-shot `launch`/`kill` signatures or `SessionRecord` schema.
- [x] 1.2 Add LF-safe Node and Windows `.cmd` fake-Claude fixtures that accept stream-json user messages over stdin, emit init/result events across configurable chunk boundaries, remain alive between turns, record deliveries, and simulate idle loss, mid-turn loss, missing init, delayed result, and graceful/forced close.
- [x] 1.3 Add focused red tests in `test/core/management-api/` for bootstrap-to-idle creation, repeated wakes on one pid/session id, idle-without-watchdog termination, incremental NDJSON parsing, malformed/unknown events, bounded tails, and shared capacity/drain admission.

## 2. Live Host and Single-Flight Implementation

- [x] 2.1 Refactor only the necessary trusted spawn/tail/runtime-context helpers in `supervisor.ts` so one-shot launches keep their exact argv/stdin behavior while reusable create/recovery launches use piped stdin and fixed stream-json argv.
- [x] 2.2 Implement reusable-host creation with synchronous capacity reservation, immutable cwd/launch facts, one user-event NDJSON encoder, per-turn overall/no-output timers, init identity capture, bootstrap result collection, and complete cleanup on every pre-live failure path.
- [x] 2.3 Implement repeated `wakeHost` delivery with one pending-turn resolver, backpressure-safe stdin writes, complete-line event decoding, result-envelope return, and transition back to idle after each healthy turn.
- [x] 2.4 Implement the synchronous per-host admission transition and structured `host_busy`/`host_retired` responses; prove an overlapping wake performs no stdin write or recovery spawn while different hosts remain independently admissible.

## 3. Loss Recovery, Retirement, and Owner Shutdown

- [x] 3.1 Classify child `error`/`close` exactly once, release live-process capacity and runtime resources exactly once, preserve idle host recovery facts, and return `delivery_uncertain` without replay when close follows an accepted stdin write but precedes its result.
- [x] 3.2 Implement next-wake recovery for a known lost host by spawning `--resume <captured-session-id>` in the original cwd with the original trusted launch facts, preserving the stable host reference and updating pid; return `host_unrecoverable` without spawning when no session id exists.
- [x] 3.3 Implement terminal, idempotent retirement: block new wakes synchronously, let an accepted turn settle within its bounds, close stdin, wait for actual close, escalate through `killProcessTree` after grace, and retire an already lost host without resume.
- [x] 3.4 Extend `shutdownAll()` to drain and reap reusable hosts alongside one-shot sessions while preserving the existing synchronous drain gate, close-keyed release discipline, and non-retirement semantics of owner shutdown.

## 4. Cross-Platform and Regression Verification

- [x] 4.1 Add focused recovery/retirement tests covering idle loss and new pid, original-cwd resume, missing identity, ambiguous mid-turn loss with zero replay, retire-during-wake, lost-host retire, repeated retire, SIGTERM-resistant escalation, exact slot accounting, and mixed one-shot/reusable shutdown.
- [x] 4.2 On Windows, run the real `.cmd` fixture path and verify canonical cwd identity, `windowsHide`, fixed argv escaping, literal metacharacter/multi-line stdin delivery, recovery argv, and process-tree cleanup using `path`/`realpath` helpers required by `test/AGENTS.md`.
- [x] 4.3 Run the focused supervisor host-lifecycle, existing supervisor, injection, session-context handover, sessions API, and server-shutdown Vitest files serially; then run `pnpm run build`, `pnpm run lint`, and `pnpm test` without concurrent root build/test commands.
- [x] 4.4 Audit the final diff to confirm no public `rasen session` command, durable registry/lock/touch policy, daemon scheduler, P2/P3 work, `src/core/change-run/**`, or `src/core/pipeline-registry/**` changes entered this child.
