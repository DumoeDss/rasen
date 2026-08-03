# LEAD session handoff — add-gauntlet-loop (relay 1)

## Why this handoff
LEAD context reached 0.456 (of the 0.5 handoff threshold). Relay at a clean milestone boundary: the **flat-gauntlet core (apply task groups 1–3) is code-complete and LEAD-sanity-checked**. The formal verify + the remaining 6 groups are handed to a fresh LEAD with full context.

## Change & run state
- Change: `add-gauntlet-loop` (rasen/changes/add-gauntlet-loop/). Branch: `feat/add-task-loop-pipeline`.
- Pipeline: small-feature, driven as LEAD orchestration. Gate policy: off (project). Tier A (Claude native).
- Run-state: `.rasen/changes/add-gauntlet-loop/ephemera/auto-run.json` — propose done; apply in_progress (groups 1–3 done + verified-sane; groups 4–9 pending).
- Artifacts (proposal/design/specs/tasks) are complete and valid; source = approved office-hours design r3 (`rasen/design-docs/sayo-feat-add-task-loop-pipeline-design-20260803-022320.md`).

## Completed & verified-sane (groups 1–3 = flat-gauntlet core)
- `src/core/change-run/internal/gauntlet-bar.ts` — BarAdapter seam, reference bar record, gauntlet error codes, v1 code/runnable inspector, judge contract, launch-intent helpers.
- `src/core/change-run/internal/gauntlet-loop.ts` — convergence-through-judge, backstop-suspend, Phase-0 flat loop, `assertGauntletMayDeliver`, `projectGauntletSection`, `gauntletActionInput`, `writeGauntletReport`, `validateGauntletCompletion`.
- `src/core/change-run/internal/goal-cycle.ts` — **purely additive**: `'gauntlet'` added to the mode union in `decodeGoalCycleResult`/`applyGoalCycleEvent`/`reduceGoalCycleEvents`; reuses task-loop's field-stripping. strict/task-loop unchanged.
- Tests: `test/core/change-run/gauntlet-bar.test.ts` (50) + `gauntlet-loop.test.ts` (47) = 97, all green. `pnpm run build` green. Footprint confirmed purely additive (no other shared files touched).

## Durable findings from the implementers (load-bearing for groups 4–9)
1. Gauntlet slots into GoalCycle's evaluate position via `mode: 'gauntlet'`; the judge result carries extra fields (`satisfactionSource`, `verdict`, `biggestGap`, `attestation`, `evidenceDigests`) that the mode strips before the generic state machine sees `{contract, satisfied, gaps, criteria}`.
2. Two satisfaction sources are structurally distinguishable: `'bar-reached'` (verdict candidate/tie + zero gaps) vs `'attestation-evidenced'` (carries `ConvergenceAttestation`, allows unsatisfied criteria). The convergence-judge produces `'attestation-evidenced'`.
3. Launch-intent freezing is automatic via `inputs.gauntlet` in `digestLaunchIntent` — no change needed.
4. Subjective-bar rejection is two-layer (`decodeGauntletInput` + `assertGauntletBarInspectable`); GauntletInput is `strictObject` with no proposal/design/specs/tasks fields.
5. C4 (code blind-A/B) resolved provisionally: anonymize by stripping comments/imports + deterministic LCG-seeded shuffle of structural blocks; observable behavior/output is the primary axis, structural completeness the fallback; injectable `CodeInspectorPlumbing`.
6. **The integration wiring into facade-runtime/projector is the main remaining work (groups 4–6).** The module exports (`validateGauntletCompletion`, `assertGauntletMayDeliver`, `projectGauntletSection`, `gauntletActionInput`, `writeGauntletReport`) have signatures matching the task-loop integration pattern and drop into the same facade-runtime hooks (complete pre-commit validation, ship defense-in-depth, projector section, report regeneration).

## Next for the successor LEAD
1. **Formal verify (deferred):** run a fresh non-author review (`rasen-review`) over the groups 1–3 diff before building orchestration on the core. This was intentionally left for the fresh session.
2. **Continue apply (groups 4–9):**
   - **Group 4 — wave orchestration:** add the `gauntlet-wave` bounded-loop body kind (alongside review-cycle/goal-cycle/composite); spawn piece-loops as **non-nested children** (respect `NESTED_LOOP`/`COMPOSITE_RECURSION`); parent/child piece-loop accounting via the Run DAG (NOT association-registry); decomposition as **replayable committed Actions** (ReviewCycle model — sealed plan digest unchanged); **two-sub-phase staging** (all piece-builders serial → all critics + meta-critic admitted together read-only).
   - **Group 5 — lead-driven phased model:** lead role (goal+bar+phase-transition sovereign, meta-critic advisory) + per-wave one-level re-decomposition + optional fresh smoothing pass + 1-piece-decomposition = stay-Phase-0.
   - **Group 6 — pipeline/skill/registry/parity:** `pipelines/gauntlet-loop/pipeline.yaml`, internal `rasen-gauntlet-loop` skill (lead/builder/critic/meta-critic/smoothing), register in builtins (internal/non-user-invokable), auto dependency closure, init/update/parity, profile filtering, reconciler-required preflight.
   - **Group 7 — auto/localization/no-gate:** auto guidance + selectors, classifier never suggests, no-gate integration, en/ja/zh-cn diagnostics.
   - **Group 8 — E2E/resume/Windows:** temp-repo E2E (Phase0→decompose→parallel-critic→meta-critic→smoothing→converge→ship→archive, no spec artifacts), resume across waves (replay decomposition Actions, sealed plan intact), convergence-abort, parallelism, Windows-safe.
   - **Group 9 — regression gates:** build/lint/tsc, focused suites, full deterministic shard matrix; record evidence.
3. Then **verify → review-loop → ship → archive.**

## Hard constraints (must hold throughout — from design r3 + adversarial review)
- Convergence MUST flow **through the judge** (`'attestation-evidenced'` satisfaction) — no bypass terminal; mechanical-trust invariant preserved.
- Backstop = **suspend-and-prompt**, never destroy.
- Decompositions = **replayable committed Actions** (sealed plan never mutated).
- **Engine invariants not relaxed:** `COMPOSITE_RECURSION` (definition.ts:1071), `NESTED_LOOP` (definition.ts:1406), single-writer serialization (`selectCompatibleAdmissions`, reconciler.ts:1086-1101) → serial builders + parallel critics via two-sub-phase staging.
- gauntlet is one-level per-wave decomposition, NOT infinite nesting.
- Additive only — goal-loop/task-loop contracts unchanged.

## Branch / delivery caveat
gauntlet code is **uncommitted** on `feat/add-task-loop-pipeline` (task-loop PR **#132**'s branch). **#132 still awaits the user's merge for archive** (on-merge). At gauntlet ship: commit/push gauntlet **after #132 merges** (or from a branch off the #132 merge) so it doesn't ride into PR #132.

## Next entry point
Resume via `/rasen-auto` (reads `.rasen/changes/add-gauntlet-loop/ephemera/auto-run.json`) or `/rasen-apply-change add-gauntlet-loop`; this handoff doc is the distillate. Start by running the deferred formal verify on the groups 1–3 diff, then continue group 4.
