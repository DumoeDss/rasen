## Context

`src/core/agent-context.ts` is a pure-core probe: `probeAgentContext` resolves a transcript path (`--transcript` or `--latest`), scans for the last `message.usage` entry, resolves a limit via `resolveModelLimit` (built-in prefix map, 200k conservative default, `--limit` override), and returns `AgentContextResult {model, contextTokens, limit, pct, transcript}`. `src/commands/agent.ts` is a thin printer. `tryContextEstimate` is the never-throw variant `pipeline resume` uses against recorded worker transcripts.

The shipped `codex-exec-runtime` module (a658620) provides `readRolloutOccupancy(path)` → `{totalTokens, modelContextWindow, pct} | null` (last `token_count` event; `null` = zero completed turns = 0%, NOT an error) and records Codex workers in run-state with the rollout path in the `transcript` field. This change connects the two: the probe must recognize a rollout path and produce the same result shape.

Deliberately designed ONLY against exec-core's shipped surface. The concurrent `codex-runtime-lifecycle` apply adds an archived-sessions fallback to `findRolloutPath` and warm-seed distillation — neither is needed here (this probe takes explicit paths and reads occupancy only). Zero dependency on lifecycle-not-yet-implemented pieces.

## Goals / Non-Goals

**Goals:**

- `rasen agent context --transcript <rollout>.jsonl` (and `--json`) works on Codex rollouts, same output shape, same threshold semantics for all existing consumers.
- Cheap, deterministic-first kind detection with an explicit override flag.
- `tryContextEstimate` routes identically, so `pipeline resume` probes recorded Codex workers without modification.
- Zero-completed-turns rollouts report 0% occupancy as a success, not an error.

**Non-Goals:**

- No `--latest` support for Codex (it is defined over the Claude projects directory; the LEAD always holds explicit rollout paths via run-state `transcript` or `findRolloutPath`).
- No thread-id → rollout resolution in the CLI (callers resolve paths; adding a `--thread-id` flag would drag CODEX_HOME semantics into a command that is deliberately path-based — revisit only if the playbook sibling finds path-passing awkward).
- No occupancy push/streaming (app-server territory, out of the portfolio).
- No changes to thresholds or their consumers.

## Decisions

### D1: Detection order — filename convention, then first-line sniff, then explicit override wins over both

`detectTranscriptKind(path, runtimeOverride)` → `'codex' | 'claude'`:

