# 0.1.6 Executable Composite Pipelines — Decomposition Plan

## Decision

Take the `auto-decompose` stage. The 0.1.6 scope contains several distinct,
review-heavy capabilities that share an ordered contract. The parent
`executable-composite-pipelines` Change is a planning and delivery container;
implementation is delegated to seven child Changes.

All children use the decompose-free `small-feature` Pipeline and run strictly
serially. The current Codex host supports native collaboration and therefore
executes at Tier A, but the slices intentionally deepen the same Pipeline
definition, compiler, run-state, management API, Canvas, and Operations seams.
There is still no honest non-overlapping parallel cohort.

## Current Codex-native execution contract

- Host/runtime/dispatch are Tier A / `codex` / `native`.
- A new worker is dispatched with `spawn_agent`; an idle worker receives its
  next turn through `followup_task`; `send_message` is only for intermediate
  guidance while that worker is still running.
- A Codex-native worker's final response is delivered to the LEAD
  automatically and is not duplicated with a completion message.
- `wait_agent` is reserved for a real dependency barrier and, when needed, is
  used as one event-driven wait rather than a 30/60-second polling loop.
- Native `agentId` values are session handles and are never resurrected after
  a host-session restart. Resume uses the latest handoff first, a real
  transcript second, and planning artifacts plus run-state as an explicitly
  recorded cold-reconstruction fallback. No `threadId`, `turnId`, transcript,
  or replacement identity is invented.

## Dependency DAG

```text
ecp-definition-v2
  -> ecp-run-spine
    -> ecp-review-cycle
      -> ecp-custom-composite
        -> ecp-goal-loop
          -> ecp-full-feature
            -> ecp-product-closure
```

## Child Changes

### 1. `ecp-definition-v2`

Establish the public language and compiler seam without claiming runtime
ownership yet.

Scope:

- Pipeline Definition v2 envelope and discriminated node vocabulary
- stable node/source identity, typed ports/outcomes, limits and exits
- v1 flat/legacy-loop normalization
- immutable `ChangeRunPlan` contract, digest, validation, and compiler errors
- server wire types plus v1/v2 detail/save/export round-trip
- Canvas v2 root-graph draft, AtomicStage/Gate/Choice rendering and validation
- explicit “not executable by reconciler yet” capability reporting

Likely seams:

- `src/core/pipeline-registry/**`
- a new compiler/definition module under `src/core`
- `src/core/management-api/pipelines.ts` and wire types
- `packages/ui/src/api/types.ts`, `packages/ui/src/canvas/**`
- pipeline-definition and Canvas specs/tests

Acceptance:

- unversioned/v1 definitions still normalize and round-trip
- unknown versions fail closed
- v2 definition -> save/detail/export -> compile preserves semantic plan/digest
- Canvas and server reject the same invalid root graph
- v2 cannot accidentally enter a prompt-owned or partial reconciler runtime

Why separate:

Every later child consumes this interface. Mixing the public grammar, compiler,
runtime journal, loop reducers, and UI controls in one diff would make the
contract impossible to review independently.

### 2. `ecp-run-spine`

Create the deterministic Change Run spine and prove it with the simple
`bug-fix` path.

Scope:

- canonical durable Run Record and atomic validated result commit
- pure `reconcile(plan, record) -> NextActions`
- stable run/node/invocation/attempt/effect identity
- typed Agent/command/host action and result adapters
- Gate/suspend/finish/escalate/cancel, crash recovery, definition drift checks
- launch-time `engine: legacy | reconciler` ownership freeze
- CLI/JSON run/status/resume/cancel
- Change-run Operations list/detail, root frontier, active invocation and wait reason
- `bug-fix` simple path dogfood; adaptive complex path suspends fail-closed

Likely seams:

- new `src/core/change-run/**` deep module
- pipeline registry/compiler integration
- CLI pipeline/run commands
- management runs API, Board/Operations UI, shared wire contracts
- focused reducer, journal, failure-injection, CLI/API/UI parity tests

Acceptance:

- identical plan + committed record yields identical next actions
- crash-before/after-commit tests never double-admit a completed invocation
- Operations and CLI project the same canonical frontier/wait reason
- legacy Run recovery remains unchanged when reconciler ownership is off
- `bug-fix` complex adaptive outcome cannot fall through to the legacy loop

Why separate:

This is the smallest executable vertical proof. It gives later Composite work a
real owner and journal instead of letting each loop invent its own run-state.

### 3. `ecp-review-cycle`

Add the first bounded Composite consumer and close the complete `bug-fix` and
`small-feature` paths.

Scope:

- `CompositeRef` and `BoundedLoop` plan/runtime semantics
- built-in ReviewCycle body plan and hierarchical identities
- structured Review/Triage/Fix/Re-review results and reducer
- author != verifier enforcement
- round/stall/blocked/strategy limits and explicit exits
- fail-closed ship guard for open Blocker/Major findings
- Canvas Composite/loop body, limits/exits/outcome-port editing
- Operations composite path, round/phase, findings, actor, evidence and decisions
- Run Record-derived review-cycle compatibility report
- `rasen-review-cycle` standalone compatibility wrapper

Acceptance:

- interruption/recovery works at review, fix, and re-review boundaries
- cap with an open Major never makes ship ready
- same actor as fixer and verifier is rejected
- malformed results cannot commit
- real finding -> fix -> independent re-review completes
- `bug-fix` adaptive complex and `small-feature` use the same ReviewCycle plan

Why separate:

ReviewCycle is the first complex consumer of the generic spine and supplies a
bounded, evidence-heavy proof before the public Custom Composite surface opens.

### 4. `ecp-custom-composite`

Expose the constrained public authoring contract and prove built-in/custom
parity.

Scope:

- reusable Custom Composite definition/reference contract
- typed inputs, artifact outputs and outcomes
- Canvas create/reference/fold/expand/body editing
- server and Canvas validation for recursion, nested loops, missing exits,
  ordinary cycles, capability and budget violations
- save/detail/export and compiler parity with built-in Composite
- Operations display for custom paths without custom-specific state
- at least one Canvas-authored Custom Composite real Run

Acceptance:

- built-in and Custom Composite compile through the same public interface
- recursive calls, nested loops and missing exits fail at both authoring and server seams
- Custom Composite round-trip preserves body/limits/ports
- real Canvas-authored definition reaches completion through the same Reconciler

Why separate:

This is a public product capability with its own security and authoring risks.
It depends on a proven built-in Composite lifecycle but must not be reduced to a
post-release UI wrapper.

### 5. `ecp-goal-loop`

Use GoalLoop as the second real bounded-loop consumer and converge the goal
entry.

Scope:

- GoalLoop Measure/Evaluate/Research plans and domain result schemas
- shared round/attempt, admission, stall/blocked, resume/cancel lifecycle
- command measure gate and independent evaluation gate
- prose work product and report-only tail
- Canvas goal contract, limits and exit mapping
- Operations score/evaluation/gaps/stall/cap/report views
- `rasen-goal` as completion preset/launcher

Acceptance:

- Measure and Evaluate both complete real iterations
- GoalLoop shares lifecycle primitives with ReviewCycle without sharing domain reducers
- canonical Run Record, not `goal-run.json`, owns completion
- legacy goal artifacts are derived compatibility projections

Why separate:

The second consumer is the falsification test for the generic loop interface.
It should be reviewed after ReviewCycle and Custom Composite semantics are
stable enough to challenge.

### 6. `ecp-full-feature`

Complete the root graph vocabulary and migrate the largest built-in Pipeline.

Scope:

- deterministic Condition/Choice evaluation
- budgeted FanOut/Join, collect-all barrier, concurrency, timeout and cancel
- multi-reviewer evidence merge and unified open frontier
- Canvas condition/FanOut/Join authoring and barrier validation
- Operations parallel frontier, member state, budget admission and join outcome
- complete `full-feature` reconciler-owned dogfood

Acceptance:

- parallel readiness and join outcomes deterministically recompute
- collect-all does not advance early
- budget/timeout/cancel produce explicit durable outcomes
- Canvas declaration, compiled plan, runtime and Operations pass parity tests
- all Change-level built-in Pipelines are now executable by the Reconciler

Why separate:

Parallel barriers materially expand the kernel and Operations model. They
should not obscure the bounded-loop review or goal migrations.

### 7. `ecp-product-closure`

Close the 0.1.6 product and compatibility surface; do not add a new runtime
model.

Scope:

- `rasen-auto`, `rasen-goal`, and `rasen-review-cycle` thin launcher/preset/adapter convergence
- reconciler engine selection/default/fallback and legacy recovery policy
- complete CLI/Canvas/Operations product wording and capability discovery
- built-in and Custom Composite end-to-end dogfood matrix
- migration/user documentation and 0.1.6 version/release contract
- remove duplicate prompt-owned mechanical rules where replacement evidence exists

Acceptance:

- no entry owns independent mechanical progression
- one Run has one engine owner and one canonical state
- all 0.1.6 exit conditions in the research document have evidence
- full root/composite crash-recovery and cross-plane parity suite passes
- packaging/build/release checks pass

Why separate:

This is an integration and deletion slice. It can only be reviewed honestly
after every consumer has landed, and it prevents compatibility code from
becoming an accidental second implementation.

## LEAD self-audit

- Slice coherence: each child has one dominant product proof and a bounded
  interface expansion.
- Dependency correctness: every child consumes only contracts made review-clean
  by its direct predecessor.
- Independence: no safe parallel cohort exists because every child overlaps the
  shared compiler/runtime/wire/UI seams; strict serial execution is required.
- Scope: Issue Execution Plan, portfolio as a product feature, distributed
  scheduling, recursive calls, nested loops, arbitrary scripts, and cross-project
  Operations remain excluded.
- Delivery: each review-clean child creates a local commit; only the parent
  portfolio pushes and opens one PR to `dev/0.1.6`.

## Shared interface problem for design-it-twice

The first two children must lock a deep module with a small caller interface:

```ts
normalizePipelineDefinition(source): NormalizedPipelineDefinition
compileChangeRunPlan(definition, sources): CompileResult<ChangeRunPlan>
reconcile(plan, record): NextActions
commitInvocationResult(plan, record, result): CommitResult
projectChangeRun(plan, record): ChangeRunView
```

The exact split and types are not yet approved. Three independent designs will
compare a minimal interface, an extensible interface, and a default-caller-first
interface before the first child proposal is finalized.
