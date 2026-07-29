# Planning Context — ecp-custom-composite (ECP-2 Custom Composite Authoring & Runtime Parity)

> LEAD seed. Read FIRST, then research only what it doesn't cover. Append durable findings.
> This is slice **ECP-2** of the `executable-composite-pipelines` Direction, stacked on **ECP-1** (done on `feat/ecp-review-cycle`).

## User intent & scope

Continue the ECP program: deliver ECP-2 now. Branch `feat/ecp-review-cycle` already holds ECP-1 (ReviewCycle Vertical Closure, all 12 acceptance DONE, review-clean, full suite green). ECP-2 builds ON it.

**ECP-2 user result** (from roadmap): a user declares a constrained **Custom Composite** in the Canvas (inputs/outputs/outcome/limits/body), embeds it as a `CompositeRef` in a Pipeline, saves, and runs it through the SAME deterministic reconciler as built-ins.

## Authority (read these)
- Roadmap ECP-2 section: `rasen/work/issue-centered-automation-platform/executable-composite-pipelines/roadmap.md` (### ECP-2).
- Target state (Custom Composite parity, locked decisions): `…/executable-composite-pipelines/target-state.md`.
- Research (Composite domain model, compiler, canvas, migration): `…/executable-composite-pipelines/deterministic-pipeline-kernel-research.md`.
- ECP-1's proven patterns to REUSE: `rasen/changes/ecp-review-cycle/design.md` + the shipped code (`src/core/change-run/internal/review-cycle*.ts`, lowerer, runtime-plan, reconciler bounded-loop pass, projector review-cycle section, `plan.json` persistence, facade pre-commit validation).

## ECP-2 exit evidence (must prove)
1. A **non-built-in, Canvas-authored** Custom Composite completes real success + failure + recovery paths via the reconciler.
2. **Export → import** round-trip: semantic digest unchanged.
3. The custom Composite's compiled plan + runtime contract is **equivalent** to an isomorphic built-in fixture (built-in and custom use the SAME validate/lower/reconcile/persist/project).

## New complexity to prove
- Canvas **authoring** of Composite: declaration + body, port mapping, create/reference/fold/expand/edit/delete (ECP-1 only made BoundedLoop viewable + maxRounds configurable — authoring is NEW).
- Static validation: recursion, nested loop, general cycle, missing exit, illegal port, capability + budget overrun → fail closed at prepare/lower (Definition v2 already has static validators; extend for custom-authored shapes).
- Built-in ↔ custom isomorphism: no hidden privileged runtime path for built-ins; custom passes the same checks.
- Projection: root summary + composite drill-down from the SAME projector (one `ChangeRunView`).

## Locked decisions (do not violate)
One Run = one canonical Record; reconciler owns mechanics (no prompt-owned loops); fix in the canonical seam (no sibling runtime); built-in and custom isomorphic; top-level DAG + constrained Composite (reject general cycles/recursion/nested loops); plan frozen at run start. **Reuse the ECP-1 BoundedLoop/Composite kernel** — do not build a second runtime.

## Scope boundary
ECP-2 ONLY. Do NOT do GoalLoop (ECP-3), Choice/FanOut/Join/full-feature parallel (ECP-4), or product closure/release (ECP-5). Do NOT touch `auto-decompose`/Issue dispatch. Custom Composite is constrained (no recursive Composite, no nested loop, no user executable code) per target-state boundaries.

## Test baseline (current)
Full suite green (6149/0/33), tsc clean (state at end of ECP-1). Build before CLI tests (`node build.js`); CLI reads `dist/`. `provenance`/`canvas`/`position`/`sourcePath` are non-semantic canonicalization keys (ECP-1 finding).

## Delivery
Local commits on `feat/ecp-review-cycle` (stacked on ECP-1). Each task group → its own commit. Failure-first tests before happy-path.
