## Context

`goal-loop-core` (archived `2026-07-08-goal-loop-core`, specs synced to canonical)
shipped the goal-loop mechanism end to end: the `StageLoopSchema`
`kind: goal` discriminated-union variant with its measure/evaluate gate union,
the `loopConfig`/`loopProgress` run-state additions, Step L in the orchestration
playbook, the three backend pipeline YAMLs (`goal-loop-measure`,
`goal-loop-evaluate`, `goal-loop-research`), the three skill templates
(`openspec-goal-plan`, `openspec-goal-iterate`, `openspec-goal-report`), the
`/opsx:goal` entry (`openspec-opsx-goal` + the `OPSX: Goal` command template),
and unit tests for the schema/registry surface.

Its verify pass (durable findings) established a critical scoping fact: **the
goal-loop loop semantics — the round protocol, stall detection, resume rules,
warm-reuse, measure-failure handling — live in the LEAD playbook as prose**
(`_orchestration.ts` Step L), NOT as executable code. goal-loop-core correctly
shipped vitests only for the deterministic parts (schema parse/register/narrow,
`loopConfig` round-trip, pipeline DAGs, skill-template generation). The loop's
*behavior* is agent-driven and is not code-testable.

So `goal-loop-validation`'s realistic scope is NOT "deterministically test the
agent's loop behavior." It is three things, each grounded in what goal-loop-core
actually shipped vs. left uncovered.

### What goal-loop-core already tests (do NOT duplicate)

- `test/core/pipeline-registry/pipeline.test.ts`: goal loop with measure gate
  parses + narrows; evaluate gate parses; defaults (`maxRounds=5`,
  `loopStallLimit=2`, `runArtifact=goal-run.json`); measure gate with
  `threshold` + `direction: gte` + `timeoutSec` default; rejects measure gate
  missing both `threshold` and `target`; rejects a gate combining measure +
  evaluate fields; rejects unknown loop kind.
- `test/core/pipeline-registry/builtins.test.ts`: all three `goal-loop-*`
  pipelines list/parse/validate (load + reparse, acyclic, skills exist, requires
  resolve) and have a `goal` loop on their `iterate` stage.
- `test/core/pipeline-registry/run-state.test.ts`: `loopConfig` measure gate
  preserves a configured `timeoutSec` through parse; defaults `timeoutSec=120`;
  round-trips `timeoutSec` through write + read.
- `test/core/shared/skill-generation.test.ts`: the four skill templates
  (`openspec-goal-plan`, `openspec-goal-iterate`, `openspec-goal-report`,
  `openspec-opsx-goal`) and the `goal-command` command template are registered.

### The gaps this change fills

**A. Deterministic-machinery test gaps (code-testable, vitest):**
- `pipeline show` goal-loop display — `pipeline.ts:641` was generalized in
  goal-loop-core to emit `loop=goal[<gate-kind>](max N, stall L)`, but
  `test/commands/pipeline.test.ts` has no goal-loop display assertion. This is
  pure string-rendering code with deterministic output.
- `loopProgress` round-trip — run-state.test.ts covers `loopConfig` only;
  `loopProgress` (round, lastScore, measurePassed, evaluateSatisfied,
  stallStreak, historyRef) has no round-trip test.
- Evaluate-gate `loopConfig` — only the measure variant is round-trip tested.
- `direction: lte` — only `gte` is exercised (latency/memory "smaller-is-better"
  is untested).
- `target` (passed-count) stop condition — only `threshold` is exercised.
- Per-pipeline structural differences — builtins.test.ts asserts each pipeline
  "has a goal loop on iterate" but does NOT assert the tail divergence
  (research → `report` stage + 0.35 implementer threshold; measure/evaluate →
  `ship`→`archive` with `model: sonnet`).

**B. Docs:**
- No goal-loop chapter in `docs/opsx-workflow-guide.md` (the workflow guide has
  §2 autopilot, §3 per-stage commands; a user cannot discover `/opsx:goal`).
- `openspec/office-hours/goal-loop-primitive.md` is still the v3 single-pipeline
  draft (combined measure+evaluate AND-semantics, conditional tail, generic
  iterate skill) — superseded by the v4 family design that actually shipped.

**C. E2e validation runbook:**
- The loop's prose-driven behavior (rounds, stall, resume, measure-failure) is
  not vitestable. A runbook documents how a human (or future harness) validates
  it end-to-end with a throwaway measure task.

## Goals / Non-Goals

**Goals:**
- Fill every code-testable gap left by goal-loop-core, with zero duplication of
  its existing cases and zero regression to the three built-in pipelines or the
  review-cycle loop.
- Give users a discoverable, worked-example-rich goal-loop chapter in the
  workflow guide.
- Make the office-hours design doc match what shipped (v4).
- Provide a repeatable runbook for validating the prose-driven loop behavior.

**Non-Goals:**
- Re-architecting any goal-loop mechanism. If a new test exposes a genuine
  defect, the fix is a localized correction (e.g. a display-string or
  run-state-field fix), not a redesign — and it is called out explicitly.
- Turning the prose loop semantics (Step L) into executable code. The loop stays
  LEAD-driven; this change adds a runbook, not a runtime.
- Re-testing schema parse/narrow, builtins list/parse, `loopConfig` measure
  `timeoutSec`, or skill-generation registration (goal-loop-core owns these).

## Decisions

### D1 — Fill gaps in the existing test files, not new test files

