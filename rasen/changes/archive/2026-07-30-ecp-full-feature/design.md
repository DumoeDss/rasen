## Context

ECP-1 shipped the BoundedLoop kernel via ReviewCycle: a pure reconciler pass between the atomic succeeded-set and the atomic classification, with `projectReviewCycleProgress` as the domain projector. ECP-2 added the `composite` body kind for Custom Composite inlining. ECP-3 added the `goal-cycle` body kind for GoalLoop. All three share the same lifecycle: round identity, admit/cap/recovery/terminal, workspace lock through one `selectCompatibleAdmissions`.

The remaining node kinds — Choice, FanOut, Join — exist statically in Definition v2 (`ECP_NODE_KINDS` includes them) but have zero runtime support. The lowerer skips them (`if (node.kind === 'Choice') continue`), `createRuntimePlan` only accepts `atomic | bounded-loop | finish`, and the reconciler has no pass for them. The `full-feature` built-in declares 6 parallel expert review stages with `parallelGroup: experts` and per-stage `condition` fields, but the runtime flattens them into independent atomic nodes with no structured concurrency, budget, or barrier.

The kernel to extend is proven: the reconciler's `selectCompatibleAdmissions` enforces single-writer-per-workspace across atomic + bounded-loop candidates merged into ONE selection call (the ECP-1 Minor-2 lesson). FanOut members must go through the same selection — this is now load-bearing for parallel correctness.

## Goals / Non-Goals

**Goals:**
- The reconciler executes `choice`, `fan-out`, and `join` runtime plan nodes.
- Choice: condition evaluated once → selected branch persisted in Record → un-selected branches never execute.
- FanOut: condition dispatch (which members are active), concurrency cap, budget enforcement; members are independent atomic nodes respecting the workspace lock.
- Join: barrier over required vs optional members; required failed → fail closed; optional failed → suppressed; idempotent on restart.
- `full-feature` migrates to the reconciler as a real Run.
- Canvas: parallel authoring with legality feedback (concurrency/budget bounds, required/optional flags).
- Operations: parallel frontier (members ready/running/waiting/failed), Join state, key blockers — from the one `ChangeRunView`.
- Recovery: restart ready-set deterministic; Join never re-consumes a committed member result.
- A real CLI dogfood completes the full-feature Run end-to-end.

**Non-Goals:**
- Product closure / legacy engine default-off (ECP-5).
- Auto-decompose / Issue dispatch.
- Recursive or nested FanOut/Join (parallelism inside parallelism).
- User-provided executable code or arbitrary scripting.
- Modifying ReviewCycle or GoalLoop domain semantics.
- Remote/distributed parallel execution.

## Decisions

### D1: Runtime plan new node kinds — choice, fan-out, join

The `RuntimePlanNode` union gains three members alongside `atomic`, `bounded-loop`, and `finish`:

```ts
interface RuntimePlanChoiceNode {
  readonly kind: 'choice';
  readonly nodeId: NodeId;
  readonly hierarchicalPath: string;
  readonly requires: readonly NodeId[];
  readonly profilePath: string;
  readonly admissionKind: RuntimePlanAdmissionKind;
  readonly workspace: RuntimePlanWorkspace;
  readonly outcomes: readonly string[];
  /** outcome → branch hierarchical path added to succeeded set when selected */
  readonly branches: Readonly<Record<string, string>>;
}

interface RuntimePlanFanOutMember {
  readonly nodeId: NodeId;
  readonly hierarchicalPath: string;
  readonly required: boolean;
  readonly condition: string; // 'always' | 'security-relevant' | ...
}

interface RuntimePlanFanOutNode {
  readonly kind: 'fan-out';
  readonly nodeId: NodeId;
  readonly hierarchicalPath: string;
  readonly requires: readonly NodeId[];
  readonly profilePath: string; // condition evaluator capability
  readonly admissionKind: RuntimePlanAdmissionKind;
  readonly workspace: RuntimePlanWorkspace;
  readonly members: readonly RuntimePlanFanOutMember[];
  readonly concurrencyCap: number;
  readonly budget: number;
  readonly joinNodeId: NodeId;
}

interface RuntimePlanJoinNode {
  readonly kind: 'join';
  readonly nodeId: NodeId;
  readonly hierarchicalPath: string;
  readonly requires: readonly NodeId[];
  readonly requiredMembers: readonly NodeId[];
  readonly optionalMembers: readonly NodeId[];
  readonly outcomes: Readonly<{ proceed: string; failed: string }>;
}
```

FanOut member atomic nodes are lowered as `RuntimePlanAtomicNode` entries with an added `fanOut?: { nodeId: NodeId; required: boolean }` tag. They go through the existing atomic classification pass unchanged — the FanOut-specific logic is a candidate filter applied before the merged `selectCompatibleAdmissions` call.

