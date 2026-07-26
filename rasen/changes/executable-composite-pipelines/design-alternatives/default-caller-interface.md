# Design alternative C: default-caller-first ECP interface

## Recommendation

Make the public runtime Module a small `ChangePipelineRuntime` facade optimized
for the dominant call:

```ts
await runtime.start({ change, pipeline: 'small-feature' });
await runtime.resume({ change });
```

Both a built-in Pipeline and a Canvas-authored Pipeline are launched by the
same registered Pipeline name. Canvas saves a Pipeline Definition v2 through
the existing validation/registry path first; launch never receives a special
Canvas graph or a second execution model.

The facade resolves and compiles the Definition, freezes the
`ChangeRunPlan`, creates or loads the canonical Run Record, invokes the
Pipeline Reconciler, executes typed actions through injected Adapters, commits
validated results, and continues until the Run reaches a quiescent point. The
caller receives an Operations-shaped projection, not the mutable Record.

This is the preferred Interface because it has high **Depth**: a two-method
common surface hides version normalization, compilation, durable recovery,
optimistic concurrency, identity, action execution, result validation, and
projection. That gives launcher, CLI, management API, and test callers high
**Leverage** without weakening the one-truth invariant.

## Module boundary

### Public Module

```ts
export interface ChangePipelineRuntime {
  /**
   * Start one registered Change-level ECP and drive it until it is waiting,
   * terminal, or has exhausted the configured drive budget.
   *
   * A retry with the same requestKey resolves to the same Run.
   */
  start(request: StartChangePipeline): Promise<ChangeRunReceipt>;

  /**
   * Load the existing Run for a Change (or the named Run), honor its frozen
   * engine owner and ChangeRunPlan, and drive it to the next quiescent point.
   */
  resume(request: ResumeChangePipeline): Promise<ChangeRunReceipt>;

  /** Read-only Operations projection. Never exposes mutable canonical state. */
  inspect(ref: ChangeRunRef): Promise<ChangeRunView>;

  /**
   * Submit a user/Operations control against an observed Record version.
   * Controls append a validated transition; they never patch a client view.
   */
  control(request: ChangeRunControlRequest): Promise<ChangeRunReceipt>;
}

export interface ChangeRef {
  projectRoot: string;
  changeId: string;
}

export interface ChangeRunRef {
  change: ChangeRef;
  runId?: RunId;
}

export interface StartChangePipeline {
  change: ChangeRef;

  /**
   * Registered built-in or saved Custom Pipeline. A Canvas-authored
   * definition reaches this Interface by the same name-based path.
   */
  pipeline: PipelineName;

  /** Values checked against Definition v2's declared input contract. */
  inputs?: Readonly<Record<string, JsonValue>>;

  /**
   * Idempotency at launch boundaries (CLI/API/session retry). Adapters should
   * supply it; direct in-process callers may omit it and receive a fresh Run.
   */
  requestKey?: StartRequestKey;
}

export interface ResumeChangePipeline extends ChangeRunRef {
  /**
   * Optional bound for actions committed by this call. The runtime default
   * prevents a long BoundedLoop from monopolizing one host turn.
   */
  driveBudget?: number;
}

export interface ChangeRunReceipt {
  ref: Required<ChangeRunRef>;
  disposition: 'waiting' | 'progressed' | 'terminal';
  view: ChangeRunView;
}

export interface ChangeRunView {
  runId: RunId;
  change: ChangeRef;
  pipeline: PipelineName;
  engine: 'legacy' | 'reconciler';
  recordVersion: number;
  status:
    | 'running'
    | 'waiting'
    | 'completed'
    | 'escalated'
    | 'failed'
    | 'cancelled';
  frontier: readonly RunFrontierItem[];
  activeInvocations: readonly ActiveInvocationView[];
  compositePath?: readonly NodeId[];
  round?: number;
  phase?: string;
  wait?: WaitView;
  evidence: readonly EvidenceView[];
  terminal?: TerminalRunView;
}

export type ChangeRunControlRequest =
  | {
      ref: Required<ChangeRunRef>;
      expectedRecordVersion: number;
      command: { kind: 'resume' };
    }
  | {
      ref: Required<ChangeRunRef>;
      expectedRecordVersion: number;
      command: { kind: 'cancel'; reason?: string };
    }
  | {
      ref: Required<ChangeRunRef>;
      expectedRecordVersion: number;
      command: {
        kind: 'decision';
        decisionId: DecisionId;
        outcome: string;
        evidence?: readonly EvidenceRef[];
      };
    };
```

`start` and `resume` are the optimized common Interface. `inspect` and
`control` are the narrower Operations Interface. Keeping them on the same
facade gives callers one discovery point while keeping mutation versioned and
explicit.

### Pure kernel Interface

