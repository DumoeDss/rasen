# Tasks: add-context-handoff

## Workstream A — sensing + config + resume (TypeScript, delegated to implementer worker)

- [x] 1.1 `src/core/agent-context.ts`: transcript scan (last assistant `message.usage`), contextTokens sum, model→limit map (opus-4/sonnet-5/sonnet-4-6/fable/opus-4-x → 1_000_000; haiku → 200_000; default 200_000), `--latest` main-session resolution (newest non-`agent-*` `*.jsonl` in the Claude projects dir for the cwd slug; `dir` override), typed result `{ model, contextTokens, limit, pct, transcript }`, actionable errors.
- [x] 1.2 `src/commands/agent.ts` + registration in `src/cli/index.ts`: `openspec agent context [--transcript <path>] [--latest] [--dir <dir>] [--limit <n>] [--json]`; text output one line, json exact shape; exit non-zero only on unreadable/no-usage transcript.
- [x] 1.3 `src/core/pipeline-registry/types.ts`: `HandoffConfigSchema` (`threshold` in (0,1], `roles` partial map of StageRole→threshold, `maxRelays`/`stallLimit` positive ints) — optional at pipeline level and per-stage (`handoff` field on StageSchema); export `DEFAULT_HANDOFF = { threshold: 0.5, maxRelays: 3, stallLimit: 2 }` and `resolveStageHandoffConfig(stage, pipeline)` (stage > roles[role].threshold > pipeline > defaults).
- [x] 1.4 Surface resolved handoff config in `openspec pipeline show --json` (per-stage `handoff` field) — follow how runtime config is surfaced in `src/commands/pipeline.ts` / resolver.
- [x] 1.5 `src/core/pipeline-registry/run-state.ts`: optional top-level `sessionHandoff` `{ path, pct?, afterStage?, at? }` and per-stage `handoffs[]` `{ n?, path, reason?, completed?, remaining?, at? }` (lenient parsing, ignore unknown keys, old files parse unchanged).
- [x] 1.6 `openspec pipeline resume --json` reports `sessionHandoff` and per-stage latest handoff path (e.g. `handoffs: { <stageId>: <latestPath> }`); when a worker transcript path exists and is readable, include optional `contextEstimate` `{ contextTokens, limit, pct }` per worker via agent-context core (skip silently when unreadable).
- [x] 1.7 Tests: `test/core/agent-context.test.ts` (fixture jsonl: usage sum, no-usage error, latest-resolution with agent-*.jsonl excluded, limit map + override); extend pipeline registry tests for handoff schema validation + resolution order; run-state tests for new optional fields + resume output.

## Workstream B — templates + registration + docs (LEAD)

- [x] 2.1 `src/core/templates/workflows/handoff.ts`: `getHandoffSkillTemplate()` (name `openspec-handoff`) + `getOpsxHandoffCommandTemplate()` sharing one instruction body: session-level flow (probe via `openspec agent context --latest`, write `handoff/lead-<n>.md` with template sections, update `sessionHandoff` in `auto-run.json`, tell user how to resume) + worker-level template sections (incl. mandatory eliminated-hypotheses section for fixer/debugger) per design.md.
- [x] 2.2 Registration: export from `skill-templates.ts`; `skill-generation.ts` (skill dirName `openspec-handoff`, workflowId `handoff`; command id `handoff`); `profiles.ts` ALL_WORKFLOWS (+ NOT core); `tool-detection.ts` COMMAND_IDS; `init.ts` WORKFLOW_TO_SKILL_DIR; `profile-sync-drift.ts` WORKFLOW_TO_SKILL_DIR.
- [x] 2.3 `_orchestration.ts`: add Step H (context sensing & handoff): probe primitive, worker handoff clause in the Step B dispatch prompt shape, LEAD handoff accounting (`handoffs[]`, stall comparison), relay caps with LEAD review, warm-continue guard before every `SendMessage` (incl. making B.1 planner "retire on bloat" deterministic via probe), escalation ladder + parked `escalated` status + `strategyAttempts`; update Step E termination to route through the ladder (keep "never report clean with open Blocker/Major"); update Step F run-state example with new fields; update F.1 to prefer handoff docs over raw transcript warm-seed.
- [x] 2.4 `auto.ts`: Step 0 pre-flight probe (`openspec agent context --latest`; >= threshold → one-line non-blocking reminder suggesting `/opsx:handoff`).
- [x] 2.5 `review-cycle.ts`: align termination text with the ladder (LEAD strategy review + parking replaces the immediate human stop; never silently pass).
- [x] 2.6 `docs/opsx-workflow-guide.md`: handoff section (§ sensing CLI, /opsx:handoff, worker self-handoff, config, escalation ladder).
- [x] 2.7 Template/registration tests: handoff workflow generation opt-in (mirror review-cycle.test.ts generation block), playbook content assertions (handoff clause, relay caps, warm-continue guard, parked escalation), auto preflight assertion.
- [x] 2.8 Changeset (`.changeset/add-context-handoff.md`, minor).

## Integration

- [x] 3.1 `tsc --noEmit` clean; affected vitest suites green.
- [x] 3.2 Independent reviewer worker over the full diff; triage; fix; non-author delta re-review.
- [ ] 3.3 Commit (only this change's files), `openspec validate add-context-handoff --strict`, archive, final commit.
