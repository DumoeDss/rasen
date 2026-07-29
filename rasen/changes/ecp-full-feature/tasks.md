## 1. Runtime Plan Types — Choice, FanOut, Join (Acceptance: D1)

- [x] 1.1 Add `RuntimePlanChoiceNode`, `RuntimePlanFanOutNode`, `RuntimePlanFanOutMember`, and `RuntimePlanJoinNode` interfaces to `src/core/change-run/internal/runtime-plan.ts`
- [x] 1.2 Extend `RuntimePlanNode` union to include `choice | fan-out | join`
- [x] 1.3 Extend `RuntimePlanNodeInput` to accept `kind: 'choice' | 'fan-out' | 'join'` with corresponding input fields
- [x] 1.4 Add `RuntimePlanChoiceInput`, `RuntimePlanFanOutInput`, `RuntimePlanJoinInput` interfaces
- [x] 1.5 Extend `RuntimePlanAtomicNode` with optional `fanOut?: { nodeId: NodeId; required: boolean }` tag
- [x] 1.6 Add validation functions: `validateChoice()`, `validateFanOut()`, `validateJoin()` in `createRuntimePlan()`
  - choice: >= 2 outcomes, each maps to non-empty branch path, profilePath valid
  - fan-out: >= 1 member, `concurrencyCap` in [1, 32], `budget >= required member count`, `joinNodeId` references a join node
  - join: required/optional disjoint, all nodeIds exist, outcomes non-empty
- [x] 1.7 Add the new node kinds to the built-node construction map in `createRuntimePlan()` with proper deepFreeze
- [x] 1.8 Write unit tests: valid choice/fan-out/join plans are accepted; invalid ones (bad cap, bad budget, dangling join ref, duplicate member) are rejected

## 2. Lowerer — Choice/FanOut/Join Lowering (Acceptance: D5, D6)

- [x] 2.1 Extend `lowerV2ReviewCyclePlanInput` in `src/core/change-run/internal/lowerer.ts` with a `Choice` root node branch: resolve outcome → branch path mapping from definition connections, produce `choice` RuntimePlanNodeInput
- [x] 2.2 Add a `FanOut` root node branch: produce `fan-out` RuntimePlanNodeInput + member `atomic` RuntimePlanNodeInput entries (each with `fanOut` tag, `hierarchicalPath: root:<fan-out-id>/<member-id>`, `requires: [root:<fan-out-id>]`)
- [x] 2.3 Add a `Join` root node branch: split inputs into `requiredMembers`/`optionalMembers` by cross-referencing FanOut member metadata, produce `join` RuntimePlanNodeInput
- [x] 2.4 Extend the `resolveRequires` helper to expand FanOut/Join node references for downstream dependencies (downstream of Join requires Join path; downstream of Choice branch requires the branch path)
- [x] 2.5 Write lowerer tests: v2 definition with Choice/FanOut/Join lowers to valid runtime plan with correct topology

## 3. Normalizer — v1 parallelGroup → v2 FanOut/Join (Acceptance: D6)

- [x] 3.1 Extend `normalizeV1` in `src/core/pipeline-registry/definition.ts` to detect `parallelGroup` on v1 stages
- [x] 3.2 For each group: produce `FanOut` root node, member `AtomicStage` root nodes (with `required` based on `condition`), and `Join` root node
- [x] 3.3 Map downstream `requires` from individual group-member references to the Join node
- [x] 3.4 Add a synthetic `parallel-dispatch` capability for the FanOut condition evaluator
- [x] 3.5 Write normalizer tests: `full-feature` v1 YAML normalizes to v2 with correct FanOut/Join/member structure; `condition: always` → required; other conditions → optional
- [x] 3.6 Verify `bug-fix` and `small-feature` normalization is unaffected (no `parallelGroup`)

## 4. Reconciler — Choice Pass (Acceptance: D2)