**Decision.** Add cases to `test/commands/pipeline.test.ts`,
`test/core/pipeline-registry/run-state.test.ts`, and
`test/core/pipeline-registry/builtins.test.ts`. Do not create new test files.

**Rationale.** Each gap belongs to a file that already exists and already tests
the same surface — the display test belongs with the other `pipeline show`
tests; the run-state round-trip cases belong next to the existing `loopConfig`
block; the structural assertions belong next to the existing goal-loop builtins
block. New files would fragment coverage and obscure the "what's already tested
vs. what this change adds" boundary.

### D2 — A new `goal-loop-validation` capability holds the validation + docs contract

**Decision.** A new capability `goal-loop-validation` carries four requirements:
(1) the deterministic validation suite enumerates the gap cases the suite SHALL
cover; (2) the docs chapter deliverable; (3) the office-hours v4 update
deliverable; (4) the e2e runbook deliverable. A MODIFIED delta to
`opsx-pipeline-registry` adds the one genuinely unspecified behavior — the
`pipeline show` goal-loop display rendering.

**Rationale.** The test-gap cases mostly verify EXISTING requirements in
`goal-loop-workflow` / `opsx-goal-command` / `opsx-pipeline-registry` (the
behaviors are already specified; goal-loop-core just didn't test every variant).
Bundling the gap enumeration in one validation capability is clearer than
scattering MODIFY deltas across three capabilities for a handful of added
scenarios each. The `pipeline show` display is the exception: it is a real
behavior that shipped unspecified and belongs to `opsx-pipeline-registry`, so it
gets a proper MODIFY delta there.

**Alternative considered (rejected).** Scenarios added as MODIFY deltas onto
`goal-loop-workflow` (loopProgress / evaluate / lte / target) and
`opsx-pipeline-registry` (display). Rejected — it spreads a small validation
change across many files and makes the validation contract harder to find.

### D3 — The runbook lives in the change directory, not in docs/

**Decision.** The e2e runbook is written as
`openspec/changes/goal-loop-validation/goal-loop-e2e-runbook.md` (a change
artifact), not under `docs/`.

**Rationale.** The runbook is validation material for the prose-driven loop — it
documents how to exercise agent behavior that vitest cannot reach. It is not
end-user documentation (the user-facing surface is the docs chapter). Keeping it
in the change directory makes clear it is a validation artifact that accompanies
this change's archive; a future test harness can promote it if the loop ever
becomes code-driven. The office-hours doc and the docs chapter ARE user-facing,
so they live in their canonical locations.

### D4 — Office-hours doc is rewritten in place, not appended

**Decision.** `openspec/office-hours/goal-loop-primitive.md` is rewritten from
v3 to v4 in place (the file already carries a DRAFT v3 status header; this
converges it).

**Rationale.** The file is the design record for the goal-loop idea; leaving a
superseded v3 next to the shipped v4 would mislead. Rewriting in place preserves
the office-hours narrative voice (problem statement, what-makes-this-cool,
approaches considered) while updating the technical design to the family-of-three
+ implementer-inline reality. The planning-context already states it "supersedes
the older office-hours doc"; this change makes the doc itself reflect that.

## Risks / Trade-offs

- **[A new test could expose a real goal-loop-core defect]** → If so, the fix is
  a localized correction to the display string or run-state field, called out
  explicitly in the task and the ship log. This is a feature (the test did its
  job), not a scope expansion. The mechanism design is not revisited.
- **[The runbook is manual and could rot]** → The runbook is dated and references
  the concrete artifacts (`goal-run.json`, `openspec pipeline resume`) by name;
  if the loop becomes code-driven later, the runbook is promotable into an
  automated harness. For now, manual is the honest choice given the loop is
  prose.
- **[The docs chapter duplicates planning-context content]** → Intentional but
  scoped: planning-context is an internal portfolio artifact (not user-facing);
  the docs chapter is user-facing with worked examples and the `/opsx:goal`
  command surface. The chapter links to the design doc for depth, it does not
  reproduce the internal decomposition rationale.
- **[Updating the office-hours doc loses the v3 decision trail]** → The v3→v4
  delta is already captured in planning-context.md ("Converged architecture v4 —
  read carefully, this differs from the office-hours doc") and in goal-loop-core's
  design.md D1 (the three defects that killed v3). The decision trail survives in
  those two places; the office-hours doc itself should reflect what shipped.

## Migration Plan

1. Write the test-gap cases (scope A) and run `pnpm test`. If any case fails, the
   failure is a real defect — fix it in-place (localized), re-run.
2. Write the docs chapter (scope B.1), matching the existing §2/§3 style.
3. Rewrite the office-hours doc to v4 (scope B.2).
4. Write the e2e runbook (scope C).

**Rollback.** This change is tests + docs only. Reverting removes the new test
cases, the docs chapter, the runbook, and restores the office-hours v3 content.
No production-code rollback is needed unless a defect was fixed in step 1 (in
which case revert that fix together with its test).

## Open Questions

- **OQ1 — Should the runbook be promoted to `docs/`?** v1 keeps it in the change
  directory (validation artifact). Promote if a future change makes the loop
  code-driven and the runbook becomes an automated harness spec.
- **OQ2 — Display string format.** goal-loop-core shipped
  `loop=goal[measure](max N, stall L)`. This change tests that exact string; if
  the implementer finds a clearer format during test-writing, the format change
  is in-scope (it is a display detail, not a mechanism change) and the test
  asserts the chosen format.
