## Context

Definition v2 already models `BoundedLoop` with `maxIterations`, optional `maxActions`/`budget`, and body-outcome `continue|exit` mappings. Lowering currently drops the loop-local action and budget limits, however, and the runtime plan retains only `maxIterations` plus `clean`/`exhausted` strings. ReviewCycle and GoalLoop then replay successful phase actions through separate reducers: ReviewCycle owns `clean|exhausted`; GoalLoop owns `satisfied|exhausted` and a goal-only `stallStreak`. Neither path implements one public policy for stable progress, repeated blockers, strategy attempts, human guidance, or all terminal reasons.

The canonical Record already provides immutable action/attempt identities, typed action results, durable waits, terminal states, evidence, optimistic controls, and replay. The missing layer is a pure bounded-loop lifecycle interpretation over the frozen plan and that Record. It must not introduce another writable run-state file or merge the review and goal domain schemas.

Two current behaviors are important evidence for the design:

- Loop adapters select an action with `Object.values(record.actions).find(...)`. After a blocked phase is resumed and a later attempt exists, that first-match rule can keep projecting the old blocked attempt forever. Shared lifecycle readers must select the latest attempt by committed ordinal.
- GoalLoop computes a local stall counter, while ReviewCycle has none, and the reconciler maps every round-cap result straight to `escalate`. The strategy ladder described by the product contract is therefore not represented in the immutable plan or canonical Record.

## Goals / Non-Goals

**Goals:**

- Define one versioned lifecycle policy for every executable Definition v2 `BoundedLoop` and seal it into the runtime plan.
- Make iteration, action, budget, stall, same-blocker, strategy, human-required, recovery, and terminal decisions pure functions of the plan and canonical Record.
- Preserve separate ReviewCycle and GoalLoop domain reducers and their result schemas; they contribute domain facts to a shared mechanical reducer.
- Give normal rounds, blocked retries, strategy attempts, and recovery rounds stable, non-overlapping identities.
- Keep CLI, Management API, Operations, Markdown reports, and `goal-run.json` as projections of the same Record.
- Preserve v1 compatibility by materializing an explicit conservative lifecycle during normalization.

**Non-Goals:**

- Canvas creation/editing of the new policy (the later Canvas parity Change owns it).
- Reauthoring built-in pipeline YAML or changing the public default from v1 to v2 (the next portfolio Change owns both).
- Agent process/session execution, worker reuse, handoff, or usage accounting (ECP-7).
- Nested loops, recursive Composite calls, arbitrary scripts, Issue/Dispatch, portfolios, or cross-project scheduling.
- Reopening settle, reservation, association, or canonical Run ownership designs already delivered by prior ECP Changes.

## Decisions

### D1: Add a closed `lifecycle` policy beside body `exits`

`BoundedLoop.exits` continues to map domain body outcomes such as `needs_fix` or `clean`. A new `lifecycle` object governs mechanical triggers that cannot be expressed as a body result:

```ts
interface BoundedLoopLifecyclePolicyV1 {
  version: 1;
  thresholds: {
    stallIterations: number;
    sameBlockerAttempts: number;
  };
  strategy: {
    maxAttempts: number;
    requireMaterialChange: true;
    capability?: { id: string; version: string };
  };
  exits: {
    iterationLimit: LoopLifecycleExit;
    actionLimit: LoopLifecycleTerminalExit;
    budgetLimit: LoopLifecycleTerminalExit;
    stalled: LoopLifecycleExit;
    blocked: LoopLifecycleBlockedExit;
    strategyExhausted: LoopLifecycleTerminalExit;
  };
}

type LoopLifecycleTerminalExit = {
  action: 'exit' | 'escalate' | 'fail';
  outcome: string;
};

type LoopLifecycleExit =
  | LoopLifecycleTerminalExit
  | { action: 'strategy' };

type LoopLifecycleBlockedExit =
  | LoopLifecycleExit
  | { action: 'human-required'; outcome: string };
```

The exact frozen object is canonicalized into the source, capability, policy, and plan digests. Positive safe-integer bounds are required, except `strategy.maxAttempts` may be zero. If any trigger maps to `strategy`, a strategy capability and a positive strategy budget are required; otherwise the capability is forbidden. `requireMaterialChange` is fixed to `true` in the first contract. Every trigger must have an explicit mapping and non-empty typed outcome where its action exits, waits, escalates, or fails.

This separates domain exits from lifecycle exits while still letting a pipeline choose its tail. For example, a ReviewCycle iteration limit maps to `escalate`, while a research GoalLoop may map the same trigger to `exit` with `max-rounds-exhausted` so its report-only tail can run without claiming the goal succeeded.

