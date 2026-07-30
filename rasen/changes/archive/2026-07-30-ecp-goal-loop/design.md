## Context

ECP-1 shipped the BoundedLoop kernel via ReviewCycle: a 4-phase domain reducer (`review-cycle.ts`), runtime adapter (`review-cycle-runtime.ts`), reconciler bounded-loop pass, lowerer, facade pre-commit validation, projector section, and built-in migration for `bug-fix`/`small-feature`. ECP-2 added the `composite` body kind for Custom Composite authoring. Both are review-clean on `feat/ecp-review-cycle`.

The three goal-loop built-ins (`goal-loop-measure`, `goal-loop-evaluate`, `goal-loop-research`) still run entirely under prompt ownership: `goal-command.ts` classifies the variant, `_orchestration.ts` Step L drives the modify→judge loop, the LEAD counts rounds/score/stall/blocked, and `goal-run.json` is the authoritative spine. The pipeline YAML declares `loop: { kind: goal, gate: { kind: measure|evaluate } }` but the runtime treats this as a single atomic stage — the loop is invisible to the reconciler.

The BoundedLoop kernel (admit/round/cap/recovery/terminal) is proven by ReviewCycle. GoalLoop is the second consumer: it validates the lifecycle is genuinely generic and thins the launchers to their product role.

## Goals / Non-Goals

**Goals:**
- The reconciler executes `goal-cycle` body bounded-loop nodes, making goal-loop built-ins runnable as real Runs.
- Three domain reducers (Measure, Evaluate, Research) with typed result contracts, Zod validation, fail-closed transitions, and pure event reducers — separate from ReviewCycle, sharing identity/limits/recovery/terminal mechanics.
- `goal-run.json` becomes a compatibility projection; the authoritative loop spine is the canonical Record + projector.
- `rasen-goal` thins to a completion preset/launcher; `rasen-auto` thins to selection/launch only.
- Recovery at work/judge quiescent boundaries is deterministic (inherent from plan + Record).
- At least one measure/evaluate AND one research real Run progresses through multiple rounds + recovery + termination.

**Non-Goals:**
- Choice/FanOut/Join/full-feature parallelism (ECP-4).
- Product closure / legacy engine default-off (ECP-5).
- auto-decompose / Issue dispatch.
- Modifying the v1 legacy engine path.
- Nested loops or recursive composites.

## Decisions

### D1: `goal-cycle` body kind — shared lifecycle, variant-parameterized domain

The `RuntimePlanBoundedLoopNode.body` union gains a third member: `RuntimePlanGoalCycleBody`. This mirrors how ECP-2 added `composite` alongside `review-cycle`.

```ts
interface RuntimePlanGoalCyclePhase {
  readonly phase: 'work' | 'judge';
  readonly profilePath: string;
  readonly admissionKind: RuntimePlanAdmissionKind;
  readonly workspace: RuntimePlanWorkspace;
}

interface RuntimePlanGoalCycleBody {
  readonly kind: 'goal-cycle';
  readonly variant: 'measure' | 'evaluate' | 'research';
  readonly phases: readonly RuntimePlanGoalCyclePhase[]; // exactly 2: work, judge
}
```

The 2-phase body (work → judge) is the same for all three variants. The variant only parameterizes the domain result contracts and exit policy. This is NOT a fourth body kind per variant — the mechanical lifecycle (round, admit, cap, stall, recovery) is shared, and the domain differences live in the typed results.

**Alternative considered:** Three separate body kinds (`goal-measure`, `goal-evaluate`, `goal-research`). Rejected because the loop mechanics are identical across variants — only the result contracts differ. One body kind with a `variant` discriminator keeps the reconciler switch compact and proves lifecycle genericity.

### D2: Domain reducer (`goal-cycle.ts`) — three result-contract families

A single `goal-cycle.ts` file houses the three variant reducers, mirroring how `review-cycle.ts` houses four phase parsers. Each variant has:

**Measure variant:**
- `GoalWorkResult` (`contract: 'goal-cycle/work-result/1'`): findingIds replaced by `workDescription`, `beforeTree`, `afterTree`, `delta` (EvidenceRef). The work phase produced a material change.
- `MeasureJudgeResult` (`contract: 'goal-cycle/measure-judge/1'`): `score` (number), `threshold`, `direction` ('gte' | 'lte'), `passed` (boolean), `detail?`. The judge ran the measure command and parsed its output.

**Evaluate variant:**
- `GoalWorkResult` (same contract as measure).
- `EvaluateJudgeResult` (`contract: 'goal-cycle/evaluate-judge/1'`): `satisfied` (boolean), `gaps` (string[]), `criteria` (array of `{ id, satisfied, evidence }`). The fresh reviewer judged the rubric.

**Research variant:**
- `ResearchWorkResult` (`contract: 'goal-cycle/research-work/1'`): `documentPath`, `beforeTree`, `afterTree`, `delta`. The work phase refined a document.
- `ResearchJudgeResult` (`contract: 'goal-cycle/research-judge/1'`): `satisfied` (boolean), `gaps` (string[]), `qualityAssessment`. The fresh reviewer judged document quality.

**Reducer state (`GoalCycleState`):**
```ts
interface GoalCycleState {
  readonly round: number;
  readonly phase: 'work' | 'judge';
  readonly outcome?: 'satisfied' | 'exhausted';
  readonly variant: 'measure' | 'evaluate' | 'research';
  readonly lastScore?: number;
  readonly lastSatisfied?: boolean;
  readonly lastGaps: readonly string[];
  readonly stallStreak: number;
  readonly eventCount: number;
  readonly lastActor?: ActorRef;
  readonly judgeActor?: ActorRef;
  readonly workerActor?: ActorRef;
}
```

The `applyGoalCycleEvent` transition function:
- `work` phase: accepts the variant-appropriate work result, advances to `judge`. A zero-delta work result (no material change) increments the stall streak.
- `judge` phase: accepts the variant-appropriate judge result. If `passed`/`satisfied` is true, outcome becomes `satisfied`. If false and `round >= maxIterations`, outcome becomes `exhausted`. If false and rounds remain, advance to `round + 1` and reset to `work` phase. Score-based stall detection (measure: score did not move favorably) increments the stall streak.

**Actor separation:** The `judge` phase actor MUST differ from the `work` phase actor (by `identityDigest`), mirroring ReviewCycle's fixer≠verifier invariant. This is enforced before commit.

**Alternative considered:** Separate `measure-cycle.ts`, `evaluate-cycle.ts`, `research-cycle.ts` files. Rejected because the three share 90% of the reducer, runtime adapter, and reconciler logic. The variant-specific parsing is a `switch` on `event.phase` + `body.variant`, exactly like `decodeReviewCycleResult` switches on `phase`.

### D3: Runtime adapter (`goal-cycle-runtime.ts`)

Mirrors `review-cycle-runtime.ts` exactly in shape:

- `projectGoalCycleProgress(plan, loop, record)` → `GoalCycleProgress` (`ready` | `waiting` | `failed` | `satisfied` | `exhausted`). Reads committed events from the Record, reduces them through the domain reducer, and derives the next ready action.
- `validateGoalCycleCompletion(plan, record, request)` — pre-commit validation: checks the completion addresses the exact expected phase, validates the result shape, and rejects same-actor work→judge pairs.
- `locateGoalCycleInvocation(plan, nodeId)` — finds the goal-cycle descriptor for a given nodeId.

The `eventsFromRecord` function iterates rounds 1..maxIterations, phases work→judge, deriving per-round per-phase nodeIds from the hierarchical path `${loopPath}/round:${round}/phase:${phase}` — identical to the ReviewCycle pattern.

### D4: Reconciler `goal-cycle` branch

