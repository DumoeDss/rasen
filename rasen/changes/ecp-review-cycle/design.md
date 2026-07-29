## Context

The deterministic root-DAG Change Run spine (`ecp-run-spine`) ships a pure reconciler, canonical Record, reducer, facade, and projector that execute v1 bug-fix simple-path plans. A prior session wrote a strong front half for v2 ReviewCycle: the domain reducer (`review-cycle.ts`, 600 LoC), runtime adapter (`review-cycle-runtime.ts`, 249 LoC), definition prepare, support analysis, lowerer, and runtime plan types. These are correct but orphaned — the reconciler only admits atomic nodes, `CommittedDomainResult` lacks committed actor truth, and the facade doesn't validate ReviewCycle completions pre-commit. The back half wires these into the canonical execution spine.

The built-in pipelines are v1 YAML in `pipelines/`: `bug-fix` (5 stages, verify with `verifyPolicy: adaptive`) and `small-feature` (6 stages, includes a `review-loop` stage with `loop: { kind: 'review-cycle', maxRounds: 3 }`). The `rasen-review-cycle` skill (`src/core/templates/workflows/review-cycle.ts`) currently owns the full mechanical loop (round counter, phase sequencing, cap enforcement, escalation).

## Goals / Non-Goals

**Goals:**
- The reconciler executes `bounded-loop` plan nodes, making authored v2 ReviewCycle definitions runnable.
- Every ReviewCycle domain result binds committed actor + attestation; malformed/same-actor/open-Major fail closed before commit.
- `bug-fix` complex and `small-feature` normalize to v2 definitions that route through the same ReviewCycle body.
- CLI, Management API, Operations, and Canvas consume one `ChangeRunView` for composite path, round, phase, findings, actor, evidence.
- `rasen-review-cycle` becomes a thin launcher of the canonical Run.
- Recovery at review/fix/re-review quiescent boundaries is deterministic.
- One real dogfood completes finding → fix → independent re-review → clean.

**Non-Goals:**
- Custom Composite authoring UX (ECP-2).
- GoalLoop (ECP-3).
- FanOut/Join/full-feature parallelism (ECP-4).
- Product closure / legacy engine default-off (ECP-5).
- Recursive Composite, nested loop, user-provided executable code.
- Modifying the existing v1 legacy engine path.

## Decisions

### D1: Reconciler bounded-loop execution — project, admit, finish-guard

The reconciler's `reconcile()` gains a bounded-loop pass between the atomic succeeded-set computation and the atomic classification pass. For each `bounded-loop` node whose `requires` are in the succeeded set, it calls `projectReviewCycleProgress(plan, loop, record)` (already written, pure, deterministic) and maps the result:

| Progress | Reconciler action | Succeeded set |
|----------|------------------|---------------|
| `ready` | Emit `admit` for `descriptor.nodeId` with `descriptor.admissionKind` / `descriptor.workspace.access` | not added |
| `waiting` | No candidate (an action is already active for this phase) | not added |
| `failed` | No candidate (committed failure; surface via projection) | not added |
| `clean` | No candidate — add `loop.nodeId` to succeeded set | **added** |
| `exhausted` | Emit `escalate` with code `loop.outcomes.exhausted` | not added |

`finishCandidate()` is guarded: it checks that ALL plan nodes (atomic + bounded-loop) are in the completed set before finishing. A bounded-loop with remaining work (ready/waiting/failed) blocks finish. A clean bounded-loop contributes to the completed set; an exhausted one emits escalate before finish is evaluated.

The bounded-loop pass runs BEFORE the atomic classification pass so that downstream atomic nodes (e.g. ship, archive) whose `requires` includes the bounded-loop can see it in the succeeded set. The order is: (1) atomic succeeded set, (2) bounded-loop outcomes → succeeded set update, (3) atomic classification, (4) bounded-loop ready → admit candidates, (5) workspace selection, (6) finish candidate.

The `ReconcilerNextAction.admit` for a bounded-loop phase carries the descriptor's `profilePath` in a new optional `input.reviewCycle` payload so the facade can build the action with the correct capability binding and input context.

**Alternative considered:** Emit the bounded-loop as a pseudo-atomic node that the existing atomic pass handles. Rejected because the bounded-loop's phase-level identity, workspace access, and admission kind vary per round/phase — a static atomic node cannot represent this.

### D2: CommittedDomainResult enrichment — actor + attestation

