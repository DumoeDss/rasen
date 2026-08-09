# Minimal Interface: a three-entry Executable Composite Pipeline Module

## Decision

Create one deep **Module** whose external **Seam** is
`src/core/executable-composite-pipeline/index.ts`. Its **Interface** has exactly
three primary entry points:

```ts
export interface ExecutableCompositePipelines {
  compile(request: CompilePipelineRequest): Promise<CompilePipelineResult>;
  commit(request: RunCommitRequest): Promise<RunCommitResult>;
  inspect(request: InspectRunRequest): Promise<InspectRunResult>;
}
```

`compile` owns Pipeline Definition v2 normalization, validation, Composite
resolution, and immutable `ChangeRunPlan` compilation. `commit` owns every
durable state transition. `inspect` returns the current typed actions and the
Operations projection without changing state.

The **Implementation** keeps both the pure
`reconcile(plan, record) -> NextActions` function and the canonical Run Record
behind the Seam. Callers never load, edit, or persist a Run Record and never
sequence “commit, reconcile, project” themselves. This is the principal source
of **Depth**: one atomic call validates a stimulus, commits it, reconciles the
entire root DAG and all Composite / BoundedLoop scopes, then derives a consistent
Operations view.

## TypeScript-level Interface

### Public definition and compilation types

```ts
type JsonValue =
  | null | boolean | number | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

type Digest = `sha256:${string}`;
type PipelineName = string & { readonly __brand: "PipelineName" };
type CompositeName = string & { readonly __brand: "CompositeName" };
type NodeId = string & { readonly __brand: "NodeId" };
type OutcomeName = string & { readonly __brand: "OutcomeName" };
type SchemaRef = string & { readonly __brand: "SchemaRef" };

interface SourceIdentity {
  readonly id: string;
  readonly revision: string;
  readonly digest: Digest;
}

type PipelineSource =
  | {
      readonly kind: "inline";
      readonly identity: Omit<SourceIdentity, "digest">;
      readonly definition: unknown;
    }
  | {
      readonly kind: "registered";
      readonly name: PipelineName;
      readonly revision?: string;
    };

interface NodeBase {
  readonly id: NodeId;
  readonly requires: readonly {
    readonly node: NodeId;
    readonly outcomes?: readonly OutcomeName[];
  }[];
  readonly outcomes: readonly OutcomeName[];
}

type DefinitionNode =
  | (NodeBase & {
      readonly kind: "atomic";
      readonly invoke:
        | { readonly kind: "agent"; readonly capability: string }
        | { readonly kind: "command"; readonly command: string; readonly timeoutMs: number }
        | { readonly kind: "host"; readonly effect: string };
      readonly input: Readonly<Record<string, JsonValue>>;
      readonly result: SchemaRef;
    })
  | (NodeBase & {
      readonly kind: "composite";
      readonly composite: CompositeName;
      readonly input: Readonly<Record<string, JsonValue>>;
      readonly mapOutcomes: Readonly<Record<OutcomeName, OutcomeName>>;
    })
  | (NodeBase & {
      readonly kind: "bounded-loop";
      readonly body: CompositeName;
      readonly limits: {
        readonly maxRounds: number;
        readonly stallRounds: number;
        readonly blockedThreshold: number;
        readonly maxStrategyAttempts: number;
      };
      readonly continueOn: readonly OutcomeName[];
      readonly exits: Readonly<
        Record<OutcomeName, "complete" | "suspend" | "escalate" | "fail">
      >;
    })
  | (NodeBase & {
      readonly kind: "choice";
      readonly select: { readonly node: NodeId };
      readonly cases: Readonly<Record<OutcomeName, OutcomeName>>;
    })
  | (NodeBase & {
      readonly kind: "fan-out";
      readonly group: string;
      readonly members: readonly NodeId[];
      readonly concurrency: number;
      readonly budget: number;
    })
  | (NodeBase & {
      readonly kind: "join";
      readonly group: string;
      readonly mode: "collect-all";
    })
  | (NodeBase & {
      readonly kind: "gate";
      readonly proof: SchemaRef;
      readonly onMissing: "suspend" | "fail";
    })
  | (NodeBase & {
      readonly kind: "finish";
      readonly terminal: "succeeded" | "exhausted" | "escalated" | "failed" | "cancelled";
    });

interface CompositeDefinition {
  readonly name: CompositeName;
  readonly inputs: Readonly<Record<string, SchemaRef>>;
  readonly outputs: Readonly<Record<string, SchemaRef>>;
  readonly outcomes: readonly OutcomeName[];
  readonly nodes: readonly DefinitionNode[];
}

interface PipelineDefinitionV2 {
  readonly version: 2;
  readonly name: PipelineName;
  readonly inputs: Readonly<Record<string, SchemaRef>>;
  readonly outcomes: readonly OutcomeName[];
  readonly composites: readonly CompositeDefinition[];
  readonly nodes: readonly DefinitionNode[];
}

interface CompilePipelineRequest {
  readonly source: PipelineSource;
  readonly capabilities: readonly string[];
  readonly safetyLimits: {
    readonly maxRounds: number;
    readonly maxFanOut: number;
    readonly maxConcurrency: number;
  };
}

declare const changeRunPlanBrand: unique symbol;

/**
 * Serializable and immutable, but opaque to callers. Only this Module may
 * construct or interpret its compiled payload.
 */
type ChangeRunPlan = Readonly<{
  readonly format: "change-run-plan/1";
  readonly digest: Digest;
  readonly root: SourceIdentity;
  readonly sources: readonly SourceIdentity[];
  readonly [changeRunPlanBrand]: true;
}>;

interface CompileIssue {
  readonly code:
    | "unsupported_version"
    | "schema_invalid"
    | "ordinary_cycle"
    | "recursive_composite"
    | "nested_loop"
    | "missing_outcome_mapping"
    | "invalid_limit"
    | "capability_denied"
    | "budget_impossible"
    | "source_unavailable";
  readonly path: string;
  readonly message: string;
}

type CompilePipelineResult =
  | {
      readonly ok: true;
      readonly normalized: PipelineDefinitionV2;
      readonly plan: ChangeRunPlan;
      readonly warnings: readonly CompileIssue[];
    }
  | { readonly ok: false; readonly issues: readonly CompileIssue[] };
```