`createRuntimePlan` validation for the new kinds:
- **choice**: at least 2 outcomes; each outcome maps to a non-empty branch path; profilePath is valid; no gate/outcome fields.
- **fan-out**: at least 1 member; `concurrencyCap >= 1 && <= 32`; `budget >= members.length` (budget must cover all required members); `joinNodeId` references a `join` node in the plan.
- **join**: `requiredMembers` and `optionalMembers` are disjoint; all referenced nodeIds exist in the plan; `outcomes.proceed` and `outcomes.failed` are non-empty.

**Alternative considered:** Represent FanOut members as a separate node kind (`fan-out-member`). Rejected because members are fundamentally atomic executions that go through the same admit/workspace-lock/recovery machinery. A tag on the atomic node is sufficient and avoids a proliferating union.

### D2: Choice execution — condition evaluation, persisted selection, branch activation

The reconciler gains a Choice pass after the bounded-loop pass and before the atomic classification:

1. For each `choice` node whose `requires` are in the succeeded set:
   a. Check if a committed action result exists for the choice's nodeId.
   b. If NO committed result: emit an `admit` candidate for the condition evaluator (profilePath, admissionKind, workspace). The choice is not yet in the succeeded set.
   c. If committed result exists: read `result.outcome` (a string matching one of `outcomes`). Add the choice's `nodeId` to the succeeded set. Add `branches[outcome]` to the succeeded set. Un-selected branches are never added.

2. Downstream nodes that require a specific branch path (e.g., `root:choice/simple-path`) only become ready when that path is in the succeeded set.

The choice's committed result shape:
```json
{
  "outcome": "complex",
  "rationale": "diff touches authentication module"
}
```

The selection is persisted in the Record as a committed `CommittedDomainResult` with `result.outcome`. On replay/restart, the reconciler reads the same committed result and derives the same succeeded set — deterministic.

**Idempotency**: the choice is admitted at most once. Its committed result is final. Restart does not re-admit the choice evaluator.

### D3: FanOut execution — condition dispatch, concurrency cap, budget, workspace lock

The reconciler gains a FanOut pass after the Choice pass:

1. For each `fan-out` node whose `requires` are in the succeeded set:
   a. Check if a committed condition-evaluation result exists.
   b. If NO committed result: emit an `admit` candidate for the condition evaluator. The FanOut is not yet in the succeeded set (members are not eligible).
   c. If committed result exists: read `result.activeMembers` (array of member hierarchical paths). Add the FanOut's `nodeId` to the succeeded set (so the join node's requires are partially satisfied).

2. For each active FanOut member (in the `activeMembers` list):
   a. Check if the member already has a committed terminal result (succeeded/failed). If so, skip.
   b. If not terminal and no active action: add to fan-out member candidates.

3. Apply concurrency cap: from the fan-out member candidates for this FanOut, select at most `concurrencyCap` (in stable hierarchical-path order).

4. Apply budget: count committed actions across ALL member nodeIds for this FanOut. If `committedCount >= budget`, suppress remaining candidates. Available slots = `budget - committedCount`. Select at most `min(concurrencyCap, availableSlots)` candidates.

5. Capped candidates are tagged with their `fanOut.nodeId` and merged into the unified `selectCompatibleAdmissions` call alongside atomic and bounded-loop candidates.

The FanOut's committed condition-evaluation result shape:
```json
{
  "activeMembers": ["root:fan-out/review", "root:fan-out/cso"],
  "inactiveMembers": ["root:fan-out/benchmark", "root:fan-out/qa"],
  "rationale": {
    "review": "always",
    "cso": "security-relevant: authentication code detected",
    "benchmark": "not performance-sensitive",
    "qa": "non-ui change"
  }
}
```

**Required members are always active** (they have `condition: 'always'`). Optional members are activated by the condition evaluator's judgment.

**Budget exhaustion**: when the budget is exhausted before all active members are admitted, un-admitted members are suppressed. The Join treats them as suppressed-optional (does not wait for them, does not fail).

**Workspace lock**: FanOut members that are read-access (e.g., reviews) can coexist under the workspace lock. Write-access members are serialized by the lock. The concurrency cap is an ADDITIONAL resource limit on top of the workspace lock — it limits total concurrent agent calls, not just workspace conflicts.

### D4: Join execution — barrier with required/optional/fail-closed

The reconciler gains a Join pass after the FanOut pass and before the atomic classification:

1. For each `join` node whose non-member `requires` are in the succeeded set:
   a. Read the FanOut's committed condition result to determine active vs suppressed members.
   b. For each **active required** member:
      - `succeeded` → OK, continue.
      - `failed` / `cancelled` / terminal-non-succeeded → **Join fails closed**: emit `escalate` with `outcomes.failed`.
      - Not terminal → Join waits (no action, no candidate).
   c. For each **active optional** member:
      - `succeeded` → OK.
      - `failed` / `cancelled` / terminal-non-succeeded → **suppressed** (ignored).
      - Not terminal → Join waits.
   d. For each **suppressed** member (not in `activeMembers`): ignored entirely.
   e. If all active required succeeded AND all active optional are terminal: add Join's `nodeId` to the succeeded set. Downstream nodes may proceed.

