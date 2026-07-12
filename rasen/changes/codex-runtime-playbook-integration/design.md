## Context

This is the merge node of the codex-runtime portfolio. The three prerequisites are shipped and review-clean:

- **exec-core (a658620)**: `src/core/codex/` — `buildCodexExecInvocation` (data-only; flat guard `CODEX_FLAT_HIERARCHY_GUARD` always appended; `ultra` clamped to `xhigh` with a warning; provider override injection point; template inlining), `formatShellInvocation` (POSIX `< /dev/null`, Windows argv-form preferred), `parseExecEventStream`/`extractThreadId`, `findRolloutPath`/`readRolloutOccupancy`/`readRolloutConversation`, `LEAF_RETURN_SCHEMA`/`EVALUATE_GATE_SCHEMA` + parsers, `buildCodexWorkerRecord` (rollout path recorded in `transcript`; `turnId` never set in exec mode).
- **lifecycle (115c0c67)**: `resume` option on the same builder — live-verified correction: `codex exec resume` REJECTS `-s`/`--sandbox` (sandbox is fixed at thread creation; the builder omits `-s` on resume and records a warning when a differing sandbox was requested); `detectThreadDeath` (real rollout vocabulary: `task_started` opens, `task_complete`/`turn_aborted` close; dotted `turn.*` names are exec-stdout-only, accepted defensively); `CODEX_REVIVAL_NOTICE`; `classifyTurnFailure` (retryable 429 / fatal 404 / unknown, auditable reasons) + `backoffDelayMs` (20s base, ×2, 120s cap); `claimThreadWriter` (in-process; cross-process single-writer is a documented operator invariant); `distillWarmSeed` (commentary-phase blacklist — unphased/unknown-phase records kept; cross-SOURCE dedup only).
- **context-probe (shipping)**: `rasen agent context --transcript <rolloutPath>` works (detection: `--runtime` > `rollout-*.jsonl` basename > first-line sniff; model read from the last `turn_context` row — `session_meta` never carries model; zero-turn rollout = success with pct 0). `tryContextEstimate` routes the same way, so `pipeline resume` probes Codex records with no playbook change.

What the playbook currently says (`src/core/templates/workflows/_orchestration.ts`) predates all of this: Step A.1 tells the LEAD Codex workers run "through Codex app-server threads via the installed Codex Claude Code plugin or the Rasen Codex bridge", Step B offers `/codex:rescue` / `/codex:rescue --resume` as the manual path, and both promise `turnId` capture. `docs/codex-workflow-integration.md` (+ zh mirror) is the 2026-06-08 pre-research app-server design. The `AgentRuntimeSchema` comment in `pipeline-registry/types.ts` repeats the app-server claim. None of it matches the shipped machinery.

Template discipline: `ORCHESTRATION_PLAYBOOK` is a shared block imported by `auto.ts`, `goal-command.ts`, and `review-cycle.ts`; those templates are pinned by the parity golden master (`workflow-template-parity` spec, `test/core/templates/skill-templates-parity.test.ts` — function-payload AND generated-content hash maps). Template changes flow build → `rasen update`, and hashes are re-pinned by hand.

## Goals / Non-Goals

**Goals:**

- Every Codex sentence in the playbook describes shipped, live-verified machinery, with the corrections (resume rejects `-s`; no `turnId` in exec mode; rollout vocabulary) reflected — the LEAD following the playbook verbatim succeeds.
- AGENTS.md / prompt-reference context guidance (solution 11) and the session-relay conclusion (solution 13) land in the playbook.
- Stale artifacts outside the playbook corrected: types.ts comment; integration docs superseded-bannered (EN + ZH mirrored).
- Parity hashes re-pinned; full suite green.

**Non-Goals:**

- No new runtime machinery, wrappers, or CLI surface — the playbook references only shipped library functions and existing commands. In particular NO app-server bridge, NO invented "broker"/plugin layer, NO `codex mcp-server` path.
- No pipeline-registry schema changes (`AgentRuntimeSchema` etc. already model everything needed; only a doc comment is wrong).
- No rewrite of `docs/codex-workflow-integration.md`'s 573 lines — superseded banner + pointer, preserving it as a historical design record.
- No change to the `/codex` second-opinion expert skill (`templates/experts/codex.ts`) — it is a manual interactive tool, not the worker dispatch path, and was verified working in the dossier (E-baseline usage).

