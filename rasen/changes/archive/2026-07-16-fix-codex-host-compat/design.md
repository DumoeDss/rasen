# Design: fix-codex-host-compat

## Context

`rasen-auto` was written with a Claude Code LEAD as the implicit host. Two seams break when the LEAD is a Codex CLI session (screenshots, 2026-07): the pre-flight context probe hard-errors (no Claude transcript exists for the cwd), and run-state validation rejects `transcript: null` / `runtime: "codex-host-fallback"`. Code facts verified at HEAD of `fix/codex-host-compat` (based on dev/0.1.4):

- `src/core/pipeline-registry/types.ts:23` — `AgentRuntimeSchema = z.enum(['claude','codex'])`.
- `src/core/pipeline-registry/run-state.ts:51,54` — `runtime: AgentRuntimeSchema.optional()`, `transcript: z.string().optional()` (null rejected).
- `run-state.ts:235-243` — `readRunState` maps ANY parse/validation failure to `null`; resume then prints "No run-state (auto-run.json) found", masking the real cause.
- `src/commands/pipeline.ts:322,390` — resume already resolves the external workDir (`ensure:false`) and reads run-state workDir-first with sticky-legacy fallback (`resolveRunStateLocation`, run-state.ts:258). Spec'd in `opsx-pipeline-registry` (Pipeline CLI Surface). Scope item 3 is therefore regression-test-only.
- `src/core/agent-context.ts:307-337` — `findLatestMainTranscript` throws when the projects dir is absent or holds no main transcript; `src/cli/index.ts:729-736` maps every throw to exit 1.
- Generated rasen-auto instruction ≈ 90KB (`auto.ts` 23KB + `_orchestration.ts` 67KB) — the Codex read-truncation item is declared out of scope (template surgery disproportionate; segmented reads already work).

## Goals / Non-Goals

**Goals:**
- Host-runtime-neutral parse boundary for run-state: a Codex-LEAD-written `auto-run.json` parses; nothing the writer legitimately records is silently destroyed (unknown runtime preserved as `runtimeRaw`).
- Machine-readable graceful degradation for `rasen agent context --latest` on hosts with no Claude transcript, exit 0, so the non-blocking probe contract holds for any host.
- Diagnosable residual failures: resume distinguishes "run-state file invalid" from "no run-state file".
- Writer-side guidance so future LEADs write canonical values.

**Non-Goals:**
- Splitting/shortening the rasen-auto instruction for Codex read limits (known-open).
- Widening the canonical write schema — `writeRunState` stays strict.
- Any version bump.
- Changing resume's workDir resolution (already correct).

## Decisions

### D1 — Lenient parse-boundary normalization over schema widening

`parseRunState` gains a pre-validation normalization pass over every stage worker record (and the portfolio `planner` record, which reuses the same shape):

- `transcript: null` → key removed (treated as absent).
- `runtime` not in `{claude, codex}` → value moved to `runtimeRaw` (passthrough key, original preserved for observability), `runtime` removed.
- Same treatment for other nullable-optional string drift on the worker record (`agentId: null`, `threadId: null`, etc.): null → absent. Null is a "field known, value unknown" statement from JSON-producing hosts; absent is what the schema means by it.

Alternative considered: widen the schema (`z.string().nullable().optional()` + `.transform`, `runtime: z.string()`). Rejected because the schema is also the WRITE contract (`writeRunState` uses `RunStateSchema.parse`) and widening it would legalize non-canonical writes forever; normalization keeps one strict canonical shape while making reads tolerant — Postel's law with a preserved original. `runtimeRaw` rather than coercing `codex-host-fallback` → `codex`: coercion would fabricate a claim (that the worker ran on the codex exec bridge) that downstream resume logic acts on; an absent runtime is honest and everything downstream already handles it as optional.

### D2 — Availability semantics for the context probe, scoped to environmental absence

Split failure modes:

- **Environmental absence** (only reachable via `--latest`): projects directory missing, or present with no main-session transcript. New behavior: report unavailable, exit 0. JSON: `{"available": false, "reason": "no-transcript", "detail": "<human message>"}`. Text mode: `context unavailable: <detail>` on stdout, exit 0.
- **Input errors** (unchanged, exit 1): invalid `--runtime`/`--limit`, neither `--transcript` nor `--latest` given, explicit `--transcript` path unreadable or usage-free. An explicitly named file that can't be probed is a caller mistake, not a host condition.

Success JSON gains `available: true` (additive; existing fields unchanged; threshold consumers keep working). Implementation: `agent-context.ts` exports a wrapper (e.g. `probeAgentContextSafe` or a tagged union result) that catches ONLY the two environmental-absence errors from `findLatestMainTranscript` — implemented by typed error marking (an `AgentContextUnavailableError` subclass thrown there), not message matching. The command layer maps the tagged result; the CLI catch-all keeps mapping real throws to exit 1.

Trade-off: a Claude host probing a mis-derived projects dir now gets a quiet `available: false` instead of a loud error. Accepted: the probe is advisory by contract (auto workflow step 0 calls it non-blocking), `detail` still names the missing directory, and `--transcript` retains the hard error for anyone who needs one.

### D3 — Resume reports invalid run-state distinctly

`run-state.ts` gains a read variant returning a tagged result (`{state} | {error} | null`-style, e.g. `readRunStateDetailed`), keeping `readRunState`'s null-swallowing signature for existing callers. `resume` uses the detailed read: when the located file fails JSON.parse or (post-normalization) schema validation, the no-run-state JSON keeps `hasRunState: false` (additive compatibility) but the `note` names the file path and the validation reason, and gains `invalidRunState: true` + `runStatePath`. After D1, this branch should be rare — it is the diagnosability backstop.

### D4 — Writer guidance in the auto template

`auto.ts` / `_orchestration.ts` run-state recording guidance gains one line: `runtime` MUST be `claude` or `codex`; when the host runtime is neither, omit the field; never write JSON `null` for an absent optional field — omit the key. Also step 0's probe text notes the `available:false` shape as the "record unavailable and proceed" path. Template-only text change; the command/skill artifacts regenerate through the normal build (`parity` hash updates handled at apply time per repo convention).

## Risks / Trade-offs

- [Normalization hides writer bugs] → `runtimeRaw` preserves the original value in the parsed state and on disk; D4 fixes the writer; D3 keeps genuinely broken files loud.
- [Exit-0 unavailable could mask a misconfigured Claude host] → `detail` names the directory probed; explicit `--transcript` still errors hard.
- [Consumers pattern-matching exact probe JSON] → change is additive (`available` added, no field removed/renamed); unavailable shape is new, previously that path was a non-JSON error line + exit 1, which no machine consumer could have relied on as success.
- [Screenshot ran an older installed version] → all fixes are asserted against HEAD behavior with new tests, not against the screenshot; item 3 lands as regression coverage only.

## Migration Plan

Pure forward-compatible change: old run-state files keep parsing (normalization only widens acceptance), old probe consumers see one added field. No data migration, no rollback steps beyond reverting the commit.

## Open Questions

- (none blocking; D6-style adjudications can revisit `runtimeRaw` naming at review)