Alternative considered: add `stalled`, `blocked`, and `human_required` as more keys in the existing body `exits`. Rejected because those are mechanically derived lifecycle triggers, not outputs emitted by the review or goal body, and treating them as body results would put counters back into domain agents.

### D2: One pure lifecycle reducer wraps, but does not replace, domain reducers

Add a small internal module (for example `bounded-loop-lifecycle.ts`) with a closed adapter boundary:

```ts
interface LoopDomainSnapshot {
  iteration: number;
  phase: string;
  completionOutcome?: string;
  continueRequested: boolean;
  progressMaterial: JsonValue;
  nextInvocation?: LoopDomainInvocation;
}

type LoopLifecycleDecision =
  | { kind: 'ready'; invocation: LoopDomainInvocation }
  | { kind: 'waiting'; waitId?: WaitId }
  | { kind: 'strategy-ready'; attempt: number; invocation: LoopStrategyInvocation }
  | { kind: 'human-required'; wait: CanonicalWait }
  | { kind: 'completed'; outcome: string; reason: 'domain-complete' | LoopExitReason }
  | { kind: 'escalated'; outcome: string; reason: LoopExitReason }
  | { kind: 'failed'; outcome: string; reason: LoopExitReason }
  | { kind: 'cancelled' };
```

ReviewCycle continues to validate and reduce review/triage/fix/re-review events and supplies open-finding progress plus `clean|continue`. GoalLoop continues to validate work/judge events and supplies score/gaps/satisfaction plus `satisfied|continue`. Generic Composite bodies supply completed-stage/result facts. None of those reducers counts stalls, blockers, strategies, action budget, or terminal policy after this Change.

The shared reducer reads only the immutable runtime plan, stable-sorted committed actions/waits/transitions, and the adapter snapshot. The reconciler consumes its closed decision union. No lifecycle cache is written to `auto-run.json`, `goal-run.json`, a report, or a second Record field.

Alternative considered: one universal reducer with a union of review findings and goal scores. Rejected because it couples unrelated domain contracts, grows every transition switch with consumer-specific logic, and makes later loop kinds harder to add safely.

### D3: Progress and blocker identity are canonical, not agent assertions

The lifecycle computes `progressFingerprint` with the existing canonical JSON/domain-digest utilities:

- ReviewCycle: stable-sorted unresolved Blocker/Major identities and statuses, plus the accepted-known set; actor identity and prose summaries are excluded so harmless narration cannot reset stall detection.
- Goal measure: variant, direction, and normalized score; Goal evaluate/research: variant and stable-sorted, de-duplicated gap identities plus satisfaction.
- Generic Composite body: stable stage identities and committed successful result digests for the completed iteration.

The first completed iteration establishes a baseline and never increments the stall streak. A materially different fingerprint resets the streak to zero; an equal fingerprint increments it. A configured threshold fires once and is consumed by the resulting strategy/exit decision, so replay cannot spend the same trigger twice.

Loop phase completions with `status: blocked` must use a closed `bounded-loop/blocked/1` result envelope carrying `reasonCode`, a stable semantic `blockerKey`, and optional detail. The lifecycle derives `blockerFingerprint` from loop identity + phase identity + `reasonCode` + `blockerKey`; evidence or free text cannot create a new blocker. The same fingerprint increments `blockedStreak`, a different blocker resets it to one, and successful material progress resets it to zero. Non-loop blocked results retain their existing compatibility behavior.

All per-node action readers select the latest attempt by `attemptOrdinal` (with ActionId as the stable tie-breaker) and distinguish active, blocked, failed, and succeeded attempts. This fixes blocked resume rather than merely adding counters around the stale first-attempt bug.

Alternative considered: require workers to return a `progressFingerprint`. Rejected because an agent could accidentally or deliberately reset stall detection with an arbitrary string. Workers provide structured domain facts; Rasen computes identity.

### D4: Strategy is a separate bounded action and counter

When a lifecycle trigger maps to `strategy`, the reconciler admits the frozen strategy capability at a hierarchical path distinct from ordinary domain rounds:

```text
<loop>/strategy:<n>/plan
<loop>/strategy:<n>/recovery/phase:<domain-phase>
```

The strategy result uses a closed `bounded-loop/strategy-result/1` contract with a stable `strategyKey`, rationale, intended change surface, and evidence. The strategy action itself does not certify progress. After it succeeds, one domain recovery iteration runs under the same strategy identity; the shared reducer compares its program-computed progress fingerprint with the pre-strategy fingerprint. This enforces `requireMaterialChange` without trusting self-report.