The deterministic kernel is a separate, side-effect-free Seam used by the
facade and directly by reducer tests:

```ts
export interface PipelineReconciler {
  reconcile(
    plan: ChangeRunPlan,
    record: CanonicalRunRecord
  ): ReconcileDecision;
}

export interface ReconcileDecision {
  actions: readonly NextAction[];
  quiescence:
    | { kind: 'none' }
    | { kind: 'waiting'; reason: WaitReason }
    | { kind: 'terminal'; outcome: TerminalOutcome };
}
```

The Reconciler returns typed actions only. It does not read files, call an
Agent, execute a command, render Operations, update Markdown, or mutate a Run
Record. This makes `reconcile(plan, record)` mechanically pure and permits
exact replay in tests.

## Default caller examples

### `rasen-auto`: select, then launch

```ts
const selected = await launchPolicy.select(task, projectRoot);

const receipt = await runtime.start({
  change: { projectRoot, changeId },
  pipeline: selected.pipeline,
  inputs: selected.inputs,
  requestKey: commandInvocationId,
});

renderRun(receipt.view);
```

`rasen-auto` owns selection policy only. It does not fetch build order, mark a
stage complete, interpret a Composite, advance a BoundedLoop, or write
`auto-run.json`.

### `rasen-goal`: add a completion preset, then launch

```ts
const receipt = await runtime.start({
  change,
  pipeline: goalPreset.pipeline,
  inputs: {
    completion: goalPreset.completionContract,
    workProduct: goalPreset.workProduct,
  },
  requestKey: commandInvocationId,
});
```

The Measure/Evaluate distinction is typed Definition input and compiled plan
data. `rasen-goal` does not own a loop reducer.

### Resume after a host or process interruption

```ts
const receipt = await runtime.resume({ change });

if (receipt.disposition === 'waiting') {
  renderWait(receipt.view.wait);
}
```

The caller does not re-supply the Pipeline Definition, reconstruct a frontier,
or decide which round to run. Resume uses the frozen engine and
`ChangeRunPlan` attached to the canonical Run Record.

### Operations control

```ts
const current = await runtime.inspect({ change, runId });

const next = await runtime.control({
  ref: { change, runId },
  expectedRecordVersion: current.recordVersion,
  command: { kind: 'resume' },
});
```

The version precondition prevents two Operations clients from making
conflicting decisions based on the same stale projection.

## Invariants and required ordering

### Start ordering

The Implementation SHALL perform these steps in order:

1. Resolve the `requestKey`; return the existing Run if the same accepted
   launch was already committed.
2. Resolve the registered Pipeline name from the normal project > user >
   package registry. Built-in and Canvas-authored Custom definitions use the
   same path.
3. Parse the versioned source, normalize v1 to Definition v2, and run complete
   structural, capability, budget, Composite-call, and BoundedLoop validation.
4. Compile exactly once to an immutable `ChangeRunPlan`, including source
   revision/digest, plan digest, stable node identities, typed outcomes, and
   policy.
5. Resolve `engine: legacy | reconciler` through the compatibility Adapter and
   freeze it when the Run is created. The common caller does not choose an
   engine ad hoc.
6. Atomically persist the plan reference/content and initial canonical Run
   Record before admitting any action.
7. Drive the Run through read -> reconcile -> admit -> execute -> validate ->
   compare-and-commit until waiting, terminal, or drive budget.
8. Project the committed Record to `ChangeRunView`.

No action can execute before steps 1-6 commit.

### Resume ordering

1. Resolve the Run by `runId`, or the Change's single active Run.
2. Load and validate the canonical Record plus its frozen `ChangeRunPlan`.
3. Reject missing/mismatched plan digest or engine ownership. Do not silently
   recompile the current Pipeline source as replacement runtime truth.
4. Detect source drift for Operations diagnostics only. Drift does not mutate
   the frozen plan.
5. Reconcile from the last committed Record version.
6. Before retrying an effectful invocation, apply its Adapter-specific
   recovery policy using the stable invocation identity.
7. Execute and commit only validated results, then project.

### Cross-plane invariants

- Pipeline Definition v2 is the declaration truth.
- Canvas edits that Definition; it does not maintain an execution graph.
- `ChangeRunPlan` is immutable for one Run.
- The canonical Run Record is the only runtime truth.
- Operations, timelines, `auto-run.json`, `goal-run.json`, and Markdown reports
  are projections of committed transitions.
- Root DAG, Composite body, and Composite call graph remain acyclic.
- Feedback exists only in a bounded `BoundedLoop` with complete exits.
- No recursive Composite calls and no nested loops in 0.1.6.
- Root and Composite execution share one Pipeline Reconciler and one Record.
- Only a validated result committed at the expected Record version can advance
  state.
