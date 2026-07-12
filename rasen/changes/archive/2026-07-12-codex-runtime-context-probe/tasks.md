# Tasks — codex-runtime-context-probe

Version premise: codex-cli 0.144.1 (`CODEX_CLI_VERSION_PREMISE`). Never bump the package version. Design only against exec-core as shipped at a658620 — no imports of anything the concurrent lifecycle apply is adding.

## 1. Core: detection and Codex branch

- [x] 1.1 Live-capture a real rollout head on this machine (first row + a token_count row) into a fixture under `test/fixtures/` (follow existing fixture layout); confirm the first row's `type` (`session_meta` expected) and where the model id lives — adjust D1's sniff and D2's model extraction to the captured reality
- [x] 1.2 Implement `detectTranscriptKind(path)` in `src/core/agent-context.ts`: explicit runtime option short-circuits; basename `rollout-*.jsonl` → codex (zero extra I/O); first non-empty-line sniff for renamed copies (per fixture from 1.1); default claude
- [x] 1.3 Implement `computeContextFromRollout(path, { limit? })`: wrap `readRolloutOccupancy` from `../core/codex` — `contextTokens` = totalTokens, `limit` = override ?? inline window, `pct` recomputed on override (reuse the existing rounding helper); best-effort model from session metadata with `'unknown'` fallback; `null` occupancy → `{contextTokens: 0, pct: 0, limit: override ?? 0}` as SUCCESS
- [x] 1.4 Route `probeAgentContext` through detection (add `runtime?: 'claude' | 'codex'` to `ProbeOptions`; validate the value); Claude branch behavior byte-identical
- [x] 1.5 Route `tryContextEstimate` through the same detection (never-throw contract preserved: unreadable rollout → undefined)
- [x] 1.6 Tests in `test/core/agent-context.test.ts`: detection precedence (override > filename > sniff > claude default), codex occupancy mapping incl. `--limit` override recompute, zero-turn success shape, unreadable-rollout error (probe) and undefined (estimate), existing Claude cases untouched (no snapshot churn)

## 2. Command and CLI surface

- [x] 2.1 Add `runtime` to `AgentContextOptions` in `src/commands/agent.ts` and thread it to `probeAgentContext` (output formatting unchanged — same result shape)
- [x] 2.2 Register `--runtime <runtime>` on the `agent context` command in `src/cli/index.ts` (near the existing `--transcript`/`--limit` options at ~line 715); update the `--transcript` help text to say "transcript or Codex rollout jsonl"; invalid value → actionable error, non-zero exit; do NOT add `--store`/`--project`
- [x] 2.3 Command-layer tests (follow `test/core/commands/` conventions): `--json` output for a codex rollout fixture; zero-turn rollout exits 0; `--runtime bogus` errors actionably

## 3. Validation and wrap-up

- [x] 3.1 Run `pnpm test` (full suite) and `rasen validate codex-runtime-context-probe` — both clean; if lifecycle's apply has landed meanwhile, rebase and confirm no interference (it must not change `readRolloutOccupancy`'s signature)
- [x] 3.2 Sweep: new doc comments cite `CODEX_CLI_VERSION_PREMISE` for rollout-shape assumptions; the zero-turn asymmetry (rollout young vs Claude malformed) is documented at the branch point; no version bump