- [x] 4.1 Add a Choice pass to `reconcile()` in `src/core/change-run/internal/reconciler.ts` after the bounded-loop pass and before the atomic classification
- [x] 4.2 For each `choice` node with satisfied requires: if no committed result → emit admit; if committed result → add `choice.nodeId` + `branches[outcome]` to succeeded set
- [x] 4.3 Extend `finishCandidate` to include `choice` nodes in the required-nodes check (a choice with no committed result blocks finish)
- [x] 4.4 Write failure-first tests: choice with no committed result blocks downstream; choice result persisted → un-selected branch never ready

## 5. Reconciler — FanOut Pass (Acceptance: D3)

- [x] 5.1 Add a FanOut pass after the Choice pass: for each `fan-out` node with satisfied requires, check condition-evaluation committed result
- [x] 5.2 If no committed condition result → emit admit for condition evaluator; if committed → add `fan-out.nodeId` to succeeded set and collect active member candidates
- [x] 5.3 Apply concurrency cap: select at most `cap` candidates per pass (stable hierarchical-path order)
- [x] 5.4 Apply budget: count committed member actions; suppress candidates beyond `budget - committedCount`
- [x] 5.5 Merge capped FanOut member candidates with atomic + bounded-loop candidates into ONE `selectCompatibleAdmissions` call
- [x] 5.6 Write failure-first tests: over-cap admits at most N; over-budget suppresses; suppressed members never admitted

## 6. Reconciler — Join Pass (Acceptance: D4)

- [x] 6.1 Add a Join pass after the FanOut pass: for each `join` node with satisfied non-member requires, check member outcomes
- [x] 6.2 For active required members: all succeeded → continue; any failed → emit escalate with `outcomes.failed`; some non-terminal → wait
- [x] 6.3 For active optional members: failed → suppressed (ignored); non-terminal → wait
- [x] 6.4 If all active required succeeded and all active optional terminal → add `join.nodeId` to succeeded set
- [x] 6.5 Read the FanOut's committed condition result to determine active vs suppressed members (suppressed members ignored by Join)
- [x] 6.6 Extend `finishCandidate` to include `join` nodes in the required-nodes check
- [x] 6.7 Write failure-first tests: required member fails → escalate; optional member fails → suppressed; all succeed → proceed

## 7. Pre-Commit Validation (Acceptance: D2, D3)

- [x] 7.1 Add `validateChoiceCompletion(plan, record, request)` in `facade-runtime.ts`: verify the result has a valid `outcome` field matching one of the choice's declared outcomes
- [x] 7.2 Add `validateFanOutConditionCompletion(plan, record, request)`: verify the result has `activeMembers` and `inactiveMembers` arrays referencing valid member paths; required members must be in `activeMembers`
- [x] 7.3 Call both validators in `facade-runtime.ts` `complete()` after `verifyCompletion` and before commit
- [x] 7.4 Write tests: malformed choice result (bad outcome) rejected; malformed fan-out result (missing activeMembers, required member suppressed) rejected

## 8. Projection — parallel/1 and choice/1 Sections (Acceptance: D7)

- [x] 8.1 Add `buildParallelSection(plan, record)` to `src/core/change-run/internal/projector.ts`: iterate fan-out members, read committed action states, derive member statuses, compute join state, budget usage, key blockers
- [x] 8.2 Add `buildChoiceSection(plan, record)`: read choice committed result, show selected outcome and active/inactive branches
- [x] 8.3 Wire both sections into `buildSections()` alongside existing root-dag/review-cycle/goal/composite sections
- [x] 8.4 Update CLI `pipeline status` to render parallel/choice section data from `ChangeRunView`
- [x] 8.5 Verify Management API returns parallel/choice sections from the same `projectRunView` call
- [x] 8.6 Write parity test: CLI, Management API, and Operations consume same fixture and see same parallel/choice sections

## 9. Canvas — Parallel Authoring (Acceptance: D8)