- Open Blocker/Major findings cannot make ship ready.
- Author and verifier identity are checked by the Implementation, not trusted
  from prompt prose.
- Terminal and cancelled Runs emit no new action.

## Hidden Implementation

The facade hides the following Modules:

```text
ChangePipelineRuntime (public facade)
  ├─ DefinitionCatalog
  ├─ DefinitionNormalizer
  ├─ ChangeRunCompiler
  ├─ ChangeRunPlanStore
  ├─ CanonicalRunRecordStore
  ├─ PipelineReconciler
  ├─ ActionAdmissionPolicy
  ├─ ActionAdapterRegistry
  ├─ ResultValidatorRegistry
  ├─ ResultCommitter
  ├─ CompatibilityProjectionWriter
  └─ ChangeRunProjector
```

### Storage Seam

```ts
export interface CanonicalRunRecordStore {
  create(
    plan: ChangeRunPlan,
    seed: InitialRunRecord,
    requestKey?: StartRequestKey
  ): Promise<StoredRunRecord>;

  load(ref: Required<ChangeRunRef>): Promise<StoredRunRecord>;

  commit(
    ref: Required<ChangeRunRef>,
    expectedVersion: number,
    transition: ValidatedTransition
  ): Promise<StoredRunRecord>;
}
```

`commit` is compare-and-commit. The exact storage Implementation (JSONL, WAL
plus snapshot, or SQLite) stays hidden; none of those choices may leak into
the public Interface or Operations wire contract.

### Adapter Seam

```ts
export interface ActionAdapter<K extends NextAction['kind']> {
  readonly kind: K;

  recover(
    action: Extract<NextAction, { kind: K }>,
    context: InvocationRecoveryContext
  ): Promise<RecoveryDisposition>;

  execute(
    action: Extract<NextAction, { kind: K }>,
    context: ActionExecutionContext
  ): Promise<UntrustedActionResult>;
}

export interface ResultValidator<K extends NextAction['kind']> {
  validate(
    action: Extract<NextAction, { kind: K }>,
    result: UntrustedActionResult
  ): ValidatedActionResult<K>;
}
```

Agent, command, and host Adapters are dependencies of the runtime
Implementation. They never call `commit` themselves. This preserves the Seam:
Adapters perform effects; the runtime validates and atomically commits.

The existing Claude/Codex differences stay behind Agent Adapters. A host-driven
Claude Adapter may return a durable wait/dispatch action while a Codex Adapter
may execute a subprocess directly; neither changes the
Reconciler/result-commit contract.

## Error model

`ChangePipelineRuntime` throws a typed `EcpRuntimeError`. Waiting, escalation,
exhaustion, blocking, failure outcomes declared by the Definition, and
cancellation are Run state, not exceptions.

```ts
export class EcpRuntimeError extends Error {
  constructor(
    readonly code: EcpRuntimeErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly details?: Readonly<Record<string, JsonValue>>
  ) {
    super(message);
  }
}

export type EcpRuntimeErrorCode =
  | 'change_not_found'
  | 'pipeline_not_found'
  | 'definition_invalid'
  | 'inputs_invalid'
  | 'compile_failed'
  | 'active_run_ambiguous'
  | 'start_key_conflict'
  | 'plan_missing'
  | 'plan_digest_mismatch'
  | 'record_invalid'
  | 'record_version_conflict'
  | 'engine_owner_mismatch'
  | 'adapter_unavailable'
  | 'adapter_execution_failed'
  | 'result_schema_invalid'
  | 'evidence_missing'
  | 'identity_constraint_failed'
  | 'effect_recovery_uncertain';
```

Ordering/error rules:

- Definition and input errors occur before a Run or action is created.
- A `record_version_conflict` is retryable after re-inspection; the runtime
  never overwrites the winner.
- A missing or digest-mismatched frozen plan fails closed.
- Invalid Agent/command results remain uncommitted and cannot change frontier.
- An uncertain non-idempotent effect recovery produces a durable wait or
  escalation through policy; it is never guessed completed.
- Source drift is observable metadata, not a resume error, while the frozen
  plan remains available and valid.
- Adapter infrastructure failure is distinct from a domain `failed` outcome.

## Dependency direction and Locality

Dependency direction is inward:

```text
CLI / launch skills / Management API / Operations
                    │
                    ▼
          ChangePipelineRuntime facade
                    │
      ┌─────────────┼─────────────┐
      ▼             ▼             ▼
 Definition     Execution      Projection
 / compiler       kernel        adapters
      │             │             │
      └────── typed domain contracts ──────┘
```

- CLI, `rasen-auto`, `rasen-goal`, and `rasen-review-cycle` depend on the
  facade, never the Pipeline Reconciler directly.
