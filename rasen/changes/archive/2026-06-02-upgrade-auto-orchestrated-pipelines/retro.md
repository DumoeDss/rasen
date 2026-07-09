# Retro: upgrade-auto-orchestrated-pipelines

## What shipped

Converted `/opsx:auto` from a single-context linear recipe into a LEAD that
orchestrates role-isolated subagents, with pipelines promoted to a data-driven
registry. Delivered in three phases:

- **P1 — orchestration layer.** New shared LEAD playbook (`_orchestration.ts`):
  capability tiers A/B/C, role-isolated leaf workers invoking existing stage
  skills, change-directory blackboard + run-state, structural author≠verifier,
  gate/loop/parallelGroup/condition, bounded loops + human escalation. Rewrote
  `auto` and `review-cycle` onto it; corrected review-cycle's primary/fallback
  inversion (SendMessage multi-agent now PRIMARY).
- **P2 — data-driven registry + CLI.** `src/core/pipeline-registry/*` mirroring
  the artifact-graph schema system; built-in `full-feature`/`small-feature`/
  `bug-fix` YAML; `openspec pipeline list|show|classify|resume --json`;
  pipeline validation wired into `openspec validate`; `auto` refactored to
  source its DAG from the CLI (no longer hard-coded).
- **P3 — hardening.** Typed run-state (`auto-run.json`) schema + reader/writer;
  validate UX gaps closed (`--type pipeline` alone, interactive selector);
  workflow guide updated to the orchestration model.

## What went well

- **WHAT/HOW split paid off.** Decoupling the pipeline DAG (data) from the LEAD
  playbook (instructions) in P1 meant P2 was a *source swap* (inline → CLR),
  not a rewrite. Adding a task type is now a YAML file with zero code change —
  proven by a regression test.
- **Dogfooded author≠verifier.** Every phase was authored then audited by a
  separate, adversarial reviewer subagent (the exact pattern this change
  builds). Reviews surfaced real issues each time (P1: 7 findings incl. the
  Tier C leadReview self-review gap; P2: 5 findings incl. classify substring
  false-positives). Fixes were re-confirmed by fresh non-author re-reviews.
- **Role-isolated implementer subagents** kept the LEAD context lean across a
  large build and matched the architecture under construction.

## What was tricky

- **Skill-name ground truth.** Expert skills' canonical `template.name` is
  `gstack:<x>`, not `openspec-gstack-<x>` (the loader dirName). Caught by the
  implementer verifying against `getSkillTemplates()` before finalizing the
  built-in YAML — otherwise skill-existence validation would have failed.
- **Modeling the verify fan-out.** Representing the expert matrix as individual
  stages sharing `parallelGroup: experts` (with complementary `ui`/`non-ui`
  conditions for qa/qa-only) resolved the ambiguity a reviewer flagged about
  how a single `verify` stage expands into N concurrent workers.
- **Tier C honesty.** Several invariants (author≠verifier, the propose
  direction-review gate) only hold structurally on Tiers A/B; the single-context
  fallback needed explicit degrade rules so it never silently claims a
  non-author check it cannot provide.

## Follow-ups

- **Live Tier A dry-run** of `/opsx:auto` on real Claude Code with agent-teams
  (P1 task 2.8) — could not be exercised in the dev session that built this.
- **Doc mirrors:** propagate the orchestration model into `docs/commands.md`,
  `docs/workflows.md`, `docs/supported-tools.md` (tier annotations) and the
  `docs/zh/` mirrors (only `docs/opsx-workflow-guide.md` was updated here).
- **Archive** the change (`openspec archive`) to merge the new
  `opsx-pipeline-registry` / `opsx-orchestration` capabilities and the
  `opsx-auto-command` / `review-cycle-workflow` deltas into canonical specs.
