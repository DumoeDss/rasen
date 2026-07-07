# Review Report — goal-loop-core

**Reviewer:** reviewer-1 (role-isolated; did NOT write this code)
**Date:** 2026-07-08
**Base:** uncommitted working-tree changes on `dev-harness` (diff vs `HEAD` + untracked files)
**Design of record:** `openspec/changes/goal-loop/planning-context.md` (v4)
**Skill:** `openspec-review`

> NOTE: `.claude/skills/review/checklist.md` does not exist in this repo, so the
> embedded two-pass structure (Standards axis + Spec axis) from the skill text was
> used as the baseline, with planning-context.md as the Spec source of truth.

## Verdict

**No Blockers. No Majors.** The implementation faithfully conforms to the design
of record. Both intentional deviations are **SOUND** (justified by the
template-then-inject model + the strict run-time schema). One Minor fidelity gap
and two informational test gaps.

| Severity | Count |
|----------|-------|
| Blocker  | 0 |
| Major    | 0 |
| Minor    | 1 |
| Info     | 2 |

**Verification evidence:**
- `npx vitest run` on the 3 affected test files: **125/125 pass**
  (pipeline.test.ts 52, builtins.test.ts 36, skill-generation.test.ts 37),
  including the review-cycle canary at `pipeline.test.ts:74`
  (`{ kind: 'review-cycle', maxRounds: 3 }` byte-for-byte preserved).
- `npx tsc --noEmit`: **exit 0** — the discriminated union narrows cleanly; no
  consumer breaks.
- grep for `stage.loop` / `.loop.kind` consumers in `src/`: only
  `src/commands/pipeline.ts` (now narrows on `kind`) and the playbook prose —
  both updated. No `.loop?.kind === 'review-cycle'` narrowing existed elsewhere
  (confirms planning-context's grep-verified migration claim).
- All 3 goal-loop pipelines load, parse, validate, and are acyclic (builtins
  test). `listPipelines()` returns all three (registry auto-discovery confirmed
  at the code level the CLI calls; `dist` was stale so the raw CLI check was
  inconclusive, but the test exercises the identical `collectPipelineNames`
  path).

---

## Spec axis — conformance to planning-context.md

All hard requirements verified conformant:

- **`gate` is a required discriminated union, measure XOR evaluate, no
  combination.** `types.ts`: `gate: z.discriminatedUnion('kind', [measure,
  evaluate])`, **required** on the `goal` variant. Both gate variants are
  `.strict()`, so a measure gate carrying an evaluate-only field (`rubric`) is
  rejected — the "reject combination" test passes. ✓
- **Field name `loopStallLimit`.** Used consistently across types.ts,
  run-state.ts, _orchestration.ts, pipeline.ts. No `stallLimit` /
  `measureStallLimit` collision with `HandoffConfigSchema.stallLimit`. ✓
- **review-cycle shape byte-for-byte.** Canary green; parsed shape identical. ✓
- **Step L** (`_orchestration.ts`): every required element present and faithful:
  single-dispatch-per-round; warm-reused implementer across rounds (Tier A
  `SendMessage` same agentId); **FRESH reviewer ≠ implementer** for evaluate
  (author≠verifier); measure-failure branch (non-zero/timeout/unparseable →
  record error, treat not-passed, no deadlock); gate-neutral stall (score-favorable
  / gap-set-shrank, round 1 always progresses, `loopStallLimit` → Step H.5);
  precise resume (satisfied→tail / not-passed→lastRound+1 / no-record→round 1 /
  MAY re-run gate once); implementer inline + H.3 relay, no child subagents. ✓
- **research pipeline tail = `report`** (not ship/archive); **lower implementer
  threshold (0.35)** set via `handoff.roles.implementer`. ✓
- **Zero behavior change** to full/small/bug-fix + review-cycle: builtins +
  pipeline tests green, tsc clean. ✓

### The two intentional deviations — JUDGMENT: BOTH SOUND

The design uses a deliberate **two-tier validation model**: a *lenient* registry
schema (so the bare pipeline template `{ kind: measure }` / `{ kind: evaluate }`
validates) paired with a *strict* run-time `loopConfig` schema (the injected
config is validated on write). Both deviations are instances of this pattern:

1. **`superRefine` fires only when `command` is present** (types.ts). The design's
   original refine (`threshold===undefined && target===undefined` regardless of
   command) would **reject the bare registry template** that task 5.1 requires —
   a real conflict in the design as written. The implementer resolved it
   correctly: a measure gate *with a command* MUST have a stop condition (catches
   the would-deadlock case), while the commandless template is the injection
   point. At run-time, `loopConfig.gate.measure.command` is `z.string()`
   (**required**) — so a template that never gets injected fails loudly at the
   Inject step, not silently. The measure-failure branch backstops even a
   pathological commandless run. No hole. ✓
2. **`evaluate.goal` optional in the registry schema** (types.ts), required at
   run-time (`loopConfig.gate.evaluate.goal: z.string()`). Same two-tier pattern;
   the bare `{ kind: evaluate }` template validates, the LEAD injects
   goal/rubric from goal-plan.md, and the run-state schema enforces presence on
   injection. ✓

---

## Standards axis — findings

### [Minor] `timeoutSec` is collected in goal-plan.md but silently dropped at run-time

**Where:** `goal-plan.ts:42` (planner template invites setting `timeoutSec`);
`_orchestration.ts` Step L Inject ("copy `threshold`/`target`/`direction`" —
notably omits `timeoutSec`); `run-state.ts` `loopConfig.gate.measure` object
(has `command/threshold/target/direction`, **no `timeoutSec`**).

**Failure scenario:** A planner sets `timeoutSec: 30` in goal-plan.md for a fast
command. The LEAD reads goal-plan.md at Inject but the playbook only copies
threshold/target/direction; even if it tried to copy timeoutSec, the
`loopConfig.gate.measure` Zod object (default strip) would drop it. The gate
runner falls back to the playbook's hardcoded "default 120s". The configured
30s timeout is silently ignored; a hung command can run up to 90s longer than
intended.

**Why Minor, not higher:** Functional impact is bounded — the measure-failure
branch records any timeout as an error and treats the round as not-passed (no
deadlock, "never lie"). The default 120s is reasonable. This is a fidelity gap
(dead user-facing field), not a safety hole. Worth fixing before
goal-loop-validation's e2e timeout tests, or by adding `timeoutSec` to the
run-time `loopConfig.gate.measure` schema + the Inject copy list.

### [Info] Test gap — superRefine deviation boundary not locked in

The implementer's intentional leniency (a measure gate with a `threshold` but no
`command` validates) is not directly asserted. The suite covers the negative
(command present, no threshold → rejected) and the bare template (no command, no
threshold → valid), but not the `{ kind: measure, threshold: 90 }` (no command)
positive case. A regression test asserting that shape validates would lock in
the deviation's intent and protect it from a future "tighten the refine"
refactor. (`test/core/pipeline-registry/pipeline.test.ts`.)

