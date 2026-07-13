## Context

The `codex-parity-research` dossier (docs/codex-parity/, English originals + docs/zh/codex-parity-solutions.md) live-verified, against codex-cli 0.144.1, how each rasen orchestration primitive maps onto Codex. The pipeline registry already declares the target shapes: `AgentRuntimeSchema` includes `'codex'`, `AgentRuntimeSandboxSchema` is `['read-only', 'workspace-write']`, and `RunStateWorkerSchema` already carries `runtime`, `threadId`, `sandbox`, `model`, `effort`. What is missing is the library that produces correct Codex invocations and consumes Codex outputs. This change is the first of four siblings (see `rasen/changes/codex-runtime/planning-context.md`); it builds the dispatch primitives only.

Hard facts from the dossier that shape this design:

- `codex exec` blocks forever waiting for stdin EOF unless stdin is closed (E01) — every invocation must close stdin.
- `$CODEX_HOME/prompts/*.md` is rejected on BOTH invocation surfaces (E06 exec: silent hallucination; E13 TUI: `Unrecognized command`) — template bodies must be inlined client-side, and the exec-side failure is silent, so inlining is mandatory.
- Codex 0.144.1 ships a native hierarchical multi-agent system (`spawn_agent`/…) enabled by default, suppressible only at the prompt level; `ultra` reasoning effort is documented as auto-delegating (E11, E07 Step 3) — leaf dispatch must append a no-delegation guard and never pass `ultra`.
- `--output-schema` enforces strict-JSON final messages (E10) — strictly better than prose-marker parsing for DONE/HANDOFF and evaluate gates.
- `thread.started` in the `--json` event stream carries `thread_id`; exec-mode `turn.started`/`turn.completed` events are bare (no turn id); rollout JSONL `task_started`/`task_complete` payloads carry `turn_id`; the last `token_count` event carries `total_token_usage` AND `model_context_window` inline (E01/E02/E03).
- This dev machine needs a `model_providers` override (`-c model_providers.<name>.…` + `-c model_provider="<name>"`) because the built-in provider ignores `OPENAI_BASE_URL` — an environment quirk, so the builder gets an injection point but never a hardcoded default.

## Goals / Non-Goals

**Goals:**

- A pure-core module `src/core/codex/` (reads the filesystem, never spawns processes, prints, or exits — same discipline as `agent-context.ts`) exporting:
  1. the `codex exec` invocation builder with all safety invariants baked in;
  2. a pluggable client-side template inliner;
  3. DONE/HANDOFF and evaluate-gate contract schemas plus last-message parsers;
  4. exec event-stream parsing (thread id capture), rollout location/parsing (occupancy, turn ids, conversation reconstruction), and the run-state worker identity record builder.
- Exports shaped so the sibling changes consume them without rework (seams listed under Decisions D10).
- Fixture-driven vitest coverage; CI never invokes a real `codex` binary.

**Non-Goals:**