- Canvas depends on Definition validation/save Interfaces, not runtime storage.
- Operations depends on `inspect/control`, not Record files.
- The Reconciler depends only on immutable `ChangeRunPlan` and canonical Record
  types.
- Storage and action technologies implement ports owned by the runtime Module.

This improves **Locality**: changing journal storage, Claude/Codex dispatch, or
timeline rendering remains local to an Adapter or hidden Module. Adding a new
Composite domain reducer changes the compiler/reducer registry and projections,
not every caller.

## Compatibility

### Definition compatibility

- Historical unversioned and v1 Pipeline definitions remain accepted.
- v1 flat stages and `stage.loop` normalize to Definition v2 before compile.
- Explicit unknown versions continue to fail closed.
- v2 save/detail/export round-trips without being flattened to v1.

### Run compatibility

- A legacy `auto-run.json` remains owned by `engine: legacy`; resume routes it
  through a `LegacyRunAdapter`.
- A reconciler Run freezes `engine: reconciler` in its canonical Record and
  never resumes through prompt-owned mechanics.
- Do not migrate an in-progress legacy Run into a new Record in place. A user
  may start a new reconciler Run explicitly after the legacy Run reaches a safe
  boundary.
- `auto-run.json`, `goal-run.json`, and review/ship Markdown generated for a
  reconciler Run are one-way compatibility projections. External edits do not
  advance the Run.
- Existing `rasen pipeline resume <change>` becomes a thin dispatch Adapter:
  legacy input uses legacy behavior; canonical input calls
  `ChangePipelineRuntime.resume`.
- `auto-decompose` and portfolio state stay on the legacy/Issue-planning side
  in 0.1.6 and never enter this Change-level facade.

### Product compatibility

- Built-ins and saved Canvas-authored Custom Pipelines are both selected by
  name; callers have no provenance branch.
- `rasen-auto` supplies selection, `rasen-goal` supplies a completion preset,
  and standalone `rasen-review-cycle` supplies wrapper inputs. None owns
  mechanical progression.
- Operations receives the same `ChangeRunView` projection used by CLI status,
  preventing a second observation truth.

## Trade-offs

### Benefits

- The most common launch/resume caller is one operation with no compiler,
  Record, or action loop knowledge.
- Registered-name launch makes built-in/Canvas parity structural.
- Drive-to-quiescence hides repetitive reconcile/execute/commit mechanics.
- Opaque canonical state prevents callers from becoming peer writers.
- Versioned control commands make Operations races explicit.
- Adapter injection preserves runtime portability without making the public
  Interface an open plugin language.
- The pure kernel remains independently testable despite the convenient facade.

### Costs

- `start`/`resume` may be long-lived operations. The drive budget and durable
  waiting states are required to bound a host turn.
- Advanced callers cannot manually mutate or step the Record. They must use
  `control` or a test-only kernel harness.
- Launch by registered name requires Canvas drafts to save successfully before
  execution. This is intentional: unsaved client graph state is not executable
  truth.
- The facade does more orchestration internally, so its failure-injection and
  compare-and-commit tests must be unusually strong.
- An opaque Record can make debugging less convenient; Operations projections
  and an internal diagnostic reader must compensate without becoming writers.
- Auto-resolving a Change's active Run is convenient but ambiguous when several
  Runs are active. That case fails with `active_run_ambiguous` and requires an
  explicit `runId`.

## Rejected caller shapes

### Expose compile/reconcile/commit to every launcher

```ts
const definition = normalize(source);
const plan = compile(definition);
const record = loadRecord(change);
const actions = reconcile(plan, record);
// caller executes, validates, and commits
```

Rejected because every launcher would reimplement ordering, retries, recovery,
and commit. It has a small kernel Interface but poor system Depth and poor
caller Locality.

### Pass a Canvas draft directly to `start`

Rejected because it creates an execution path around registry save, server
validation, source revision, and digest. Built-in and Custom would no longer
share one source contract.

### Return the canonical Run Record to Operations

Rejected because client code would couple to journal/storage layout and would
be tempted to patch it. Operations needs a projection plus versioned commands.

### Put `engine` on every common start call

Rejected because engine ownership is rollout/compatibility policy, not task
intent. An injected engine-selection Adapter resolves it once and the Record
freezes it. Administrative/test entry points may override that Adapter
explicitly; normal launchers should not.

## Decision summary

The recommended deep Module is:

```ts
runtime.start({ change, pipeline, inputs? })
runtime.resume({ change, runId? })
runtime.inspect(ref)
runtime.control({ ref, expectedRecordVersion, command })
```

Its Implementation owns the only legal path from Definition v2 to immutable
`ChangeRunPlan`, Pipeline Reconciler action, validated commit, canonical Run
Record, and Operations projection. The common caller stays trivial precisely
because deterministic recovery and one-truth enforcement stay hard and deep
inside the Module.
