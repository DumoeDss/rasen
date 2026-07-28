# Alternative B — Extensible ECP Interface

## Position

Maximize safe flexibility by keeping the Reconciler's control algebra closed while
making three things extensible:

1. Definition v2 may declare new typed AtomicStage capabilities.
2. Authors may define new non-recursive Composite graphs from the fixed node
   vocabulary.
3. Canvas, Operations, CLI, and compatibility outputs are named, read-only
   projections of the same compiled plan and canonical Run Record.

This gives Custom Composite authors Leverage without admitting arbitrary scripting,
dynamic control nodes, recursive Composite calls, or nested BoundedLoop scopes.
Adding a capability does not require changing Canvas graph mechanics or the
Reconciler. Adding a new control primitive does require an explicit Definition v2
revision and Reconciler change.

## Module and Seam placement

The design has two deep Modules.

- The **Definition Module** owns normalization, validation, source resolution,
  capability checking, and compilation. Its Interface is the authoring/compiler
  Seam used by the registry, management HTTP Interface, and Canvas.
- The **Change Run Module** owns deterministic reconciliation, validated
  transition reduction, and projections. Its Interface is the execution Seam used
  by CLI launchers, the runtime host, and Operations.

Storage and external execution are internal seams. Their Adapters do not appear in
Definition v2 and cannot add control semantics.

## TypeScript-level Interface

The following is an Interface sketch, not an Implementation.

```ts
type Brand<T, Name extends string> = T & { readonly __brand: Name };

type DefinitionDigest = Brand<string, "DefinitionDigest">;
type PlanDigest = Brand<string, "PlanDigest">;
type CapabilityDigest = Brand<string, "CapabilityDigest">;
type RunId = Brand<string, "RunId">;
type RecordVersion = Brand<number, "RecordVersion">;
type NodeId = Brand<string, "NodeId">;
type NodePath = Brand<string, "NodePath">;
type InvocationId = Brand<string, "InvocationId">;
type ActionId = Brand<string, "ActionId">;
type EvidenceRef = Brand<string, "EvidenceRef">;
type ArtifactRef = Brand<string, "ArtifactRef">;
type SchemaRef = Brand<string, "SchemaRef">; // versioned, e.g. schema:ReviewResult@1
type CapabilityRef = Brand<string, "CapabilityRef">; // versioned
type CompositeRef = Brand<string, "CompositeRef">; // versioned
type ProjectionRef = Brand<string, "ProjectionRef">;

type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };

type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
```

### Definition v2