An unversioned or explicit v1 source is normalized to Pipeline Definition v2
inside `compile`. An unknown explicit version returns `unsupported_version`.
Built-in and Custom Composite sources take exactly the same path and produce the
same opaque `ChangeRunPlan`.

### Durable run mutation

```ts
type RunId = string & { readonly __brand: "RunId" };
type ActionId = string & { readonly __brand: "ActionId" };
type InvocationId = string & { readonly __brand: "InvocationId" };
type RecordVersion = number & { readonly __brand: "RecordVersion" };

interface ActorRef {
  readonly runtime: "claude" | "codex" | "command" | "host" | "human";
  readonly id: string;
}

interface EvidenceRef {
  readonly kind: string;
  readonly uri: string;
  readonly digest?: Digest;
  readonly tree?: string;
}

type ExecutionAction =
  | {
      readonly kind: "agent";
      readonly actionId: ActionId;
      readonly invocationId: InvocationId;
      readonly attempt: number;
      readonly capability: string;
      readonly input: JsonValue;
      readonly resultSchema: SchemaRef;
      readonly constraints: {
        readonly sandbox: "read-only" | "workspace-write";
        readonly distinctFrom: readonly ActorRef[];
      };
    }
  | {
      readonly kind: "command";
      readonly actionId: ActionId;
      readonly invocationId: InvocationId;
      readonly attempt: number;
      readonly command: string;
      readonly timeoutMs: number;
      readonly tree?: string;
      readonly resultSchema: SchemaRef;
    }
  | {
      readonly kind: "host";
      readonly actionId: ActionId;
      readonly invocationId: InvocationId;
      readonly attempt: number;
      readonly effect: string;
      readonly idempotencyKey: string;
      readonly input: JsonValue;
      readonly resultSchema: SchemaRef;
    };

interface ActionCompletion {
  readonly actionId: ActionId;
  readonly invocationId: InvocationId;
  readonly receiptDigest: Digest;
  readonly actor: ActorRef;
  readonly status: "succeeded" | "failed" | "uncertain";
  readonly output?: unknown;
  readonly failure?: { readonly code: string; readonly message: string; readonly retryable: boolean };
  readonly evidence: readonly EvidenceRef[];
}

type RunControl =
  | { readonly kind: "resume" }
  | { readonly kind: "cancel"; readonly reason: string }
  | {
      readonly kind: "decision";
      readonly gateId: NodeId;
      readonly outcome: OutcomeName;
      readonly actor: ActorRef;
      readonly evidence: readonly EvidenceRef[];
    };

type RunCommitRequest =
  | {
      readonly kind: "launch";
      readonly runId: RunId;
      readonly changeId: string;
      readonly plan: ChangeRunPlan;
      readonly inputs: JsonValue;
      readonly engine: "reconciler";
      readonly expected: "absent";
    }
  | {
      readonly kind: "result";
      readonly runId: RunId;
      readonly completion: ActionCompletion;
    }
  | {
      readonly kind: "control";
      readonly runId: RunId;
      readonly ifVersion: RecordVersion;
      readonly control: RunControl;
    };

interface InspectRunRequest {
  readonly runId: RunId;
}
```