Normal iteration count and strategy-attempt count are independent. A strategy triggered before the normal iteration cap may return to the remaining normal rounds after material progress. A strategy triggered by `iterationLimit` receives one recovery iteration without pretending `maxIterations` increased. If that recovery does not complete the domain outcome, the next strategy attempt is selected until the separate budget is exhausted; then `strategyExhausted` mapping is applied exactly once.

Strategy Actions count toward loop `maxActions` and budget. Their capability binding is frozen and validated like any AtomicStage binding. They therefore remain grants from the same canonical Run even before ECP-7 supplies the independent Session executor.

Alternative considered: let the launcher perform the strategy ladder after an `exhausted` terminal. Rejected because it would mutate behavior outside the frozen plan, lose one-Run recovery, and recreate prompt-owned counters.

### D5: Blocked retries and human escalation use durable waits

Below `sameBlockerAttempts`, a blocked loop phase uses the existing `domain-blocked` wait and exact optimistic `resume`; a resumed phase is a new attempt with the same phase NodeId and a new occurrence. At the threshold, the shared policy applies `blocked`:

- `strategy` admits the next strategy attempt if budget remains.
- `human-required` replaces the phase wait with a new canonical `human-required` wait carrying loop path, phase, blocker fingerprint, reason code, evidence, and the declared outcome code.
- `exit`, `escalate`, or `fail` applies the declared typed outcome.

The `human-required` wait projects only versioned `decision` (`retry` or `escalate`), run-global `escalate`, and `cancel` controls. A decision commits a dedicated transition with the WaitId, decision, and evidence before removing the wait. `retry` re-enters through a new attempt; `escalate` applies the frozen blocked outcome. Stale/wrong WaitIds and replayed decisions remain idempotent or fail closed under the existing control rules.

Cancellation remains Run-global and terminal. Infrastructure, uncertain-effect, capability, workspace, and reservation waits keep their existing semantics; this Change does not conflate them with a domain blocker.

Alternative considered: reuse a Gate wait. Rejected because a Gate is authored graph control, while human-required is a derived lifecycle state with blocker identity and streak evidence. Sharing the `decision` command is useful; sharing the wait kind would erase why the user is being asked.

### D6: Loop-local limits survive lowering and are admitted atomically

`RuntimePlanBoundedLoopNode` retains the complete authored `limits` and lifecycle policy, not just `maxIterations`. Before any loop action is admitted, the shared reducer counts stable actions under that loop path and computes budget use. In v1 of this contract, one admitted action consumes one budget unit; the separate `maxActions` cap remains useful because it is an absolute safety bound while `budget` is the author-controlled work allowance. Strategy and blocked retries consume both.

If admitting a candidate would exceed a loop-local bound, the reconciler applies the matching lifecycle exit without admitting the action. The Record's existing global limits remain the outer safety ceiling; the effective admission is the stricter of global and loop-local bounds. A global cap never gets mislabeled as a loop-domain outcome.

Alternative considered: rely only on Record-global `maxActions`. Rejected because two loops in one future plan need independent budgets and because the public Definition already claims loop-local limits that lowering currently discards.

### D7: Typed lifecycle outcome is additive to domain projections

Add a versioned `bounded-loop-lifecycle/1` `ChangeRunView` section per loop:

```ts
interface BoundedLoopLifecycleViewSection {
  kind: 'bounded-loop-lifecycle';
  version: 1;
  loopPath: string;
  bodyKind: 'review-cycle' | 'goal-cycle' | 'composite';
  state: 'running' | 'waiting' | 'strategizing' | 'human-required' | 'terminal';
  iteration: number;
  phase: string;
  limits: { iterations: UsedMax; actions: UsedMax; budget: UsedMax };
  progressFingerprint?: Digest;
  stallStreak: number;
  blockerFingerprint?: Digest;
  blockedStreak: number;
  strategy: { attempts: number; maxAttempts: number; active?: number };
  wait?: { waitId: WaitId; kind: string; reasonCode?: string };
  outcome?: {
    kind: 'completed' | 'iteration-limit' | 'action-limit' | 'budget-limit' |
      'stalled' | 'blocked' | 'strategy-exhausted' | 'failed' | 'cancelled';
    disposition: 'exit' | 'escalate' | 'fail' | 'cancel';
    value?: string;
  };
}
```

The existing `review-cycle/1` section continues to own findings and actors. The existing `goal/1` section continues to own variant, score, satisfaction, and gaps, but its local stall/budget fields are derived from the shared section or retained only as compatibility mirrors with parity assertions. CLI text/JSON, Management API, shared UI types, and Operations consume the same new section and never recompute counters.

An `exit` lifecycle disposition marks the loop node complete and allows its configured tail while preserving a non-success reason in the lifecycle section. Only a domain completion (`clean`/`satisfied`) is projected as `outcome.kind: completed`. Review ship guards continue to require the review domain outcome to be clean; a research report tail may intentionally continue after a typed non-success lifecycle exit.