```ts
interface PortContract {
  readonly inputs: Readonly<Record<string, SchemaRef>>;
  readonly artifacts: Readonly<Record<string, SchemaRef>>;
  readonly outcomes: readonly string[];
}

interface Binding {
  readonly from:
    | { readonly kind: "run-input"; readonly port: string }
    | { readonly kind: "node-output"; readonly node: NodeId; readonly port: string }
    | { readonly kind: "artifact"; readonly node: NodeId; readonly port: string };
}

interface NodeBase<K extends string> {
  readonly id: NodeId;
  readonly kind: K;
  readonly requires: readonly NodeId[];
  readonly inputs: Readonly<Record<string, Binding>>;
  /** Namespaced, non-semantic metadata; round-tripped but ignored by compilation. */
  readonly annotations?: Readonly<Record<`${string}/${string}`, Json>>;
}

interface AtomicStageNode extends NodeBase<"atomic"> {
  readonly capability: CapabilityRef;
}

interface GateNode extends NodeBase<"gate"> {
  readonly mode: "proof" | "approval";
  readonly policy: CapabilityRef;
  readonly failClosed: true;
}

interface ChoiceNode extends NodeBase<"choice"> {
  /** A trusted pure capability over committed, schema-validated values. */
  readonly policy: CapabilityRef;
  readonly cases: Readonly<Record<string, NodeId | RootExit>>;
}

interface CompositeRefNode extends NodeBase<"composite"> {
  readonly composite: CompositeRef;
  readonly outcomeMap: Readonly<Record<string, NodeId | RootExit>>;
}

interface BoundedLoopNode extends NodeBase<"bounded-loop"> {
  /** One Composite invocation is one round. */
  readonly body: CompositeRef;
  readonly limits: {
    readonly maxRounds: number;
    readonly stallRounds: number;
    readonly blockedThreshold: number;
    readonly maxStrategyAttempts?: number;
  };
  readonly outcomeMap: Readonly<
    Record<
      "complete" | "exhausted" | "stalled" | "blocked" |
      "human_required" | "failed" | "cancelled",
      NodeId | RootExit
    >
  >;
}

interface FanOutNode extends NodeBase<"fan-out"> {
  readonly memberCapability: CapabilityRef;
  readonly collectionPort: string;
  readonly maxMembers: number;
  readonly concurrency: number;
  readonly timeoutMs: number;
}

interface JoinNode extends NodeBase<"join"> {
  readonly fanOut: NodeId;
  readonly barrier: "collect-all";
  readonly policy: CapabilityRef;
}

interface FinishNode extends NodeBase<"finish"> {
  readonly outcome:
    | "success"
    | "exhausted"
    | "escalated"
    | "failed"
    | "cancelled";
}

type DefinitionNode =
  | AtomicStageNode
  | GateNode
  | ChoiceNode
  | CompositeRefNode
  | BoundedLoopNode
  | FanOutNode
  | JoinNode
  | FinishNode;

interface RootExit {
  readonly kind: "root-exit";
  readonly outcome: string;
}

interface DefinitionGraph {
  readonly nodes: readonly DefinitionNode[];
}

interface CompositeDefinitionV2 {
  readonly ref: CompositeRef;
  readonly contract: PortContract;
  /** A single invocation body is always a DAG. */
  readonly body: DefinitionGraph;
  readonly requiredCapabilities?: readonly CapabilityRef[];
}

interface PipelineDefinitionV2 {
  readonly version: 2;
  readonly name: string;
  readonly contract: PortContract;
  readonly root: DefinitionGraph;
  readonly composites: readonly CompositeDefinitionV2[];
  readonly annotations?: Readonly<Record<`${string}/${string}`, Json>>;
}
```

The Definition node union is deliberately closed. `CapabilityRef` and
`CompositeRef` are the extension points. Unknown semantic fields fail closed;
only namespaced `annotations` may be preserved without interpretation.

### Typed capability catalog

```ts
interface CapabilityDescriptor {
  readonly ref: CapabilityRef;
  readonly digest: CapabilityDigest;
  readonly mode: "agent" | "command" | "host" | "pure-policy";
  readonly input: Readonly<Record<string, SchemaRef>>;
  readonly output: Readonly<Record<string, SchemaRef>>;
  readonly outcomes: readonly string[];
  readonly effects: readonly (
    | "read-worktree"
    | "write-worktree"
    | "network"
    | "git"
    | "external-delivery"
  )[];
  readonly evidence: readonly SchemaRef[];
  readonly idempotency:
    | { readonly kind: "read-only" }
    | { readonly kind: "tree-reconcile" }
    | { readonly kind: "request-key"; readonly keyVersion: number }
    | { readonly kind: "must-suspend-if-ambiguous" };
  readonly allowedRoles?: readonly string[];
}

interface CapabilityCatalogSnapshot {
  readonly digest: CapabilityDigest;
  readonly capabilities: Readonly<Record<CapabilityRef, CapabilityDescriptor>>;
}
```

Definition v2 can reference only capabilities in the compiler's trusted catalog
snapshot. A Custom Composite cannot upload code, a predicate, an executable path,
or an Adapter. A `pure-policy` capability is trusted, versioned program code
registered by Rasen, not user-authored script text.

### Definition Module Interface

```ts
interface DefinitionDiagnostic {
  readonly severity: "error" | "warning";
  readonly code:
    | "unsupported_definition_version"
    | "schema_invalid"
    | "duplicate_node_id"
    | "ordinary_cycle"
    | "unresolved_composite"
    | "recursive_composite"
    | "nested_loop"
    | "unknown_capability"
    | "port_type_mismatch"
    | "missing_outcome_mapping"
    | "invalid_limit"
    | "unsatisfied_actor_constraint"
    | "insufficient_budget"
    | "capability_forbidden";
  readonly path: string;
  readonly message: string;
}

interface DefinitionSource {
  readonly value: unknown;
  readonly source: string;
  readonly revision: string;
  readonly digest: DefinitionDigest;
}

interface PreparedDefinition {
  readonly normalized: PipelineDefinitionV2;
  readonly diagnostics: readonly DefinitionDiagnostic[];
  readonly executable: boolean;
  readonly plan?: ChangeRunPlan;
}

interface EcpDefinitionModule {
  /**
   * Normalizes v1 or validates v2, resolves every Composite and capability,
   * and emits a plan only when no error diagnostic exists.
   */
  prepare(
    source: DefinitionSource,
    catalog: CapabilityCatalogSnapshot
  ): Result<PreparedDefinition, DefinitionReadError>;
}
```

