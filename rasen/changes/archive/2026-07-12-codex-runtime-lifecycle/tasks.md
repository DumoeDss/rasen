# Tasks — codex-runtime-lifecycle

Version premise: codex-cli 0.144.1 (`CODEX_CLI_VERSION_PREMISE`); never bump the package version. All extensions to existing files are additive. Do NOT use E10's captured output-schema fixture as a contract example — it predates the finalized schemas.

## 1. Resume dispatch (builder extension)

- [x] 1.1 Add `resume?: { threadId: string }` to `BuildCodexExecInvocationOptions` in `src/core/codex/invocation.ts`; when present emit `exec resume <threadId>` ahead of the existing flags, leaving all other argv assembly untouched (no `--last` support by design — see design D1)
- [x] 1.2 Tests in `test/core/codex/invocation.test.ts`: resume argv ordering; resume composes with `--output-schema`/`-o`/`-s`/`-m`/effort clamp/provider override; flat guard still terminates the prompt; fresh-dispatch snapshots unchanged

## 2. Death detection and revival notice

- [x] 2.1 Implement `detectThreadDeath(rolloutPath)` + pure `detectDeathInRows(rows)` in new `src/core/codex/lifecycle.ts`: last turn-opening event (`task_started`/`turn.started`, top-level or `event_msg` payload) with no subsequent closer (`task_complete`/`turn.completed`/`turn.failed`/`turn_failed`/`turn_aborted`) → `{ dead: true, lastOpenedAt? }`; no opener at all → `{ dead: false }`
- [x] 2.2 Live-verify the real turn-boundary vocabulary on this machine: kill a throwaway `codex exec` mid-turn (dev machine only, never CI), capture the rollout tail as the test fixture, and trim the matcher's accepted names to what reality shows (keep tolerance for both families if inconclusive). LIVE RESULT: killed a throwaway `codex exec` in a scratchpad dir (thread `019f5786-0da4-...`); the rollout tail showed only `event_msg`/`task_started` with no `task_complete`/`turn_aborted` — confirming the rollout-side vocabulary is `task_started`/`task_complete`/`turn_aborted` (event_msg payload only); scanned ~40 real rollouts and never saw a dotted `turn.*` name inside a rollout file (that vocabulary is exec `--json` stdout-only). Kept both families in the matcher per design's explicit tolerance directive since the miss cost is asymmetric (extra accepted name vs. missed real signal); documented the finding in lifecycle.ts's doc comment.
- [x] 2.3 Add exported `CODEX_REVIVAL_NOTICE` constant (interrupted turn, last action may be incomplete, re-verify file/command state) — provided to callers, never auto-injected
- [x] 2.4 Tests `test/core/codex/lifecycle.test.ts`: killed-mid-turn fixture → dead; cleanly-completed fixture → not dead; opener-free rollout → not dead; malformed lines skipped

## 3. Failure classification and backoff

- [x] 3.1 Implement `classifyTurnFailure(input: TurnFailedEvent | string)` → `{ kind: 'retryable' | 'fatal' | 'unknown', reason }`: case-insensitive substring rules (429/too many requests/rate limit → retryable; 404/not available → fatal; else unknown), `reason` quoting the matched fragment
- [x] 3.2 Implement `backoffDelayMs(attempt, { baseMs = 20_000, maxMs = 120_000 })`: exponential doubling from base, capped, deterministic; pure function (caller sleeps)
- [x] 3.3 Tests: E02's 429 message → retryable; E05's `404 Not Found: model … is not available` message → fatal; unrelated message → unknown; accepts both a `TurnFailedEvent` and a bare string; backoff sequence 20s/40s/80s/120s/120s

## 4. Single-writer-per-thread claims

- [x] 4.1 Implement `claimThreadWriter(threadId)` (returns idempotent release; throws on double-claim naming the thread id) and `isThreadWriterClaimed(threadId)` over a module-level registry; document the cross-process "one thread id, one writer globally" operator invariant on the registry doc comment
- [x] 4.2 Tests: double-claim throws with the thread id in the message; release then re-claim succeeds; release is idempotent; independent thread ids don't interfere

## 5. Cross-session warm seed

- [x] 5.1 Extend `findRolloutPath` in `src/core/codex/rollout.ts` with a final `<codexHome>/archived_sessions/` flat-directory fallback (filename contains thread id, newest-first mtime), absent-means-undefined contract unchanged
- [x] 5.2 Extend `readRolloutConversation`: populate `finalAnswerRecords: { text, source: 'agent_message' | 'task_complete', phase? }[]` alongside the existing `finalAnswers` strings (existing fields byte-identical for existing fixtures), reading `phase` from the live-verified `agent_message` payload field
- [x] 5.3 Implement `distillWarmSeed(conversation)` in `lifecycle.ts`: keep turns; keep `agent_message` records only when `phase === 'final_answer'` (drop `commentary`); dedupe exact-text repeats against `task_complete` records; records without phase are kept
- [x] 5.4 Tests: archived-sessions fallback (temp-dir fixture with active-tree miss), still-undefined when absent everywhere; `finalAnswerRecords` population incl. null `last_agent_message` skip; distiller drops commentary, dedupes the duplicated terminal answer to one occurrence, keeps unphased records; existing `finalAnswers` behavior unchanged

## 6. Export surface, validation, wrap-up

- [x] 6.1 Re-export all new symbols through `src/core/codex/index.ts` (siblings import from the module root only)
- [x] 6.2 One-shot local live smoke (dev machine only, not CI): `codex exec resume <threadId>` with the full flag set incl. `--output-schema` against a throwaway thread, confirming composition; record the outcome in the change work dir. FINDING: `-s`/`--sandbox` is rejected outright by `codex exec resume` (confirmed via failure + `--help`) — fixed the builder to omit it on resume, corrected design.md D1 and the spec's "compose with resume" scenario accordingly; every other flag (`-o`/`-m`/`-c` effort+provider/`--output-schema`) live-confirmed to compose, and resume correctly re-entered the same thread id. Full writeup: `/Users/sayo/.rasen/projects/rasen-1e42477e/changes/codex-runtime-lifecycle/work/live-smoke/task-6.2-resume-smoke.md`
- [x] 6.3 Run `pnpm test` (full suite) and `rasen validate codex-runtime-lifecycle` — both clean; sweep new doc comments for `CODEX_CLI_VERSION_PREMISE` citations on version-contingent behavior; confirm no version bump and no hardcoded provider values
