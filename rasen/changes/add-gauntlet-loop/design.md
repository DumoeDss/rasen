## Context

rasen has two loop pipelines. `goal-loop` (measure/evaluate/research; writes `goal-plan.md`) and `task-loop` (spec-free bounded engineering; criterion-checklist bar; mechanical satisfaction → ship/archive). Both reuse GoalCycle and borrowed the Gauntlet Loop's *review technique* (builder + fresh-context critic + one-gap feedback + anti-summary) but dropped its *loop structure*: per-wave piece-decomposition against a reference exemplar, open-ended creation, and human-judged convergence. Creative work — games, UI, code, writing — where "done" is judged against an exemplar rather than a checkable criterion checklist has no rasen pipeline.

The central tension: rasen's delivery spine requires a satisfaction signal before ship/archive; Gauntlet's bar is intentionally unreachable and stops on a human. The design must connect open creation to delivery without breaking the "non-satisfied never ships" guarantee or the engine's hard invariants.

**Engine constraints (verified in code, this design respects — it does not relax them):**
- `COMPOSITE_RECURSION` (`definition.ts:1071`) — composite call graphs must be non-recursive.
- `NESTED_LOOP` (`definition.ts:1406`) — no BoundedLoop inside a BoundedLoop.
- Single-writer serialization (`selectCompatibleAdmissions`, `reconciler.ts:1086-1101`) — one write-access Action admitted per reconcile cycle; readers parallelize.
- Sealed `RuntimePlan` (`planDigest` checked at resume) — the plan is frozen at launch.

**Reusable unchanged:** GoalCycle bounded loop + fresh-critic enforcement, CanonicalRun (inputs/evidence/identity/resume), reconciler next-action, profile resolution, dispatch, the ReviewCycle action-replay pattern (dynamic rounds carried as replayable committed Actions within a sealed plan), and the ship/archive delivery guards.

**Verified NOT reusable:** composite recursion and nested loops (forbidden above); parallel writers (serialized); `association-registry` (a change-identity ledger, not a run parent/child tree); `auto-decompose` (Change-level, one-shot, non-recursive). Gauntlet's wave-orchestration, decomposition, and parent/child piece-loop accounting are new machinery reusing only the primitives above.

Source: the approved office-hours design (`rasen/design-docs/sayo-feat-add-task-loop-pipeline-design-20260803-022320.md`, r3), which survived a fresh adversarial review + warm verification confirming feasibility on the engine as built.

## Goals / Non-Goals

**Goals:**
- One built-in `gauntlet-loop` Pipeline, explicit-only, for open creative work judged against a reference exemplar.
- A **phased** model: Phase 0 serial foundation → lead-driven phase transition → Phase 1+ per-wave polish → optional smoothing → user convergence.
- **Fit the engine as built** — respect `COMPOSITE_RECURSION`/`NESTED_LOOP`/single-writer/sealed-plan with no core surgery.
- Reference blind-A/B bar behind a pluggable `BarAdapter` seam; v1 proves it on the code/runnable domain.
- Human-convergence delivery bridge that flows **through the judge**, preserving the mechanical-trust invariant.
- Mechanical enforcement (fresh critic, real evidence, blind A/B, terminal honesty) as code, not prompt convention.

**Non-Goals:**
- No new public command; no classifier route into gauntlet-loop; no conversion/fallback from a terminal gauntlet outcome.
- No multi-workspace / true parallel writers in v1 (serial piece-build is accepted; multi-workspace is a v2 candidate if proven necessary).
- No infinite sub-piece recursion — gauntlet is one-level decomposition re-applied per wave.
- No relaxation of any engine invariant.
- Not replacing or altering `goal-loop` or `task-loop`.

## Decisions

### 1. Delivery: hybrid + convergence-through-judge (over pure-creation-tool / two-phase)
A pure creation tool (no ship/archive) cuts rasen's delivery spine; a two-phase split creates disconnected lifecycles. Instead the loop runs open and the user's convergence attestation drives a **final convergence-judge Action** whose satisfied result unlocks ship/archive via the *existing* guards. The attestation flows **through** the judge, not around it — preserving the mechanical-trust invariant that `assertGoalCycleMayShip`/`assertTaskLoopMayDeliver` protect.

### 2. Architecture: engine-driven reframe on the current engine (over engine-surgery / from-scratch / extend-task-loop)
Alternatives rejected: (a) engine changes as prerequisites (multi-workspace for true parallel writers + relax recursion/nesting guards + plan-versioning) — major core surgery; (b) a from-scratch flat gauntlet engine — duplicates bounded-loop/replay/state machinery; (c) extending `task-loop` in-place — mixes "mechanical satisfaction" and "open creation" philosophies and muddies task-loop's boundary. The chosen reframe ships on the engine as built (verified feasible by adversarial review) and keeps task-loop clean.

