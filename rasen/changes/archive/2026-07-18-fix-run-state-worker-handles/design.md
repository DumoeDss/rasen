## Context

This repo is the Rasen/OpenSpec TS CLI, which dogfoods its own workflow. The orchestration **playbook the LEAD reads at runtime is GENERATED** from template strings in `src/core/templates/workflows/*.ts` (the shared `ORCHESTRATION_PLAYBOOK` in `_orchestration.ts`, embedded by `auto.ts`, `review-cycle.ts`, `goal-command.ts`). Run-state (`auto-run.json`) is the typed contract in `src/core/pipeline-registry/run-state.ts`; `src/commands/pipeline.ts` `resume` is its read surface. So "fixing the playbook" means editing TS template strings, and "fixing run-state validation" means editing `run-state.ts` + `pipeline.ts`.

A real autopilot run (session `a2f6314f-…`, one continuous session, NO compaction) surfaced two coupled defects:

- **Defect #1.** The LEAD recorded each worker as `{ role, runtime, name }` — a `name` field that is **not even in the schema** — instead of the `agentId` + `transcript` the Agent tool's spawn result actually returned. `collectStageWorkers` (`run-state.ts` ~L314) only surfaces workers with `agentId || transcript || threadId`, so the name-only record was **silently dropped** → the worker vanished from `rasen pipeline resume` → no warm-seed pointer, forced cold reconstruction. The `Worker` schema and its doc comment are already correct/optional; the gaps are (a) the playbook never forces the LEAD to capture `agentId`+`transcript` from the spawn result, and (b) nothing validates/warns when a worker record lacks a durable handle.
- **Defect #2.** The playbook (Step A ~L26, Step F.1 ~L174/L183/L264) asserts that within a live session `SendMessage`-ing a completed worker revives it (the "two are the SAME mechanism" note). The transcript contradicts this for **name-based** addressing: a completed Agent-tool subagent was NOT name-addressable ~27 messages later in the same un-compacted session; the harness error itself directed to "use the agent ID", implying `agentId` is the more durable live handle and `name` is not.

The `Worker` schema fields are already optional and `.passthrough()`; archived `auto-run.json` must keep parsing. No runtime `tier` detection exists today — `tier` is LEAD-self-reported from the playbook, and `ensureClaudeAgentTeams` only writes the env var into `.claude/settings.json` during `init`/`update`.

## Goals / Non-Goals

**Goals:**
- The LEAD always records a durable handle (`agentId`+`transcript` for Claude, `threadId`/`turnId` for Codex) on every dispatch, because the playbook tells it to.
- A worker record that lacks a durable handle is **surfaced** (warned) on resume, not silently dropped.
- The playbook no longer makes the false within-session-revival-by-name claim; it prescribes agentId-first re-engagement with a transcript warm-seed fallback, and the code comments agree.
- The Tier-A description is honest about what agent-teams does and does not guarantee.
- All four hidden-bug leads the reviewer will check are explicitly resolved (fixed in-scope or recorded as accepted-known with rationale).
- Backward-compatible: archived `auto-run.json` parses; schema stays optional + passthrough; no CLI breaking changes; `pnpm test`/`lint`/`tsc` green.

**Non-Goals:**
- A runtime env-probe that auto-detects/sets `tier` (no detection code exists; the LEAD cannot reliably read its own harness env; adding this is a separate capability — recorded as a finding, out of scope).
- Making any `Worker` field required, or hard-rejecting unknown worker keys (would break archived run-state and the passthrough philosophy).
- The portfolio `planner` pointer / `portfolio-run.json` validation (single pointer, not the `collectStageWorkers` silent-drop path that caused this failure).
- Integrating worker-handle validation into `rasen doctor` (doctor owns root/store/registry relationship health; resume is the canonical run-state surface and already reads workers — see D1).
- Rewriting the worker-death taxonomy (H.4a classes) or the counter table — only the revival *addressing* (name → agentId) changes.

## Decisions

**D1 — Warn in `pipeline resume`, not `doctor`.** resume already reads run-state, surfaces `workers`, and is THE resume surface; doctor's domain is relationship/root/store/registry health and it does not currently read `auto-run.json`. Adding a run-state pass to doctor is scope creep across module boundaries. *Alternative considered:* warn in both — rejected (minimal delta; resume is where a resuming LEAD actually looks, and the JSON field is machine-consumable by the LEAD itself).

