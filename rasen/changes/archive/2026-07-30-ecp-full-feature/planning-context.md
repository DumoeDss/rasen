# Planning Context — ecp-full-feature (ECP-4 Choice / FanOut / Join & full-feature)

> LEAD seed. Read FIRST. Slice **ECP-4**, stacked on ECP-1 (ReviewCycle) + ECP-2 (Custom Composite) + ECP-3 (GoalLoop), all done on `feat/ecp-review-cycle`. This is the HARDEST slice (parallelism + Join semantics).

## User intent & scope
The user runs `full-feature`: a **Choice** picks one legal conditional branch; **FanOut** runs parallel members under concurrency/budget limits; **Join** decides progression from required/optional/failed/cancelled members. Restart doesn't drift the ready-set; Join never re-consumes a result.

## Authority (read)
- Roadmap ECP-4: `rasen/work/issue-centered-automation-platform/executable-composite-pipelines/roadmap.md` (### ECP-4 — user result, new complexity, exit evidence).
- Target state (locked decisions; FanOut/Join finite/recoverable mechanics §3): `…/executable-composite-pipelines/target-state.md`.
- Research (parallel/barrier semantics, budget): `…/executable-composite-pipelines/deterministic-pipeline-kernel-research.md`.
- **REUSE the kernel**: ECP-1/2/3 shipped the BoundedLoop lifecycle (review-cycle/composite/goal-cycle body kinds), the reconciler's succeeded-set + admit + finish-guard, `buildAction` profilePath, projector additive sections, `plan.json` persistence. ECP-4 adds Choice/FanOut/Join as NEW runtime-node kinds (Definition v2 already declares them statically; the runtime must now EXECUTE them) — extend the same reconciler/projector/lowerer, do NOT fork.

## ECP-4 exit evidence (must prove)
A real Run covers: **parallel success** (all members complete → Join proceeds); **partial-failure recovery** (an optional member fails → Join proceeds/suppresses; a required member fails → Join fails closed); and **cancel/timeout**. After restart, the **ready-set doesn't drift** and **Join doesn't re-consume** a committed member result (idempotent). `full-feature` migrates to the reconciler (real Run).

## New complexity to prove
- **Choice**: condition evaluated once at runtime → select exactly one branch; the selection is PERSISTED in the Record (deterministic on replay); un-selected branches never execute.
- **FanOut**: a ready-set of members; admission respects **concurrency cap + budget** (how many admit concurrently); members are independent (separate workspaces/locks — recall the ECP-1 lesson: atomic + bounded-loop candidates merged into ONE `selectCompatibleAdmissions` to enforce the workspace lock — FanOut members must respect the same lock invariant).
- **Join**: a barrier over required vs optional members; semantics for member **succeeded / failed / cancelled / timed-out** → Join proceeds (all required succeeded), suppresses (optional failed), or **fails closed** (required failed). Idempotent: a committed member result is consumed once; restart re-derives Join state from plan+Record without re-admitting completed members.
- **Canvas parallel authoring**: declare FanOut/Join shapes with legality feedback (concurrency/budget bounds, required/optional flags); never mark an over-budget/illegal shape runnable.
- **Operations projection**: parallel frontier (which members ready/running/waiting), key blockers, Join state — from the one `ChangeRunView`.
- **Migrate `full-feature`** to the reconciler (real Run through Choice → FanOut → Join → tail).

## ⚠️ Apply the cross-layer + real-CLI lessons
- Wire ALL CLI-start gates for any new executable shape (analyzeReconcilerSupport, preflight, resolveRuntime/v2-cast, profile-resolver, lowerRuntimePlan, buildAction). 
- **Prove a REAL CLI Run early** (full-feature through Choice→FanOut→Join) — facade tests miss real-CLI crashes. Effect observation is kernel-internal (observeEffects before complete) — mirror the ECP-1/ECP-3 dogfood pattern.
- FanOut members + workspace lock: enforce single-writer per workspace across ALL concurrent admits (the ECP-1 Minor-2 lesson, now load-bearing).

## Locked decisions
One Run = one canonical Record; reconciler owns mechanics (NO prompt-owned parallel/barrier logic); fix in the canonical seam; top-level DAG + constrained structures (FanOut/Join are bounded, not arbitrary spawn); fail closed on partial failure; plan frozen. Built-in/custom isomorphic.

## Scope boundary
ECP-4 ONLY. No product closure/release (ECP-5), no auto-decompose/Issue dispatch, no recursive/nested parallelism, no user-provided executable code. `full-feature` migration is in scope; legacy engine path stays for un-migrated projects.

## Test baseline
Full suite green at end of ECP-3 (core 973/973; ~9 pre-existing Windows flakes in CLI-spawning/supervisor areas). Build before CLI tests. `provenance`/`canvas`/`position`/`sourcePath` non-semantic.

## Delivery
Local commits on `feat/ecp-review-cycle` (stacked on ECP-1+2+3). Per-group commits. Failure-first tests (required-failure → Join fail-closed; over-budget → reject) before happy-path.