One operation serves registry load, Canvas validation, save preflight, export
parity, and launch compilation. `prepare` returning a normalized definition and
diagnostics avoids separate, drifting Canvas and execution validators.

### Immutable ChangeRunPlan

```ts
interface ChangeRunPlan {
  readonly format: 1;
  readonly digest: PlanDigest;
  readonly definition: {
    readonly version: 1 | 2;
    readonly source: string;
    readonly revision: string;
    readonly digest: DefinitionDigest;
  };
  readonly capabilityCatalogDigest: CapabilityDigest;
  readonly engine: "reconciler";
  readonly root: CompiledGraph;
  readonly composites: Readonly<Record<CompositeRef, CompiledComposite>>;
  readonly capabilities: Readonly<Record<CapabilityRef, CapabilityDescriptor>>;
  readonly sourceMap: Readonly<Record<NodePath, string>>;
}
```

The compiled graph may lower several Definition v2 nodes into smaller internal
instructions. That internal instruction union is hidden Implementation, not a
public extension Seam. The plan freezes every referenced Composite revision,
capability descriptor, policy, and digest.

### Change Run Module Interface

```ts
interface CanonicalRunRecord {
  readonly format: 1;
  readonly runId: RunId;
  readonly engine: "reconciler";
  readonly planDigest: PlanDigest;
  readonly version: RecordVersion;
  readonly status:
    | "running"
    | "waiting"
    | "completed"
    | "escalated"
    | "failed"
    | "cancelled";
  readonly transitions: readonly CommittedTransition[];
  readonly invocations: Readonly<Record<InvocationId, CommittedInvocation>>;
  readonly evidence: Readonly<Record<EvidenceRef, CommittedEvidence>>;
}

type NextAction =
  | {
      readonly kind: "invoke";
      readonly actionId: ActionId;
      readonly invocationId: InvocationId;
      readonly node: NodePath;
      readonly capability: CapabilityRef;
      readonly adapter: "agent" | "command" | "host";
      readonly input: Json;
      readonly evidenceRequired: readonly SchemaRef[];
      readonly expectedRecordVersion: RecordVersion;
    }
  | {
      readonly kind: "reconcile-effect";
      readonly actionId: ActionId;
      readonly invocationId: InvocationId;
      readonly strategy: CapabilityDescriptor["idempotency"];
      readonly expectedRecordVersion: RecordVersion;
    }
  | {
      readonly kind: "await-command";
      readonly node: NodePath;
      readonly reason: WaitReason;
      readonly allowed: readonly RunControlCommand["kind"][];
      readonly expectedRecordVersion: RecordVersion;
    };

interface ReconcileDecision {
  readonly planDigest: PlanDigest;
  readonly recordVersion: RecordVersion;
  readonly state: "ready" | "waiting" | "terminal";
  readonly actions: readonly NextAction[];
  readonly terminal?: CanonicalRunRecord["status"];
}

type CommitInput =
  | { readonly kind: "start"; readonly runId: RunId; readonly inputs: Json }
  | { readonly kind: "admit"; readonly action: NextAction }
  | { readonly kind: "invocation-result"; readonly result: UntrustedInvocationResult }
  | { readonly kind: "effect-observation"; readonly observation: EffectObservation }
  | RunControlCommand;

type RunControlCommand =
  | {
      readonly kind: "resume";
      readonly expectedRecordVersion: RecordVersion;
      readonly decision?: Json;
    }
  | {
      readonly kind: "cancel";
      readonly expectedRecordVersion: RecordVersion;
      readonly reason: string;
    };

interface CommitResult {
  readonly previousVersion: RecordVersion | null;
  readonly record: CanonicalRunRecord;
  /** Convenience projection only; these transitions are already in `record`. */
  readonly committed: readonly CommittedTransition[];
}

interface ProjectionTypes {
  readonly "operations/change-run@1": OperationsChangeRunView;
  readonly "canvas/run-overlay@1": CanvasRunOverlay;
  readonly "cli/run-status@1": CliRunStatus;
  readonly "compat/auto-run@1": LegacyAutoRunProjection;
  readonly "compat/goal-run@1": LegacyGoalRunProjection;
  readonly "compat/review-report@1": ReviewReportProjection;
}

interface EcpChangeRunModule {
  /** Mechanically pure: identical plan + record produces identical output. */
  reconcile(
    plan: ChangeRunPlan,
    record: CanonicalRunRecord
  ): Result<ReconcileDecision, ReconcileError>;

  /** Pure validation/reduction; durability is supplied by record-store CAS. */
  commit(
    plan: ChangeRunPlan,
    record: CanonicalRunRecord | null,
    input: CommitInput
  ): Result<CommitResult, CommitError>;

  project<K extends keyof ProjectionTypes>(
    plan: ChangeRunPlan,
    record: CanonicalRunRecord,
    projection: K
  ): Result<ProjectionTypes[K], ProjectionError>;
}
```

