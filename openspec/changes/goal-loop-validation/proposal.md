## Why

`goal-loop-core` shipped the goal-loop mechanism (the `kind: goal` loop, the
measure/evaluate gate union, three backend pipelines, three skill templates, the
`/opsx:goal` entry, run-state additions, and unit tests for the schema/registry
surface) and archived it with its specs synced to canonical. But three things
are missing before the feature is genuinely shippable:

1. **Test-coverage gaps in the deterministic machinery.** goal-loop-core's unit
   tests cover the schema parse/narrow happy path and the `loopConfig` measure
   gate with `timeoutSec`, but leave several code-testable surfaces unexercised:
   `pipeline show` goal-loop gate rendering (`pipeline.ts:641` now emits
   `loop=goal[measure](max N, stall L)` with no command test), `loopProgress`
   round-trip (only `loopConfig` is round-trip tested), the evaluate-gate
   `loopConfig` variant, the `direction: lte` (smaller-is-better) measure path,
   the `target` (passed-count) stop condition, and the per-pipeline structural
   differences (research's `report` tail + 0.35 implementer threshold vs
   measure/evaluate's `ship`→`archive` tail with `model: sonnet`). These are all
   pure code with deterministic output — they belong in the vitest suite.
2. **No user-facing docs.** `docs/opsx-workflow-guide.md` has no goal-loop
   chapter; a user cannot discover `/opsx:goal`, the three backend pipelines, or
   the `goal-run.json` / resume model from the guide.
3. **A stale design doc.** `openspec/office-hours/goal-loop-primitive.md` still
   reads as the superseded v3 single-pipeline draft (combined measure+evaluate
   AND-semantics, conditional tail, generic iterate skill). It must be updated to
   the converged v4 design (single entry + LEAD-classified family of three
   homogeneous pipelines + implementer-inline+relay) so the design record matches
   what shipped.
4. **No way to validate the loop itself end-to-end.** The loop semantics (round
   protocol, stall detection, resume rules, measure-failure handling) live in the
   LEAD playbook as prose (`_orchestration.ts` Step L), not as executable code —
   so they are not vitestable. A human-driven (or future-harness-driven) runbook
   is needed to validate the loop actually behaves: run a throwaway measure task,
   observe rounds appending to `goal-run.json`, observe `maxRounds`-exhaustion
   marking, kill + `openspec pipeline resume` and confirm the resume branches.

## What Changes

- **Deterministic test gaps filled (scope A)** — additions to the existing test
  files (no new test files): `test/commands/pipeline.test.ts` gains goal-loop
  `pipeline show` display assertions; `test/core/pipeline-registry/run-state.test.ts`
  gains `loopProgress` round-trip, evaluate-gate `loopConfig`, `direction: lte`,
  and `target` stop-condition cases; `test/core/pipeline-registry/builtins.test.ts`
  gains per-pipeline structural assertions (research `report` tail + lowered
  implementer threshold; measure/evaluate `ship`→`archive` tail with
  `model: sonnet`). No duplication of goal-loop-core's existing cases.
- **Docs chapter (scope B.1)** — a new goal-loop chapter in
  `docs/opsx-workflow-guide.md` (a top-level section mirroring the existing §2/§3
  style): the `/opsx:goal` entry, LEAD classification keywords + explicit
  override, the three backend pipelines, the define-goal → iterate → tail flow
  for each, `goal-run.json`, the resume model, and a worked example each for
  measure / evaluate / research.
- **Office-hours doc updated to v4 (scope B.2)** — `openspec/office-hours/goal-loop-primitive.md`
  rewritten from the v3 single-pipeline draft to the converged v4 design: single
  user-facing entry, LEAD-classified family of three homogeneous pipelines (one
  gate type each), implementer-inline + H.3 relay for research (not a
  research-sibling), the gate-neutral `loopStallLimit`, and the
  `goal-run.json`-as-spine decision. Keeps the office-hours doc's narrative voice.
- **E2e validation runbook (scope C)** — a runbook (a doc, not a vitest) under
  the change directory that walks through validating the loop end-to-end: a
  sample measure task (a throwaway script that emits a `{score, passed}` JSON),
  `/opsx:goal measure ...`, observing rounds append to `goal-run.json`, observing
  `maxRounds`-exhaustion marking, kill + `openspec pipeline resume` exercising the
  satisfied / not-passed / no-record resume branches. This is the validation
  surface for the prose-driven loop behavior that vitest cannot reach.

Non-goals: re-testing what goal-loop-core already covered (schema parse/narrow,
builtins list/parse/validate, `loopConfig` measure `timeoutSec`, skill-generation
registration); changing any goal-loop mechanism code (this change adds tests +
docs only; if a test reveals a real defect, that defect is fixed in-place as a
minor correction, not a redesign); turning the prose loop semantics into
executable code.

## Capabilities

### New Capabilities

- `goal-loop-validation`: The validation + documentation layer for the goal-loop
  feature — the deterministic test-coverage contract for the machinery gaps
  goal-loop-core left, the user-facing docs chapter, the office-hours design-doc
  update to the converged v4, and the end-to-end validation runbook for the
  prose-driven loop behavior.

### Modified Capabilities

- `opsx-pipeline-registry`: `pipeline show` SHALL render goal-loop gate metadata
  in the human-readable stage meta line (measure → `loop=goal[measure](max N,
  stall L)`; evaluate → `loop=goal[evaluate](...)`), generalizing the existing
  review-cycle-only `loop=review-cycle(max N)` label. This behavior shipped in
  goal-loop-core but was not specified; this delta adds the requirement + display
  scenarios.

## Impact

- **Tests** (`test/commands/pipeline.test.ts`, `test/core/pipeline-registry/run-state.test.ts`,
  `test/core/pipeline-registry/builtins.test.ts`): new cases only; the existing
  goal-loop-core cases and the review-cycle / three-built-in-pipeline assertions
  stay green (zero regression).
- **Docs** (`docs/opsx-workflow-guide.md`): one new chapter appended; no existing
  chapter rewritten.
- **Design doc** (`openspec/office-hours/goal-loop-primitive.md`): rewritten in
  place to v4 (the file already carries a DRAFT v3; this converges it to what
  shipped).
- **Runbook** (`openspec/changes/goal-loop-validation/goal-loop-e2e-runbook.md`):
  one new doc artifact, consumed by humans / a future test harness.
- **No production code change** unless a new test exposes a genuine defect, in
  which case the fix is a localized correction to the goal-loop display or
  run-state code path (not a mechanism change).
