# Review Report — goal-loop-validation

**Reviewer:** reviewer-1 (role-isolated; did NOT write this code)
**Date:** 2026-07-08
**Base:** uncommitted working-tree changes on `dev-harness` (diff vs `HEAD` + untracked files)
**Skill:** `openspec-review`

> NOTE: `.claude/skills/review/checklist.md` does not exist in this repo, so the
> embedded two-pass structure (Standards axis + Spec axis) from the skill text was
> used as the baseline. The change's own `proposal.md` / `tasks.md` are the Spec
> source of truth. `goal-loop-core` (the feature implementation) is archived; this
> change is its validation layer (tests + docs + runbook), so the spec axis is
> evaluated against what `goal-loop-core` shipped + this change's stated scope.

## Verdict

**No Blockers. No Majors.** The validation layer is sound: tests assert
meaningful behavior against the real shipped code, the docs §9 chapter is
accurate, and the runbook is honest about what is prose-driven vs code-tested.
One Minor doc-accuracy gap (stale code block in the office-hours v4 rewrite) and
one Trivial runbook nit.

| Severity | Count |
|----------|-------|
| Blocker  | 0 |
| Major    | 0 |
| Minor    | 1 |
| Trivial  | 1 |

**Verification evidence:**
- `node build.js` then `npx vitest run` on the 3 affected test files:
  **120/120 pass** (pipeline.test.ts, builtins.test.ts, run-state.test.ts),
  including the 3 new `pipeline show` display tests, 6 new run-state cases,
  and 5 new builtins tail-structure cases.
- Every test assertion cross-checked against the real shipped code:
  - `src/commands/pipeline.ts:646` emits
    ``loop=goal[${gate.kind}](max ${maxRounds}, stall ${loopStallLimit})`` —
    the asserted `loop=goal[measure](max 5, stall 2)` /
    `loop=goal[evaluate](max 5, stall 2)` match the format string + the
    registry-schema defaults (`maxRounds.default(5)`, `loopStallLimit.default(2)`
    in `types.ts:223,229`) since the YAMLs declare only `gate: { kind: ... }`.
  - The 3 pipeline YAMLs confirm the tail assertions: measure/evaluate end in
    `ship` → `archive` (each `model: sonnet`); research ends in a single `report`
    stage (`openspec-goal-report`).
  - `resolveStageHandoffConfig` (`types.ts:431-465`) returns
    `{ threshold, source }` with `source: 'role'` when
    `pipelineHandoff.roles[<role>]` is set — research YAML has
    `handoff.roles.implementer: 0.35` → asserted `threshold 0.35 / source 'role'`;
    measure/evaluate have no handoff config → asserted `threshold 0.5 / source 'default'`.
  - run-state `loopConfig`/`loopProgress` schema (`run-state.ts:139-177`) accepts
    every shape the new round-trip tests write (evaluate gate, `direction: 'lte'`,
    `target`-only measure gate, both loopProgress variants).
- `_orchestration.ts` Step L cross-checked: single-dispatch warm-reused
  implementer, record shape, stop/stall/resume rules, and the research
  `threshold: 0.35` inline-relay decision all match docs §9 and the runbook.

---

## Scope check

CLEAN. This change fills gaps left by `goal-loop-core`; it does not duplicate
core's tests:
- **Display string** — core generalized `pipeline.ts` but shipped no command test
  for the goal-loop label; these 3 tests assert the exact format + a review-cycle
  regression guard.
- **Tail structure** — core asserted each pipeline "has a goal loop on iterate"
  but not the structural tail divergence; these 5 tests pin ship→archive vs
  report + the handoff-threshold contrast.
- **run-state variants** — core round-trip-tested the measure `gte` + `threshold`
  + `timeoutSec` path only; these 6 cases cover evaluate-gate, `direction: lte`,
  `target` stop-condition, both `loopProgress` variants, and backward-compat.
- **Docs §9 + office-hours v4 + runbook** — explicitly deferred to this change by
  `goal-loop-core`'s proposal/tasks.

The sibling working-tree changes (archive move of `goal-loop-core/`, spec syncs
to `openspec/specs/*`) are the expected archive consequences, not scope creep.

---

## Spec axis — does the validation match what was asked for?

The change's `proposal.md`/`tasks.md` ask for: (a) the 3 display tests, (b) the
6 run-state cases, (c) the 5 builtins tail-structure cases, (d) the docs §9
chapter + §2.2 rows, (e) the office-hours v3→v4 rewrite, (f) the e2e runbook.
All six deliverables are present and verified above. No requirements missing; no
scope creep.

---

## Standards axis — findings

### [Minor] office-hours v4 doc schema code block is stale vs the shipped two-tier model

**Where:** `openspec/office-hours/goal-loop-primitive.md:92-116` — the inline
`StageLoopSchema` code block.

**The divergence.** The doc header claims "v4 (converged — matches shipped
design; see planning-context.md)", but the code block shows:
- `command: z.string().min(1)` (required) — shipped `types.ts:201` is
  `command: z.string().min(1).optional()` (optional in registry).
- `goal: z.string().min(1)` (required) — shipped `types.ts:214` is
  `goal: z.string().min(1).optional()`.
- A `superRefine` that fires whenever `threshold === undefined && target === undefined`
  (regardless of `command`) — shipped `types.ts:240-244` guards on
  `s.gate.command !== undefined` first.