The reconciler's bounded-loop pass (`reconcile()`) gains a third case in the `loop.body.kind` switch:

```
case 'goal-cycle': {
  const progress = projectGoalCycleProgress(plan, loop, record);
  switch (progress.kind) {
    case 'satisfied': succeeded.add(loop.nodeId); break;
    case 'exhausted': actions.push({ kind: 'escalate', code: loop.outcomes.exhausted }); break;
    case 'ready':     boundedLoopAdmitCandidates.push({...}); break;
    case 'waiting':
    case 'failed':    break; // surface via projection
  }
}
```

The `BoundedLoopAdmitCandidate` type gains `bodyKind: 'review-cycle' | 'composite' | 'goal-cycle'`. The admit payload carries `{ loopPath, round, phase, variant }` for the facade.

**Finish guard:** `finishCandidate` already checks all bounded-loop nodes in the succeeded set — `satisfied` contributes, `exhausted` emits escalate before finish. No change needed.

### D5: Lowerer — goal built-in normalization

The normalizer in `definition.ts` detects `loop: { kind: goal }` stages and produces:
1. A `BoundedLoop` root node with `maxIterations` from `loop.maxRounds`.
2. A `CompositeDeclaration` body with 2 `AtomicStage` nodes: `work` (the iterate skill's capability) and `judge` (the gate's capability).
3. The variant is detected from `loop.gate.kind`: `measure` → variant `measure`, `evaluate` → variant `evaluate` (used by both `goal-loop-evaluate` and `goal-loop-research`; the research variant is distinguished by the pipeline name or a `workProduct: prose` marker).

The lowerer (`lowerer.ts`) detects goal-cycle-shaped BoundedLoops (2-phase body with `work`/`judge` AtomicStages carrying `goalCyclePhase` tags, parallel to `reviewCyclePhase`) and lowers them to `body: { kind: 'goal-cycle', variant, phases }`.

`analyzeReconcilerSupport` is extended to include goal-cycle body stages in the expected capability bindings, exactly as it was extended for ReviewCycle body phases in ECP-1 and composite body stages in ECP-2.

### D6: Goal projection (`goal/1` section)

The projector emits a `goal/1` section when the plan contains a goal-cycle bounded-loop:

```
{
  kind: 'goal',
  version: 1,
  loopPath: string,
  variant: 'measure' | 'evaluate' | 'research',
  round: number,
  phase: 'work' | 'judge',
  outcome: 'satisfied' | 'exhausted' | undefined,
  lastScore?: number,
  lastGaps: string[],
  stallStreak: number,
  budget: { used: number, max: number },
  waitReason: string | undefined,
}
```

CLI `pipeline status`, Management API `GET /api/v1/runs`, and Operations all consume the same `ChangeRunView`.

### D7: Pre-commit validation and ship guard

`validateGoalCycleCompletion` is called in the facade's `complete()` method, mirroring `validateReviewCycleCompletion`:
- Malformed work/judge results fail closed before commit.
- Same-actor work→judge pairs rejected.
- Completions for the wrong phase/nodeId rejected.

A completion guard for goal-cycle bounded-loops asserts `outcome === 'satisfied'` before a completed terminal — mirroring `assertReviewCycleMayShip`. An `exhausted` outcome produces an escalated terminal, not a completed one.

### D8: Built-in migration — normalize goal pipelines to v2

All three goal-loop v1 YAML pipelines (`goal-loop-measure`, `goal-loop-evaluate`, `goal-loop-research`) normalize to v2 definitions:

- `goal-loop-measure` → `define-goal` (atomic) → `goal-loop` (bounded-loop, goal-cycle/measure) → `ship` → `retain` → `archive`
- `goal-loop-evaluate` → same with variant `evaluate`
- `goal-loop-research` → `define-goal` → `goal-loop` (bounded-loop, goal-cycle/research) → `report` (atomic, report-only tail)

