# Task Loop (`task-loop`)

Task Loop is Rasen's **explicit-only, spec-free autonomous pipeline** for small,
direct implementation work. It runs a role-separated builder/critic loop over your
*real* artifacts against a frozen, evidence-backed quality bar, and ships only when
that bar is mechanically satisfied — without producing the proposal/design/spec/task
artifacts that the spec-driven pipelines generate.

> When you want a change reviewed against a spec and a design, use `small-feature`,
> `bug-fix`, or `full-feature`. When the work is a focused implementation task and the
> spec lifecycle would cost more than the work, use `task-loop`.

## When to use it — and when not to

**Use `task-loop` for** focused, directly-verifiable implementation tasks:

- Fix a specific defect with a reproducible check.
- Implement a small feature whose "done" can be expressed as concrete, inspectable
  evidence (a passing test, a rendered output, a measurement, a file that exists and
  behaves a certain way).
- Refactor with an observable behavior-preservation guarantee.

**Do NOT use `task-loop` for** work that genuinely needs a design and a contract:

- Anything where the *requirements themselves* need proposing, reviewing, or
  decomposing before implementation is safe.
- Cross-cutting changes that must be reviewed against a written spec/delta.
- Work where "done" cannot be reduced to inspectable evidence against real artifacts.

`task-loop` is **never selected automatically.** The classifier never suggests it,
`small-feature` remains the default, and a terminal `task-loop` outcome never
converts, upgrades, or falls back to a spec-driven pipeline.

## Starting a task loop

Exactly two explicit forms select it (both are equivalent):

```bash
rasen-auto task-loop <task description>
rasen-auto --pipeline task-loop <task description>
```

The leading `task-loop` selector token (or `--pipeline task-loop`) is stripped; the
remainder is the task description. Classification is not consulted, and the
selection-policy flags (`--auto-select`, `--auto-compose`) have no effect.

### The frozen task contract

Before any builder is admitted, the auto driver freezes a **task contract** that
becomes the run's source of truth (replacing `proposal.md`/`design.md`/`specs/`/
`tasks.md`/`goal-plan.md` for this lifecycle):

```json
{
  "format": "task-loop-input/1",
  "goal": "the observable result to produce",
  "artifactTargets": ["workspace-relative path", "https://url", "runtime:name"],
  "bar": [
    {
      "id": "stable-kebab-id",
      "criterion": "a directly checkable pass condition",
      "evidenceHint": "the file/command/render/measurement that proves it"
    }
  ],
  "constraints": ["scope, platform, safety, or format constraint"]
}
```

Rules the contract must satisfy (enforced before work begins):

- **`goal`** — non-empty, the observable result you want.
- **`artifactTargets`** — at least one real target. Local paths resolve against the
  project root with platform path APIs and **must stay inside the authorized
  workspace** (symlinks/junctions/reparse points that escape are rejected). URLs and
  `runtime:` targets stay opaque to the core and are inspected by the assigned tools.
- **`bar`** — at least one criterion; every criterion has a unique stable `id`, a
  directly-checkable `criterion`, and a concrete `evidenceHint`. An empty or
  unprovable bar is rejected — the driver does **not** substitute subjective
  adjectives ("clean", "well-tested") for a real bar.
- **`constraints`** — scope/platform/safety/format limits.

The contract is written to `<ephemeraDir>/task-loop-input.json` and the canonical
Run is launched with `rasen pipeline start <change> task-loop --input-file
"<ephemeraDir>/task-loop-input.json"`. The contract participates in launch identity
and **never changes** for the life of the Run.

### Writing a good bar

The bar is the loop's definition of done. The quality of a task-loop run is bounded
by the quality of its bar.

- Make each criterion a single, directly-checkable condition, not an aspiration.
- Name the concrete evidence in `evidenceHint`: a test that passes, a command whose
  output matches, a file whose contents/shape you can read, a render you can compare.
- Prefer fewer, sharper criteria over many vague ones. The critic returns only the
  **single largest remaining gap** each round, so a crisp bar keeps the loop focused.
- Targets with spaces or non-ASCII characters are fine on Windows; paths are resolved
  with platform APIs, never shell redirection.

## The lifecycle

A task-loop Run is three uninterrupted stages:

```
iterate [bounded build → fresh-critic loop] → ship → archive
```

- **`iterate`** — a bounded goal-cycle loop. Each round has two phases:
  - **work (builder)** — an implementer edits the real artifact targets, runs the
    smallest direct checks, and returns material before/after workspace revisions
    plus raw evidence. The builder **cannot declare the bar satisfied** — its
    completion claims are non-authoritative.
  - **judge (fresh critic)** — a reviewer, *distinct from the builder and from every
    prior round's critic*, independently inspects the real artifacts/evidence and
    returns a structured judgment covering every frozen criterion exactly once.
- **`ship`** — admitted only after a mechanically valid `satisfied` judgment.
- **`archive`** — admitted only after successful ship.

What is **not** created: no `proposal.md`, `design.md`, `specs/`, `tasks.md`,
`planning-context.md`, or `goal-plan.md`. The Change is used only as the canonical
Run's technical identity and storage/evidence/delivery container.

### A round, in detail

1. The builder receives the frozen contract plus (for round > 1) only the prior
   critic's **largest gap** and **pass condition**. It improves the real targets and
   returns bound before/after trees and a delta evidence ref.
2. The Run advances to judgment — it never ships from a builder claim.
3. A **fresh critic** receives the frozen contract, real target locations, the
   after-tree, and raw evidence — **never** the builder's reasoning or summary. It
   inspects the real artifacts and returns a verdict.
4. If every criterion is satisfied with raw evidence and no gap → `satisfied`.
   Otherwise the critic returns exactly one largest gap and one explicit, testable
   next-round pass condition, and the loop continues.

Feedback is deliberately narrow: one gap per round, not a brainstorm. This keeps the
builder focused and the budget meaningful.

## Terminal outcomes

| Outcome | Meaning | Delivery |
|---|---|---|
| `satisfied` | Every frozen criterion met with raw evidence; zero gaps | `ship` → `archive` admitted |
| `task_loop_exhausted` | Round budget consumed without satisfaction | Terminal/escalated; **no** ship/archive |
| blocked / escalated | A permission, safety, dependency, or failed-phase blocker | Terminal; retains original cause; **no** ship/archive |
| cancelled | User cancelled the active Run | Terminal; **no** further actions |

A non-`satisfied` outcome is **final and honest**: Rasen reports the evidence and the
remaining gap, and never converts the Run into another pipeline. Starting over means a
new explicit run, not a mutation of the active one.

## Trust and safety model

Task Loop reuses the canonical Run, GoalCycle, and reconciler, and adds task-specific
mechanical checks so trust never depends on a summary:

- **Frozen contract** — goal/targets/bar/constraints are immutable for the Run and
  stamp launch identity. Relaunching the same contract is idempotent; a changed
  goal/target/bar/Pipeline returns `launch_request_conflict` and leaves the existing
  Run untouched.
- **Evidence-bound judgments** — every criterion result must cite evidence digests
  that resolve to raw evidence refs committed by *that judge action*, bound to the
  correct change/run/action/schema and the current workspace tree. Unrelated, stale,
  or summary-only evidence is rejected.
- **Fresh critic** — each round's critic must differ by agent **session** from the
  builder and from every prior critic, and must carry the reviewer role/runtime. The
  same session or a wrong role is rejected (`task_loop_critic_reused` /
  `goal_cycle_actor_separation`).
- **Exact bar coverage** — the judgment must cover every frozen criterion exactly
  once. Omissions, additions, duplicates, or identifier changes are rejected
  (`task_loop_bar_mismatch`). `satisfied: true` with any unsatisfied criterion or gap
  is rejected (`task_loop_false_satisfaction`).
- **Physical path authorization** — launch inputs and artifact targets are authorized
  with no-follow physical containment; symlink/junction/reparse-point escapes are
  rejected. The hidden input bridge reads only from the resolved change ephemera root.
- **Launch identity** — Rasen derives the launch digest from normalized
  pipeline/engine/inputs; a caller-supplied digest is only a consistency assertion and
  cannot override it. Legacy empty-input records stay compatible.
- **Exact built-in identity** — `task-loop` guards engage only for the genuine
  package built-in plan (exact `iterate → ship → archive` shape). A same-named
  project/user override with a different DAG is not misclassified.