Alternative considered: add all fields directly to both domain sections. Rejected because it duplicates the shared contract, guarantees drift, and leaves generic Composite loops without an observable lifecycle.

### D8: Compatibility is explicit and authored v2 is strict

Authored v2 loops without `lifecycle.version: 1` fail preparation with path-addressed diagnostics. This is the intentional breaking part of the Change and forces new v2 sources to state their real behavior.

Legacy v1 inputs remain accepted. Normalization materializes a complete lifecycle using declared `loopStallLimit`/`blockedThreshold` where available and conservative compatibility values otherwise. Until the next child reauthors built-ins at v2, v1 normalization does not invent a strategy capability: mechanical exits use explicit `exit`/`human-required`/`escalate` mappings that preserve the prior clean/satisfied versus exhausted behavior. The normalized policy is visible in preparation and the plan digest, never hidden as runtime defaulting.

Stored immutable plans and Records keep their current versions only if the codec can decode the additive policy unambiguously. If not, bump the internal runtime-plan/Record format at the existing single decode boundary and retain read-only inspection for old terminal Runs; never guess a missing policy for a live stored Run.

### D9: Verification is matrix-first and serialized

Tests lock the contract in this order:

1. Definition/read/canonicalization diagnostics and plan-digest sensitivity.
2. Runtime-plan decode/lowering fidelity for every limit, threshold, strategy binding, and exit.
3. Shared reducer tables for progress change/no-change, same/different blockers, every limit, strategy materiality, and every disposition.
4. ReviewCycle and GoalLoop adapter tests proving their domain results remain distinct while lifecycle decisions match.
5. Canonical blocked retry, human decision, strategy/recovery, cancellation, crash-before/after-commit, ack-loss, and fresh-process replay.
6. `ChangeRunView`, CLI, API, and Operations parity, including additive unknown-section tolerance.

Build and test commands run serially because multiple build/test processes mutate `dist/`. Focused tests follow `test/AGENTS.md`; path expectations use Node path helpers on Windows and POSIX.

## Risks / Trade-offs

- **[Scope growth from a real strategy path]** Strategy requires a frozen capability, stable identities, and recovery rather than just another counter. → Keep the strategy action/result contract narrow and reuse existing Action, capability-binding, evidence, and settle machinery.
- **[Duplicate derived state]** Adding lifecycle fields to each domain reducer would create multiple truths. → Keep the shared lifecycle snapshot derived from plan + Record and expose it as one additive view section.
- **[Blocked retry regression]** Existing first-match action reads can strand resumed phases. → Replace them with one stable latest-attempt selector and add blocked→resume→success tests for ReviewCycle and GoalLoop before adding streak logic.
- **[Strategy claims material change without proof]** An agent-supplied flag is not evidence. → Compare canonical domain progress fingerprints before and after the recovery iteration.
- **[Compatibility digest churn]** Materializing lifecycle policy changes normalized plans and fixtures. → Land shared lifecycle before built-in v2 migration, update fixtures once per dependency boundary, and keep v1 authored sources unchanged.
- **[Research tail ambiguity]** Loop completion and goal success are different. → Preserve both lifecycle reason/disposition and domain outcome; downstream continuation follows the frozen lifecycle exit, while reports never label a non-satisfied goal as satisfied.
- **[Old live Run decoding]** A policy-free stored plan cannot safely acquire new behavior. → Fail closed for live unsupported formats and keep read-only terminal inspection; do not default during resume.

## Migration Plan

1. Land codecs, validation, canonicalization, and lowering while keeping current built-ins on normalized v1 compatibility policies.
2. Land the shared lifecycle reducer, latest-attempt selection, typed blocker/strategy results, human-required wait, and reconciler decisions behind the sealed runtime-plan contract.
3. Adapt ReviewCycle, GoalLoop, and generic Composite-body projection; remove domain-owned caps/stall decisions only after parity tests pass.
4. Add CLI/API/Operations projection and cross-plane tests.
5. Let the dependent built-in migration Change author explicit v2 lifecycle policies and strategy capabilities; let the Canvas Change add authoring controls.

Rollback is code-level: before any v2 built-in is authored, reverting this Change restores prior normalization and runtime behavior without rewriting user v1 sources. Once explicit v2 policies are published, rollback requires retaining the new read/diagnostic codec even if execution is disabled.

## Open Questions

None for implementation. Capability selection for each built-in strategy is intentionally deferred to the dependent built-in migration Change; this Change proves the contract with authored v2 fixtures and compatibility-normalized current built-ins.