**Failure scenario.** A reader copies the code block literally and gets a schema
that **rejects the shipped bare pipeline templates** (`gate: { kind: measure }`
with no command), because the block's command is required and its superRefine
fires on the commandless template. The doc's own §1 prose (lines 118-121)
correctly describes the two-tier model ("measure.command 注册时可选、运行时必填"),
so the prose is right — only the code block is stale.

**Why Minor, not higher:** This is a design-consultation artifact, not code or
the authoritative spec (`openspec/specs/opsx-pipeline-registry/spec.md` is
correct, and `types.ts` is correct). Impact is limited to a reader who trusts the
illustrative block over the prose. Fix: update the block to match `types.ts`
(`.optional()` on command/goal, add the `command !== undefined` guard to the
superRefine) so the "matches shipped design" header is literally true.

### [Trivial] runbook measure.sh comment says "climbs one point per run" but climbs 3

**Where:** `goal-loop-e2e-runbook.md:29-30` comment vs line 37 `next=$(( n + 3 ))`.

The script increments by 3 each run (80→83→86→89→92), not 1. The block above it
says "The exact script does not matter", so this has no behavioral impact — a
reader who adapts the script won't be misled on anything load-bearing. Cosmetic.

---

## Test correctness — detailed assessment (no findings, evidence recorded)

The new tests are NOT tautologies; each asserts a real property against shipped code:

- **Display tests** assert exact substrings produced by `pipeline.ts:646` with
  real schema defaults — a regression that flipped the `loop.kind` branch or
  changed the bracket format would fail them. The review-cycle regression guard
  (`loop=review-cycle(max 3)` on small-feature, and `loop=goal[` absent) is real:
  it pins that the goal-loop generalization left the review-cycle display path
  byte-for-byte intact.
- **run-state round-trips** write a specific gate shape, read it back, and assert
  field presence + TypeScript narrowing (the `if (...gate.kind === 'evaluate')`
  branch). They prove the strict run-time `loopConfig` schema preserves
  evaluate/lte/target variants — the half of the two-tier model that makes
  optional-in-registry fields safe.
- **builtins tail tests** assert concrete last/second-last stage IDs + `model`
  values + handoff-threshold `source`, exercising `resolveStageHandoffConfig`
  end-to-end against the real YAMLs.

## Doc accuracy — §9 chapter (no findings)

`docs/opsx-workflow-guide.md` §9 cross-checked against shipped code:
- §9.1 classification keywords + ambiguous-defaults-to-evaluate match
  `goal-command.ts:39-42` verbatim.
- §9.1 table tails (measure/evaluate → ship→archive; research → report) match the
  3 pipeline YAMLs.
- §9.2 flow (define-goal `gate: true`, warm-reused implementer, evaluate =
  fresh reviewer ≠ implementer) matches Step L (`_orchestration.ts:115-122`).
- §9.4 bounds (`maxRounds` default 5, `loopStallLimit` default 2, gate-neutral
  stall) match `types.ts:223,229` defaults.
- §9.5 resume table (satisfied→tail / not-passed→lastRound+1 / no-record→round 1)
  matches Step L (`_orchestration.ts:128-132`).
- §9.6 research worked example cites the lowered 0.35 threshold — confirmed in
  YAML + tested.

## Runbook correctness (no findings beyond the Trivial nit)

The runbook is honest and runnable:
- The "Why this is a manual runbook" section correctly states loop semantics live
  in playbook prose, not executable code, and that `goal-loop-core`'s vitests
  cover only deterministic machinery. This is accurate.
- Scenario A (happy path) record shape and score progression match the script
  logic + the spec's record fields.
- Scenario B (maxRounds exhaustion) correctly uses `GOAL_CEILING` below threshold
  to make the gate unreachable, and asserts `outcome: maxRounds-exhausted` honesty.
- Scenario C (failure branch) correctly injects a non-zero exit / bad JSON and
  asserts the `error` field + no-deadlock.
- Scenario D.1/D.2/D.3 resume branches map 1:1 to Step L's three resume cases.
- The throwaway measure script is bash; the runbook notes "A Node script or a
  one-liner works equally well", so portability to the Windows-primary dev box is
  addressed (the repo's Bash tool / Git Bash runs it directly).

---

## Durable findings

1. **Validation-layer tests can only cover deterministic surfaces.** The
   goal-loop's *behavior* (round protocol, stall detection, resume, exhaustion
   honesty) lives in LEAD playbook prose (`_orchestration.ts` Step L), not code.
   `goal-loop-validation` correctly draws this line: vitests for the
   deterministic machinery (display string, tail structure, schema round-trip),
   and a manual runbook for the behavioral surface. If the loop ever becomes
   code-driven, the runbook is the promotable harness spec. Future changes
   adding loop *kinds* should mirror this split.

2. **The two-tier validation model is now load-bearing for docs.** The
   office-hours v4 code-block staleness (the Minor finding) is a symptom: design
   docs that inline the registry schema must reflect the lenient-registry /
   strict-runtime split, or they mislead. `goal-loop-core`'s review already
   documented this pattern; the office-hours rewrite missed updating its block.
   Worth a one-line note in the doc convention that inline schema blocks should
   be copied from `types.ts`, not retyped from memory.