2. Suppressed-required members (which should not occur since `condition: always` is always active) are treated as a plan violation — the reconciler emits `escalate` with code `fan_out_required_member_suppressed`.

**Idempotency**: the Join reads only committed action results from the Record. A committed member result is consumed exactly once (its status is read, not mutated). On restart, the same committed results produce the same Join state — no re-admission, no re-evaluation.

**Cancel/timeout**: member actions that are cancelled or timed-out have terminal states in the Record. The Join reads these as non-succeeded terminal states and applies the same required/optional logic.

### D5: Lowerer — Choice/FanOut/Join lowering

The lowerer's `lowerV2ReviewCyclePlanInput` (now functionally `lowerV2PlanInput`) gains three new branches:

**Choice lowering:**
- The `ChoiceNode.outcomes` become the runtime plan choice's `outcomes`.
- Each outcome maps to a branch path. The branch path is the downstream node's hierarchical path that depends on that outcome. The lowerer resolves this from the definition's connections: a connection from `ChoiceNode:port:<outcome>` to a downstream node determines the branch path.
- The condition evaluator's `profilePath` is `root:<choice-id>` (same as atomic root nodes).

**FanOut lowering:**
- The `FanOutNode.branches` (enriched with `required` and `condition` metadata) become the runtime plan fan-out's `members`.
- Each member is also lowered as a SEPARATE `RuntimePlanAtomicNode` with `hierarchicalPath: root:<fan-out-id>/<member-id>` and `fanOut: { nodeId, required }` tag.
- The FanOut's condition evaluator `profilePath` is `root:<fan-out-id>`.
- `concurrencyCap` and `budget` come from the FanOutNode's limits (default cap=3, budget=members.length).

**Join lowering:**
- The `JoinNode.inputs` are split into `requiredMembers` and `optionalMembers` by cross-referencing the FanOut's member metadata (required vs optional).
- The Join's `requires` includes all member hierarchical paths (so the acyclic check passes) plus any upstream non-member dependencies.
- `outcomes.proceed` defaults to `'proceed'`; `outcomes.failed` defaults to `'parallel_failed'`.

The lowerer resolves CompositeRef terminal paths for member `requires` (same expansion as ECP-2).

### D6: Normalization — v1 parallelGroup + condition to v2 FanOut/Join

The normalizer in `definition.ts` detects `parallelGroup` on v1 stages:

1. Collect all stages with the same `parallelGroup` value.
2. Produce a `FanOut` root node with `id: <group-name>`.
3. For each stage in the group:
   - Produce a member `AtomicStage` root node with `id: <stage-id>`.
   - Mark `required: true` if `condition === 'always'`, else `required: false`.
   - The member's root-level requires becomes `[<fan-out-id>]` (the FanOut gates member eligibility).
4. Produce a `Join` root node with `id: <group-name>-join`.
   - `requiredMembers`: nodeIds of stages with `condition: 'always'`.
   - `optionalMembers`: nodeIds of conditional stages.
5. The downstream stage that previously required all group members now requires the Join node.

The FanOut's condition evaluator capability is a synthetic `parallel-dispatch` capability that evaluates the change context and determines active members.

### D7: Projection — parallel/1 and choice/1 sections

The projector gains two new additive sections:

**`parallel/1` section** (when plan contains a fan-out node):
```
{
  kind: 'parallel', version: 1,
  fanOutPath: string,
  joinPath: string,
  members: [{
    path: string,
    status: 'suppressed' | 'ready' | 'running' | 'succeeded' | 'failed',
    required: boolean,
    condition: string,
    actor?: ActorRef,
  }],
  joinState: 'waiting' | 'proceeding' | 'failed' | 'not-reached',
  concurrencyCap: number,
  budget: { used: number, max: number },
  activeCount: number,
  succeededCount: number,
  failedCount: number,
  keyBlockers: string[], // e.g., ["required member 'review' failed"]
}
```

**`choice/1` section** (when plan contains a choice node):
```
{
  kind: 'choice', version: 1,
  choicePath: string,
  outcome: string | undefined,
  branches: [{ outcome: string, path: string, active: boolean }],
}
```

Both derive from the same canonical Record. CLI, Management API, and Operations consume the same `ChangeRunView`.

### D8: Canvas — parallel authoring with legality feedback

Canvas changes in `packages/ui/src/canvas/`:

1. **V2NodePanel**: FanOut panel shows member list (path, required badge, condition), concurrency cap (configurable scalar), budget (configurable scalar). Join panel shows required/optional members and proceed/failed outcomes. Choice panel shows outcomes list and branch mapping.
2. **StageNode**: FanOut card badge shows "Parallel (N members)". Join card badge shows "Barrier". Choice card badge shows "Conditional".
3. **layout.ts**: `isV2EditableNodeKind` expands to include `Choice` (full editing). `FanOut` and `Join` are editable for member configuration (required/optional flags, conditions) but member add/remove requires the FanOut panel.
4. **Legality feedback**: when concurrency cap < 1 or > 32, the Canvas shows a validation error and does not mark the pipeline runnable. When budget < required-member count, shows a warning. Over-budget or illegal shapes are rejected at prepare time (the existing Definition v2 validators extended for FanOut/Join constraints).
5. **Support status**: `EngineSupportPanel` reflects whether the definition will execute via the reconciler (`supported_v2_parallel`) or not.

The Canvas never marks a FanOut/Join as independently runnable — they are structural nodes driven by the reconciler.

### D9: full-feature migration

The v1 `full-feature` pipeline normalizes to v2:
```
office-hours(gate) → propose(gate) → apply(gate) →
  FanOut(experts, cap=3, budget=6, members=[
    {review, required:true, condition:always},
    {cso, required:false, condition:security-relevant},
    {benchmark, required:false, condition:performance-sensitive},
    {design-review, required:false, condition:ui},
    {qa, required:false, condition:ui},
    {qa-only, required:false, condition:non-ui}
  ]) →
  Join(experts-join) →
  BoundedLoop(review-loop, maxRounds=3) →
  ship(gate) → retain → archive
```

The `review` stage (`condition: always`) is the only required member. All expert review stages have `workspace.access: 'read'` (they review the diff, not modify it), so they coexist under the workspace lock. The concurrency cap (default 3) limits how many reviews run concurrently.

The `analyzeReconcilerSupport` function is extended to recognize FanOut/Join nodes and include their capability bindings in the expected set.

### D10: Recovery — fault-injection and idempotency

Recovery is inherent in the plan + Record invariant. Fault-injection tests mirror the ECP-1 pattern:

- **Crash before FanOut condition commit**: the condition evaluation was never committed → the FanOut stays unresolved → resume re-admits the condition evaluator (same action, same identity).
- **Crash after FanOut condition commit**: the condition result is committed → resume reads `activeMembers` from the Record → admits active members that haven't been admitted yet.
- **Crash mid-member-execution**: some members have committed results, others are still active → resume admits remaining active members (up to cap/budget).
- **Crash after Join resolution**: the Join's barrier is satisfied → resume sees the Join in the succeeded set → downstream proceeds.
- **Required member failure → Join fail-closed**: the required member's committed result has `status: 'failed'` → the Join emits escalate → the Run escalates (never completes).
- **Optional member failure → Join suppresses**: the optional member fails → the Join ignores it → if all required succeeded, the Join proceeds.
- **Restart ready-set determinism**: the same plan + Record always produces the same active member set, same concurrency-capped admission, and same Join state.
- **Join idempotency**: a committed member result is read once per reconcile pass. The Join never re-admits a completed member. The Join's state is fully derived from committed results.

## Risks / Trade-offs

- **[Concurrency cap + workspace lock interaction]** The concurrency cap and the workspace lock are two independent admission filters. The workspace lock prevents correctness violations (concurrent writers); the concurrency cap limits resource usage (total concurrent agents). If a FanOut has 5 read-access members and cap=3, the reconciler admits 3 per pass. On the next pass (after some complete), it admits more. This is correct but may require multiple reconcile passes to drain all members. → Mitigation: the reconciler is called on every settle cycle, so members drain progressively. The cap is a resource limit, not a correctness constraint.

- **[FanOut condition evaluator as single point of failure]** If the condition evaluator crashes before committing, no members are admitted. → Mitigation: the condition evaluator is a single agent action with stable identity. Restart re-admits it. If it consistently fails, the Run escalates (no members → Join cannot proceed → escalate).

- **[Join waiting for optional members]** The Join waits for ALL active members (required + optional) before proceeding. An optional member that hangs indefinitely blocks the Join. → Mitigation: optional members have the same timeout/cancel semantics as any action. The facade's timeout policy (inherited from the execution profile) applies. A timed-out optional member is treated as "failed" → suppressed by the Join.

- **[Normalization complexity]** The v1 `parallelGroup` normalization produces 3 new root nodes (FanOut + Join + condition evaluator capability) per group. This changes the v2 shape for `full-feature`. → Mitigation: the v2 definition is an internal normalization. The v1 YAML and legacy engine are unchanged. `analyzeReconcilerSupport` gates which plans enter the reconciler. Existing tests for `bug-fix` and `small-feature` are unaffected (they have no `parallelGroup`).
