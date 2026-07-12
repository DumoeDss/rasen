# Tasks — codex-runtime-exec-core

Version premise: all behavior below is pinned to codex-cli 0.144.1 (design D11); never bump the package version.

## 1. Module scaffold and shared helpers

- [x] 1.1 Create `src/core/codex/codex-home.ts` exporting `resolveCodexHome()` (CODEX_HOME env override, default `~/.codex`, `path.resolve`/`path.join` only) and `CODEX_CLI_VERSION_PREMISE = '0.144.1'`
- [x] 1.2 Refactor `src/core/command-generation/adapters/codex.ts` to import `resolveCodexHome()` from the new module, deleting its private copy (behavior unchanged; existing adapter tests still pass)
- [x] 1.3 Create `src/core/codex/index.ts` re-exporting the public surface as each file lands; export the module from `src/core/index.ts` following the existing barrel convention (check how other core modules are exposed first)

## 2. Invocation builder

- [x] 2.1 Implement `invocation.ts`: `CodexExecInvocation` type (`command`, `args`, `stdin: 'ignore'`, `prompt`, `warnings`), `buildCodexExecInvocation(options)` emitting `exec`, `--json`, `-o <path>`, `-s <sandbox>`, `-m <model>`, `-c model_reasoning_effort="<effort>"` (TOML-quoted), and the prompt as the final positional argument
- [x] 2.2 Add the leaf effort clamp: `ultra` → `xhigh` with a warning pushed to `invocation.warnings`; `low|medium|high|xhigh|max` pass through
- [x] 2.3 Add `CODEX_FLAT_HIERARCHY_GUARD` named constant (no-delegation clause naming spawn_agent/followup_task/send_message/wait_agent) and append it as the final paragraph of every built prompt
- [x] 2.4 Add `ModelProviderOverride` support: when present emit `-c model_providers.<name>.name/base_url/wire_api/env_key` and `-c model_provider="<name>"`; when absent emit no provider flags (assert no hardcoded default anywhere)
- [x] 2.5 Implement `formatShellInvocation(invocation, { shell })`: POSIX single-quote escaping (`'\''`) ending in `< /dev/null`; Windows cmd variant ending in `< NUL` with its quoting limits documented in the doc comment
- [x] 2.6 Tests `test/core/codex/invocation.test.ts`: full-flag assembly, effort clamp + warning, guard always present, provider override present/absent, shell quoting torture cases (single quotes, newlines, `$`, backticks in prompt), Windows redirect variant

## 3. Template inlining

- [x] 3.1 Implement `template-inline.ts`: `TemplateInliner` interface and `inlineCommandTemplate(source, args)` — strip leading `--- … ---` YAML frontmatter, substitute all `$ARGUMENTS` occurrences, append trailing `ARGUMENTS: <args>` line when body has no placeholder and args are non-empty
- [x] 3.2 Wire `template?: { source, args, inliner? }` into `buildCodexExecInvocation` so the inlined body is prepended to the task prompt (before the flat guard), defaulting to `inlineCommandTemplate`
- [x] 3.3 Tests `test/core/codex/template-inline.test.ts`: frontmatter stripped, no-frontmatter source passes through, `$ARGUMENTS` substitution (multiple occurrences), no-placeholder append behavior, empty args, custom inliner injected through the builder

## 4. Structured-return contracts

- [x] 4.1 Implement `contracts.ts`: `LEAF_RETURN_SCHEMA` and `EVALUATE_GATE_SCHEMA` JSON Schema literals (required status fields, `enum: ["DONE","HANDOFF"]`, `additionalProperties: false`, optional `summary` escape hatch; leaf also has optional `handoffReason`)
- [x] 4.2 Implement paired zod parsers `parseLeafReturn(text)` / `parseEvaluateGate(text)` throwing actionable errors on empty/non-JSON/non-conforming input
- [x] 4.3 Tests `test/core/codex/contracts.test.ts`: conforming fixtures parse; malformed/extra-property/missing-required inputs fail with named expectations; a parity check that the zod parser and the JSON Schema literal agree on shared accept/reject fixtures; and the dossier's captured `{"gaps":["missing tests","no docs"],"status":"HANDOFF"}` (E10's ad-hoc test schema, not either finalized contract) is asserted as a REJECTION fixture against `parseEvaluateGate`, with the reasoning documented in the test

## 5. Exec event stream and rollout utilities

- [x] 5.1 Implement `exec-events.ts`: `parseExecEventStream(text)` (typed `thread.started`/`turn.started`/`turn.completed`/`turn.failed`/`item.*` + unknown passthrough, malformed lines skipped) and `extractThreadId(...)` returning the `thread.started` `thread_id` or undefined
- [x] 5.2 Implement `rollout.ts` locator: `findRolloutPath(threadId, { codexHome?, timestamp? })` — deterministic `sessions/<YYYY>/<MM>/<DD>/rollout-<ts>-<threadId>.jsonl` when timestamped, bounded newest-first tree scan fallback, undefined when absent; all paths via `path.join`
- [x] 5.3 Implement `readRolloutOccupancy(path)`: last `token_count` event → `{ totalTokens, modelContextWindow, pct }`; `null` when no `token_count` line (documented zero-occupancy signal, not an error)
- [x] 5.4 Implement `readRolloutConversation(path)`: ordered user/assistant `response_item` turns (developer scaffolding skipped), `task_complete`/`agent_message` final answers, and `turn_id`s from `task_started`/`task_complete` payloads
- [x] 5.5 Tests `test/core/codex/exec-events.test.ts` + `rollout.test.ts` with fixtures mirroring the dossier captures (E01 thread.started, E02 kill-mid-turn tail with unmatched turn.started, E03 token_count with `model_context_window: 353400`): thread-id capture/absence, malformed-line tolerance, deterministic + scan + missing locator paths (temp-dir fixture trees), occupancy math, null-occupancy case, conversation reconstruction

## 6. Run-state identity

- [x] 6.1 Implement `identity.ts`: `buildCodexWorkerRecord({ threadId, model, sandbox, effort, rolloutPath?, role? })` → `runtime: 'codex'` record with rollout path in `transcript`, `updatedAt` ISO timestamp, `turnId` never set
- [x] 6.2 Tests `test/core/codex/identity.test.ts`: record validates against `RunStateWorkerSchema` (import the real schema), `transcript` carries the rollout path, `turnId` absent, and `stageWorkers()` picks the record up as warm-seedable

## 7. Validation and wrap-up

- [x] 7.1 Run `pnpm test` (full suite) and `rasen validate codex-runtime-exec-core` (or the store-scoped equivalent) — both clean
- [x] 7.2 Sweep doc comments: every 0.144.1-contingent behavior cites `CODEX_CLI_VERSION_PREMISE`; confirm no file hardcodes a provider base URL or bumps the package version
