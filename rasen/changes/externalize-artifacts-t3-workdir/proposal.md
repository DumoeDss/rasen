# Proposal: externalize-artifacts-t3-workdir

## Why

Every change generates process ephemera — run-state (`auto-run.json`, `portfolio-run.json`, `goal-run.json`), handoff documents, review/expert reports, `ship-log.md`, verification reports — that only the agents driving the change consume, yet they are born inside `rasen/changes/<name>/` where they pollute `git status`, leak into PR diffs, and (this repo, today) leave 60+ permanently-untracked files strewn through the archive. The design of record (`rasen/office-hours/externalize-openspec-artifacts.md`, Decision 2) classifies these as Tier 3: external from birth, never in git. The foundation shipped in `externalize-artifacts-machine-home` (commit ed1adbd): every project now has a registered machine home with a frozen `resolveProjectHome(...).workDir(changeName)` resolver. This change makes the pipeline actually write there.

## What Changes

- **T3 ephemera move to the external work directory.** All process ephemera — handoff docs (`handoff/*.md`, `relay-prompt.txt`), review-cycle round logs and `review-cycle-report.md`, expert reports (`review-report.md`, `cso-report.md`, `qa-report.md`, `benchmark-report.md`, `design-review-report.md`), `verification-report.md`, `ship-log.md`, and run-state (`auto-run.json`, `portfolio-run.json`, `goal-run.json` / `loop.runArtifact`) — are written to `resolveProjectHome(projectRoot).workDir(changeName)` = `<home>/changes/<name>/work/` instead of the change directory. They never enter git; no gitignore is needed. T2 review material (proposal/design/tasks/delta specs) and T4 knowledge (office-hours/research docs) stay in the repo, unchanged.
- **CLI exposure (answers open Q5, exposure half).** The resolved work directory is exposed only via the CLI: `rasen status --change <n> --json` and both instructions payloads (`rasen instructions`, apply-instructions) gain a top-level `workDir` field; `rasen pipeline resume` resolves run-state from the work directory (with change-dir fallback) and reports which location it read; `rasen context` gains machine-home visibility for the resolved root. Templates reference the CLI-reported `workDir`, never a hardcoded path.
- **Template path audit (answers open Q5, inventory half).** Every template under `src/core/templates/**` that reads or writes ephemera via change-dir-relative paths switches to the CLI-resolved `workDir`: `_orchestration.ts` (run-state, goal-loop run artifact, handoff records, inter-stage blackboard wording), `handoff.ts`, `auto.ts`, `ship.ts`, `verify-change.ts`, `verify-enhanced.ts`, `review-cycle.ts`, `retro.ts`, `archive-change.ts` (read side only), `goal-command.ts` / `goal-iterate.ts` / `goal-report.ts`, `experts/_shared.ts`, and the six expert dispatched-mode report lines (`review`, `cso`, `qa`, `qa-only`, `benchmark`, `design-review`). Generated `.claude/skills` and `.codex` prompts are regenerated via the build → update flow; the skill-templates-parity test stays green.
- **CLI readers follow.** `pipeline resume` reads run-state/portfolio-state from the work directory first, falling back to the change directory; ship's verification pre-flight and archive's verification/ship-log gates read reports there (via templates); retro reads ephemera from the work directory with legacy fallback.
- **Backward compatibility (answers open Q3).** Sticky-legacy per file: a file that already exists in the change directory keeps living there (readers check workDir first, then the change directory; writers append to a legacy file where it already exists rather than splitting state). New files are born in workDir. Projects with no machine identity yet (no `projectId`, older CLI) degrade gracefully: `workDir` is absent from CLI payloads and templates fall back to the change directory — exactly today's behavior. Existing archives are untouched; no bulk migration.
- **Open Q2 (minor, decided).** Change-scoped research remains Tier 2 (rides the PR). Templates gain guidance that bulky raw research dumps (scratch logs, fetched corpora) belong in `work/research/`, with conclusions distilled into design.md or a slim T2 research doc.

## Capabilities

### New Capabilities
- `change-work-dir`: the Tier 3 contract — which artifacts are process ephemera, where the external per-change work directory lives (inside the registered project home), how the CLI exposes it (`workDir` in change-scoped payloads), the sticky-legacy fallback policy, and the guarantee that ephemera never require git bookkeeping.

### Modified Capabilities
- `cli-artifact-workflow`: `status --json` and instructions payloads expose the resolved `workDir` for the change.
- `opsx-pipeline-registry`: `pipeline resume` resolves run-state/portfolio-state from the work directory with change-dir fallback and reports the source location.
- `opsx-orchestration`: the LEAD playbook records run-state, the goal-loop run artifact, and worker handoff documents in the CLI-reported work directory.
- `workflow-handoff-command`: handoff documents, relay prompts, and the sessionHandoff run-state update target the work directory.
- `session-relay`: relay bootstrap reads the handoff distillate from the work directory.
- `opsx-ship-command`: `ship-log.md` is written to the work directory; pre-flight verification evidence is read from there (with fallback).
- `verify-ship-evidence`: `verification-report.md` and the test-evidence chain live in the work directory.
- `opsx-verify-enhanced-command`: report aggregation reads/writes work-directory report paths.
- `expert-dispatch-contract`: the canonical `<skill>-report.md` is written to the work directory.
- `opsx-retro-command`: retro reads ephemera from the work directory with legacy change-dir fallback.
- `opsx-archive-skill`: archive's verification and ship-log gates read from the work directory with fallback (archive timing/destination stay as-is — siblings own those).
- `goal-loop-workflow`: `goal-run.json` (the loop spine) lives in the work directory.

## Impact

- **New code**: a small change-work resolution helper in `src/core/` bridging planning-root resolution to the frozen `resolveProjectHome` API (probe-first, mint-once semantics).
- **CLI**: `src/commands/workflow/status.ts`, `src/commands/workflow/instructions.ts`, `src/commands/pipeline.ts`, `src/commands/context.ts`; run-state path resolution in `src/core/pipeline-registry/{run-state,portfolio-state}.ts`.
- **Templates**: ~15 files under `src/core/templates/{workflows,experts}/` (source of truth); `.claude/skills` and `.codex` are regenerated, keeping `skill-templates-parity` green.
- **Tests**: new unit tests for resolution/exposure/fallback; existing pipeline/status/instructions test updates.
- **Not in scope**: archive timing and destination (children 3/4), SHA cross-stamping (child 5), GC retention policy for swept work dirs (archive-time sweep is child 3/4; this change only guarantees work dirs live inside registered homes so the child-1 GC never treats them as orphans).
- **Coordination risk (shared working tree)**: a concurrent session has previously held uncommitted edits to several of the same template files (`_orchestration.ts`, `apply-change.ts`, `archive-change.ts`, `continue-change.ts`, `office-hours.ts`, `propose.ts`). As of proposal time `git status` on `src/core/templates/**` is clean, but apply MUST re-check `git status` on every template file immediately before editing and before every commit, edit only files clean of foreign modifications, commit with explicit pathspec (`git commit -- <paths>`), and wait or escalate if foreign dirt reappears.