Action results do not carry `ifVersion`: parallel actions may finish against the
same earlier snapshot. The Implementation serializes commits and admits a
result only while its stable `ActionId` remains active. Controls do carry
`ifVersion` because a human decision must not overwrite a state the operator has
not seen.

### One returned snapshot for executors and Operations

```ts
interface OperationsView {
  readonly engine: "reconciler";
  readonly runId: RunId;
  readonly planDigest: Digest;
  readonly status:
    | "running" | "waiting" | "succeeded" | "exhausted"
    | "escalated" | "failed" | "cancelled";
  readonly frontier: readonly {
    readonly path: string;
    readonly node: NodeId;
    readonly state: "ready" | "active" | "blocked";
  }[];
  readonly activeInvocations: readonly {
    readonly invocationId: InvocationId;
    readonly path: string;
    readonly attempt: number;
    readonly actor?: ActorRef;
  }[];
  readonly scopes: readonly {
    readonly path: string;
    readonly composite: CompositeName;
    readonly round?: number;
    readonly phase?: string;
    readonly outcome?: OutcomeName;
  }[];
  readonly wait?: {
    readonly kind: "gate" | "human" | "uncertain-effect" | "budget" | "capability";
    readonly reason: string;
  };
  readonly evidence: readonly EvidenceRef[];
  readonly openFindings: readonly {
    readonly id: string;
    readonly severity: "blocker" | "major" | "minor" | "trivial";
    readonly status: "open" | "resolved" | "accepted_known" | "invalid";
  }[];
}

interface RunSnapshot {
  readonly runId: RunId;
  readonly recordVersion: RecordVersion;
  readonly planDigest: Digest;
  readonly actions: readonly ExecutionAction[];
  readonly view: OperationsView;
}

type RunCommitError =
  | { readonly code: "run_exists" | "run_not_found" | "version_conflict" | "terminal_run"; readonly message: string }
  | { readonly code: "plan_invalid" | "plan_drift"; readonly message: string }
  | { readonly code: "unknown_action" | "stale_action" | "receipt_conflict"; readonly message: string }
  | { readonly code: "result_invalid" | "actor_constraint" | "evidence_missing"; readonly message: string; readonly path?: string }
  | { readonly code: "invalid_control"; readonly message: string }
  | { readonly code: "store_unavailable"; readonly message: string; readonly retryable: true };

type RunCommitResult =
  | { readonly ok: true; readonly snapshot: RunSnapshot; readonly idempotent: boolean }
  | { readonly ok: false; readonly error: RunCommitError; readonly snapshot?: RunSnapshot };

type InspectRunResult =
  | { readonly ok: true; readonly snapshot: RunSnapshot }
  | { readonly ok: false; readonly error: { readonly code: "run_not_found" | "store_unavailable"; readonly message: string } };
```