**D2 — Validation is warning-only, never fatal.** Archived run-state with role-only/name-only workers must still parse; the resume exit code stays 0. Zod stays `.passthrough()`; we do NOT add `.strict()`. The new checks are advisory functions layered on top of the existing parse, surfaced as warnings. *Alternative:* hard-error on unknown keys — rejected (breaks archived state + forward-compat).

**D3 — Duplicate-key detection via a small scanner, not `JSON.parse`.** `JSON.parse` (and Zod on its output) silently collapses duplicate keys to the last value, so the bug is invisible today. Add a lightweight detector (`detectDuplicateKeys(content: string): { path: string; key: string }[]`) that token-scans the raw JSON text and reports repeated keys at the same object level. It runs alongside `parseRunState`, is non-fatal, and does not alter the parsed value. *Alternative:* a `JSON.parse` reviver — rejected (a reviver cannot see repeats; only a pre-scan can). *Alternative:* adopt a strict JSON parser dep — rejected (new dependency for a small advisory check).

**D4 — agentId-first re-engagement; do NOT claim agentId guarantees revival.** The transcript proved `name` fails and the harness hinted `agentId` is the durable live handle, but we have NO direct evidence that `agentId` reliably revives a *completed* worker in-session either. So the playbook prescribes: record `agentId`+`transcript`; re-engage by `agentId` first; fall back to the transcript warm-seed (Step F.1 / Tier-B path) if `agentId` is absent or does not resolve. We assert only what was observed. *Alternative:* claim agentId always revives — rejected (unproven, and would repeat the original overclaim).

**D5 — One capability (`orchestration-worker-lifecycle`), Modified + Added.** Both defects are worker-handle durability/addressing concerns; the two wrong claims already live in this capability's requirements, so they MUST be corrected here regardless. Splitting the run-state-validation requirements into a new `run-state-worker-handles` capability would fragment a tightly-coupled fix across two specs (more delta). The capability name is broad enough to cover durable handles + validation.

**D6 — Hidden-bug triage (reviewer checklist).**

| Hidden-bug lead (planning-context) | Disposition |
|---|---|
| #1 `collectStageWorkers` silent drop | **In-scope (fix):** resume `workerHandleWarnings` names the stage. |
| #2 unknown `name` field drift | **In-scope (fix):** warning enumerates non-durable keys (e.g. `name`); passthrough preserved (no hard reject). |
| #3 Tier-A honesty | **In-scope (fix text):** Step A + `claude-settings.ts` comment stop overclaiming. Runtime env-probe: **accepted-known** (no detection code exists; rationale in Non-Goals). |
| #4 duplicate JSON keys | **In-scope (fix):** `detectDuplicateKeys` + non-fatal resume warning. |
| #5 Step B doesn't tell LEAD to capture agentId+transcript | **In-scope (fix):** this is defect #1's root — Step B rewritten. |
| #6 H.4a(b)/H.4b SendMessage-by-name assumptions | **In-scope (fix):** corrected to agentId-first under the MODIFIED "SendMessage-resume scoping" requirement. |

## Risks / Trade-offs

- **[Playbook text edits ripple to parity hashes]** Editing `_orchestration.ts` changes the rendered `rasen-auto`, `rasen-review-cycle`, and `rasen-goal` skill templates, whose SHA-256 hashes are pinned in `test/core/templates/skill-templates-parity.test.ts`. → *Mitigation:* the implementer MUST regenerate and update those three (or more) hashes; a stale hash fails CI loudly (this is the intended guardrail, not a silent regression).
- **[Resume becomes noisy on legacy runs]** Old archived changes with role-only/bare-string workers will warn when resumed. → *Mitigation:* the warning is correct (those workers genuinely have no warm-seed) and advisory; it does not block resume. Acceptable and accurate.
- **[Dup-key scanner false positives/nesting]** A naive scanner could mis-report keys at different nesting levels or inside string literals. → *Mitigation:* the detector tracks object-level scope and ignores string-internal tokens; covered by a dedicated test (duplicate at top level + duplicate inside `stages` + a key that appears at two different levels is NOT a duplicate).
- **[Overcorrecting the revival claim could discourage legitimate in-session reuse]** If we implied agentId never works, the LEAD would skip the cheap in-session path. → *Mitigation:* the prescription is agentId-*first* (try it), falling back only on absence/non-resolution — preserves the cheap path where it actually works.
- **[agentId durability across harness versions is empirical]** The observed behavior is from one CLI version; future agent-teams changes could alter it. → *Mitigation:* the spec is phrased on the OBSERVED fact (name is not durable; completed worker not reliably name-addressable) and prescribes the safe fallback, so it stays correct regardless of how agentId durability evolves.
