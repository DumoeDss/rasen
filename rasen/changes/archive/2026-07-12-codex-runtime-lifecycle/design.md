## Context

`codex-runtime-exec-core` shipped (commit a658620) the dispatch primitives in `src/core/codex/`: the data-only invocation builder with its safety invariants, exec event-stream parsing, rollout location/reading, contracts, and the run-state identity record (rollout path recorded in the `transcript` field). This change adds the lifecycle layer per the portfolio plan (`rasen/changes/codex-runtime/planning-context.md`) and dossier solutions 02/03/04/06.

Facts this design leans on:

- `codex exec resume <thread-id> --json -o <file> "<msg>"` re-enters an existing thread from any process/cwd with full prior context, even after a `kill -9` mid-turn; only the in-flight turn's uncommitted final answer is lost, and the killed turn's in-progress command output is missing from restored context (E02).
- Death signal: the rollout event log's final turn has an opening event with no matching completion/failure event (E02's captured tail).
- Transient `429 Too Many Requests` is retryable (E02: succeeded ~20s later); `turn.failed` with a model 404 is fatal without a config change (E05). These two classes must be kept distinct in run-state handling (solution 14).
- Parallel `codex exec` processes are safe because each gets its own thread and rollout; the un-tested (presumed unsafe) case is two concurrent resumes of ONE thread id — hence single-writer-per-thread (E08, solution 02).
- Archived rollouts live under `<codexHome>/archived_sessions/` as a flat `rollout-<ts>-<threadId>.jsonl` dir; exec-core's `findRolloutPath` explicitly deferred this fallback to this change (rollout.ts comment, design D8 of exec-core).

Implementation discoveries from exec-core (must be honored here):

- `readRolloutConversation` reads the REAL nested payload shape (`response_item.payload.role/content`; `task_complete.last_agent_message` may be null; `agent_message.payload.message`) — live-verified.
- `agent_message` payloads carry a `phase` field (`commentary` | `final_answer`), and the terminal answer DUPLICATES across `agent_message` and `task_complete.last_agent_message` (accepted-known n1). The warm-seed consumer in THIS change filters OUT `phase === 'commentary'` (blacklist, not a whitelist on `final_answer` — see the review-round correction under D6 below) and dedupes only across the `agent_message`/`task_complete` source pair.
- `deterministicRolloutPath` uses LOCAL time (codex names rollout files in local time); the full-scan fallback already exists.
- E10's captured `--output-schema` fixture is an ad-hoc hybrid, NOT conformant to the finalized contract schemas — no fixture or test in this change may treat it as a contract example.

## Goals / Non-Goals

**Goals:**

- Extend `buildCodexExecInvocation` additively with a resume variant (one builder, per the portfolio interface contract).
- `src/core/codex/lifecycle.ts`: death detection over rollout event logs, a named revival-notice constant, `turn.failed` retry classification, a pure backoff schedule, an in-process thread-writer claim registry, and a warm-seed distiller.
- Extend `findRolloutPath` with the deferred `archived_sessions/` fallback and extend the rollout reader's final-answer output with source/phase metadata (additively — existing fields keep their shape).
- Fixture-driven vitest coverage; CI never invokes a real `codex` binary. Pure-core discipline throughout: this module computes and reads; the caller spawns, sleeps, and writes.

**Non-Goals:**

- No `rasen agent context` / occupancy integration (sibling `codex-runtime-context-probe`).
- No playbook/template wiring, no decision policy for WHEN to resume vs cold-respawn (sibling `codex-runtime-playbook-integration`; this module provides the mechanisms and signals).
- No cross-PROCESS locking (lock files, sqlite). The LEAD is a single process; the claim registry covers the real concurrency surface (parallel dispatch inside one LEAD). Cross-process discipline stays a documented invariant.
- No actual retry loop or sleeping — `backoffDelayMs` computes a schedule; executing it is the caller's job.
- No app-server bridge, no `codex exec resume --last`.

## Decisions

### D1: Resume is an additive option on the ONE builder