`CommittedDomainResult` (record.ts) gains `actor?: ActorRef` and `actorAttestation?: EvidenceRef`. These are optional for backward compatibility (non-ReviewCycle domain results may omit them), but the ReviewCycle runtime adapter (`successfulEvent`) requires both — it already throws `malformed_review_cycle_result` when either is missing (lines 102-109 of `review-cycle-runtime.ts`).

The Zod `ResultSchema` is extended with optional `actor` and `actorAttestation` fields. The `commit-action-result` stimulus (`RunStimulus`) gains `actor?` and `actorAttestation?` fields, passed through from `CompleteRunAction.actor` / `CompleteRunAction.actorAttestation` by the facade. The reducer stores them in the committed result.

This fixes the 3 existing TS errors in `review-cycle-runtime.ts` where `action.result.actor` and `action.result.actorAttestation` are accessed but don't exist on the current type.

### D3: Pre-commit validation in the facade, not the reducer

`validateReviewCycleCompletion(plan, record, request)` (already written) is called in the facade's `complete()` method AFTER `verifyCompletion` but BEFORE the commit stimulus is applied to the Record. This ensures:
- Malformed review/triage/fix/re-review results fail closed before commit (acceptance #3).
- Same-actor fixer + verifier rejected before commit (acceptance #4).
- The completion addresses the exact mechanically-expected phase.

The facade has `deps.plan` and `request` (CompleteRunAction), so it can call the validator directly. The reducer stays plan-agnostic (it processes stimuli, not typed completions). This preserves the separation of concerns: the facade owns the plan-aware validation boundary; the reducer owns the Record invariant.

If `validateReviewCycleCompletion` throws, the facade surfaces the error WITHOUT committing anything — the Record stays at its pre-completion state.

### D4: Built-in migration — normalize verify/review-loop to BoundedLoop

Both `bug-fix` and `small-feature` normalize to v2 definitions that include one BoundedLoop with the same 4-phase ReviewCycle body. The normalizer path in `normalizeV1` (definition.ts) is extended:

**For stages with `loop: { kind: 'review-cycle' }`** (small-feature's review-loop stage):
- Produce a `BoundedLoop` root node + a `CompositeDeclaration` with 4 AtomicStage phases (review, triage, fix, re-review)
- The BoundedLoop's `requires` replaces the stage's `requires`
- `maxIterations` comes from `loop.maxRounds`

**For stages with `verifyPolicy: 'adaptive'`** (bug-fix's verify stage):
- Produce the same BoundedLoop + declaration, absorbing the verify into the review phase
- The verify capability becomes the review phase's capability
- `maxIterations` defaults to 3 (matching the review-cycle skill's default cap)

This means `bug-fix` v2 plan: propose → apply → review-cycle → ship → archive (5 nodes, verify absorbed).
And `small-feature` v2 plan: propose → apply → verify → review-cycle → ship → archive (6 nodes, verify stays, review-loop → BoundedLoop).

Both ReviewCycle bodies use the same declaration shape (same capability contracts, same phase order). The difference is only what precedes the BoundedLoop. When the review phase finds no Blocker/Major findings, the cycle exits clean after round 1 — equivalent to a simple verify pass.

**Alternative considered:** Add an `enterCondition` field to the bounded-loop for conditional entry based on adaptive verify route. Rejected for this slice because absorbing the verify into the review phase is simpler, avoids plan-level conditional branching, and the "clean after round 1" behavior is product-equivalent to the current simple path.

**Compatibility:** The v1 YAML definitions are unchanged. Legacy engine execution (for projects not yet on the reconciler) continues to read the YAML stages as-is. The normalizer only produces v2 BoundedLoop nodes when `analyzeReconcilerSupport` determines the reconciler is the target engine.

### D5: Lowerer extension — mixed atomic + bounded-loop plans

`lowerV2ReviewCyclePlanInput` (lowerer.ts) currently only handles BoundedLoop + Finish root nodes. It is extended to also handle AtomicStage root nodes, lowering them with the same logic as the v1 path (capability/policy binding, admission kind, workspace access, adaptiveVerify). This produces mixed plans like: propose(atomic) → apply(atomic) → review-cycle(bounded-loop) → ship(atomic) → archive(atomic).

The existing `createRuntimePlan` already supports mixed node kinds — `validateBoundedLoop` and the atomic validation coexist in the same plan.

### D6: Projection — review-cycle view section

The projector (`projector.ts`) emits a new `review-cycle/1` section alongside the existing `root-dag/1` section when the plan contains a bounded-loop. The section is derived from the Record by calling `projectReviewCycleProgress`:

```
{
  kind: 'review-cycle',
  version: 1,
  loopPath: string,
  round: number,
  phase: 'review' | 'triage' | 'fix' | 're-review',
  outcome: 'clean' | 'exhausted' | undefined,
  findings: [{ id, severity, status, claim, actor? }],
  actors: { fixer?: ActorRef, verifier?: ActorRef, lastActor?: ActorRef },
  waitReason: string | undefined,
  maxRounds: number,
}
```

CLI `pipeline status`, Management API `GET /api/v1/runs`, and Operations all consume the same `ChangeRunView` — no separate projection path. The `ChangeRunViewSection` type already allows additive sections (`Readonly<Record<string, unknown>>`).

### D7: Canvas — constrained view, safe config, honest support status

Canvas changes in `packages/ui/src/canvas/`:
- **V2NodePanel.tsx**: BoundedLoop panel shows body phases (review/triage/fix/re-review), max rounds, and exit outcomes. Read-only shape — no add/remove phase.
- **StageNode.tsx**: BoundedLoop card badge shows "Review Cycle" instead of generic "Preserved".
- **layout.ts**: `isV2EditableNodeKind` continues to exclude BoundedLoop (shape editing is ECP-2).
- **Safe config**: maxRounds is exposed as a configurable scalar in the detail panel (not the draft editor), saved to the pipeline YAML's `loop.maxRounds` field.
- **Support status**: The existing `EngineSupportPanel` already shows `executionMode` labels. The Canvas reflects whether the definition will execute via the reconciler (`supported_v2_review_cycle`) or not.

The Canvas never marks a BoundedLoop as independently runnable — it is a structural node whose execution is driven by the reconciler.

### D8: rasen-review-cycle thin launcher

The skill body (`src/core/templates/workflows/review-cycle.ts`) is rewritten:
- **Removed**: round counter (`r = 1`), phase sequencing logic, max-rounds enforcement, author != verifier checking, escalation ladder, cycle report format.
- **Kept**: change selection, brief composition per phase (what the agent should review/fix), delegation to `rasen-review`.
- **Added**: `rasen pipeline start` / `rasen pipeline resume` / `rasen pipeline status` commands as the primary interface; the skill reads the `ChangeRunView` review-cycle section to report progress.
- The skill's `review-cycle-report.md` becomes a projection of the canonical Record, not an independent log.

### D9: Recovery — quiescent-boundary determinism

Recovery is an inherent property of the canonical Record + frozen plan. At any quiescent boundary (after review commit, after fix commit, after re-review commit), the state is fully reconstructable:

1. `projectReviewCycleProgress(plan, loop, record)` replays all committed events from the Record
2. The next ready action is deterministic (same nodeId, same phase, same round)
3. Completed actions are never re-admitted (their nodeId has a committed result)
4. Open findings are preserved in the committed results' finding data

Fault-injection tests cover:
- **Crash before commit**: the completion was never committed → the action stays active → resume re-admits nothing, the same action is still active.
- **Crash after commit**: the completion was committed but the settle didn't run → resume calls `reconcile()` which sees the committed result and admits the next phase.
- **Ack loss**: the action was granted but the agent never started → the action stays active → resume detects it's still active and surfaces the wait.

## Risks / Trade-offs

- **[Reconciler complexity]** Adding bounded-loop handling to the pure reconciler increases its branch count. → Mitigation: the bounded-loop pass is a separate loop after the atomic succeeded-set, not interleaved. The pure/deterministic invariant is preserved — `projectReviewCycleProgress` reads only plan + Record.

- ** [Normalizer backward compatibility]** Extending `normalizeV1` to produce BoundedLoop nodes changes the v2 definition shape for existing pipelines. → Mitigation: the v2 definition is an internal normalization — the v1 YAML and legacy engine path are unchanged. `analyzeReconcilerSupport` gates which plans enter the reconciler.

- **[Bug-fix behavioral change]** Absorbing the adaptive verify into the ReviewCycle means every bug-fix runs at least one review round. → Mitigation: a clean round-1 review is product-equivalent to the current simple verify pass. The cycle exits immediately on clean. This is arguably better — even "simple" fixes get a proper structured review.

- ** [Record schema widening]** Adding optional `actor`/`actorAttestation` to `CommittedDomainResult` widens the Zod schema. → Mitigation: both fields are optional, so existing Records remain valid. The strict-object Zod schema is extended, not loosened.
