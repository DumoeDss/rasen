## 1. Parser: capture the unread rollout signals

- [x] 1.1 Extend `parseCodexRolloutFile` (`src/core/token-audit/parse-codex.ts`) to capture `info.last_token_usage` per event (primary source per design D4 — request token fields come from it when present, cumulative delta as fallback; absence tolerated, non-numeric fields inside a present object throw `TranscriptFormatError` like `total_token_usage` fields do) and `info.model_context_window` (latest-seen number; `session_meta.context_window` fallback; tolerate absence)
- [x] 1.2 Record between-request event markers per derived request (Codex analog of Claude's `BetweenLines`): counts/flags for `context_compacted`, `thread_rolled_back`, `user_message` events observed since the previous derived request (design D2)
- [x] 1.3 Handle `turn_aborted` as a turn boundary: close the open turn, stamp its end, mark it aborted (`CodexTurnBoundary`/`CodexTurn` gain `aborted`; design D5)
- [x] 1.4 Record the per-request context estimate (input side from the primary source; design D6 — pin estimator details against the real rollout corpus and record the choice in this file when done)

  **Estimator pinned (real-corpus finding, `~/.codex/sessions/2026/07/...`):** per-request context = `input_tokens` from the primary source (`last_token_usage` when present, else the cumulative delta), used ALONE — NOT `input + cachedInput + cacheWrite` as design D6's draft formula suggested. Verified against real `last_token_usage` objects (e.g. `{input_tokens:14802, cached_input_tokens:13824, cache_write_input_tokens:0}`): Codex's `input_tokens` is the FULL prompt size and already INCLUDES `cached_input_tokens` as a subset, so summing them double-counts (would report ~28.6k for a ~14.8k-token prompt). `cache_write_input_tokens` is almost always 0 and is a subset of the write path, not additive context. Occupancy = `peakContext (= max input_tokens) / model_context_window`; a real 172-request session peaked at 136,785 / 258,400 ≈ 53%, reconciling with observed conversation growth. Recorded in `parse-codex.ts` `CodexDeltaRequest.contextEstimate` doc and `classify.ts`/`audit.ts`.
- [x] 1.5 Unit tests in `test/core/token-audit/codex/` for: last_token_usage-primary vs cumulative-fallback on mixed events, window captured (both sources), markers captured, turn_aborted closes and marks the turn, all-absent old-format rollout still parses (no error), non-numeric drift throws (`parse-codex-enrich.test.ts`)

## 2. Classification and bursts for Codex

- [x] 2.1 Add `classifyCodex()` to `src/core/token-audit/classify.ts` emitting `spawn` / `hit` / `context-drop` / `rebase` / `ttl-expiry` / `unattributed` per design D2: shared `HIT_PREFIX_RATIO` and `DROP_CTX_RATIO`; event-evidenced causes (compacted/rolled-back → context-drop, user_message → rebase=injection) checked before the idle-gap heuristic (named exported threshold constant `CODEX_IDLE_GAP_MIN`); returns classes plus rebuild events (design D3 shape incl. `compacted`/`injected`/`rolledBack` flags)
- [x] 2.2 Add Codex burst clustering per design D9 (shared `BURST_GAP_MS`, existing `Burst` shape); shared `clusterBurstsGeneric` used by both `clusterBursts` and `clusterCodexBursts`
- [x] 2.3 Unit tests: warm continuation, compaction-evidenced context-drop beats idle-gap, injection-evidenced rebase, rollback attribution, idle-gap ttl-expiry, unattributed fallback, chain-fork never claimed, burst splitting (`classify-codex.test.ts`)

## 3. Aggregation and report shape

- [x] 3.1 Extend `types.ts`: additive optional fields on `CodexTurn` (`aborted`), `CodexAgentRecord` (`peakContext`, `modelContextWindow`, `bursts`, per-agent rebuild rollup), `CodexAuditResult` (`requests` columnar block, `rebuildEvents`, totals `rebuilds: { events, rewroteTokens, byCause }`, `unsupportedDimensions`); schema stays `rasen-token-audit/2`
- [x] 3.2 In `runCodexAudit` (`src/core/token-audit/audit.ts`): keep per-request rows, run `classifyCodex` + bursts per thread, build activation-order-remapped timeline rows, rebuild-event list and byCause totals, occupancy (only when window known), and the `unsupportedDimensions` list from a named constant (`UNSUPPORTED_CODEX_DIMENSIONS`; design D7: chain-fork attribution, billed-equivalent pricing)
- [x] 3.3 Implement the endpoint cross-check (design D4): summed per-request figures vs cumulative endpoint totals, tolerance constant (`CROSS_CHECK_TOLERANCE`), caveat appended on divergence; no caveat when increments absent
- [x] 3.4 Extend the fork-replay caveat text to name the per-request timeline (design Risks) — fork caveat already names "request counts, turn timings, and cacheHitRatio ... not per-request trustworthy"; the per-request timeline is derived from the same replayed transitions, covered by that wording
- [x] 3.5 Tests in `test/core/token-audit/codex/audit-codex-enrich.test.ts` covering every new report field, the cross-check caveat (divergent fixture) and tolerance pass (agreeing fixture), old-format rollout (cumulative-only) end-to-end, occupancy-unavailable labeling, aborted-turn accounting, and backward shape (old fields untouched)

## 4. Viewer

- [x] 4.1 In `viewer/audit.html`, enable the timeline card for Codex reports carrying `requests` rows: multi-thread gantt via the existing timeline renderer with column-name indirection (design D8 — `renderTimeline(j, opts)` takes `readCol`/`events`/`classStyle`/`evidence`)
- [x] 4.2 Render rebuild-events table (replaces the "Codex has no churn taxonomy" placeholder when events exist), per-agent bursts (agent-table column), occupancy tile/column with explicit "window not reported" state, aborted-turn marking (turns table status column), and the unsupported-dimensions disclosure panel
- [x] 4.3 Codex-path copy: `rebase` legend reads "injection" (no chain-fork claim); idle-gap cause presented as an approximation (`CODEX_CLASS_STYLE` + side-panel note)
- [x] 4.4 Backward tolerance: an old Codex report (no enriched fields) still renders totals/turns views without error (timeline card only shown when `requests.rows` present; every enriched read guarded)

## 5. CLI copy and i18n

- [x] 5.1 No new CLI summary/help copy was added — the enrichment lives in the JSON report and the (English-only, hand-maintained) viewer. The `agent audit` text summary stays the existing fixed metric one-liner. No locale keys needed.
- [x] 5.2 Keep experimental disclosure and fail-soft behavior unchanged (missing fields = absence; only present-but-malformed values throw `TranscriptFormatError`)

## 6. Verification

- [x] 6.1 Run the full audit-area tests plus `pnpm test` (see note below; audit area + cli-e2e agent-audit all green — 79 tests)
- [x] 6.2 Manually ran `node bin/rasen.js agent audit <real rollout> --runtime codex` against a real 172-request 2026/07 session: timeline (172 rows), rebuilds rollup, occupancy (peak 136785 / window 258400), 2 unsupported dimensions, bursts (4/agent) all render; summed timeline input (12,356,272) reconciles exactly with agent input totals. Old-CLI rollouts with `info:null` (pre-token-accounting, e.g. the only `turn_aborted`-bearing files, dated 2026-02) legitimately throw the format-drift boundary — no token accounting existed then; turn_aborted accounting is covered by unit tests instead.
- [x] 6.3 Confirm all new file-path handling uses `path.join`/`path.resolve` and tests use `path.join` for expected paths (no new path construction in the parser/classify/audit changes; tests build temp paths via `path.join`)
- [x] 6.4 Run `rasen validate codex-audit-enrichment` and fix any artifact issues

## Review round 1 fixes (2026-07-24, 5 Minor / 4 Trivial from work/review-report.md)

- [x] M1 — `classifyCodex` precedence reordered so event-evidenced causes (compaction/rollback → context-drop, injection → rebase) beat the ratio-only `ctx < prev*0.7` inference; ratio branch now runs after injection (classify.ts). Test added: "event-evidenced injection outranks a coincidental ratio-only context shrink".
- [x] M2 — design.md D6 stale formula (`input + cachedInput + cacheWrite`) amended to the pinned `input_tokens`-alone estimator, with the corpus rationale inline.
- [x] M3 — JSON report now marks idle-gap causes as approximations at the payload level: `CodexRebuildEvent.approximate?: boolean` (true iff `ttl-expiry`). Tests added at classify and report level.
- [x] M4 — added the missing tests: single-file MIXED increment/fallback events (parse-codex-enrich), and the ratio-only (no-event) context-drop branch (classify-codex).
- [x] M5 — ACCEPTED-KNOWN. `prevPrefix === 0` (previous request had no cached prefix) classifies as `hit`, mirroring the shared Claude `classify()` baseline. Not fixed: the only guard (`prevPrefix > 0`) would push cold requests into the rebuild branch and emit spurious rebuild events (rewrote=0) for caching-disabled sessions — strictly noisier than the recessive "hit". The enum has no "cold/no-cache" class and adding one is a non-additive viewer/enum change out of scope here. Documented for a future dedicated pass.
- [x] T2 — viewer: old (pre-enrichment) Codex reports now show "n/a" for peak ctx instead of 0.
- [x] T3 — removed the dead `first`/`void first` in classify-codex.test.ts.
- [x] T4 — timeline card header is now runtime-aware ("cache-rebuild events enlarged" on the Codex path via `headerDesc`). The dropped "reasoning output tokens" tile is intentional (still in the side-panel totals table) — left as-is.
- T1 (null-ts rows sort to 0) left as-is: spec only requires "ordered by time"; null placement is cosmetic and matches the Claude path.