`UntrustedInvocationResult` is always schema-validated, identity-checked, and
evidence-checked inside `commit`. It never becomes a committed result merely
because an Adapter returned it.

## Required ordering

1. Resolve a definition source and immutable capability catalog snapshot.
2. Call `prepare`; do not save as executable or launch if `executable` is false.
3. Persist the emitted ChangeRunPlan by digest.
4. Start the canonical Run Record with `commit(plan, null, start)` and atomically
   create it.
5. Load the matching plan and latest canonical Run Record.
6. Call pure `reconcile`.
7. Before executing an `invoke` action, commit its admission with compare-and-swap
   on `RecordVersion`.
8. Dispatch the admitted action through its trusted Adapter.
9. Commit the returned result using the same invocation identity and
   compare-and-swap. Only this validated commit may advance the Run.
10. Reconcile again. Operations may issue only the control commands listed by the
    current `await-command` action.
11. Generate Canvas, Operations, CLI, Markdown, and compatibility views only with
    `project`.

On compare-and-swap conflict, discard the uncommitted reduction, reload the
canonical Run Record, and reconcile again.

## Invariants

- Root graphs, every Composite body, and the Composite call graph are DAGs.
- The Composite call graph is non-recursive.
- A BoundedLoop repeats exactly one Composite body and cannot occur within
  another BoundedLoop in 0.1.6.
- All BoundedLoop limits are positive, capped by system policy, and all terminal
  outcomes are explicitly mapped.
- Node IDs are unique within their graph; compiled NodePath, InvocationId,
  ActionId, round, attempt, and effect identities are stable and deterministic.
- All input bindings and outcome mappings are schema compatible.
- Capability catalog entries are trusted and versioned. Definitions cannot
  supply executable code or override capability descriptors.
- A proof Gate is always fail closed.
- Missing or malformed results, evidence, actor identity, tree identity, or
  effect observations do not advance the Run.
- ReviewCycle cannot produce a clean outcome while a Blocker or Major remains
  open, and author/verifier distinctness is checked by the Change Run Module.
- A terminal Run emits no further actions.
- `engine: legacy | reconciler` is frozen at launch. A Run never crosses engines.
- The ChangeRunPlan is immutable for the Run. Source or capability drift requires
  a new plan and a new Run attempt.
- The canonical Run Record is the only runtime truth. Projection output is never
  accepted as commit input.
- The Reconciler performs no I/O, reads no clock, generates no random IDs, and
  invokes no Adapter.
- FanOut admission is atomic against member, budget, and concurrency limits;
  Join is a deterministic collect-all barrier.

## Error modes

`prepare` returns path-addressed diagnostics for all author-correctable problems.
Unknown versions, unknown capabilities, recursion, nested loops, ordinary cycles,
missing exits, and unsafe capability requests are errors, never warnings.

`reconcile` returns:

- `plan_record_mismatch` when digests or engines differ;
- `record_corrupt` when committed transitions cannot reduce to a valid state;
- `unsupported_plan` when the plan uses an unknown compiled format;
- `invariant_violation` when no safe deterministic decision exists.

All are fail-closed and produce no action.

`commit` returns:

- `stale_record_version`;
- `action_not_admissible`;
- `unknown_invocation`;
- `duplicate_or_conflicting_result`;
- `result_schema_invalid`;
- `evidence_incomplete`;
- `identity_constraint_failed`;
- `effect_ambiguous`;
- `command_not_allowed`;
- `terminal_record`;
- `plan_record_mismatch`.

Duplicate delivery of the byte-identical already-committed result is an idempotent
success. A conflicting result for the same InvocationId fails closed.

`project` returns `unknown_projection` or `projection_invariant_violation`; it
never mutates or repairs the Run Record.

## Caller example

```ts
const prepared = definitionModule.prepare(source, capabilityCatalog);
if (!prepared.ok || !prepared.value.executable || !prepared.value.plan) {
  return showDefinitionDiagnostics(prepared);
}

const plan = prepared.value.plan;
await planStore.putIfAbsent(plan.digest, plan);

const started = runModule.commit(plan, null, {
  kind: "start",
  runId: runIds.forPlan(plan.digest),
  inputs: validatedInputs,
});
if (!started.ok) return fail(started.error);
await recordStore.create(started.value.record);

for (;;) {
  const record = await recordStore.read(started.value.record.runId);
  const decision = runModule.reconcile(plan, record);
  if (!decision.ok) return failClosed(decision.error);
  if (decision.value.state === "terminal") break;

  for (const action of decision.value.actions) {
    if (action.kind !== "invoke") continue;

    const admitted = runModule.commit(plan, record, { kind: "admit", action });
    if (!admitted.ok) continue; // reload and reconcile on stale/admission failure
    await recordStore.compareAndSwap(
      record.runId,
      admitted.value.previousVersion,
      admitted.value.record
    );

    const untrusted = await actionAdapters[action.adapter].execute(action);
    const latest = await recordStore.read(record.runId);
    const committed = runModule.commit(plan, latest, {
      kind: "invocation-result",
      result: untrusted,
    });
    if (!committed.ok) return handleCommitFailure(committed.error);
    await recordStore.compareAndSwap(
      latest.runId,
      committed.value.previousVersion,
      committed.value.record
    );
  }
}

const finalRecord = await recordStore.read(started.value.record.runId);
return runModule.project(plan, finalRecord, "operations/change-run@1");
```

## Hidden Implementation

The Definition Module hides:

- v1 parsing and normalization into Definition v2;
- graph, call-graph, port, exit, actor, capability, and budget validation;
- Composite source resolution and source-map construction;
- lowering Definition nodes into the internal plan instruction algebra;
- semantic canonicalization and digest calculation;
- capability descriptor freezing;
- Canvas/server diagnostic parity.

The Change Run Module hides:

- root and Composite frontier calculation;
- hierarchical identity construction;
- BoundedLoop round, attempt, stall, blocked, and strategy counters;
- Choice, Gate, FanOut, Join, cancellation, escalation, and finish reducers;
- ReviewCycle and GoalLoop domain-policy invocation;
- admission and result validation;
- crash recovery and ambiguous-effect routing;
- Operations, Canvas, CLI, Markdown, and compatibility projection reducers.

This Depth gives callers Leverage: they learn one definition preparation operation
and three run operations while the Implementation retains Locality for all
mechanical progression rules.

## Dependency categories and Adapters

### In-process

- normalization, graph analysis, compilation, digesting, reconciliation, commit
  reduction, schema validation, and projections;
- built-in pure-policy capabilities for Choice, Gate, ReviewCycle, and GoalLoop.

These are tested directly through the two Module Interfaces. No Adapter is needed.

### Local-substitutable

- ChangeRunPlan storage;
- canonical Run Record storage with atomic compare-and-swap;
- artifact/evidence storage;
- capability catalog loading.

Production may use filesystem/SQLite Adapters; tests use in-memory Adapters. These
are internal seams and do not enlarge the public Module Interfaces.

### Remote but owned

- an optional owned Agent backend or daemon transport.

Define a narrow typed action port at this Seam. Use a local-process or HTTP Adapter
in production and an in-memory Adapter in tests. Transport errors return an
untrusted infrastructure result; they do not edit the Run Record directly.

### True external

- command execution, Git hosting, push/PR/delivery, and other host effects.

Agent, command, and host Adapters accept only admitted typed actions. Each uses the
frozen idempotency policy and returns an observation/result envelope. Tests use
mock Adapters. Ambiguous irreversible effects suspend rather than assume
exactly-once execution.

### Projection Adapters