`BuildCodexExecInvocationOptions` gains `resume?: { threadId: string }`. When present, argv becomes `exec resume <threadId> --json …` (subcommand and id inserted immediately after `exec`, before flags, matching E02's verified form); everything else — `-o`, `-m`, effort clamp, `--output-schema`, provider override, template inlining, flat guard — composes unchanged. Rationale: the portfolio contract says "extend the SAME builder additively; no second builder", and a fresh dispatch and a resume differ in exactly one argv segment plus one flag omission (below). `--last` is rejected by design (not even an option field): under parallel dispatch "the most recent thread" is a race, and the LEAD always holds explicit thread ids in run-state.

**Correction from the task 6.2 live smoke test (supersedes the "sandbox/model are per-invocation" claim from E02/solution 03, which turned out to describe the app-server bridge's semantics, not `codex exec resume`'s actual CLI flag surface):** `codex exec resume` does NOT accept `-s`/`--sandbox` at all. A real invocation carrying `-s` fails immediately with `error: unexpected argument '-s' found` before any dispatch happens — confirmed both by this failure and by `codex exec resume --help`, whose flag list has no `-s`/`--sandbox` entry (it does list `-m`, `-c`, `--output-schema`, `--json`, `-o`). Sandbox mode is apparently fixed at thread creation, not a per-resume override. The builder omits `-s` when `resume` is present; `-o`, `-m`, `-c` (effort clamp + provider override), and `--output-schema` were all live-confirmed to compose correctly with resume in the same smoke test (the actual turn was blocked by transient 502s from this dev machine's reverse proxy — an environment issue matching E02's documented flakiness, not a composition failure). Spec scenario "Fresh-dispatch invariants compose with resume" is corrected to match.

The flat guard stays appended on resume prompts. Alternative (skip the guard on resume because the thread start scaffolding already saw it) rejected: the guard arrives as message text, not thread scaffolding, so a new message without it is a new opportunity to delegate; repeating one paragraph is free.

### D2: Death detection reads the rollout, tolerates both turn-boundary vocabularies

`detectThreadDeath(rolloutPath)` (and a pure `detectDeathInRows(rows)` over pre-parsed lines for testability) returns `{ dead: boolean, lastOpenedAt?: string }`. A thread is dead-in-flight when the LAST turn-opening event has no subsequent turn-closing event. The dossier's captures name the boundary events inconsistently — the exec `--json` stream says `turn.started`/`turn.completed`/`turn.failed`, while rollout `event_msg` payloads carry `task_started`/`task_complete` — so the matcher accepts both vocabularies (openers: `task_started`, `turn.started`; closers: `task_complete`, `turn.completed`, `turn.failed`, `turn_failed`, `turn_aborted`), operating on both top-level `type` and `event_msg` `payload.type`. Rationale: the two families are observed in different capture surfaces of the same version; matching both makes the detector robust to which one a rollout actually carries, and unknown events are ignored (consistent with exec-core's tolerant readers). The implementer live-verifies against a real kill-mid-turn rollout on this machine (exec-core's implementer already proved live verification is available) and trims the vocabulary if reality is narrower — the fixture then records the real shape.

A rollout with NO turn-opening event at all is `dead: false` — a thread that never started a turn is idle, not dead (mirrors exec-core's "no token_count = 0%, not an error" convention).

### D3: Revival notice is a named constant

`CODEX_REVIVAL_NOTICE` (exported, per "if we generate it, track it by name"): a paragraph the LEAD prepends/appends to the resume message after a death detection, stating that the previous turn was interrupted, its last action may not have completed, and the worker must re-verify actual file/command state rather than trusting its prior turn's claims. Directly encodes E02's observed loss mode (the killed `sleep 30`'s output never exists in restored context). This module does not auto-inject it into resume prompts — whether a resume is a revival is the caller's knowledge; the constant keeps the wording uniform and testable.

### D4: Failure classification is data-in, verdict-out, with an explicit `unknown`

```ts
classifyTurnFailure(input: TurnFailedEvent | string): {
  kind: 'retryable' | 'fatal' | 'unknown';
  reason: string;   // which rule matched, quoting the matched fragment
}
```

Rules (case-insensitive substring over the error message): `429` or `too many requests` or `rate limit` → `retryable`; `404` or `not available` → `fatal`. Everything else → `unknown` — deliberately NOT collapsed into `fatal`: the dossier only proves two classes, and the playbook sibling decides `unknown` policy (likely fail-with-report). Encoding unproven failures as `fatal` would silently forbid retry on e.g. a transient 500. Alternative (structured error codes) rejected: exec-mode `turn.failed` carries a prose `error.message` only (exec-core's `TurnFailedEvent`); substring matching over live-captured messages is the honest precision available, and `reason` keeps every verdict auditable.

`backoffDelayMs(attempt, { baseMs = 20_000, maxMs = 120_000 })` — exponential doubling from `baseMs` (attempt 1 → 20s, matching E02's observed ~20s recovery), capped, deterministic (no jitter: the LEAD retries a handful of workers, not a thundering herd, and deterministic values are testable exactly). Pure function; the caller sleeps.

### D5: Single-writer discipline is an in-process claim registry

```ts
claimThreadWriter(threadId: string): () => void   // returns release; throws if already claimed
isThreadWriterClaimed(threadId: string): boolean
```

Module-level `Set`-backed registry. Claiming a thread id that is already claimed throws an actionable error naming the thread id — this converts the dossier's "presumed unsafe, untested" double-resume into a loud programming error at the dispatch layer. Release is idempotent. Scope is deliberately per-process: the LEAD (one Claude session) is the only dispatcher, so in-process coverage is the real concurrency surface; a cross-process lock file was considered and rejected — it writes outside the repo (violating pure-core read-only discipline), leaks on crash (stale locks need TTL policy), and defends against an architecture rasen doesn't have. The cross-process invariant ("one thread id has one writer, globally") is documented on the registry and in the new capability spec as an operator rule.

### D6: Warm seed = archived-sessions fallback + phase-aware distillation

Two additive extensions to `rollout.ts`, one new distiller in `lifecycle.ts`:

1. `findRolloutPath` gains a final fallback scanning `<codexHome>/archived_sessions/` (flat dir, filename contains the thread id, newest-first on mtime) after the dated-tree scan. Same absent-means-undefined contract. This closes the gap exec-core's D8 explicitly parked here.
2. `RolloutConversation` gains `finalAnswerRecords: Array<{ text: string; source: 'agent_message' | 'task_complete'; phase?: string }>` populated alongside the existing `finalAnswers: string[]` (unchanged, so exec-core's spec and any consumer of the string array are untouched). `phase` is read from the live-verified `agent_message` payload field; `task_complete` records carry no phase.
3. `distillWarmSeed(conversation)` in `lifecycle.ts` → `{ turns, finalAnswers }` where final answers DROP only `agent_message` records with `phase === 'commentary'` (a blacklist), then deduplicate exact-text repeats but ONLY across the `agent_message`/`task_complete` source pair — matching the live-verified duplication (accepted-known n1) without collapsing two legitimately identical answers from different turns of the same source. Records with no phase (task_complete, or drifted shapes) AND records with an unrecognized-but-present phase value both survive — missing/unknown metadata degrades to "keep", never to silent loss. Kept as a pure function over `RolloutConversation` (not a file reader) so the playbook sibling can compose it with either a fresh read or a cached conversation.

**Correction from review round 1 (M2/M3):** the first implementation used a whitelist (`phase === 'final_answer'` kept, everything else dropped) and a global exact-text dedup across all records regardless of source. The whitelist form contradicted this very file's Risks section ("phase field is a live observation … drift degrades to duplicate answers, not loss") — a drifted-but-present phase value was silently dropped, which is loss, not duplication. The global dedup was wider than "against `task_complete` records" above and could collapse two different turns' identical answers. Both are fixed to the blacklist/cross-source-only form described here; tests added for an unrecognized-phase record (kept) and same-source repeats across turns (not deduped against each other).

Rationale for splitting extraction (exec-core) from distillation (here): extraction is a shape fact about rollouts; what a warm seed should KEEP is lifecycle policy — the portfolio put the dedupe/filter decision in this child verbatim.

### D7: File layout and export surface

New `src/core/codex/lifecycle.ts` holds death detection, `CODEX_REVIVAL_NOTICE`, classification, backoff, the claim registry, and `distillWarmSeed` — one file, one concern (thread lifecycle), mirroring exec-core's per-concern layout. `invocation.ts` and `rollout.ts` are extended in place (additive). Everything new is re-exported through `src/core/codex/index.ts`; siblings keep importing from the module root only.

## Risks / Trade-offs

- [Rollout turn-boundary vocabulary may be narrower than the dual-family matcher assumes] → implementer live-verifies a kill-mid-turn rollout on this machine before finalizing; fixtures record the real captured shape; the matcher's tolerance means a wrong guess degrades to "extra accepted names", never a missed real signal.
- [Substring failure classification can misfire on messages that merely mention "404"/"429"] → `reason` quotes the matched fragment so every verdict is auditable; `unknown` (not a guessed class) is the fallback; classification gates a RETRY decision, so the worst misfire is a wasted retry or an early report, never data loss.
- [In-process claims don't stop a second LEAD process from resuming the same thread] → documented invariant on the registry and in the spec; rasen's architecture has one LEAD per run, and run-state ownership of a change is already single-session by convention.
- [Deterministic (jitterless) backoff could synchronize retries if many workers 429 together] → cap + the LEAD's small worker counts make this negligible; revisit only if parallel widths grow by an order of magnitude.
- [`phase` field is a live observation, not documented API — may drift] → distiller treats missing/unknown phase as "keep"; drift degrades to duplicate answers in a seed (harmless verbosity), not loss.
- [Resume composition with `--output-schema` was verified as "no reason to doubt", not exhaustively re-tested per flag] → tasks include a one-shot local live smoke (dev machine only, not CI) of `exec resume` with the full flag set before ship.

## Migration Plan

Additive library change: new exports, extended options, one widened return type (`RolloutConversation` gains a field). No existing caller changes behavior; no data migration; rollback is reverting the commit.

## Open Questions

- Whether `turn.failed` can also surface transient 5xx messages worth a `retryable` rule — left to live evidence; `unknown` + auditable `reason` is the safe default until observed.
- Whether the playbook sibling wants `distillWarmSeed` to also cap seed size (token budget) — deferred there; this module returns everything and lets the consumer truncate.
