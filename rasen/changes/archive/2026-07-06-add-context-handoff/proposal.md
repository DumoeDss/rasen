# Proposal: Context Sensing & Handoff for the OPSX Pipeline

## Why

Neither the LEAD (main agent) nor its role-isolated workers can perceive their own context-window usage today. Long pipeline runs degrade silently: workers hit compaction mid-stage and lose detail, warm-continued workers (planner reuse, review-loop re-review) bloat until responses degrade, and the only recovery is the harness's lossy auto-compact. The orchestration playbook already gestures at the problem ("retire on bloat" for the planner) but gives no way to decide *when*, and no standard artifact for handing work from an exhausted agent to a successor.

The fix has two halves:

1. **Deterministic sensing.** Claude Code transcripts (`*.jsonl`) record exact per-turn API `usage`; current context occupancy is `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` of the latest assistant message. A CLI probe turns that into a number any agent can act on — no estimation.
2. **A standard handoff protocol.** A distilled handoff document (decisions, eliminated hypotheses, next action — the things the blackboard doesn't record) plus orchestration rules: session-level handoff is user-invoked (`/opsx:handoff`) with a non-blocking reminder at `/opsx:auto` entry; worker-level handoff is mid-stage self-service — the worker writes the doc, returns a structured handoff result, and the LEAD spawns a successor in the same session. Escalation is LEAD-first (relay caps, stall detection, strategy ladder); humans are only consulted at natural pause points, never by mid-run hard interruption.

## What Changes

- **New CLI:** `openspec agent context [--transcript <path> | --latest] [--json] [--limit <n>]` — reads a transcript jsonl, reports `{ model, contextTokens, limit, pct }`.
- **Pipeline config:** optional `handoff` block (`threshold`, `roles.<role>`, `maxRelays`, `stallLimit`) at pipeline and stage level, with stage > role > pipeline > built-in-default resolution; surfaced by `openspec pipeline show` and validated by `openspec validate --type pipeline`.
- **Run-state:** `auto-run.json` gains optional top-level `sessionHandoff` and per-stage `handoffs[]` records; `openspec pipeline resume` reports them (plus per-worker context estimates when transcripts are readable).
- **New workflow:** `handoff` (skill `openspec-handoff`, command `/opsx:handoff`), opt-in via ALL_WORKFLOWS — writes the handoff document for the current session or a worker.
- **Orchestration playbook** (`_orchestration.ts`): worker spawn prompts gain a handoff clause (triggers + structured return contract); LEAD-side relay accounting (maxRelays / stallLimit / progress comparison); SendMessage warm-continue guard (probe worker transcript first, retire-via-handoff-doc above threshold); planner "retire on bloat" becomes deterministic; review-loop termination becomes a strategy ladder with non-blocking escalation (park + report at next gate) instead of a mid-run human stop.
- **`/opsx:auto` entry:** Step 0 pre-flight probe of the LEAD's own transcript with a non-blocking reminder when above threshold.
- **Docs:** `docs/opsx-workflow-guide.md` gains a handoff section.

## What Does NOT Change

- No continuous token-meter injection into any agent's context (discrete checkpoints only — avoids cache invalidation and context anxiety).
- The blackboard model: the change directory stays the primary state channel; handoff docs are a distillation checkpoint, not a replacement.
- Review quality gates: "never silently pass" is preserved — escalation is re-shaped (LEAD strategy ladder + parked escalation), not removed.
- Author != verifier invariants and the flat LEAD/worker hierarchy.

## Capabilities Touched

- `cli-agent-context` (ADDED)
- `pipeline-handoff-config` (ADDED)
- `orchestration-handoff` (ADDED)
- `workflow-handoff-command` (ADDED)

## Impact

- New: `src/core/agent-context.ts`, `src/commands/agent.ts`, `src/core/templates/workflows/handoff.ts`, tests.
- Modified: `src/cli/index.ts`, `src/core/pipeline-registry/{types,run-state}.ts`, `src/commands/pipeline.ts`, `src/core/templates/workflows/{_orchestration,auto,review-cycle}.ts`, `src/core/shared/{skill-generation,tool-detection}.ts`, `src/core/templates/skill-templates.ts`, `src/core/profiles.ts`, `src/core/init.ts`, `src/core/profile-sync-drift.ts`, `docs/opsx-workflow-guide.md`.
- Non-breaking: all new config/state fields are optional; existing pipelines and run-states parse unchanged.
