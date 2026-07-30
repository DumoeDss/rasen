# Planning Context — ecp-goal-loop (ECP-3 GoalLoop & Thin Entrypoints)

> LEAD seed. Read FIRST. Slice **ECP-3**, stacked on ECP-1 (ReviewCycle) + ECP-2 (Custom Composite), both done on `feat/ecp-review-cycle`.

## User intent & scope
GoalLoop is the **second real BoundedLoop consumer**. A user runs a **measure / evaluate / research** goal loop; the system deterministically drives it and can explain baseline, current result, threshold, remaining budget, and why it continues/completes/stalls/exhausts.

## Authority (read)
- Roadmap ECP-3: `rasen/work/issue-centered-automation-platform/executable-composite-pipelines/roadmap.md` (### ECP-3 — user result, new complexity, exit evidence).
- Target state (locked decisions, esp. §6 domain reducer vs generic loop lifecycle separation): `…/executable-composite-pipelines/target-state.md`.
- Research (loop lifecycle, goal domain): `…/executable-composite-pipelines/deterministic-pipeline-kernel-research.md`.
- **REUSE the now-proven BoundedLoop kernel** from ECP-1/ECP-2: `review-cycle.ts`/`review-cycle-runtime.ts` (the domain-reducer + adapter pattern to MIRROR for goal), the reconciler bounded-loop pass, `composite-runtime.ts` (projectCompositeBodyProgress shape), projector sections, `plan.json` persistence, facade pre-commit validation, and the cross-layer wiring lessons (analyzeReconcilerSupport + preflight + profile-resolver + buildAction — ALL gates).

## ECP-3 exit evidence (must prove)
1. At least one **measure/evaluate** AND one **research** real Run progress through multiple rounds + recovery + termination (complete / exhausted).
2. The legacy `goal-run.json` becomes ONLY a compatibility projection — it cannot back-drive a new Run. The authoritative loop spine is the canonical Record + projector.

## New complexity to prove
- **Three domain reducers** (mirror `review-cycle.ts`): Measure (score/threshold/direction/target), Evaluate (satisfied/gaps rubric), Research (document-refinement). Each is a pure event reducer with its own result contracts + Zod validation + fail-closed. Domain reducers stay SEPARATE from the generic loop lifecycle (locked decision §6) but share identity/limits/recovery/terminal mechanics.
- **Goal projection**: score/evaluation/gaps/stall/blocked/round/budget + report tail — a `goal/1` (or per-kind) projector section from the one `ChangeRunView`.
- **Generic loop lifecycle validation**: GoalLoop as the second consumer proves the BoundedLoop lifecycle (admit/round/cap/stall/recovery/terminal) is genuinely generic, not ReviewCycle-specific. If it isn't, FIX the common mechanics (don't fork).
- **Migrate the 3 goal built-ins** (`goal-loop-measure`, `goal-loop-evaluate`, `goal-loop-research`) to the reconciler (real Runs).
- **Thin the launchers**: `rasen-goal` → completion preset/launcher (no prompt-owned loop state); `rasen-auto` → selection/launch strategy only. The mechanical progression is owned by the reconciler.

## ⚠️ Apply the ECP-1/ECP-2 cross-layer lesson
Every new v2 executable shape (the goal BoundedLoop bodies) must pass ALL CLI-start gates: `analyzeReconcilerSupport` (include goal body stages), `preflightPreparedDefinitionExecution`, `resolveRuntime`/v2-cast, `resolveRuntimeExecutionProfile`, `lowerRuntimePlan`, `buildAction`. **Prove a REAL CLI Run early** — facade tests miss real-CLI crashes (the recurring lesson). Also recall: production capabilities have `inputs:[]` (port-validation boundary from ECP-2) — goal bodies may need legacy/compatible capabilities or connectionless bodies.

## Locked decisions
One Run = one canonical Record; reconciler owns mechanics (prompt/skill CANNOT own loop/round/budget — that's the whole point of ECP-3); fix in the canonical seam; domain reducer ≠ generic lifecycle (separate, sharing mechanics); plan frozen; built-in/custom isomorphic. Do NOT merge the goal domain reducer with the review domain reducer.

## Scope boundary
ECP-3 ONLY. No Choice/FanOut/Join/full-feature parallel (ECP-4), no product closure/release (ECP-5), no auto-decompose/Issue dispatch. `rasen-auto` thins to selection/launch but does NOT become Issue dispatch.

## Test baseline
Full suite green at end of ECP-2 (6181/0/33), root + UI tsc clean. Build before CLI tests. `provenance`/`canvas`/`position`/`sourcePath` non-semantic.

## Delivery
Local commits on `feat/ecp-review-cycle` (stacked on ECP-1+ECP-2). Per-group commits. Failure-first tests before happy-path.