### 3. "Recursion" = one-level per-wave re-decomposition (not infinite nesting)
Matt's Gauntlet divides the goal into pieces once per wave via the live progress page — it is not infinite sub-piece nesting. Under this reading `COMPOSITE_RECURSION` and `NESTED_LOOP` dissolve: piece-loops are one level, re-emitted each wave. Dynamic decomposition is modeled as **replayable committed Actions** (the ReviewCycle pattern), so the sealed RuntimePlan is never mutated and resume reconstructs wave structure from the event log.

### 4. "Parallel" = serial builders + parallel critics, via two-sub-phase staging
The single-writer lock (`selectCompatibleAdmissions`) serializes piece-builders; it admits readers together. The wave-orchestration stages each wave in **two sub-phases**: first all piece-builders (admitted serially), then all piece-critics and the meta-critic admitted together as read-only (parallel). Critics are withheld until every piece in the wave is committed — this staging is what actually yields critic parallelism. True parallel building (multi-workspace) is deferred to v2.

### 5. Wave-orchestration = a new BoundedLoop body kind (`gauntlet-wave`)
The reconciler dispatches bounded loops on `loop.body.kind` (`review-cycle`/`goal-cycle`/`composite`). Gauntlet adds a fourth body kind whose body orchestrates piece-loops spawned as **non-nested children**, so `NESTED_LOOP` is respected. Parent/child piece-loop accounting uses the Run's action/DAG model (new; the association-registry does not serve this).

### 6. Reference blind-A/B bar behind a `BarAdapter` seam; v1 code/runnable
`task-loop`'s design rejected speculative adapter seams "before a second real implementation exists." Gauntlet is that second concrete loop type, so the `BarAdapter` seam is now earned. Provisional interface: `inspect(target, workspaceTree) → InspectionResult`; `compare(candidate, reference) → { verdict, biggestGap, evidence }`. v1 implements a code/runnable inspector; visual/prose arrive as additional adapters without engine changes.

### 7. Convergence satisfaction = through-judge, "user-converged via attestation"
Because the bar is intentionally unreachable, no honest judge can return "bar reached." The convergence-judge's `satisfied: true` is semantically **"user-converged, evidenced by attestation"** — a distinct, auditable satisfaction source. Gauntlet's judgment validation accepts this attestation-evidenced satisfaction (parallel to how `task-loop` accepts criterion-evidenced satisfaction). The convergence-judge runs under a **fresh session identity**, subject to gauntlet's critic-reuse guard. No bypass terminal is introduced.

### 8. Backstop = suspend-and-prompt (not destroy)
A compute/round cap, on expiry, suspends the run and prompts the user to converge — it never discards in-progress creative work. (A destructive terminal against an unreachable bar would be unacceptable data loss.)

### 9. Scope: domain-agnostic seams + code/runnable proving domain; full phased v1
General BarAdapter/inspector seams are built, but v1 implements and validates one domain (code/runnable — the most dogfoodable for rasen). The full phased model ships in v1 (feasible under the reframe).

## Risks / Trade-offs

- **[Serial build caps "parallel" to critics]** → accepted (Decision 4); framed honestly; multi-workspace is a v2 candidate only if real use demands parallel building.
- **[Convergence satisfaction differs semantically from criterion satisfaction]** → through-judge + auditable attestation evidence distinguishes the source; validation accepts attestation-evidenced satisfaction explicitly and is covered by negative tests.
- **[Blind A/B is awkward for code (C4)]** → lead Open Question; provisional mechanism (anonymized/shuffled artifacts; behavior/output comparison as the blind axis). May reshape the code-domain bar — resolved during implementation.
- **[Decomposition quality depends on lead judgment]** → lead-driven and sovereign, meta-critic advisory; consistent with "the lead owns task assignment."
- **[Wave-orchestration + parent/child accounting is new machinery]** → built on the Run DAG; explicitly tested; the association-registry is not reused for this.
- **[Backstop suspend could stall]** → it prompts the user, who converges or resumes; no silent data loss.

## Migration Plan

Additive: a new pipeline, internal skill, bounded-loop body kind, `BarAdapter` seam + code inspector, and convergence/backstop terminal path. No data migration; existing Runs, Records, and pipelines (goal-loop, task-loop) are unchanged. Rollback removes the pipeline, body kind, and skill; existing loops and canonical records remain readable. No external dependency or config rollout.

## Open Questions

- **C4 — blind-A/B presentation for the code domain** (provisional: anonymized/shuffled artifacts, behavior/output comparison). Resolved during implementation; may reshape the code-domain bar.
- Naming: `gauntlet-loop` vs `create-loop` (working name `gauntlet-loop`).
- Parent/child piece-loop accounting: the exact Run action/DAG-model shape.
- Smoothing pass: always-on per wave, or lead-triggered.
- Backstop cap values and granularity (per-piece / per-wave / whole-run).