The `loop: { kind: goal, gate: { kind: measure|evaluate } }` declaration is consumed by the normalizer to produce the BoundedLoop + goal-cycle body declaration. The v1 YAML files remain unchanged; legacy engine execution continues to read stages as-is.

### D9: Thin launchers

**`rasen-goal` (`goal-command.ts`):**
- **Kept:** variant classification (measure/evaluate/research keyword selector), `goal-plan.md` reading for gate configuration, `rasen pipeline start` / `rasen pipeline resume` / `rasen pipeline status` as primary interface, `ChangeRunView` goal section reading for progress reporting.
- **Removed:** round counter, work→judge phase sequencing, maxRounds enforcement, stall/blocked streak tracking, `goal-run.json` writing, author≠verifier checking, strategy ladder, completion-audit enforcement.
- The skill reads the `goal/1` projector section to report progress instead of owning the loop state.

**`rasen-auto` (`auto.ts`):**
- Goal-loop references in the shared `_orchestration.ts` playbook (Step L) are removed. The auto command does not drive goal-loop mechanics.

### D10: `goal-run.json` demotion

The legacy `goal-run.json` file becomes a compatibility projection:
- A read-only projection function derives the per-round record array from the canonical Record's committed goal-cycle events.
- The management API `readGoalRunDetailed()` path is rewired to project from the Record instead of reading the file.
- The file MAY still be written for backward compatibility, but it CANNOT back-drive a new Run — the canonical Record is the only authoritative spine.
- New Runs started under the reconciler engine do not read `goal-run.json` on resume; they reconstruct state entirely from plan + Record.

### D11: Recovery — inherent from plan + Record

Recovery mirrors ECP-1 ReviewCycle exactly. At any quiescent boundary (after work commit, after judge commit):
1. `projectGoalCycleProgress(plan, loop, record)` replays all committed events from the Record.
2. The next ready action is deterministic (same nodeId, same phase, same round).
3. Completed actions are never re-admitted.
4. Score, gaps, and stall state are fully reconstructable.

Fault-injection tests cover:
- **Crash before commit**: the completion was never committed → the action stays active → resume re-admits nothing.
- **Crash after commit**: the completion was committed but settle didn't run → resume calls `reconcile()` which sees the committed result and admits the next phase.
- **Ack loss**: the action was granted but the agent never started → the action stays active → resume surfaces the wait.

## Risks / Trade-offs

- **[Variant-specific result contracts increase reducer complexity]** Three judge-result schemas in one file increases the branch count of `applyGoalCycleEvent`. → Mitigation: the `switch` on variant is localized to the judge-phase parse; the work-phase and round-transition logic is variant-agnostic. The pure/deterministic invariant is preserved — the reducer reads only plan + events.

- **[Goal-plan.md gate injection]** The concrete gate config (command, threshold, goal, rubric) currently lives in `goal-plan.md` and is injected at runtime by the LEAD. Under the reconciler, the plan is frozen at launch time. → Mitigation: the `define-goal` stage's completion carries the parsed gate config as a structured result, and the frozen execution profile captures the capability bindings for the `work` and `judge` phases. The gate config is not in the pipeline YAML (only the gate type) — the `goal-plan.md` artifact is read by the launcher before Run start and informs the brief composition, but the mechanical loop does not depend on parsing it mid-Run.

- **[Research pipeline report-only tail]** The research variant has no ship/archive tail — it ends with a `report` stage. The reconciler's finish logic must handle this (the finish outcome for a research pipeline is `report-completed`, not `shipped`). → Mitigation: the implicit finish outcome is parameterized by pipeline name, already supported by the existing `implicitFinishOutcome` field. The report stage is a normal atomic node that produces the report artifact.

- **[Built-in migration shape]** Normalizing `loop: { kind: goal }` to a BoundedLoop changes the v2 definition shape for goal pipelines. → Mitigation: the v2 definition is internal normalization — v1 YAML and legacy engine path are unchanged. `analyzeReconcilerSupport` gates which plans enter the reconciler.