- [x] 9.1 Update `packages/ui/src/canvas/V2NodePanel.tsx`: FanOut panel (members list with required badges + conditions, concurrency cap scalar, budget scalar), Join panel (required/optional members, outcomes), Choice panel (outcomes list, branch mapping)
- [x] 9.2 Update `packages/ui/src/canvas/StageNode.tsx`: FanOut badge "Parallel (N members)", Join badge "Barrier", Choice badge "Conditional"
- [x] 9.3 Add legality validation: concurrency cap in [1, 32], budget >= required member count; over-budget → Canvas shows error and does not mark runnable
- [x] 9.4 Update `EngineSupportPanel` to reflect `supported_v2_parallel` execution mode
- [x] 9.5 Write Canvas test: FanOut/Join/Choice panels render correctly; over-budget shape rejected

## 10. analyzeReconcilerSupport — FanOut/Join Capability Bindings (Acceptance: D6)

- [x] 10.1 Extend `analyzeReconcilerSupport` in `src/core/pipeline-registry/definition.ts` to recognize FanOut/Join/Choice root nodes
- [x] 10.2 Include FanOut condition evaluator, member atomic nodes, and choice evaluator in the expected capability bindings
- [x] 10.3 Report `supported_v2_parallel` when all FanOut/Join/Choice bindings are present
- [x] 10.4 Write test: `pipeline show full-feature --json` reports `availableEngines` including `'reconciler'`

## 11. Failure-First Tests (Acceptance: exit evidence)

- [ ] 11.1 Test: required FanOut member fails → Join emits escalate → Run does not complete
- [ ] 11.2 Test: optional FanOut member fails → Join suppresses → Run proceeds if required succeeded
- [ ] 11.3 Test: concurrency cap=2 with 4 active members → at most 2 admitted per pass
- [ ] 11.4 Test: budget=3 with 5 active members → only 3 admitted, remaining suppressed
- [ ] 11.5 Test: FanOut condition result marks required member as inactive → reconciler emits escalate (`fan_out_required_member_suppressed`)
- [ ] 11.6 Test: Choice selects 'simple' → 'complex' branch nodes never become ready

## 12. Recovery and Idempotency Tests (Acceptance: exit evidence)

- [ ] 12.1 Crash before FanOut condition commit: restart → re-admit condition evaluator (same nodeId), no members admitted
- [ ] 12.2 Crash after FanOut condition commit: restart → read activeMembers from Record → admit remaining members
- [ ] 12.3 Crash mid-member-execution: 2/5 members committed → restart → completed members not re-admitted, remaining admitted up to cap
- [ ] 12.4 Join idempotency: members with committed results → restart → Join derives same state from Record, no re-evaluation
- [ ] 12.5 Ready-set determinism: same plan + Record → same active member set, same capped admission order

## 13. full-feature Migration and Dogfood (Acceptance: exit evidence)

- [ ] 13.1 Write test: `full-feature` v1 YAML normalizes to v2 with FanOut(6 members) + Join + BoundedLoop
- [ ] 13.2 Write test: lowered plan has correct topology (atomic + fan-out + members + join + bounded-loop + atomic)
- [ ] 13.3 Run a real CLI `full-feature` Run: office-hours → propose → apply → FanOut → Join → review-loop → ship → retain → archive → completed
- [ ] 13.4 Record dogfood evidence: revision, RunId, ActionIds for FanOut condition + members, Join resolution, parallel section projection
- [ ] 13.5 Verify `pipeline status` during FanOut phase shows parallel/1 section with member frontier

## 14. Regression and Cross-Platform Verification

- [ ] 14.1 Run `npx vitest run test/core/change-run/` — zero regressions in existing 973+ tests
- [ ] 14.2 Run `npx tsc --noEmit` — zero type errors
- [ ] 14.3 Run `npx vitest run` (full suite) — no new failures beyond pre-existing Windows flakes
- [ ] 14.4 Verify Windows path handling: all new code uses `path.join()` / `path.resolve()`, no hardcoded separators
- [ ] 14.5 Run `pnpm --filter @atelierai/rasen-ui build` — Canvas changes compile without errors