The management server serializes only `snapshot.view`; Agent/command/host
Adapters consume `snapshot.actions`. Canvas consumes `normalized` from
`compile`. No plane receives a writable copy of the canonical Run Record.

## Ordering and invariants

1. `compile` must succeed before `commit({ kind: "launch" })`.
2. Launch atomically stores the immutable plan and a new canonical Run Record.
   A `RunId` cannot be relaunched.
3. Every successful launch, result, or control commit finishes by running the
   pure Pipeline Reconciler and returns actions plus an Operations projection
   derived from the same committed record version.
4. A result is schema-, actor-, identity-, tree-, and evidence-validated before
   the record version advances. Invalid results leave the record unchanged.
5. Repeating the same `ActionId` plus `receiptDigest` is idempotent and returns
   the current snapshot. Reusing an `ActionId` with different content returns
   `receipt_conflict`.
6. Root control flow, every Composite body, and the Composite call graph are
   DAGs. Only BoundedLoop can repeat work. Recursive Composite calls and nested
   loops fail compilation in 0.2.0.
7. All BoundedLoop limits are positive, within system safety limits, and every
   declared outcome has an explicit exit. Reaching a cap is an outcome, never
   implicit success.
8. A ReviewCycle with an open Blocker or Major cannot emit a ship-enabling
   outcome. A fixer cannot satisfy an independent verifier action.
9. A terminal record emits no actions. Cancellation is terminal; resumption
   requires a distinct new Run, not mutation back to running.
10. The frozen `engine` is always `reconciler` at this Seam. A legacy-owned Run
    never enters this Module.
11. Action ordering, hierarchical identities, frontier, wait reason, and
    terminal outcome depend only on the immutable `ChangeRunPlan` and committed
    Run Record. Timestamps may be recorded for display but never affect
    reconciliation.
12. External effects are at-least-once-capable, not “exactly once.” A host
    Adapter must use `idempotencyKey` or reconcile external state; an uncertain
    effect suspends fail closed.

## Caller example

```ts
const compiled = await ecp.compile({
  source: { kind: "registered", name: asPipelineName("small-feature") },
  capabilities: enabledCapabilities,
  safetyLimits: { maxRounds: 8, maxFanOut: 12, maxConcurrency: 4 },
});
if (!compiled.ok) return showDefinitionIssues(compiled.issues);

let committed = await ecp.commit({
  kind: "launch",
  runId,
  changeId,
  plan: compiled.plan,
  inputs: { changeId },
  engine: "reconciler",
  expected: "absent",
});
if (!committed.ok) throw new Error(committed.error.message);

for (const action of committed.snapshot.actions) {
  const completion = await executionAdapters.execute(action);
  committed = await ecp.commit({ kind: "result", runId, completion });
  if (!committed.ok) handleCommitError(committed.error);
}

const inspected = await ecp.inspect({ runId });
if (inspected.ok) {
  sendOperationsJson(inspected.snapshot.view);
}
```

The caller does not reopen completed nodes, count rounds, interpret Composite
exits, join parallel members, validate proof evidence, write Markdown, or
calculate the ready frontier.

## What the Implementation hides

The Implementation hides Pipeline Definition v1 coercion, v2 parsing, source
closure and digest calculation, Composite expansion, static graph analysis,
capability/budget validation, immutable plan serialization, hierarchical
identity allocation, canonical Run Record storage, compare-and-swap,
crash-safe atomic commit, result-schema lookup, domain reducers for ReviewCycle
and GoalLoop, BoundedLoop counters/fingerprints, FanOut admission and Join
barriers, Gate policy, pure reconciliation, compatibility projections, and
Operations projection.