Canvas, Operations, CLI, Markdown, `auto-run.json`, and `goal-run.json` are
Projection Adapters over `project`. New projections may be registered by trusted
code under a versioned `ProjectionRef`; they remain read-only. A projection is not
a new runtime Seam and cannot submit state by round-tripping its output.

## Management, Canvas, and Operations wire treatment

- Management definition detail uses a discriminated
  `WirePipelineDefinitionV1 | WirePipelineDefinitionV2`; unknown versions remain
  rejected.
- Draft validation is the wire projection of `prepare` diagnostics. Canvas does
  not maintain a second validator.
- Canvas keeps the complete Definition v2 value as its draft truth and derives
  visible nodes, edges, folded Composite views, loop badges, and outcome ports.
- The capability catalog endpoint exposes descriptors, schemas, and authoring
  eligibility, never Adapter code or executable paths.
- Run list/detail responses add a discriminated `engine` and a canonical
  ECP projection. Operations consumes that view, not raw transition storage.
- Operations commands carry `runId`, `expectedRecordVersion`, and a typed
  resume/cancel/decision command. They never accept a replacement state object.

## Compatibility treatment

- Missing-version and v1 definitions normalize at the Definition Module Seam.
  Their source files are not rewritten on read.
- v1 flat stages lower to AtomicStage/Gate/Choice nodes. Known
  `stage.loop.kind: review-cycle | goal` declarations lower to references to the
  same built-in Composite definitions used by Definition v2.
- The plan records original content version, source revision, source digest, and
  the normalized semantic plan digest.
- Built-in and Custom Composite definitions use the same compiler path, plan
  shape, Reconciler, identity scheme, and projection path.
- Existing legacy Runs remain owned by the legacy engine and resume unchanged.
  They are not upgraded into a canonical ECP Run Record.
- Reconciler-owned Runs may emit `auto-run.json`, `goal-run.json`, and
  `review-cycle-report.md` only as compatibility projections.
- Old Board/session callers can continue receiving the narrow legacy run shape
  during migration; new Operations fields are additive and engine-discriminated.
- `rasen-auto`, `rasen-goal`, and `rasen-review-cycle` become launcher, preset, or
  compatibility Adapters that select/freeze a Definition and start the same
  Change Run Module. They do not retain progression rules.

## Trade-offs

### Where Depth and Leverage are high

- A new safe AtomicStage capability needs a descriptor, schemas, and a trusted
  Adapter; the Reconciler and Canvas graph model do not change.
- Custom Composite authors can combine typed capabilities into reusable graphs
  without receiving a scripting language.
- ReviewCycle and GoalLoop share BoundedLoop mechanics while preserving separate
  domain schemas and policies.
- Every observation surface shares one projection mechanism, concentrating
  correction and parity tests in the Change Run Module.
- The closed compiled algebra makes deterministic replay, static validation,
  crash recovery, and Operations explanations tractable.

### Costs

- The Interface is wider than a minimal five-function design because safe
  flexibility requires explicit capability, schema, admission, command, and
  projection contracts.
- Capability evolution requires versioning and catalog snapshots; authors cannot
  hot-load arbitrary executable plugins.
- Adding a truly new control primitive is intentionally expensive: Definition
  versioning, compiler lowering, Reconciler semantics, Canvas authoring,
  Operations projection, and tests must move together.
- Generic port binding adds authoring complexity. Canvas should supply defaults
  and hide bindings that are uniquely inferable.
- Pure `commit` plus store compare-and-swap makes ordering explicit. This is more
  ceremony for the host, but it keeps persistence technology outside the kernel
  and makes the Interface the test surface.

### Rejected flexibility

- Open node-kind registries: they would let extensions redefine control semantics.
- User-supplied JavaScript, shell predicates, or expression code: arbitrary
  scripting by another spelling.
- Recursive Composite calls or nested BoundedLoop: excluded in 0.1.6.
- Projection write-back: it would create a second mutable runtime truth.
- A universal ReviewCycle/GoalLoop result schema: it would reduce Locality by
  spreading domain interpretation across callers.

## Recommendation

Adopt this shape if Definition v2 is expected to support more typed Change-level
capabilities and Custom Composite definitions during 0.1.x. Its core judgment is
that extensibility belongs at typed leaf, Composite, Adapter, and projection
seams—not inside the Reconciler's control algebra.
