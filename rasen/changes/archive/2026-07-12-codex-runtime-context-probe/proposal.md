## Why

rasen's context-occupancy probe (`rasen agent context`) drives the handoff (0.5), reuse (0.25), and research-relay (0.35) threshold decisions, but it only reads Claude Code transcripts. Codex workers dispatched via the shipped `codex-exec-runtime` primitives persist rollout JSONL files instead — and those are strictly easier to probe: the last `token_count` event carries both total tokens and the model context window inline (live-verified, dossier solution 05), so no model-to-window map is needed. Without this change, the LEAD cannot apply its existing threshold system to Codex workers, which blocks warm-reuse and handoff decisions for the whole Codex runtime.

## What Changes

- `rasen agent context` accepts a Codex rollout JSONL wherever it accepts a transcript today: the probe detects the transcript kind (Codex rollout vs Claude transcript) and reads occupancy accordingly, returning the SAME output shape (`{model, contextTokens, limit, pct, transcript}`) so every existing threshold consumer works unchanged.
- Detection is cheap and deterministic-first: a basename matching Codex's own `rollout-*.jsonl` naming convention (the convention exec-core's locator already relies on) selects the Codex reader with zero extra I/O; a copied/renamed file falls back to a first-line sniff; and a new explicit `--runtime <claude|codex>` flag overrides detection entirely (mirroring how `--limit` already overrides limit resolution).
- Codex occupancy comes from `src/core/codex`'s shipped `readRolloutOccupancy` (last `token_count` event): `contextTokens` = total tokens, `limit` = the inline `model_context_window` (an exact value, not a map lookup), `pct` = their ratio. An explicit `--limit` still wins, with `pct` recomputed against it.
- A rollout with no `token_count` event yet (zero completed turns) reports zero occupancy (`contextTokens 0`, `pct 0`) — per the exec-core contract this is a normal signal, NOT an error, unlike a usage-free Claude transcript which stays an error.
- The best-effort estimate path (`tryContextEstimate`, used by `pipeline resume` to probe recorded workers without failing) routes through the same detection, so run-state records whose `transcript` field points at a rollout (how exec-core records Codex workers) probe correctly.
- `--latest` remains Claude-only (it resolves the Claude projects directory); Codex rollouts are probed by explicit path, which is how the LEAD holds them (run-state `transcript` field or `findRolloutPath`).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities
- `cli-agent-context`: the probe command gains Codex rollout support (detection, inline-window occupancy, zero-turn-is-zero semantics, `--runtime` override), and the context-limit resolution requirement is extended to cover the Codex inline window alongside the Claude model map.

## Impact

- Modified code: `src/core/agent-context.ts` (transcript-kind detection + Codex branch in `probeAgentContext` and `tryContextEstimate`; imports from `src/core/codex`), `src/commands/agent.ts` (+`runtime` option), and the CLI registration for `agent context` (new `--runtime` flag). `rasen agent context` takes no `--store`/`--project` flags — unchanged.
- Consumed (not modified): `src/core/codex/rollout.ts` `readRolloutOccupancy` as shipped at a658620. No dependency on any `codex-runtime-lifecycle` piece — that sibling's apply runs concurrently and nothing here waits on it (the archived-sessions locator fallback it adds is irrelevant: this probe takes explicit paths).
- Existing threshold consumers (orchestration playbook prompts, reuse/handoff logic) need no changes — same output shape and field meanings.
- Tests: vitest in `test/core/agent-context.test.ts` (+ fixtures) and command-layer coverage following existing conventions. No new dependencies. Behavior version-pinned to codex-cli 0.144.1 via the existing `CODEX_CLI_VERSION_PREMISE`. Never bump the package version.
