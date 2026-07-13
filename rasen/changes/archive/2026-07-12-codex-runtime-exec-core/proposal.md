## Why

Rasen's orchestration (LEAD dispatching role-isolated workers with structured returns and durable run-state) currently only runs on the Claude Code runtime. The `codex-parity-research` dossier (docs/codex-parity/, version-pinned to codex-cli 0.144.1) live-verified how every orchestration primitive maps onto Codex, and the pipeline registry already declares `runtime: codex` as a valid stage runtime — but nothing implements it. This change builds the tier-1 minimal loop: the library primitives a LEAD needs to dispatch one Codex worker and get a structured result back.

## What Changes

- New self-contained library module `src/core/codex/` providing the Codex dispatch primitives:
  - **`codex exec` invocation builder** — assembles a correct-by-construction invocation: stdin always closed (`< /dev/null` in shell form), `--json` event stream, `-o <last-message-file>`, `-s <sandbox>`, `-m <model>` + `-c model_reasoning_effort`, with leaf-worker reasoning effort capped at `xhigh` (`ultra` auto-delegates and would break the flat-hierarchy invariant), an automatic flat-hierarchy guard clause appended to every prompt, and an optional config-driven `model_providers` override injection point (never hardcoded).
  - **Client-side template inlining** as a pluggable step — read a rasen-generated command `.md`, strip frontmatter, substitute arguments, and inline the body into the dispatch prompt. `$CODEX_HOME/prompts/*.md` is rejected on both Codex invocation surfaces (E06/E13), and the `codex exec` failure mode is a silent hallucination, so inlining is mandatory, not an optimization. Pluggable so a future native `skills/SKILL.md` mechanism (round-3 open question) can replace it.
  - **Structured-return contract schemas** — one leaf-worker DONE/HANDOFF schema and one evaluate-gate `{satisfied, gaps}` schema, wired via `--output-schema`, plus typed parsers for the `-o` last-message file.
  - **Thread identity and rollout utilities** — capture `thread_id` from the `--json` event stream (`thread.started`), locate a thread's rollout JSONL (deterministic `~/.codex/sessions/<Y>/<M>/<D>/` path with glob fallback), parse rollout events (last `token_count` occupancy with inline `model_context_window`, `task_started`/`task_complete` turn ids, user/assistant conversation reconstruction), and build the `runtime: "codex"` run-state worker identity record shape already accepted by `RunStateWorkerSchema`.
- No CLI surface, no pipeline-runtime wiring, no playbook changes in this change — sibling changes consume these exports (`codex-runtime-lifecycle` uses the rollout utilities and event parsing; `codex-runtime-context-probe` uses the occupancy reader; `codex-runtime-playbook-integration` wires everything into the orchestration templates).

## Capabilities

### New Capabilities
- `codex-exec-runtime`: the Codex dispatch primitives — invocation building with safety invariants (stdin, effort cap, flat-hierarchy guard), client-side template inlining, structured DONE/HANDOFF and evaluate-gate return contracts, and thread-identity/rollout parsing that yields run-state-compatible worker records.

### Modified Capabilities

(none — this is a new library slice; existing specs such as `cli-agent-context` and pipeline run-state behavior are unchanged. Sibling changes modify those.)

## Impact

- New code: `src/core/codex/` (invocation builder, template inliner, contract schemas + parsers, rollout/event utilities) exported for sibling changes to consume.
- Existing code read but not modified: `src/core/pipeline-registry/types.ts` (`AgentRuntimeSchema`, sandbox/model/effort fields) and `run-state.ts` (`RunStateWorkerSchema`) already define the target shapes this module produces; `src/core/command-generation/` defines the `.md` command-file format the inliner consumes.
- Dependencies: none added; uses `zod` (already a dependency) for contract parsing and `node:fs`/`node:path` for rollout access.
- Behavior assumptions are version-pinned to codex-cli 0.144.1 per the dossier; code comments and docs must state that version premise where behavior could drift.
- Tests: vitest unit tests under `test/core/codex/` for the builder, inliner, contract parsers, and rollout parsing (fixture-driven; no live Codex invocation in CI).