- No `codex exec resume` wrapper, death detection, retry classification, parallel-dispatch discipline (sibling `codex-runtime-lifecycle`).
- No `rasen agent context` integration (sibling `codex-runtime-context-probe`).
- No playbook/template rewrites or pipeline-runtime wiring (sibling `codex-runtime-playbook-integration`).
- No app-server JSON-RPC bridge (tier-3, explicitly out of the portfolio's minimal loop).
- No process execution: the module builds invocations and parses outputs; spawning stays with the caller (the LEAD playbook today, possibly a runner in a later change).

## Decisions

### D1: Module layout — `src/core/codex/` with one file per concern

```
src/core/codex/
  codex-home.ts       resolveCodexHome() — CODEX_HOME env override, default ~/.codex
  invocation.ts       buildCodexExecInvocation(), formatShellInvocation(), flat-guard constant
  template-inline.ts  TemplateInliner interface + inlineCommandTemplate() default impl
  contracts.ts        JSON Schema literals + zod parsers for leaf return / evaluate gate
  exec-events.ts      parseExecEventStream(), extractThreadId() — `codex exec --json` stdout
  rollout.ts          findRolloutPath(), readRolloutOccupancy(), readRolloutConversation(), turn ids
  identity.ts         buildCodexWorkerRecord() — run-state worker shape
  index.ts            public surface (re-exports)
```

Rationale: mirrors the existing `src/core/command-generation/` style (small files, one concern each, `index.ts` re-export). A single `codex.ts` mega-file was considered and rejected — siblings consume different slices (`lifecycle` needs rollout + events, `context-probe` needs only `readRolloutOccupancy`), and per-concern files keep those dependency lines visible.

`resolveCodexHome()` duplicates the 3-line logic currently private in `src/core/command-generation/adapters/codex.ts`; the adapter is refactored to import the new shared helper (one-line change) so there is exactly one CODEX_HOME resolution in the codebase.

### D2: Builder returns data, never spawns

`buildCodexExecInvocation(options)` returns:

```ts
interface CodexExecInvocation {
  command: 'codex';
  args: string[];              // exec, --json, -o …, -s …, -m …, -c …, <prompt>
  stdin: 'ignore';             // caller MUST close stdin (spawn stdio directive)
  prompt: string;              // final assembled prompt (inlined template + guard)
  warnings: string[];          // e.g. effort clamp notice
}
```

plus `formatShellInvocation(invocation, { shell?: 'posix' | 'windows' })` which renders a properly quoted shell command ending in `< /dev/null` (POSIX) or `< NUL` (Windows cmd). Rationale: the immediate consumer is the orchestration playbook (a prompt template that has the LEAD run a shell command), so the shell string is a first-class product; but the argv + `stdin: 'ignore'` form is the cross-platform programmatic path and keeps the module trivially unit-testable. Alternative considered: a `spawnCodexWorker()` that owns the child process — rejected for this slice; it drags process lifecycle (timeouts, kill, streaming) into scope, which is lifecycle-sibling territory, and pure-data output keeps tests hermetic.

### D3: Leaf effort cap is a clamp, not an error

Options accept `effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'`. The builder targets leaf-worker dispatch (the only dispatch mode in the minimal loop), so `ultra` — documented by the backend as "automatic task delegation", which violates the flat-hierarchy invariant — is clamped to `xhigh` and a warning is pushed to `invocation.warnings`. Rationale: a clamp keeps a mis-configured pipeline YAML running safely and visibly instead of failing the whole run; the warning keeps it from being silent. Alternative (throw) rejected: effort is advisory tuning, not correctness input, and the safe value is always known. `max` passes through un-clamped — it does not auto-delegate.

### D4: Flat-hierarchy guard is a named constant, always appended

`CODEX_FLAT_HIERARCHY_GUARD` (exported constant, per the repo rule "if we generate it, track it by name") is appended to every built prompt as a final paragraph:

> "You are a leaf worker. Do not use spawn_agent, followup_task, send_message, wait_agent, or any sub-agent delegation tool under any circumstances. Do all work yourself in this session."

Always appended, no opt-out flag in this slice. Rationale: every dispatch in the minimal loop is a leaf dispatch, and prompt-level suppression is the ONLY verified control (no `-c` hard-disable exists per E11/round-3 list). An opt-out can be added by the sibling that first needs a non-leaf dispatch; shipping one now would be an untestable escape hatch.

### D5: Provider override is a typed injection point, config-driven

```ts
interface ModelProviderOverride {
  name: string;       // -c model_providers.<name>.name="<name>", -c model_provider="<name>"
  baseUrl: string;    // -c model_providers.<name>.base_url="…"
  wireApi?: string;   // -c model_providers.<name>.wire_api="…"
  envKey?: string;    // -c model_providers.<name>.env_key="…"
}
```

When `options.providerOverride` is present the builder emits the corresponding `-c` flags (TOML string values, double-quoted with escaping); when absent it emits nothing and Codex uses its own config. No default, no environment sniffing, nothing persisted — where the override VALUES come from (project config, pipeline YAML) is a consumer decision deferred to the integration sibling. Rationale: the dossier is explicit that the proxy override is a machine quirk, not a design surface; hardcoding it would break every normally-authed install.

### D6: Template inlining is an interface with one default implementation

```ts
interface TemplateInliner {
  inline(templateSource: string, args: string): string;
}
```

Default `inlineCommandTemplate`: strip a leading YAML frontmatter block (`--- … ---`) if present, substitute every `$ARGUMENTS` occurrence with the args string, and — when the body contains no `$ARGUMENTS` placeholder and args are non-empty — append the args under a trailing `ARGUMENTS: <args>` line (matching how Claude Code hands slash-command args to a skill body). The builder takes `template?: { source: string; args: string; inliner?: TemplateInliner }` and prepends the inlined body to the task prompt. Reading the `.md` file is the caller's job (or a thin `readFileSync` at the call site) — the inliner is pure string → string, which keeps it trivially testable and swappable.

Rationale for the interface: round-3 open question #1 (a possible native `skills/SKILL.md` mechanism) may later replace client-side inlining; a one-method interface is the cheapest possible plug point. Rationale for `$ARGUMENTS`: it is the convention rasen's own command bodies already use, so the same generated `.md` files work on both runtimes.

### D7: Contracts are hand-written JSON Schema literals with paired zod parsers

`contracts.ts` exports two named JSON Schema objects (for `--output-schema`, serialized to a temp file by the caller) and two zod-backed parsers (for the `-o` last-message file):

```ts
LEAF_RETURN_SCHEMA      // {status: "DONE"|"HANDOFF", summary?, handoffReason?}, additionalProperties:false
EVALUATE_GATE_SCHEMA    // {satisfied: boolean, gaps: string[], summary?},        additionalProperties:false
parseLeafReturn(text): LeafReturn          // throws actionable error on malformed/non-conforming JSON
parseEvaluateGate(text): EvaluateGateResult
```

Both schemas keep the optional free-text `summary` escape hatch the dossier recommends (a model whose true state is ambiguous needs somewhere to put nuance without violating `additionalProperties: false`). The JSON Schema literal and the zod schema are maintained side by side in the same file with a test asserting they accept/reject the same fixtures — generating one from the other (e.g. `zod-to-json-schema`) was considered and rejected: it adds a dependency for two tiny schemas and produces noisier schema output than the hand-written form Codex was actually tested against (E10).

### D8: Event-stream and rollout parsing are tolerant, line-oriented readers

- `parseExecEventStream(text)`: parses `codex exec --json` stdout JSONL into typed events (`thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.*`, unknown passthrough), skipping malformed lines (same tolerance as `computeContextFromTranscript`). `extractThreadId(events | text)` returns the `thread.started` `thread_id` or undefined. Exposing `turn.failed` with its raw message string is deliberate — the lifecycle sibling builds its 429/404 retry classification on top without this module deciding retryability.
- `findRolloutPath(threadId, { codexHome?, timestamp? })`: tries the deterministic `<codexHome>/sessions/<YYYY>/<MM>/<DD>/rollout-<ts>-<threadId>.jsonl` layout when a timestamp is known, else scans the sessions tree for `*<threadId>*.jsonl` (bounded directory walk, newest first). Returns undefined when absent (archived-sessions fallback is lifecycle-sibling scope). All paths built with `path.join`.
- `readRolloutOccupancy(path)`: last `token_count` event → `{ totalTokens, modelContextWindow, pct }`; returns `null` when the rollout has no `token_count` line yet — documented as "zero completed turns, treat as 0% occupancy", NOT an error (dossier solution 05).
- `readRolloutConversation(path)`: reconstructs `{role, text}` turns from `response_item` lines with `role in {user, assistant}` (skipping `developer` scaffolding) and surfaces `task_complete`/`agent_message` payloads as per-turn final answers; also exposes `turn_id`s from `task_started`/`task_complete` payloads. This is the warm-seed/turn-id substrate the lifecycle sibling consumes.

### D9: Run-state identity reuses the existing worker schema, rollout path goes in `transcript`

`buildCodexWorkerRecord({ threadId, model, sandbox, effort, rolloutPath?, role? })` returns an object satisfying the existing `RunStateWorkerSchema` — `runtime: 'codex'`, `threadId`, `model`, `sandbox`, `effort`, `updatedAt`, with the rollout JSONL path recorded in the existing `transcript` field. Rationale: `transcript` is documented in `run-state.ts` as "the durable cross-session pointer to the worker's persisted conversation" — exactly what a rollout path is — and `stageWorkers()` already treats `threadId` as a reusable cross-session pointer, so no schema change is needed at all. `turnId` stays unset in exec mode (bare events carry none; recording a stale rollout-derived turn id would imply a precision exec mode does not have). Alternative (new `rolloutPath` passthrough field) rejected: two fields meaning "where the conversation lives" would force every reader to check both.

### D10: Seams promised to the sibling changes

- `codex-runtime-lifecycle`: `parseExecEventStream` (death detection = last `turn.started` without a matching `turn.completed`/`turn.failed`), `turn.failed` raw messages (retry classification), `findRolloutPath` + `readRolloutConversation` (warm seed), and the builder's options object (extended additively with a `resume` variant).
- `codex-runtime-context-probe`: `readRolloutOccupancy` + `findRolloutPath` (the null-means-0% contract is designed for its threshold math).
- `codex-runtime-playbook-integration`: `formatShellInvocation`, `CODEX_FLAT_HIERARCHY_GUARD`, contract schemas, `buildCodexWorkerRecord`.
- Everything re-exported through `src/core/codex/index.ts`; siblings import from the module root only.

### D11: Version premise is a named constant

`CODEX_CLI_VERSION_PREMISE = '0.144.1'` exported from the module and cited in doc comments wherever behavior could drift (stdin hang, prompts/*.md negative, ultra auto-delegation, event shapes). Keeps the pin greppable when round-3 research re-verifies against a newer CLI.

## Risks / Trade-offs

- [Codex CLI behavior drifts after 0.144.1 (event shapes, flag names, prompts/*.md revived)] → every behavioral assumption is pinned via D11 and concentrated in `invocation.ts`/`exec-events.ts`/`rollout.ts`; fixtures are copied from live dossier captures so a re-verification round can diff against them.
- [Prompt-level flat guard is soft — a model can still disobey] → identical trust model to Claude Task-tool workers today (documented in the guard's doc comment); round-3 follow-up #8 tracks a possible hard disable.
- [Clamping `ultra` silently changes what the pipeline author asked for] → mitigated by the `warnings` channel; the integration sibling decides how warnings surface to the user.
- [`readRolloutConversation` depends on undocumented rollout internals] → parser is tolerant (unknown lines skipped, missing fields undefined) and fixture-tested against real captured rollouts, so drift degrades to "fewer fields" rather than a crash.
- [Shell formatter quoting bugs could inject shell syntax from prompt text] → prompts are passed as a single-quoted POSIX argument with `'\''` escaping (Windows: argv form recommended; the cmd formatter documents its limits); tests include quote/newline/dollar torture cases.
- [No live end-to-end test in CI] → deliberate: CI has no Codex binary or auth. The dossier's captured outputs ARE the live evidence; unit fixtures mirror them byte-for-byte where possible.

## Open Questions

- Whether a native `skills/SKILL.md` path exists in 0.144.1+ (round-3 #1) — if so, the D6 inliner default gets swapped, interface unchanged.
- Where provider-override values live in user-facing config (project config vs pipeline YAML) — deferred to `codex-runtime-playbook-integration`; this module only defines the typed injection point.