## Decisions

### D1: The playbook teaches the exec bridge as COMMANDS the LEAD runs, not APIs it calls

The LEAD is a prompt-driven agent executing shell commands; it cannot call `buildCodexExecInvocation()` directly. The rewritten Step B therefore shows the rendered invocation shape the builder produces and the LEAD reproduces:

```
codex exec --json --output-schema <schema.json> -o <last-message.txt> \
  -s <read-only|workspace-write> -m <model> -c model_reasoning_effort="<effort>" \
  "<inlined template + task prompt + flat guard>" < /dev/null
```

with the non-negotiable invariants called out as rules: ALWAYS `< /dev/null` (hangs otherwise); ALWAYS end the prompt with the flat-hierarchy guard (quote `CODEX_FLAT_HIERARCHY_GUARD`'s text verbatim in the playbook so the two never drift apart is NOT attempted — instead the playbook cites the constant by name and paraphrases, with a test-level parity note rejected as over-coupling; the guard sentence is short enough to restate and the library remains the source of truth for programmatic callers); NEVER `ultra` effort for a worker; inline skill/template bodies into the prompt (never rely on `$CODEX_HOME/prompts` — silent-hallucination failure mode); write the contract schema (`LEAF_RETURN_SCHEMA` shape for workers, `EVALUATE_GATE_SCHEMA` for evaluate gates) to a temp file for `--output-schema` and parse the `-o` file as strict JSON. Alternative considered — pointing the playbook at a future `rasen codex dispatch` CLI — rejected: that CLI doesn't exist, and inventing it here is exactly the fiction this change removes; if a real call-site pain appears, a later change adds the command and updates one paragraph.

### D2: Identity and run-state paragraphs state the shipped record shape

Step A.1/F rewritten to: Codex workers record `runtime: "codex"`, `role`, `threadId` (from the `--json` stream's `thread.started` line), `sandbox`/`model`/`effort` as dispatched, and the rollout path in `transcript` (locate via the deterministic local-time `~/.codex/sessions/<Y>/<M>/<D>/` name or scan; `archived_sessions/` is the fallback). Explicitly: exec mode yields NO `turnId` — record none (the current text's `turnId` promise is deleted, not softened). `threadId` is the durable resume handle; `transcript` (rollout) is the probe/warm-seed asset. This matches `buildCodexWorkerRecord` exactly, so nothing new is specced into run-state.

### D3: Lifecycle guidance mirrors the shipped semantics, including the two live-verified corrections

- **Resume**: `codex exec resume <threadId> --json -o <file> "<message>" < /dev/null` — same flags EXCEPT no `-s`: sandbox is fixed at thread creation and resume rejects the flag (the playbook states this so a LEAD never "re-sandboxes" a thread by resume; changing sandbox means a fresh thread). Explicit thread id only; never a "latest thread" form.
- **Death detection**: last `task_started` in the rollout without a following `task_complete`/`turn_aborted` (the REAL rollout vocabulary; dotted `turn.*` is stdout-stream vocabulary). On revival, prepend the revival notice (cite `CODEX_REVIVAL_NOTICE`'s meaning: interrupted turn's last action may not have completed — re-verify state).
- **Failures**: 429/rate-limit → retry with ~20s → 40s → 80s → 120s backoff; 404/model-not-available → fatal, do not retry, surface; anything else → unknown, escalate per the existing worker-death taxonomy rather than guessing.
- **Occupancy**: `rasen agent context --transcript <rolloutPath> --json` — same `pct` thresholds as Claude workers (handoff 0.5, reuse 0.25, relay 0.35); a zero-turn rollout legitimately reports 0%.
- **Parallel**: N parallel workers = N independent `codex exec` processes (safe, verified); NEVER two concurrent resumes of one thread id — one thread, one writer, stated as the operator invariant it is.
- **Warm seed / reuse ladder (Step G wording)**: the existing "threadId resume for Codex" degradation wording stays (it is now true), extended with: when a thread is unresumable or context-poor, seed a fresh worker from the rollout via the warm-seed distillation (final answers deduplicated, commentary dropped).

### D4: Context injection — prompt reference is the rule, AGENTS.md is for global conventions only

New short subsection in Step B: pass per-change context by naming paths in the dispatch prompt (`Read rasen/changes/<name>/proposal.md|design.md|tasks.md`) — live-verified that workers actually read referenced files (E12's unguessable-token probe); repo-root AGENTS.md is the right place for machine/repo-global conventions (root + nested merge, root first) and is NOT a per-change vehicle — do not cd workers into change directories to game nested discovery. rasen does not start generating AGENTS.md files in this change; the playbook documents the convention for operators (matches how the existing prompt shape already says "Read rasen/changes/<name>/ for context" — that sentence gains the "this is verified mechanism, not hope" note and the file-list precision).

### D5: Session relay: one clarifying note, no mechanism

Step H.7 gains a single sentence: session relay is a LEAD (Claude) mechanism; Codex worker threads are unaffected by a LEAD relay — the successor LEAD resumes them by recorded `threadId` like any cross-session resume. Future-proofing name-drop (from solution 13): if the LEAD role ever inverts to Codex, `codex resume [SESSION_ID] [PROMPT]` / `codex fork --last` are the candidate primitives — one parenthetical, not a design.

### D6: Docs and comments: correct, don't expand

- `pipeline-registry/types.ts` `AgentRuntimeSchema` comment: "dispatch through a Codex app-server thread" → dispatched via `codex exec` (the `src/core/codex` bridge) with `threadId` recorded for resume. Comment-only; no schema change.
- `docs/codex-workflow-integration.md` + `docs/zh/codex-workflow-integration.md`: prepend a superseded banner (date, one paragraph: the app-server design was pre-research; the shipped integration is the exec bridge) plus a short "Current state" section linking `docs/codex-parity/README.md`, `docs/zh/codex-parity-solutions.md`, and `src/core/codex/`. Body preserved as historical record. EN and ZH must stay mirrored (repo convention for these paired docs).
- Rejected alternative: deleting the old docs — they hold the app-server protocol notes that tier-3 work (turn-level gates) will want.

### D7: Parity re-pin is part of the change, not an afterthought

`ORCHESTRATION_PLAYBOOK` feeds `auto.ts`, `goal-command.ts`, `review-cycle.ts` → re-pin `rasen-auto`, `rasen-goal`, `rasen-review-cycle` entries in BOTH hash maps of `test/core/templates/skill-templates-parity.test.ts` (and any command-payload entries for auto/goal/review-cycle), following the documented golden-master update flow: make the edit, run the parity test, verify the diff is exactly the intended sections, paste the new hashes. Flow: build → `rasen update` → inspect regenerated skill output → re-pin → full `pnpm test`.

## Risks / Trade-offs

- [Playbook prose can drift from library behavior again] → every behavioral claim in the rewritten sections names its source (constant/function or dossier experiment), and the corrections that already bit once (resume `-s`, `turnId`) are stated as explicit negatives; the specs added to `opsx-orchestration` pin the load-bearing claims so future edits fail review, not runtime.
- [Restating the guard/notice text in prose could diverge from the constants] → playbook paraphrases and names the constants rather than duplicating them verbatim as normative text; the library is the single source of truth for programmatic composition.
- [Hash re-pin could mask an unintended shared-block change] → the golden-master flow requires eyeballing the generated-content diff before pasting hashes; tasks make that an explicit checklist item, not an implied step.
- [EN/ZH doc mirror can skew] → the banner and current-state section are written once and translated in the same commit; tasks pair the two files in one item.
- [A LEAD might still find `/codex:rescue` in third-party plugin docs] → the playbook doesn't ban outside tools; it just no longer recommends a path this repo never shipped. No mitigation needed beyond removal.

## Migration Plan

Template + docs + comment change; regenerated skills flow to users through the normal `rasen update` path. No data or config migration. Rollback is reverting the commit (hashes revert with it).

## Open Questions

- Whether a future `rasen codex dispatch`/`rasen codex probe` CLI should wrap the builder for LEAD ergonomics — deliberately deferred until the rewritten playbook is exercised by a real `runtime: codex` run and the shell-invocation shape proves (or disproves) itself.