1. **Explicit `--runtime` flag** (new, values `claude` | `codex`) short-circuits detection entirely. Detection is a heuristic; the override is the deterministic escape hatch, mirroring how `--limit` already overrides limit resolution. Invalid values are rejected with an actionable error.
2. **Filename convention** (zero extra I/O): basename matching `rollout-*.jsonl` → codex. This is codex-cli's own deterministic naming — the same convention exec-core's `findRolloutPath` builds paths from — so every rollout in situ (which is how run-state records them) is caught without reading a byte.
3. **First-line sniff** (for copied/renamed files): parse the first non-empty line; a JSON object whose `type` is `session_meta` — the live-verified first row of every rollout — or that carries the rollout `payload` envelope with no Claude-style `message` field → codex; anything else → claude (the safe default: the claude branch's error messages already handle non-transcripts actionably).

Rationale for this order: the filename test is free and covers the actual operating mode (probing files where codex wrote them); the sniff costs one line-read and only runs when the name is inconclusive; defaulting the final ambiguity to claude preserves today's behavior for every existing caller. The sniff's exact accepted shape is confirmed against a real rollout head during implementation (live access exists on this machine) and captured as a fixture.

### D2: Codex branch produces the same `AgentContextResult`, mapped as

- `contextTokens` = `totalTokens` from the last `token_count` event (Codex's total already includes cached input — no summing across usage fields as in the Claude branch).
- `limit` = explicit `--limit` when provided, else the inline `model_context_window`. The inline value is exact (provider-sent), so `resolveModelLimit`'s prefix map and 200k default are never consulted on this branch — the map stays a Claude-transcript concept.
- `pct` = `contextTokens / limit`, recomputed when `--limit` overrides (same rounding helper as the Claude branch).
- `model` = best-effort from the rollout's `turn_context` records (last one wins, correction below), falling back to `'unknown'` — model id is informational in the result; every threshold consumer keys on `pct`.
- `transcript` = the probed path, unchanged semantics.

> **Correction (post-implementation, live-verified):** `session_meta`'s payload never carries a `model` field — checked against all 24 real rollouts under `~/.codex/sessions` on this machine (both at implementation time and again independently by review). The model id lives in each `turn_context` row's `payload.model` instead. The implementation reads the LAST `turn_context.payload.model` in the file (mirroring the "last wins" convention `readRolloutOccupancy` already uses for `token_count`), falling back to `'unknown'` when no `turn_context` row is present. This document originally assumed `session_meta` per the dossier; the assumption was wrong and is corrected here rather than left only in the code comment.

### D3: Zero-turn rollout is success with zero occupancy — asymmetric with the Claude branch, on purpose

`readRolloutOccupancy` returning `null` maps to `{contextTokens: 0, pct: 0, limit: --limit ?? 0, model: last turn_context model ?? 'unknown'}` and exit 0 (see the D2 correction above for where the model id actually comes from). The exec-core contract says null means "zero completed turns", a normal state of a just-started or killed-before-first-turn worker — exactly the moment resume tooling probes it. The Claude branch keeps its existing behavior (usage-free transcript = error): a Claude transcript with no usage entry is malformed input, whereas a token_count-free rollout is a well-formed young rollout. The asymmetry is stated in the spec so it never gets "fixed" into symmetry. `limit: 0` in this case is honest (no window was reported); documented on the result rather than inventing the Claude default, and `pct` — the only field thresholds consume — is well-defined at 0.

### D4: Routing lives in core, commands stay thin

`probeAgentContext` gains `runtime?: 'claude' | 'codex'` in `ProbeOptions` and branches after path resolution: codex → new `computeContextFromRollout(path, {limit})` (wraps `readRolloutOccupancy` + a `turn_context` model read, see D2 correction); claude → existing `computeContextFromTranscript` untouched. `tryContextEstimate` gets the same detection (its never-throw contract now also covers "unreadable rollout" → undefined). `src/commands/agent.ts` only threads the new option; output formatting is unchanged because the shape is unchanged. Import direction `agent-context.ts` → `./codex/index.js` is core-internal and cycle-free (the codex module imports nothing from agent-context).

Alternative considered: a separate `computeContextFromRollout` public API with callers choosing — rejected; the value of the probe is that ALL existing consumers (CLI, pipeline resume, playbook prompts invoking the command) get Codex support without choosing anything.

## Risks / Trade-offs

- [First-line sniff shape (`session_meta`) is a live observation, not documented API] → implementer captures a real rollout head as the fixture and adjusts the sniff to reality; the filename test (the primary path) is convention exec-core already depends on; `--runtime` overrides any misdetection.
- [A Claude transcript named `rollout-*.jsonl` would misroute] → contrived (Claude Code names transcripts by UUID/agent id); `--runtime claude` recovers; sniff is not consulted when the filename matches, trading a contrived false positive for zero I/O on the common path.
- [`limit: 0` on zero-turn rollouts could surprise a consumer that divides by limit] → audited: known consumers use `pct` (already 0); the spec scenario pins the exact zero-turn output so any new consumer sees the contract.
- [Model id may be absent/differently named in `turn_context`] → best-effort with `'unknown'` fallback (same fallback the Claude branch uses for a usage entry without model); nothing downstream keys on it. (Originally written against an assumed `session_meta` source; corrected per D2 above once implementation showed `session_meta` never carries `model`.)
- [Concurrent lifecycle apply touches `rollout.ts`] → this change reads only `readRolloutOccupancy`'s shipped signature, which lifecycle's extensions leave untouched (its `RolloutConversation` widening is a different function); no coordination needed beyond normal rebase.

## Migration Plan

Additive CLI/core change; no data migration. Existing invocations behave identically (detection only activates on rollout-named/shaped files, which previously produced "No assistant usage found" errors — strictly an improvement). Rollback is reverting the commit.

## Open Questions

- Whether the playbook sibling wants a `--thread-id` convenience (resolve via `findRolloutPath` inside the CLI) — deferred until a real call site demonstrates path-passing is awkward.
