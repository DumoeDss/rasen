## Why

`codex-runtime-exec-core` (shipped, commit a658620) gives the LEAD one-shot Codex dispatch: build an invocation, capture the thread id, parse the result. But rasen's orchestration is built on workers that live longer than one call — warm continuation (Tier A SendMessage-equivalent), revival after infrastructure death, retry-vs-abort decisions on provider failures, parallel dispatch, and cross-session warm seeding. The parity dossier live-verified all of these on Codex (solutions 02/03/04/06, codex-cli 0.144.1); this change implements the tier-2 lifecycle layer on top of exec-core's shipped primitives.

## What Changes

- **Resume dispatch** — the existing invocation builder (`buildCodexExecInvocation`) gains an additive `resume` variant emitting `codex exec resume <threadId> …`, preserving every exec-core invariant (stdin closed, flat-hierarchy guard, effort clamp, `--output-schema`/`-o` composition). No second builder. Explicit thread id only — `--last` is not supported because it is ambiguous under parallel dispatch.
- **Death detection** — a reader that inspects a thread's rollout event log and reports whether its final turn is unterminated (an opening turn event with no matching completion/failure), the live-verified signal that a worker died mid-turn. Paired with a named revival-notice constant the LEAD appends when resuming a dead worker ("your last action may not have completed — re-verify file state before trusting it"), per E02's observed loss mode.
- **Failure retry classification** — classify a `turn.failed` error as retryable (429/rate-limit — E02 observed transient 429s that succeeded on retry) vs fatal (404/model-not-available — E05) vs unknown, plus a pure exponential-backoff delay schedule. The library computes; the caller sleeps.
- **Single-writer-per-thread discipline** — an in-process claim registry that rejects a second concurrent claim on the same thread id, enforcing the dossier's "one thread id, one writer" rule for parallel dispatch (E08 verified N-process parallelism is safe precisely because threads are never shared).
- **Cross-session warm seed** — rollout location gains the `archived_sessions/` fallback exec-core explicitly deferred to this change, and a warm-seed distiller turns a rollout into seedable conversation content that filters agent messages to `phase === "final_answer"` and deduplicates the terminal answer, which the live-verified rollout shape duplicates across `agent_message` and `task_complete.last_agent_message`.
- All new behavior stays in `src/core/codex/` (pure core: reads the filesystem, never spawns, sleeps, prints, or exits), exported via the module root for the two remaining siblings.

## Capabilities

### New Capabilities
- `codex-lifecycle`: the Codex worker lifecycle layer — warm continuation via resume dispatch, mid-turn death detection with a revival notice, retryable-vs-fatal failure classification with a backoff schedule, single-writer-per-thread claims for parallel dispatch, and cross-session warm seeding from rollout files including archived sessions.

### Modified Capabilities

(none — `codex-exec-runtime`'s specced behavior is unchanged; the resume variant and richer final-answer metadata are additive, and the warm-continuation contract lives in the new capability.)

## Impact

- Modified code (additive only): `src/core/codex/invocation.ts` (resume variant), `src/core/codex/rollout.ts` (archived-sessions fallback in `findRolloutPath`; final-answer records gain source/phase metadata alongside the existing `finalAnswers` strings), `src/core/codex/index.ts` (new exports).
- New code: `src/core/codex/lifecycle.ts` (death detection, revival notice, failure classification, backoff schedule, thread-writer claims, warm-seed distillation).
- Consumers: `codex-runtime-context-probe` is unaffected; `codex-runtime-playbook-integration` consumes the resume builder, death detection, classification, and warm-seed distiller when wiring the orchestration playbook.
- Dependencies: none added. Tests: vitest under `test/core/codex/` (fixtures mirror dossier captures — E02 kill-mid-turn tail, E02/E05 failure messages, live-verified rollout shapes; no live Codex invocation in CI). Behavior remains pinned to codex-cli 0.144.1 via `CODEX_CLI_VERSION_PREMISE`. Never bump the package version.
