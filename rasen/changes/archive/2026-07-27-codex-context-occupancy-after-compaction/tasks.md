## 1. Regression Fixtures and Reader Coverage

- [x] 1.1 Update Codex occupancy test helpers and the captured rollout fixture to emit both lifetime-cumulative `total_token_usage` and current-context `last_token_usage` without changing token-audit fixtures.
- [x] 1.2 Add a `readRolloutOccupancy` regression with multiple token-count events and a `context_compacted` boundary, proving the last valid current-context value and paired window win while cumulative spend continues upward.
- [x] 1.3 Add reader coverage proving malformed JSONL and unusable token-count records preserve the last valid snapshot, a token-count stream with no valid current snapshot fails actionably, and a rollout with no token-count events still returns the zero-turn signal.

## 2. Correct Codex Occupancy Semantics

- [x] 2.1 Change `RolloutOccupancy` and `readRolloutOccupancy` to expose `contextTokens` from `last_token_usage.total_tokens`, retain its paired inline context window, and never use `total_token_usage` as an occupancy fallback.
- [x] 2.2 Track whether a rollout contains any token-count event so `readRolloutOccupancy` returns `null` only for a true zero-turn rollout and throws an actionable format/compatibility error when no current-context snapshot is usable.
- [x] 2.3 Propagate the corrected `contextTokens` field through `computeContextFromRollout` while preserving explicit limit recomputation, model detection, zero-turn results, threshold inputs, and `tryContextEstimate`'s best-effort `undefined` behavior.

## 3. Probe Integration Coverage

- [x] 3.1 Update `test/core/agent-context.test.ts` to cover post-compaction current occupancy, explicit limit overrides, last-valid selection, unsupported legacy/drifted token-count streams, zero-turn behavior, and the unchanged Claude branch.
- [x] 3.2 Update `test/core/commands/agent-command.context.test.ts` to verify command JSON and threshold calculations use current Codex context and surface the actionable unsupported-stream error.
- [x] 3.3 Update `test/cli-e2e/agent-context.test.ts` to verify `--latest --runtime codex` reports the current snapshot after cumulative/current divergence and exits non-zero without fabricating occupancy for a matching legacy/drifted rollout.

## 4. Contract and Documentation

- [x] 4.1 Update `rasen/specs/cli-agent-context/spec.md` with the current-context field semantics, compaction scenario, last-valid rule, and explicit distinction between zero-turn and unsupported token-count streams.
- [x] 4.2 Correct `docs/codex-parity/solutions/05-transcript-occupancy-probe.md` and `docs/codex-parity/experiments/E03-rollout-transcript-anatomy.md` so occupancy uses `last_token_usage.total_tokens`, while retaining `total_token_usage` as lifetime spend.
- [x] 4.3 Apply the same semantic correction to `docs/zh/codex-parity-solutions.md` and check that no remaining Codex occupancy recipe prescribes cumulative usage.

## 5. Verification

- [x] 5.1 Run `pnpm vitest run test/core/codex/rollout.test.ts test/core/agent-context.test.ts test/core/commands/agent-command.context.test.ts test/cli-e2e/agent-context.test.ts`.
- [x] 5.2 Run `pnpm lint` and `pnpm build`; broaden the test run only if the implementation diff reaches beyond the isolated Codex occupancy/probe path.
