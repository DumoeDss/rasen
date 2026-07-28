## Why

Diagnosing a session's token spend today means manually running `node scripts/token-audit/audit.mjs` from a repo checkout and dragging the JSON onto a local `viewer.html` — a debug-only path invisible to anyone who didn't write the tool. Users who want to understand their own Claude Code session cost (which agents burned tokens, how much was churn from cache misses, where the bill actually came from) have no self-service way to ask. Phase 1 productizes the existing analyzer into a first-class, pull-model CLI command: the user runs it, the result lands on their own machine, nothing is uploaded anywhere.

## What Changes

- New `rasen agent audit <sessionId|path>` command in the existing `rasen agent` namespace (alongside `agent context` and `agent wait`): parses a Claude Code session's main transcript plus its subagent transcripts, dedupes usage by `message.id`, applies the two-tier cache-write TTL pricing (1h/2x main, 5m/1.25x subagent), and classifies cache-churn events by cause (ttl-expiry, rebase, context-drop, unattributed).
- **Codex rollout support**, mirroring `agent context`'s existing `--runtime codex` flag: the command also analyzes Codex CLI session rollouts (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`), deriving per-turn token deltas from the rollout's monotonic cumulative usage counters, discovering subagent rollouts via their `parent_thread_id` chain (Codex has no `subagents/` subdirectory the way Claude does), and reporting Codex's own token/cache accounting — which has no TTL-tiered cache-write pricing or churn-cause taxonomy the way Claude's does, so the report shape differs by runtime (see design.md).
- Output is a single `session-audit-<id>.json` written under `~/.rasen/analytics/` by default — a user-owned, deletable directory. No network calls, no telemetry payload changes.
- The command and its docs carry an explicit **experimental** marker: it parses Claude Code's undocumented internal transcript format, and a harness upgrade can make parsing fail without warning.
- **Fail-soft is a hard requirement**: any transcript-format drift (missing fields, unexpected shape) SHALL produce a friendly, actionable error — never an unhandled exception or stack trace — pinned by a fixture regression test so drift is caught in CI before a user hits it.
- `viewer.html` (existing self-contained, dependency-free HTML viewer) ships as a package asset; a new `--open` flag opens it in the user's default browser, pre-loaded with the generated JSON.
- New `/rasen-audit` guidance skill: helps the user find their session id, runs the command, opens the viewer, and helps interpret the results — the skills-only delivery surface for this capability.
- `scripts/token-audit/audit.mjs` (the internal debug script this migrates from) is superseded — its disposition (thin delegating wrapper vs. removal with a README pointer to the new command) is decided in design.md; `forensics/` and `README.md` stay in place regardless.

Explicitly **out of scope** for this change (Phase 1.5/2, tracked separately): any hook-based automatic collection (Stop/SessionEnd hooks, `--install-hook`), any upload or telemetry wiring, and rich local JSONL event logging.

## Capabilities

### New Capabilities
- `cli-agent-audit`: the `rasen agent audit` command — local, pull-model session cost/churn audit with an experimental-format marker, fail-soft error handling, and viewer integration.
- `workflow-audit-command`: the `/rasen-audit` guidance skill that routes a user through finding a session, running the audit, and reading the result.

### Modified Capabilities
(none — this change only adds new capabilities; no existing spec's requirements change)

## Impact

- **New code**: an audit module under `src/core/` (parsing/dedup/TTL/churn logic migrated from `scripts/token-audit/audit.mjs`, plus a Codex rollout counterpart reusing `src/core/codex/rollout.ts`'s existing readers), a CLI command registration in `src/cli/index.ts` under the existing `agent` command group, and a new skill template under `src/core/templates/workflows/` registered in `src/core/workflow-registry/builtins.ts`.
- **Package surface**: `package.json` `files` gains an entry to ship `viewer.html` as a distributed asset (no such static-asset shipping precedent exists yet — resolved in design.md).
- **Existing tooling**: `scripts/token-audit/` (its disposition resolved in design.md); a small export added to `src/core/codex/rollout.ts` (session-meta reader, currently private to `agent-context.ts`) so Claude-context-probing and audit share one implementation instead of two; no changes to `src/telemetry/` or any upload path.
- **Tests**: a new fixture-based regression test asserting fail-soft behavior on malformed/drifted transcript input, tests for the dedup/TTL/churn logic carried over from the script, and new synthetic-fixture tests for the Codex rollout path (delta derivation, subagent-family discovery).
- **No version bump**; this is a CLI/skill addition, not a release action. The audit report's own JSON schema version is an internal design decision (design.md), unrelated to the package version.