### [Info] Test gap — no round-trip parse test for new run-state fields

`loopConfig` / `loopProgress` are additive optional fields under `.passthrough()`
so risk is low, but there is no test that a run-state JSON carrying these fields
round-trips through `parseRunState`/`readRunState` with the gate union intact
(e.g. a measure loopConfig with a missing required `direction` is rejected; an
evaluate loopConfig with a missing required `goal` is rejected — these enforce
the "strict run-time" half of the two-tier model that makes deviation #2 sound).
A small schema test would make that enforcement guarantee explicit.

---

## LLM prompt safety (goal-plan / goal-iterate / goal-report / goal-command)

These are instruction sets; checked for flat-hierarchy, handoff clause, and
injection/escape:

- **Flat-hierarchy enforced:** goal-iterate.ts "You NEVER spawn child
  subagents... Research is done by YOU inline"; goal-command.ts "Flat hierarchy.
  The implementer NEVER spawns child subagents." ✓
- **Handoff clause (H.3):** goal-iterate.ts has a full self-handoff section with
  the `HANDOFF { path, reason, completed, remaining }` return contract;
  goal-command.ts embeds `ORCHESTRATION_PLAYBOOK` (which defines Step H.3). ✓
- **"never lie about success":** enforced in both Step L and goal-report.ts
  (`outcome: maxRounds-exhausted`, "NEVER report success when the gate was never
  satisfied"). ✓
- **author≠verifier:** stated in goal-command.ts Termination Invariants and
  Step L. ✓
- **Injection/escape:** prompts are authored template literals interpolating only
  static constants (`STORE_SELECTION_GUIDANCE`, `ORCHESTRATION_PLAYBOOK`) — no
  untrusted/user input is interpolated into a codegen-time prompt. The task
  description flows to the LEAD at run time, not into these templates. No
  string-escaping issues. ✓
- **`measure.command` is arbitrary shell:** accepted risk (documented OQ1),
  mitigated by the define-goal stage's human `gate: true`. Non-goal for v1. Not
  a finding.

## Scope check

CLEAN. The diff is exactly the 9 modified + 7 new files in tasks.md. No scope
creep. Sibling untracked dirs (`openspec/changes/goal-loop/` = design source,
`goal-loop-validation/` = deferred e2e/docs change, `openspec/office-hours/` =
pre-existing per `git status`) are expected, not drift.

## Documentation staleness

None for this change's scope. User-facing docs and the v3→v4 update of
`openspec/office-hours/goal-loop-primitive.md` are explicitly deferred to
`goal-loop-validation`.

---

## Durable findings (codebase constraints discovered)

1. **Two-tier validation model.** Goal-loop establishes a pattern worth
   following for future loop/gate additions: *lenient* registry schema (bare
   template validates) + *strict* run-time `loopConfig` schema (injection
   validated on write). This is what makes optional-in-registry /
   required-at-runtime fields (measure.command, evaluate.goal) safe. Document
   this so the next variant doesn't accidentally collapse the two tiers.
2. **Loop execution semantics are playbook prose, not code.** Stall detection,
   resume, warm-reuse, and the per-round protocol live in the LEAD's
   interpretation of `_orchestration.ts` (Step L). The code provides schemas +
   run-state; the playbook is the contract. "Correctness" of the running loop is
   therefore validated via e2e (goal-loop-validation's scope), not unit tests —
   unit tests here can only prove parsing/registration/type-narrowing.
3. **`HandoffRolesSchema` values are bare threshold numbers**, not
   `{ threshold: N }` objects (types.ts:74-82). Design docs use loose
   `{ threshold: 0.35 }` notation, but the schema wants `implementer: 0.35`
   directly. The research YAML implements this correctly; future docs/tests
   should use the bare-number form.
