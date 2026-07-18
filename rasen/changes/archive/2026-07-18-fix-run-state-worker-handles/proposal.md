## Why

A real autopilot run failed to resume its workers because of two coupled defects in the orchestration-worker-lifecycle area. (1) The LEAD recorded each stage worker with a fabricated `name` field instead of the durable `agentId` + `transcript` the Agent tool actually returned, so `collectStageWorkers` silently dropped the record — the worker became invisible to `rasen pipeline resume`, forcing a cold reconstruction and losing the warm-seed path. (2) The generated playbook asserts that `SendMessage`-ing a completed worker within a live session revives it (by name) — but the transcript proves a completed Agent-tool subagent is NOT reliably name-addressable even ~27 messages later in the same un-compacted session (the harness replied "No agent named 'implementer' is currently addressable … use the agent ID"). The playbook's revival claim is wrong, and the run-state gap that made the failure silent has no validation to catch it.

## What Changes

- **Defect #1 — durable handles in run-state.** The generated playbook's Step B dispatch instructions SHALL tell the LEAD to capture `agentId` + `transcript` from the Agent (Task) tool's spawn RESULT and write them into the stage's `worker` record (Claude), or `threadId` + `transcript`/`turnId` (Codex) — never a made-up `name`. The `Worker` schema fields stay **optional** and `.passthrough()` so archived `auto-run.json` still parses.
- **Defect #1 — validation, not silence.** `rasen pipeline resume` SHALL surface a non-fatal warning (in both `--json` and human-readable output) for every stage whose `worker` record lacks any durable handle (`agentId` / `transcript` / `threadId`) — i.e. a name-only or role-only record — naming the offending stage and the non-durable keys present. A new duplicate-key detector SHALL likewise warn (non-fatal) when `auto-run.json` carries duplicate JSON keys, which `JSON.parse` silently collapses.
- **Defect #2 — correct the revival claim.** Rewrite the playbook's Step A, Step F.1 (incl. the "two are the SAME mechanism" note), and Step H.4a(b)/H.4b revival paths to prescribe **agentId-first** re-engagement: `name` is a non-durable dispatch label, NOT a resume handle; a completed Agent-tool subagent may be unreachable even within the same session; fall back to the transcript warm-seed (the Tier-B path) when `agentId` is absent or does not resolve. Align the code comments in `run-state.ts` (~L34–43) and `pipeline.ts` (~L423–425) with this reality.
- **Hidden bugs (in-scope).** `collectStageWorkers` silent drop → caught by the resume warning; the unknown `name` field → flagged by name in the warning (passthrough preserved); Tier-A honesty → Step A text and the `claude-settings.ts` header comment stop overclaiming that agent-teams guarantees a completed worker is re-addressable.
- **Tests.** Extend `run-state.test.ts` (worker-handle validation helper, duplicate-key detector, `collectStageWorkers` behavior unchanged for durable handles) and `pipeline.test.ts` (resume warns on a name-only worker and on duplicate keys, in json + text; a durable-handle worker warns nothing).

No breaking CLI changes. No new required schema fields. Archived run-state continues to parse.

## Capabilities

### New Capabilities
<!-- None — both defects are worker-handle-lifecycle concerns and belong in the existing capability. -->

### Modified Capabilities
- `orchestration-worker-lifecycle`: correct the two existing requirements that overclaim in-session `SendMessage` revival (the "SendMessage-resume scoping and cross-session dead handles" requirement and the same-session-restart scenario of "Resume matches the latest generation's distillation"); ADD requirements for durable-handle capture on dispatch, run-state worker-handle validation surfaced on resume (incl. unknown-key naming), duplicate-key detection in run-state, and Tier-A capability claims bounded to observed behavior.

## Impact

- **Generated playbook** (`src/core/templates/workflows/_orchestration.ts`): Step A (tier honesty), Step B (capture `agentId`+`transcript` from the spawn result), Step F.1 (agentId-first revival + the "same mechanism" note), Step H.4a(b)/H.4b (agentId-first revival). Embeds via `ORCHESTRATION_PLAYBOOK` into `auto.ts`, `review-cycle.ts`, `goal-command.ts` — their parity hashes in `test/core/templates/skill-templates-parity.test.ts` move.
- **`src/core/templates/workflows/auto.ts`**: the Resume-section comment that restates the (wrong) within-session revival claim is aligned.
- **`src/core/pipeline-registry/run-state.ts`**: doc comment (~L34–43) aligned; new non-fatal helpers — a duplicate-key detector over the raw JSON text and a worker-handle-validation helper. `RunStateWorkerSchema` stays optional + `.passthrough()`.
- **`src/commands/pipeline.ts`**: `resume` surfaces `workerHandleWarnings` + duplicate-key warnings (json + text); the "dead SendMessage handles" comment (~L423–425) is aligned.
- **`src/core/claude-settings.ts`**: header doc comment (~L1–9) stops overclaiming Tier-A re-review guarantees.
- **Tests**: `test/core/pipeline-registry/run-state.test.ts`, `test/commands/pipeline.test.ts`, and the parity hash list in `test/core/templates/skill-templates-parity.test.ts`.
- No runtime `tier` detection exists today (tier is LEAD-self-reported from the playbook); adding a runtime env-probe is explicitly out of scope. No `auto-run.json` is written or edited by this change.
