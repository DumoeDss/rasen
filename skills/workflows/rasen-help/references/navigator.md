<!-- adapted from mattpocock/skills (MIT, Copyright Matt Pocock) -->

# Rasen navigator

Read this map for broad cross-workflow, expert-selection, scope-control, or “which route?” questions. Return one next action; `rasen-help` routes but does not run the selected workflow.

## Main flow: idea → ship

`rasen-auto` can drive the whole flow with a selected pipeline and role-isolated stages. Reach for individual steps when the user wants manual control.

1. **`rasen-explore`** — think through an uncertain design without production implementation; its bundled prototype branch may answer one stuck question with disposable code.
2. **`rasen-propose`** — create proposal, design, specs, and tasks; its bundled codebase-design branch shapes design-dense modules and interfaces.
3. **`rasen-apply-change`** — implement and check off tasks; its bundled TDD branch runs agreed red → green vertical slices.
4. **`rasen-review-cycle`** — review, triage, fix, and re-review until clean or escalated. Use `rasen-verify-change` for artifact consistency or `rasen-verify-enhanced` for deeper expert passes.
5. **`rasen-ship`** — resolve pr / push / local delivery, run only evidence-required checks, and deliver.
6. **`rasen-retain`** — apply the selected report, codify, or off retention policy.
7. **`rasen-archive-change`** — reconcile the shipped delta into durable specs and archive the decision history.

`rasen-retro` is a temporary user-invoked compatibility alias for retain report mode, not a separate profile route.

## On-ramps

- **`rasen-office-hours-command`** — pressure-test demand before design when value is the open question.
- **`rasen-investigate`** — reproduce and isolate a bug; it refuses to hypothesise before a red-capable feedback loop exists.
- **`rasen-direction`** — optional establish/select/project/reconcile governance for work spanning multiple Changes, versions, horizons, or projects. It is never a required numbered step in daily Change flow.
- **`rasen-goal`** — bounded iteration toward one measure, evaluation rubric, or research gate; unlike Direction's cross-Change Target State, it ends at one explicit gate.

## Vocabulary layer

For a new module or non-trivial interface, use `rasen-propose`'s bundled codebase-design reference: module, interface, depth, seam, adapter, leverage, and locality. For test-first work, use `rasen-apply-change`'s bundled TDD reference. For a bounded throwaway probe, use `rasen-explore`'s prototype reference.

## Standalone specialists

- **`rasen-review`** — two-axis Standards + Spec review of a branch or PR.
- **`rasen-qa`** — real-browser QA; default standalone mode may fix and re-verify, while report-only/non-UI mode never edits and still writes `qa-report.md`.
- **`rasen-design-review`** — rendered UI design audit and standalone fix loop.
- **`rasen-design-consultation`** — establish a design system collaboratively.
- **`rasen-benchmark`** — compare repeatable performance and size measurements with budgets.
- **`rasen-cso`** — adversarial security review.
- **`rasen-codex`** — independent second opinion or bounded parallel implementation.
- **`rasen-chrome-use`** — drive real Chrome through the CDP proxy at `localhost:3456` with existing login state.
- **`rasen-workflow-author`** — stage and validate workflow or pipeline packages, then use its bundled independent-review branch before optional import.

## Scope and safety

- Use **`rasen-careful`** before destructive commands such as recursive deletion, `DROP TABLE`, or force-push.
- Use **`rasen-investigate`** to declare an evidence-backed affected area and justify expansion.
- Use review or verification to inspect the actual changed-file set and diff before delivery.
- Managed sandbox/workspace policy is execution containment; scope declaration and diff review are evidence disciplines, not mechanical write denial.