- **Delivery re-validation** — at both completion and ship/archive boundaries, the
  entire work/judge history is re-checked against the **current** workspace tree, so a
  projection or report file can never grant satisfaction or delivery authority.

## Engine requirement

Task Loop is **reconciler-only.** It depends on the canonical engine to enforce frozen
inputs, fresh critics, bounded iteration, and terminal guards. If the resolved engine
is legacy or the reconciler is unsupported, preflight stops **before any work is
admitted** with `task_loop_reconciler_required` — it never silently falls back to the
generic legacy path.

## `--no-gate`

`--no-gate` makes ordinary gate stages auto-approve instead of pausing (useful for
unattended runs). It is recorded in `gatePolicy`, but it **cannot** bypass task-loop
input validation, the evidence bar, actor separation, terminal-state checks, or the
ship/archive delivery guard. No-gate turns pauses off; it does not turn failures into
success.

## Resume and observability

- **Deterministic resume** — the sealed plan plus the canonical Record fully determine
  the next action. If a process stops after a phase completes and later resumes, Rasen
  replays committed events, preserves actor/evidence history, and admits only the next
  uncompleted phase — never re-doing a completed phase or running a planning stage.
- **Status** — `task-loop` status derives from the Record (never from projections) and
  exposes the contract digest, safe contract fields, current round/phase, effective
  budget, builder/critic identities, per-criterion evidence, the latest gap/pass
  condition, stall state, and the deterministic next action.
- **`task-loop-report.md`** — a digest-stamped, read-only projection written into the
  evidence directory after a valid judge completion. It contains the contract digest,
  outcome, round, goal, criteria with evidence digests, and sorted raw evidence. It is
  **derived**: missing, stale, or hand-edited reports cannot change status,
  satisfaction, or delivery. Ship/archive consume the canonical satisfied evidence,
  not the report.

## Registry, parity, and localization

- `rasen pipeline list` / `show` / validation expose `task-loop` as a built-in with
  `iterate → ship → archive` and the role-isolated evaluate loop.
- The internal `rasen-task-loop` skill is installed as part of the auto dependency
  closure but is **not user-invokable** (no `rasen loop` command, no directly-selectable
  skill). Existing goal pipelines keep their declared `rasen-goal-iterate` capability
  and lower exactly as before.
- Diagnostics (input/bar errors, critic reuse, bar mismatch, false satisfaction,
  reconciler-required, exhaustion, delivery guards) are localized to English, Japanese,
  and Simplified Chinese.

## Design boundaries (what it deliberately is not)

- **Not a second general-purpose orchestration entry.** One selector, under `rasen-auto`.
- **Not auto-escalated.** The classifier never routes into it; the default stays
  `small-feature`.
- **Not convertible.** Terminal outcomes are final; there is no fallback to a spec
  pipeline.
- **Not a replacement for the goal pipelines.** It reuses GoalCycle behind a small
  task-specific module; it does not change their contract.
- **Not a way to weaken review.** Independent, evidence-based criticism is the core
  guarantee; `--no-gate` and projections cannot erode it.

## Under the hood (architecture)

Task Loop is an additive layer over the canonical Change Run, not a parallel engine:

- **Launch inputs** — the contract lives in `CanonicalRunRecord.inputs.taskLoop` and
  feeds `digestLaunchIntent`, so idempotent reuse vs. conflict is decided before any
  side effect.
- **Lowering** — the v1 goal-loop normalizer lowers the stage's *declared* skill
  capability (rather than a hard-coded one), so existing goal pipelines lower
  identically while `task-loop` dispatches its internal `rasen-task-loop` skill.
- **Execution** — the bounded loop, role-isolated profile resolution (implementer =
  workspace-write work, reviewer = read-only judge), bounded budget, replay, admission,
  and stall semantics are all the existing GoalCycle's. The TaskLoop module adds only
  task-specific contract and judgment validation plus terminal/delivery guards.
- **Reconciler** — action inputs are enriched only for the built-in task-loop identity:
  work gets the contract + prior gap/pass condition; judge gets the contract + real
  targets/evidence but no builder narrative.

This keeps the deep machinery (scheduling, actor binding, replay, settlement, delivery)
shared and tested, with task policy isolated in one internal module.
