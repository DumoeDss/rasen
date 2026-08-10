## 1. Canonical Task Contract and Launch Identity

- [x] 1.1 Add `task-loop` contract tests and implement the internal TaskLoop decoder for `task-loop-input/1`, covering required goal/targets/bar, unique criterion IDs, evidence hints, constraints, stable error codes, and frozen return values.
- [x] 1.2 Validate local artifact targets against the authorized project root with Node path APIs, and add cross-platform cases for spaces, non-ASCII names, absolute/relative paths, and workspace escape rejection.
- [x] 1.3 Add a hidden UTF-8 input-file bridge to the existing `rasen pipeline start` path, parse it before launch side effects, and thread the same canonical inputs through `prepareRuntimeContext` and `StartChangePipeline` without adding a command or user-invokable skill.
- [x] 1.4 Replace the CLI's launch-key-only digest with `digestLaunchIntent({ pipeline, engine, inputs })`, preserving backward-compatible empty-input behavior and testing deterministic key-order normalization.
- [x] 1.5 Make facade start compare a requested launch digest with an existing Run before returning `reused`; prove identical task input is idempotent and changed input/Pipeline fails with `launch_request_conflict` without mutating the record.

## 2. GoalCycle Reuse and TaskLoop Guards

- [x] 2.1 Change v1 goal-loop normalization to lower the stage's declared skill capability instead of hard-coding `rasen-goal-iterate`, and add regression snapshots proving all existing goal Pipelines lower exactly as before.
- [x] 2.2 Enrich reconciler action input only for the built-in task-loop identity: work receives the frozen contract and prior largest gap/pass condition, while judge receives the contract and real targets/evidence but no builder reasoning or summary.
- [x] 2.3 Add TaskLoop completion validation that rejects a judge matching the round builder and rejects every prior task-loop critic identity, with focused canonical event replay tests for first and later rounds.
- [x] 2.4 Validate that each critic result covers the frozen criterion IDs exactly once, binds raw evidence to real targets, and rejects omitted, added, duplicate, or summary-only evidence with stable task-loop codes.
- [x] 2.5 Enforce satisfaction consistency (all criteria true and zero gaps) and unsatisfied-result focus (one largest material gap plus an explicit testable pass condition), without changing generic evaluate behavior for other GoalCycles.
- [x] 2.6 Add task-loop terminal reconciliation and delivery guards so only valid `satisfied` unlocks the tail; failed/blocked, exhausted, cancelled, and explicit-stop records remain terminal/escalated and never admit ship or archive.
- [x] 2.7 Add the task-loop status/view projection with contract digest, safe contract fields, round/phase/budget, actor lineage, criterion/raw evidence, largest gap/pass condition, stall state, outcome, and deterministic next action.
- [x] 2.8 Project a digest-stamped `task-loop-report.md` into the resolved evidence directory from committed canonical events, and prove absent/stale/edited projections cannot back-drive status, satisfaction, or delivery.

## 3. Built-in Pipeline and Internal Workflow

- [x] 3.1 Add the internal `rasen-task-loop` workflow template with phase-specific builder and critic instructions modeled on Gauntlet: real-artifact inspection, no builder self-pass, fresh critic context, one-gap feedback, and structured canonical completions.
- [x] 3.2 Add `pipelines/task-loop/pipeline.yaml` with only the evaluate GoalCycle iterate stage followed by existing ship and archive stages, no planner/retain/spec stages, no ordinary Pipeline gates, and a `task-loop-run.json` compatibility projection name.
- [x] 3.3 Cover task-loop Registry list/show/validation/profile resolution and execution preflight, including reviewer/read-only judge binding, implementer/write work binding, stage dependency order, and reconciler-required refusal before work.
- [x] 3.4 Export/register the internal template and update the auto driver's explicit workflow/skill/Pipeline dependency closure so every declared built-in dependency resolves without making `rasen-task-loop` user-invokable.
- [x] 3.5 Update explicit generated-skill name/hash/parity lists and init/update materialization, with parity tests proving source templates and generated `rasen-auto`/internal task-loop content stay synchronized.

## 4. Autopilot, Delivery, and Localization

- [x] 4.1 Update `rasen-auto` guidance to accept both explicit task-loop selectors, form and display the frozen contract before launch, write only the ephemera input bridge, and create no runtime proposal/design/specs/tasks/goal-plan artifacts.
- [x] 4.2 Add auto-template tests proving explicit selection bypasses classification, the built-in classifier never suggests task-loop, manual/classify/compose defaults remain unchanged, and no terminal task-loop branch converts or falls back to a spec Pipeline.
- [x] 4.3 Integrate the existing no-gate policy with task-loop observability and tests: record the resolved policy, keep the three-stage Pipeline uninterrupted, and demonstrate that no-gate cannot bypass input, evidence, safety, terminal, ship, or archive guards.
- [x] 4.4 Update ship/archive guidance and tests to consume the canonical satisfied task-loop evidence/report while preserving existing behavior for missing proposal, tasks, and delta specs and refusing every non-satisfied outcome.
- [x] 4.5 Add English, Japanese, and Simplified-Chinese catalog entries for task-loop input, bar, critic, launch-conflict, reconciler-required, blocked, exhausted, and delivery-guard diagnostics, with locale-key parity tests.

## 5. Canonical End-to-End and Cross-Platform Verification

- [x] 5.1 Add a temp-repository reconciler end-to-end test for explicit task-loop launch, material builder completion, fresh evidenced critic satisfaction, ship, archive, and the absence of runtime planning artifacts.
- [x] 5.2 Add end-to-end replay/resume tests for interruption after work and judgment, same-input reuse, changed-input conflict, critic replacement, and no duplicate phase admission.
- [x] 5.3 Add terminal end-to-end tests for false satisfaction, bar mismatch, summary-only judgment, blocked/failed phase, repeated unsatisfied rounds to exhaustion, user cancellation, and confirmation that ship/archive are never admitted.
- [x] 5.4 Add Windows-safe CLI and filesystem tests using temporary paths plus `path.join`/`path.resolve`, including paths with spaces/non-ASCII text and process invocation without POSIX redirection or separator assumptions.

## 6. Regression Gates

- [x] 6.1 Run formatting/lint and TypeScript checks, focused Pipeline Registry/workflow-template/change-run/CLI suites, the Windows-safe tests, and the full repository test suite; record exact commands and results under the change evidence directory.