Deleting this Module would force those rules back into the CLI, management
handlers, Canvas, launcher skills, and every Agent/command/host Adapter. That
deletion test demonstrates high **Leverage** and strong **Locality**.

## Dependencies, internal Seams, and Adapters

| Dependency category | Treatment |
| --- | --- |
| In-process | Definition normalizer, compiler, validators, Pipeline Reconciler, ReviewCycle/GoalLoop reducers, digesting, and Operations projection stay inside the Module. No Adapter is exposed. |
| Local-substitutable | A private `DefinitionSourceStore` Seam has filesystem/registry and in-memory Adapters. A private `CanonicalRunStore` Seam has crash-safe filesystem and in-memory transactional Adapters. Tests replace these Adapters and still test through the three-entry Interface. |
| Remote but owned | Agent, command, and host execution remain outside the Module. Typed `ExecutionAction` / `ActionCompletion` is their Seam. Claude, Codex, shell, and host-effect implementations are Adapters; none may advance state directly. |
| True external | Push, PR, and other provider effects sit behind host Adapters with mocks in tests. Stable idempotency identity and external-state reconciliation are mandatory. |

Clock and randomness are not Reconciler dependencies. Stable identities are
derived from plan path, scope/round, invocation, and attempt. An observational
clock may be private to the Run Store Adapter.

## Compatibility treatment

- Keep current `PipelineYamlSchema` as the Pipeline Definition v1 compatibility
  parser. Route management detail/save/validation through `compile` so v1 and v2
  share one validation/compiler path. Unknown versions fail closed.
- Replace `WirePipelineDefinition = PipelineYaml` with a v1/v2 discriminated
  definition union. Generate or share the TypeScript contract with Canvas;
  do not extend the current hand-maintained mirror independently.
- Do not grow current `RunState` into the canonical Run Record. Rename its role
  conceptually to the legacy Run State Adapter. Existing legacy runs continue
  to read, resume, and write `auto-run.json` through the legacy engine.
- Engine selection happens before this Seam. A Run freezes
  `legacy | reconciler`; no resume crosses engines and ownership never mixes.
- For reconciler Runs, `auto-run.json`, `goal-run.json`, review Markdown, and
  timelines are write-only compatibility projections of the canonical Run
  Record. The Pipeline Reconciler never reads them.
- Change-run Operations should expose a tagged engine projection. Reconciler
  entries use `OperationsView`; legacy entries may retain the existing narrow
  status projection. The UI must not receive the passthrough Run Record schema.
- `rasen-auto`, `rasen-goal`, and `rasen-review-cycle` become launch/preset/
  compatibility Adapters that call this same Interface.

## Trade-offs

This alternative maximizes **Depth**, **Leverage**, and **Locality** by hiding
the plan interpreter and canonical state protocol. It prevents CLI and
Operations callers from accidentally creating a second runtime truth, and its
three-entry Interface is also the complete external test surface.

The cost is a larger Implementation and fewer substitution points for callers.
Storage, reconciliation, and projection cannot be assembled à la carte.
`commit` is a tagged command Interface, so adding a fundamentally new class of
durable stimulus expands that union. That is deliberate: durable state changes
should be rare, centrally reviewed vocabulary.

Returning executor actions and the Operations view together may compute more
than a read-only caller needs. The extra pure projection cost is preferable to
separate calls that could observe different record versions. If profiling later
shows material cost, the Implementation may cache projections by record
version without changing the Interface.

Finally, the opaque `ChangeRunPlan` prevents external tooling from depending on
compiler internals. Debug tooling must use a separately derived diagnostic
projection rather than inspect the plan payload. This sacrifices ad hoc
extensibility to preserve compiler freedom and keep the public Seam small.
