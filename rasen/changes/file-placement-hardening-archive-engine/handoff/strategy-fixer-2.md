# Strategy Fixer 2 Handoff

## Scope

Fixed only the Strategy-attempt-1 Major: completed-integrity detection and alert persistence now have a terminal-local error boundary. A valid matching published-journal `integrityFailure` is authoritative before ordinary phase handling, including when an older generic failure wrapper left `phase: failed` with `failure.resumePhase: complete`.

No canonical review report, task state, run state, root/foundation implementation, commit, push, or archive operation was changed. This is an implementation and verification handoff, not a re-review of the delta.

## Root cause

The initial terminal-integrity implementation wrote the completed alert directly inside the main `applyArchive` try/catch. If that write threw, including a synchronization failure after bytes might have landed, the exception escaped into generic `applyFailure`. That path could rewrite the historical completed journal to `failed` and advertise an ordinary recovery command for an archive that cannot be repaired automatically.

Generic phase handling also ran before a durable terminal alert was treated as authoritative, so a matching alert wrapped by a stale `failed` phase could be routed as a normal resume.

## Implementation

- `src/core/archive-engine.ts:3688-3701`
  - Added `bindPublishedRecoveryJournal` to initialize all recovery state from the authoritative published journal without changing its historical phase.
- `src/core/archive-engine.ts:3703-3767`
  - Added `persistCompletedIntegrityFailure`, the local terminal persistence boundary.
  - It preserves the completed phase while atomically adding the alert.
  - If the write throws, it rereads and strictly validates the published journal. A matching durable alert wins and returns its deterministic manual-only result.
  - If no matching alert is durable, it returns a truthful journal-persistence blocker against the published journal with `resumed: true`, explicit manual-only guidance, and no `recoveryCommand`. It does not throw into `applyFailure` or mutate the historical phase.
- `src/core/archive-engine.ts:3770-3787`
  - Published-journal recovery ownership and alert detection now run before git, probe, source, and phase branching.
  - Any valid matching `integrityFailure` dominates the wrapper phase, including stale `failed`/`resumePhase: complete` journals.
- `src/core/archive-engine.ts:3800-3850`
  - Completed source-absent recovery binds the published journal first and routes newly detected integrity failures through the local persistence boundary.

The terminal state contract is:

| Published state | Result | Journal mutation |
| --- | --- | --- |
| Matching valid alert, any wrapper phase | Return the durable alert's deterministic manual-only result | None |
| New integrity failure, alert write succeeds | Return manual-only integrity result | Add alert; preserve historical phase |
| Alert write throws, reread finds matching durable alert | Return that durable alert's manual-only result | No further write |
| Alert write throws, no durable alert found | Return journal `EIO`/actual persistence blocker plus explicit manual action; no ordinary recovery command | Preserve the authoritative historical journal; a later invocation may retry detection/persistence only |

## Deterministic regression

`test/core/archive-fault-matrix.test.ts:1150` adds an adapter-level regression that injects exactly one `EIO` at the terminal alert journal temporary file-handle `sync` call. It proves:

- the first result points to the published journal, is `resumed: true`, is manual-only, and has no `recoveryCommand`;
- the completed journal bytes and `phase: complete` survive the failed alert write unchanged;
- the corrupted archive payload is never rewritten;
- a repeat retries detection/persistence and durably records the original accounting `ESTALE` alert while retaining `phase: complete`;
- further repeats return the same result and preserve journal bytes;
- a manually constructed stale `failed` wrapper retaining that alert is dominated by the alert before normal phase handling, with its bytes left unchanged.

TDD red evidence: before the implementation, this regression returned the injected generic journal blocker without a manual action and escaped into the ordinary recovery path. After the terminal-local boundary, the regression passes.

## Verification evidence

- New sync-fault regression: PASS, 1/1.
- Terminal-integrity group (normal corruption, sync-fault regression, real CLI round trip): PASS, 3/3.
- Full archive fault matrix: PASS, 32/32.
- Archive suite:
  - High-risk engine/consumer/fault files: PASS, 59 passed with 1 expected POSIX-only skip on Windows.
  - Remaining seven archive/accounting/ephemera/template files: PASS, 111/111.
  - Combined: PASS, 10/10 files, 170 passed with 1 expected skip.
- Adjacent work/completion tests: PASS, 27/27.
- `pnpm lint`: PASS.
- `pnpm exec tsc --noEmit`: PASS.
- `pnpm build`: PASS.
- `node bin/rasen.js --help`: PASS, exit 0.
- `node bin/rasen.js archive --help`: PASS, exit 0; `--save-plan`, `--apply-plan`, `--intent-template`, and `--intent-file` are present.
- `node bin/rasen.js work migrate --help`: PASS, exit 0.
- `node bin/rasen.js validate file-placement-hardening-archive-engine --json`: PASS, 1/1 valid.
- `git diff --check`: PASS; repository line-ending conversion warnings only.
