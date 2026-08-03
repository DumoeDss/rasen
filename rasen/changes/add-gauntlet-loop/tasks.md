## 1. Reference Bar and BarAdapter Seam

- [ ] 1.1 Define the `BarAdapter` interface (`inspect(target, workspaceTree) → InspectionResult`; `compare(candidate, reference) → { verdict, biggestGap, evidence }`) and the canonical reference-bar record/digest, with stable gauntlet error codes for missing/invalid/unprovable bars.
- [ ] 1.2 Implement the reference blind-A/B bar variant and its judge contract, slotted into GoalCycle's evaluate position the way task-loop slotted in task-specific judgment; prove a bar-reached judgment and an attestation-evidenced judgment are distinguishable sources.
- [ ] 1.3 Implement the v1 code/runnable inspector (resolving Open Question C4 provisionally: anonymized/shuffled artifact presentation and observable behavior/output as the blind axis); add cases for missing reference, non-runnable target, and stale evidence.
- [ ] 1.4 Freeze the bar in canonical launch inputs, thread it through `digestLaunchIntent`, and prove same-bar relaunch is idempotent while a changed goal/reference/Pipeline fails with `launch_request_conflict` without mutating the existing Run.
- [ ] 1.5 Reject an uninspectable or missing bar before work with a stable gauntlet code; prove Rasen does not substitute a subjective bar or start a spec workflow.

## 2. Convergence-Through-Judge Delivery and Backstop

