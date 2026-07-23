## Why

`rasen agent audit` gives Claude sessions a rich report — per-request timeline, cache-churn causes, burst clustering, occupancy — but the Codex path stops at raw totals and a cache-hit ratio, even though the Codex rollout data demonstrably supports much more (per-request deltas with timestamps and turn ids are already parsed and then discarded; `last_token_usage` and `model_context_window` are never read). A Codex user auditing the same kind of session gets a far thinner answer than the data allows, and dimensions the data genuinely cannot support are silently absent rather than honestly labeled.

## What Changes

- The Codex report gains a per-request timeline (timestamp, turn, cache read/write deltas, output) instead of discarding per-request data after turn aggregation.
- Cache-rebuild detection on the Codex path: requests whose cached-input reading collapses instead of continuing warm are surfaced as itemized rebuild events with evidenced causes — compaction/rollback (the runtime records these events directly), injected user message, or an idle-gap (TTL-approximation) cause — and explicitly "unattributed" otherwise. The one cause the data cannot evidence (message-chain fork) is never claimed.
- Per-request accounting is derived from the runtime's own per-request increments (`last_token_usage`, present on 99.6% of events per the full-corpus survey), with cumulative-delta differencing as the fallback for older-CLI events and as an endpoint cross-check; disagreement beyond tolerance is surfaced as a report caveat.
- Aborted turns (`turn_aborted`) become real turn boundaries: their spend is attributed to the aborted turn instead of dangling, and the turn is marked aborted.
- Burst clustering (activity clusters split by idle gaps, each labeled by how it resumed) is added to the Codex report.
- Context-window occupancy: `model_context_window` from the rollout is used to report how full each agent's context ran (peak and per-request), when the rollout provides it; absence is labeled, not guessed.
- Dimensions the Codex data cannot support (message-chain fork attribution, billed-equivalent pricing) are explicitly labeled as unsupported in both the JSON report and the viewer — no blank spots, no fabricated parity.
- The bundled viewer renders the new Codex dimensions: request timeline (multi-thread gantt), rebuild events, occupancy, bursts, aborted-turn marking, and a visible "not supported by Codex data" disclosure.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `cli-agent-audit`: the Codex-path requirements change — the report contract expands from raw totals + cache-hit ratio to per-request timeline, cache-rebuild visibility with evidenced attribution, burst clustering, occupancy, aborted-turn accounting, and increment-primary derivation with an endpoint cross-check, with unsupported dimensions explicitly disclosed; the viewer requirement expands to render these Codex dimensions.

## Impact

- `src/core/token-audit/types.ts` — additive fields on `CodexAuditResult` / `CodexAgentRecord` (schema stays `rasen-token-audit/2`, following the caveats precedent).
- `src/core/token-audit/parse-codex.ts` — additionally capture `last_token_usage` and `model_context_window` (fail-soft: absence is tolerated, not format drift).
- `src/core/token-audit/audit.ts` — Codex aggregation keeps per-request rows, runs rebuild detection/burst clustering, computes occupancy and the cross-check.
- `src/core/token-audit/classify.ts` — Codex-subset classification (reusing the portable HIT-prefix and burst-gap thresholds).
- `viewer/audit.html` — Codex render path gains the new views.
- Locales (`src/locales/*.json`) for any new CLI summary text.
- Tests under `test/core/token-audit/` and `test/cli-e2e/agent-audit.test.ts`.
- No version bump; experimental positioning and fail-soft parsing boundaries unchanged.
