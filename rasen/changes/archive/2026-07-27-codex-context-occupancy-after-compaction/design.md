## Context

`readRolloutOccupancy` currently scans a Codex rollout for `token_count` events and reports `info.total_token_usage.total_tokens` from the last usable event. That field is a monotonically increasing lifetime counter: Codex forms it by accumulating each request's `last_token_usage`. Codex's own context management instead treats `last_token_usage.total_tokens` as the current prompt/context size.

The distinction becomes visible after `context_compacted`: lifetime usage continues increasing while current-context usage drops. A captured rollout produced `164620250 / 258400` through the existing reader even though the same event reported a current-context value of `40556`. Existing helpers and fixtures usually emit only `total_token_usage`, so the test suite encodes the wrong contract.

The reader is shared by the core probe, `AgentCommand.context`, the CLI, and best-effort orchestration estimates. Claude transcripts use a separate reader and must remain unchanged. Codex rollout JSONL is an internal runtime format, so missing or malformed optional-looking fields must be handled without inventing an occupancy value.

## Goals / Non-Goals

**Goals:**

- Make Codex occupancy mean current context consumption, including after compaction.
- Preserve chronological "last valid snapshot wins" parsing and malformed-JSON-line tolerance.
- Distinguish a true zero-turn rollout from a token-count stream that cannot supply current occupancy.
- Prevent compatibility fallbacks from reintroducing cumulative lifetime spend as occupancy.
- Keep limit overrides, model detection, successful output shape, threshold calculation, and Claude behavior stable.
- Align the main specification and Codex parity documentation with the corrected field semantics.

**Non-Goals:**

- Change Codex token-audit accounting, whose cumulative and per-request counters serve a different spend-analysis contract.
- Estimate occupancy for old Codex rollout formats.
- Change context thresholds, session discovery, runtime detection, output fields, or the Claude transcript parser.
- Introduce a new CLI flag or external dependency.

## Decisions

### 1. Use `last_token_usage.total_tokens` as the sole Codex occupancy source

For each usable `token_count` event, the reader will pair numeric `info.last_token_usage.total_tokens` with numeric `info.model_context_window`. The latest such pair is the occupancy snapshot. Internal consumers use `contextTokens` so call sites do not confuse current occupancy with the cumulative counter. Because `RolloutOccupancy` is exported through the npm package root, the public result also retains a deprecated `totalTokens` compatibility alias equal to `contextTokens`; the alias carries the corrected current-context value and never restores lifetime-cumulative semantics.

`total_token_usage` remains valid for spend/audit analysis but is not an occupancy fallback. This matches the runtime's current-context semantics and prevents plausible-but-wrong values before the cumulative counter happens to exceed the window.

Alternative considered: use cumulative usage only when it is at or below the window. Rejected because a cumulative value can remain below the window for many requests and still overstate current context.

### 2. Preserve last-valid scanning while making unsupported streams explicit

The parser will continue skipping blank or malformed JSONL lines and structurally unusable token-count records. It will return the last event that contains a complete current-context/window pair, even if later drifted records are unusable. This preserves the reader's established resilience and makes the freshness rule explicit.

The reader will separately track whether any `token_count` event was observed:

- No token-count event means the existing zero-turn state and returns `null`.
- At least one token-count event but no valid current-context snapshot means the rollout cannot support an occupancy probe and raises an actionable error.

The core probe and direct CLI command therefore fail rather than print zero or cumulative usage for an old/drifted explicit or discovered rollout. `tryContextEstimate` keeps its existing best-effort contract and converts that reader failure to `undefined`.

Alternative considered: map a legacy stream to zero occupancy. Rejected because it is indistinguishable from a genuinely empty context and can incorrectly authorize worker reuse. A new unavailable-result reason was also considered, but would expand the public output contract for a narrowly scoped format error; the existing hard-error path is clearer and smaller.

### 3. Test the semantic boundary at every affected layer

The direct rollout-reader regression will contain multiple token-count events whose cumulative and current counters diverge, a `context_compacted` boundary, and a final event where cumulative usage continues upward while current usage drops. Assertions will prove that the final current-context value and inline window drive occupancy.

Core agent-context tests will verify propagation, limit override recomputation, zero-turn distinction, last-valid behavior, and the actionable failure when token counts exist without `last_token_usage`. Agent-command and CLI end-to-end tests will verify the observable JSON value and failure contract. Existing helpers and the captured rollout fixture will be updated to include realistic `last_token_usage` fields so unrelated tests do not retain the false legacy shape.

Claude transcript cases remain in the focused suite as a regression boundary. Broader testing is needed only if implementation changes escape the Codex reader/probe path.

### 4. Correct all authoritative occupancy prose without changing audit prose

The `cli-agent-context` main spec and its delta will define current-context usage, compaction behavior, and unsupported legacy/drifted streams. Codex parity documents that currently prescribe `total_token_usage` for occupancy—`docs/codex-parity/solutions/05-transcript-occupancy-probe.md`, `docs/codex-parity/experiments/E03-rollout-transcript-anatomy.md`, and `docs/zh/codex-parity-solutions.md`—will be corrected to use `last_token_usage`.

Token-audit documentation and code will retain their cumulative-counter descriptions because those counters are correct for lifetime spend analysis.

## Risks / Trade-offs

- [Older Codex rollouts may stop producing occupancy instead of returning a number] → Fail with an actionable message that names the missing current-context snapshot; never disguise cumulative spend or zero as live occupancy.
- [Skipping a malformed newest event can return a slightly stale earlier snapshot] → Define and test "last valid snapshot wins"; this is safer than discarding a known valid measurement or interpreting malformed data.
- [The two token fields have easily confused names] → Use `contextTokens` internally and update comments, tests, specs, and parity docs together; retain only a deprecated public `totalTokens` alias with the identical corrected value for compatibility.
- [Helper-only fixture updates could hide compatibility coverage] → Add an explicit legacy/drifted test whose token-count events intentionally omit `last_token_usage`.

## Migration Plan

1. Add the failing compaction and unsupported-stream regressions.
2. Change the rollout reader and propagate the semantic field rename through the Codex probe path.
3. Update helpers/fixtures and focused core, command, and CLI assertions.
4. Update the main spec and English/Chinese Codex parity documentation.
5. Run the focused test files, then lint and build. Revert the reader and documentation changes together if validation exposes an incompatible caller.

No user data migration or configuration change is required.

## Open Questions

None. The runtime field semantics and compatibility policy are sufficiently established by the captured rollout and Codex's own context-management behavior.