- [ ] 2.1 Implement the convergence-judge Action: a fresh-session judge (subject to gauntlet's critic-reuse guard) that records an auditable satisfied result whose evidence is the user's convergence attestation, with satisfaction source identifiable as "user-converged via attestation" (not "bar reached").
- [ ] 2.2 Wire convergence satisfaction into the existing delivery guards so ship unlocks only after the convergence-judge and archive only after ship; prove no bypass terminal is introduced and the mechanical-trust invariant is preserved.
- [ ] 2.3 Implement the convergence-settle timeout: in-flight write Actions settle within the timeout, else the workspace is snapshotted at the last committed tree and uncommitted work is abandoned; test in-flight settle, timeout-snapshot, and convergence mid-wave.
- [ ] 2.4 Implement the backstop cap as suspend-and-prompt (preserve all committed work; never destroy); test expiry→suspend→resume and expiry→converge paths.
- [ ] 2.5 Enforce terminal honesty and non-conversion: cancelled/blocked/backstop-suspended records stay terminal, never convert to another Pipeline, and `--no-gate` cannot bypass gauntlet input/evidence/fresh-critic/blind-A/B/terminal/delivery guards.

## 3. Phase-0 Serial Foundation Loop

- [ ] 3.1 Implement the Phase-0 flat gauntlet loop: one builder/critic loop over the whole artifact against the reference bar, with the meta-critic performing blind A/B and returning the single largest gap.
- [ ] 3.2 Reuse GoalCycle's fresh-critic enforcement for the Phase-0 critic; prove a builder cannot authoritatively declare the bar met and that prior-critic-session and builder-as-critic completions are rejected.
- [ ] 3.3 Prove Phase 0 creates no runtime proposal/design/specs/tasks/goal-plan artifacts and that status reports phase, round, actors, evidence, budget, and the deterministic next action.

## 4. Wave Orchestration (gauntlet-wave Body Kind)

- [ ] 4.1 Add the `gauntlet-wave` bounded-loop body kind (alongside review-cycle/goal-cycle/composite) with its reconciler/progressor dispatch.
- [ ] 4.2 Spawn piece-loops as non-nested children reusing GoalCycle; prove the plan validates without `NESTED_LOOP` or `COMPOSITE_RECURSION`.
- [ ] 4.3 Implement parent/child piece-loop accounting via the Run action/DAG model (new; association-registry is not used); prove wave/piece state is queryable and resumable.
- [ ] 4.4 Model per-wave decomposition as replayable committed Actions (the ReviewCycle pattern); prove the sealed RuntimePlan digest is unchanged across waves and resume reconstructs wave structure from the event log.
- [ ] 4.5 Implement two-sub-phase wave staging: admit all piece-builders serially, then admit all piece-critics and the meta-critic together as read-only; prove critics are withheld until every piece in the wave is committed and that critic parallelism is realized under the single-writer lock.

## 5. Lead-Driven Phased Model and Decomposition

- [ ] 5.1 Implement the lead role (goal + bar + phase-transition decisions + per-wave one-level decomposition), with the lead's transition decision sovereign over the meta-critic's advisory signal; add the lead's internal skill contract.
- [ ] 5.2 Implement the Phase-0→Phase-1+ transition and per-wave one-level re-decomposition; prove pieces are never recursively decomposed into sub-pieces (one level only, re-applied each wave).
- [ ] 5.3 Add the optional fresh smoothing pass between waves; prove it runs in a fresh context over the whole artifact and does not redesign pieces.
- [ ] 5.4 Define a 1-piece decomposition as a no-op that stays in Phase 0; prove degenerate decomposition does not pay orchestration overhead.

## 6. Built-in Pipeline, Internal Skill, Registry, and Parity

- [ ] 6.1 Add `pipelines/gauntlet-loop/pipeline.yaml` (phased iterate→ship→archive, no ordinary gates, no planner/retain/spec stages) and the internal `rasen-gauntlet-loop` skill with the lead/builder/critic/meta-critic/smoothing contracts.
- [ ] 6.2 Register the pipeline and internal skill in the workflow-registry builtins (internal/non-user-invokable, parallel to rasen-task-loop); add `isInternalBuiltInWorkflowId` coverage so it never appears in profile roots.
- [ ] 6.3 Update the auto driver's explicit selectors, guidance, and dependency closure so `gauntlet-loop` is selectable, never classified, and materialized via the auto closure without being user-invokable.
- [ ] 6.4 Update generated-skill name/hash/parity lists and init/update materialization; prove source templates and generated content stay synchronized and that goal-loop/task-loop lowerings are unchanged.
- [ ] 6.5 Add execution preflight requiring canonical reconciler support (legacy/unsupported engine refuses with a localized `gauntlet_reconciler_required`-style code before any work is admitted).

## 7. Autopilot, Localization, and No-Gate

- [ ] 7.1 Add `rasen-auto` guidance for both explicit gauntlet-loop selectors, bar formation/display before launch, and the convergence attestation action; prove it creates no runtime planning artifacts.
- [ ] 7.2 Prove the built-in classifier never suggests gauntlet-loop and that manual/classify/compose defaults remain `small-feature`.
- [ ] 7.3 Integrate the no-gate policy with gauntlet observability: record the resolved policy, keep the loop uninterrupted, and prove no-gate cannot bypass any gauntlet guard.
- [ ] 7.4 Add English, Japanese, and Simplified-Chinese catalog entries for gauntlet input/bar, blind-A/B, critic-reuse, convergence, backstop, blocked/exhausted, and delivery diagnostics, with locale-key parity tests.

## 8. Canonical End-to-End, Resume, and Cross-Platform Verification

- [x] 8.1 Add a temp-repository end-to-end test for explicit gauntlet launch → Phase-0 foundation → lead-driven decomposition → per-wave serial-build/parallel-critic polish → meta-critic A/B → smoothing → user convergence → ship → archive, and the absence of runtime planning artifacts.
- [x] 8.2 Add resume/replay tests: interruption after a wave's decomposition, reconstruction from committed Actions with the sealed plan digest unchanged, same-bar reuse, changed-bar conflict, and no duplicate phase/piece admission.
- [x] 8.3 Add convergence-abort tests: in-flight settle within timeout, timeout-snapshot-and-abandon, backstop suspend→resume, backstop suspend→converge, and confirmation that non-converged/backstop-suspended records never ship or archive.
- [x] 8.4 Add parallelism tests proving piece-builders admit serially and piece-critics/meta-critic admit together only after the wave's pieces commit (under the single-writer lock).
- [x] 8.5 Add Windows-safe CLI and filesystem tests using temporary paths plus `path.join`/`path.resolve`, including paths with spaces/non-ASCII text and process invocation without POSIX redirection or separator assumptions.

## 9. Regression Gates

- [ ] 9.1 Run formatting/lint and TypeScript checks; focused pipeline-registry/workflow-template/change-run/CLI suites; the Windows-safe tests; and the full repository suite (or the accepted deterministic shard matrix); record exact commands and results under the change evidence directory.
