## Context

The Codex path of `rasen agent audit` already derives per-request deltas (ts, turnId, cache read/write, output) in `src/core/token-audit/parse-codex.ts`, but `runCodexAudit` (`src/core/token-audit/audit.ts`) aggregates them into turns and discards the rows. The LEAD's full-corpus survey (233 rollouts / 227MB, planning-context.md「全量数据摸底」) established what the data actually supports:

- `info.last_token_usage` is present on 99.6% of `token_count` events (5493/5513) — per-request increments straight from the harness; the 20 misses are old CLI versions. `info.model_context_window` on 5446 events.
- `context_compacted`, `thread_rolled_back`, and `user_message` events exist → compaction and injection attribution ARE supported; the only genuinely unsupported churn cause is parentUuid-style message-chain fork detection (chain-fork rebase).
- `turn_aborted` (73 occurrences) is a real turn-boundary event the parser currently ignores, leaving aborted turns' requests dangling.
- `session_meta` carries agent_nickname/agent_path/agent_role/parent_thread_id, forked_from_id, cli_version, and context_window.

Constraints: no version bump; experimental positioning and fail-soft boundaries unchanged (bad line skipped, format drift throws `TranscriptFormatError`; a field a given CLI version simply didn't emit is ABSENCE, never drift); the product viewer is repo-root `viewer/audit.html` (NOT the `scripts/token-audit/viewer.html` prototype); Windows dev machine, `pnpm test` with known EBUSY flake; CLI copy localized via `RASEN_LANG`.

## Goals / Non-Goals

**Goals:**
- Surface every dimension the Codex rollout data actually supports: per-request timeline, cache-rebuild detection with cause attribution (compaction, injection, idle-gap TTL approximation), burst clustering, context-window occupancy, `last_token_usage`-based per-request accuracy.
- Handle `turn_aborted` as a turn boundary so aborted turns' spend is attributed, not dangling.
- Explicitly label the dimensions the data does not support — chain-fork rebase attribution and billed-equivalent pricing — in both JSON and viewer.
- Keep the report schema additive (`rasen-token-audit/2` stays, per the M1 caveats precedent).

**Non-Goals:**
- Codex billed-equivalent pricing (OpenAI cached-input discount multipliers are not pinned; deferred rather than guessed).
- Heuristic fork-replay segment exclusion (stays flagged-not-excluded, audit.ts M1 caveat).
- Chain-fork rebase attribution (no parentUuid-style message chain in rollouts — the one truly unsupported cause).
- Changes to the Claude path beyond code shared by both.

## Decisions

**D1 — Per-request rows in `CodexAuditResult`.** Add a `requests` block mirroring the Claude columnar shape: `{ columns, classes, rows }` with columns `['agent', 'ts', 'input', 'cachedInput', 'cacheWrite', 'output', 'reasoningOutput', 'context', 'class']` and rows of `Array<number | null>`. Columnar arrays over objects for report size and because the viewer already has column-index plumbing. Agent indices follow the same activation-order remap the Claude path uses.

**D2 — Codex classification reuses the full `RequestClass` set except chain-fork evidence.** Classes emitted: `spawn`, `hit`, `context-drop`, `rebase`, `ttl-expiry`, `unattributed` — the existing values, so the viewer's class→color map keys apply unchanged. Detection (per full-corpus facts):
- `hit`: `cachedInputTokens` >= `HIT_PREFIX_RATIO` (0.9, shared constant) of the previous request's cached prefix (`cachedInputTokens + cacheWriteInputTokens`).
- `context-drop`: a `context_compacted` or `thread_rolled_back` event observed since the previous request, or context shrank below `DROP_CTX_RATIO` (shared constant) — the direct-event signal is stronger evidence than Claude's inference-only path.
- `rebase`: a `user_message` event landed between requests (injection evidence — the same "injected" criterion Claude uses). Chain-fork evidence does not exist in rollouts, so a Codex `rebase` always means injection; viewer copy makes that explicit.
- `ttl-expiry`: idle gap ≥ threshold (interval heuristic — Codex publishes no TTL; presented as an approximation; named exported constant).
- else `unattributed`.
Event-evidenced causes are checked before the interval heuristic. Implemented as `classifyCodex()` in `classify.ts` beside `classify()` — input shapes differ (`CodexDeltaRequest` + between-request markers vs `ParsedRequest`); the parser records between-request markers (compacted / rolledBack / userMessage counts) per derived request, the Codex analog of Claude's `BetweenLines`.

**D3 — Rebuild events list.** Each non-hit, non-spawn request emits a `CodexRebuildEvent { agent, ts, gapMin, cause, prevPrefix, readNow, rewrote, compacted, injected, rolledBack }` where `rewrote = cacheWriteInputTokens` of the rebuilding request. Totals gain `rebuilds: { events, rewroteTokens, byCause }`. Named "rebuild" in Codex-facing copy; JSON field names are new (no collision with Claude fields).

**D4 — `last_token_usage` is PRIMARY; cumulative delta is fallback + cross-check.** With 99.6% coverage, `last_token_usage` is the harness's own per-request increment — more accurate than cumulative differencing in replay/reset scenarios. Rule: a derived request's token fields come from `last_token_usage` when the event carries it; when absent (old CLI versions — `session_meta.cli_version` explains why), fall back to the cumulative-delta value for that request. Cumulative counters are still tracked in parallel; aggregation compares per-field sums against the cumulative endpoint totals and appends a caveat (existing `caveats` mechanism) naming fields that disagree beyond a tolerance constant — surfaced, never silently reconciled. Alternative (cumulative-primary with increment cross-check — the first draft's choice) rejected after the full-corpus survey: the harness-authored increment is strictly better evidence at 99.6% coverage, and demoting it to a mere check would perpetuate known inaccuracy; the endpoint cross-check still guards against increment gaps. Missing `last_token_usage` on an event is ABSENCE (fallback, no caveat, no throw); a present-but-non-numeric field inside it is drift (`TranscriptFormatError`), matching the `total_token_usage` treatment.

**D5 — `turn_aborted` closes turns.** `parseCodexRolloutFile` treats `turn_aborted` like `task_complete` for boundary purposes (closes the open turn, stamps its end) and marks the turn aborted; `CodexTurn` gains `aborted?: boolean` and the viewer marks aborted turns. Requests after an abort and before the next `task_started` fall into the existing untitled-turn bucket (unchanged behavior, now rarer and correct).

**D6 — Occupancy from `model_context_window`.** Parser captures `info.model_context_window` (latest-seen; `session_meta.context_window` as fallback source) — absence tolerated. Per-request context = the request's `input_tokens` from the primary source (per D4) ALONE. (Estimator pinned against the real 233-rollout corpus during implementation, tasks.md 1.4: Codex's `input_tokens` is the full prompt size and already INCLUDES `cached_input_tokens` as a subset, so an earlier draft's `input + cachedInput + cacheWrite` sum double-counted — verified e.g. `{input_tokens:14802, cached_input_tokens:13824}` is a ~14.8k-token prompt, not ~28.6k. `cache_write_input_tokens` is near-always 0 and a write-path subset, not additive context.) Agent gains `peakContext` and `modelContextWindow: number | null`; occupancy = peakContext / window when the window is known, otherwise the dimension is labeled unavailable, never guessed.

**D7 — Unsupported dimensions are declared in the report.** `CodexAuditResult` gains `unsupportedDimensions: Array<{ dimension: string; reason: string }>` built from a named constant (rule: explicit list, not pattern-derived). Post-survey the list shrinks to: chain-fork rebase attribution (no message-chain data in rollouts) and billed-input-equivalent pricing (no pinned multipliers). The viewer renders it as a visible disclosure panel.

**D8 — Viewer.** `viewer/audit.html` Codex path (`renderCodex`) gains: the timeline card enabled for Codex reports carrying `requests` rows (multi-thread gantt via the existing timeline renderer with column-name indirection), a rebuild-events table (replacing the "no churn taxonomy" placeholder), occupancy in tiles/agent table ("n/a — window not reported" when null), bursts per agent, aborted-turn marking, and the unsupported-dimensions disclosure. Old reports without the new fields must still render (every new field optional — same backward tolerance the runtime dispatch already practices). On the Codex path the `rebase` legend reads "injection" (no chain-fork claim).

**D9 — Bursts.** `clusterBursts` generalized over the minimal shape it needs (`ts`, rewrote-source, class) or duplicated as `clusterCodexBursts`; preference for a shared generic if it stays readable. `BURST_GAP_MS` (3 min) shared. Codex agent records gain `bursts` with the existing `Burst` shape (`resume: 'spawn' | 'HIT' | 'MISS'`).

## Risks / Trade-offs

- [Interval-heuristic TTL attribution can mislabel] → presented as an approximation ("idle-gap"); event-evidenced causes (compaction/injection/rollback) are checked first so the heuristic only labels what stronger evidence didn't claim; everything else stays `unattributed`.
- [Old-CLI events lack `last_token_usage`] → per-request fallback to cumulative delta (D4); absence adds no caveat and is never drift.
- [Fork/resume replay pollutes per-request rows] → existing forkedFrom caveat extended to name the per-request timeline; `last_token_usage`-primary additionally reduces replay distortion within requests.
- [Viewer growth in a single hand-maintained HTML file] → keep new render functions in the existing sectioned style; no framework, no build step.
- [Schema consumers reading `rasen-token-audit/2`] → all additions are optional fields; nothing renamed or removed.

## Open Questions

(none — remaining estimator/threshold details are pinned during implementation against the real 233-rollout corpus, with decisions recorded in tasks.md.)
