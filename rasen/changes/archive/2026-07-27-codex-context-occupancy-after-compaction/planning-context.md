# Planning Context

## User intent

> 看有没有可以复用的干净的worktree，没有就新建。从origin/dev/0.1.5创建开发分支进行修复开发，完成后提pr

Fix the confirmed Codex context-occupancy probe bug end to end and open a pull request.

## Workspace and delivery constraints

- Reused clean worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-archive-host-aware-runtime-dispatch`
- Base: current `origin/dev/0.1.5` at `e5c4189022415d1b6062c0e97957d61bb1832d5a`
- Branch: `fix/codex-context-occupancy-after-compaction`
- Delivery: commit, push, and open a PR against `dev/0.1.5`.
- Keep the dirty original worktree untouched.
- This is one coherent bug fix; no decomposition is needed.

## Confirmed root cause and evidence

- `src/core/codex/rollout.ts::readRolloutOccupancy` reads the last
  `token_count.info.total_token_usage.total_tokens`.
- Codex defines `total_token_usage` as lifetime cumulative spend by appending each
  request's `last_token_usage`; it is not current prompt/context occupancy.
- Codex's own context management uses `last_token_usage.total_tokens` for current
  context consumption.
- In a real rollout after `context_compacted`, the existing probe reported
  `164620250 / 258400` (`pct=637.075271`), while the same event's
  `last_token_usage.total_tokens` was `40556` (about 15.7%).
- Existing fixtures omit `last_token_usage`, so tests currently preserve the
  incorrect contract.

## Expected solution qualities

- Add regression coverage for multiple token-count events where cumulative and
  current usage differ, including a compaction boundary.
- Report current context from the last valid `last_token_usage.total_tokens`.
- Define an honest compatibility policy for older/drifted events that lack
  `last_token_usage`; do not silently turn lifetime spend into occupancy.
- Update the main spec and relevant Codex-parity documentation so the public
  contract no longer says cumulative usage is occupancy.
- Preserve zero-turn behavior, explicit limit overrides, malformed-line
  tolerance, model detection, and Claude transcript behavior.
- Run focused tests for Codex rollout parsing, agent-context core, command, and
  CLI paths; broaden only if the diff creates cross-cutting risk.

## Durable planning findings

- `cli-agent-context` is the only existing capability whose product contract changes; `codex-lifecycle` and token-audit semantics remain out of scope.
- `readRolloutOccupancy` currently conflates zero-turn rollouts with token-count streams whose records are unusable, so implementation must track whether any `token_count` event was observed before returning `null`.
- The authoritative cumulative-occupancy recipe appears in the English solution, E03 experiment, and consolidated Chinese parity guide; all three must be corrected together.
