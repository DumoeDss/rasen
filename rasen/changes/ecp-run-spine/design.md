## Context

`ecp-definition-v2` established one preparation seam in
`src/core/pipeline-registry/definition.ts`. A successful preparation returns a
deeply frozen public envelope:

```ts
interface ChangeRunPlan {
  readonly version: 1;
  readonly digest: string;
  readonly payload: unknown;
}
```

The payload currently contains the semantic Definition, the frozen capability
catalog version, and the relevant frozen capability descriptors. It is opaque
through `src/core/pipeline-registry/index.ts`; registry, management, Canvas,
and ordinary launch callers cannot switch on compiled nodes.

Execution is still separate and legacy-owned:

- `src/commands/pipeline.ts` reads `auto-run.json` and computes the legacy next
  stage with `PipelineGraph`;
- `src/core/pipeline-registry/run-state.ts` defines that prompt-owned record;
- `goal-run.json`, `portfolio-run.json`, and Markdown are additional legacy
  run artifacts;
- `src/core/management-api/runs.ts` freshly reads those files for
  `GET /api/v1/runs`;
- `packages/ui/src/board/columns.ts`, `BoardPage.tsx`, and
  `TaskDetailPage.tsx` derive current Board/Task state from the legacy wire
  projection.

This change must add a real owner without upgrading an in-flight legacy Run,
exposing the opaque plan, or turning the Operations projection into a writer.
The locked public runtime Interface is:

```ts
interface ChangePipelineRuntime {
  start(request: StartChangePipeline,
        context: RuntimeMutationContext): Promise<ChangeRunReceipt>;
  resume(request: ResumeChangePipeline,
         context: RuntimeMutationContext): Promise<ChangeRunReceipt>;
  complete(request: CompleteRunAction,
           context: RuntimeMutationContext): Promise<ChangeRunReceipt>;
  inspect(ref: ExactChangeRunRef): Promise<ChangeRunView>;
  control(request: ChangeRunControlRequest,
          context: RuntimeMutationContext): Promise<ChangeRunReceipt>;
}

interface RuntimeMutationContext {
  deliveryMode: "grant" | "defer";
}
```

The pure Reconciler, validated reducer, plan decoder, identity allocator,
durable store, and projector are internal/test seams. This child proves that
shape with the simple `bug-fix` route only. It must not claim ReviewCycle,
Composite/BoundedLoop, GoalLoop, or FanOut/Join execution.

## Goals / Non-Goals

**Goals:**

- Put one immutable prepared plan and one canonical durable Run Record behind
  the locked runtime Interface.
- Make `reconcile(plan, record)` mechanically pure and deterministic.
- Derive every runtime identity from frozen inputs and committed ordinals,
  never a clock, random value, process ID, or absolute path.
- Serialize atomic commits while allowing independent action completions to
  arrive without an observed Record version.
- Validate action identity, actor, result schema, evidence, and receipt
  idempotency before advancing the Record.
- Provide version-checked human controls and a closed trusted-observation path
  for fail-closed uncertain-effect recovery.
- Freeze one engine owner at launch, preserve the existing legacy resume
  implementation, and prevent simultaneous active legacy/reconciler ownership
  for one Change.
- Detect current Definition/capability drift while always resuming from the
  stored plan.
- Add CLI and Change-run Operations projections from the same projector.
- Complete a real simple `bug-fix` root path and durably suspend its adaptive
  complex route for the next child.

**Non-Goals:**

- Runtime semantics for `CompositeRef`, `BoundedLoop`, ReviewCycle, GoalLoop,
  FanOut, Join, or Custom Composite.
- Review finding schemas, author/verifier policy, loop counters, or ship guards
  owned by `ecp-review-cycle`.
- Condition expressions beyond the explicit `bug-fix` adaptive result route.
- Automatic execution inside the Reconciler. Agent, command, and host work
  stays outside and returns through `complete`.
- `rasen-auto`, `rasen-goal`, or `rasen-review-cycle` launcher convergence.
- Importing a legacy Run into the canonical Record, or writing compatibility
  projections from the new Record in this child.
- Portfolio, `auto-decompose`, Issue Execution Plans, distributed scheduling,
  or cross-project Operations.
- An exactly-once claim for external side effects.

## Decisions

### 1. Keep one deep runtime facade and private functional seams

Add `src/core/change-run/**` with this dependency direction:

```text
CLI / management bridge / trusted execution host
                         |
                         v
             ChangePipelineRuntime facade
                         |
       +-----------------+-----------------+
       v                 v                 v
 internal plan      pure settle       read-only
 reader/lowerer     + reducer         projector
       |                 |                 |
       +-------- Canonical Run contracts --+
                         |
                         v
              private RunStore Adapter
```

The public request/response sketch is:

```ts
interface ChangeRef {
  projectRoot: string;
  changeId: string;
}

interface ExactChangeRunRef {
  change: ChangeRef;
  runId: RunId;
}

interface StartChangePipeline {
  change: ChangeRef;
  pipeline: string;
  launchRequestId: LaunchRequestId;
  inputs?: Readonly<Record<string, JsonValue>>;
  engine?: "reconciler"; // explicit preview owner in this child
}

interface ResumeChangePipeline extends ExactChangeRunRef {}

interface CompletionBase {
  format: "change-run-completion/1";
  change: ChangeRef;
  runId: RunId;
  actionId: ActionId;
  invocationId: InvocationId;
  receiptDigest: Digest;
  actor: ActorRef;
  actorAttestation: EvidenceRef;
  evidence: readonly EvidenceRef[];
}

type CompleteRunAction =
  | (CompletionBase & {
      kind: "domain-action-result";
      status: "succeeded" | "failed" | "blocked";
      result: unknown;
    })
  | (CompletionBase & {
      kind: "effect-observation";
      effectId: EffectId;
      status: "succeeded" | "failed" | "not_executed";
      observation: unknown;
    })
  | (CompletionBase & {
      kind: "infrastructure-observation";
      status: "infrastructure_failed";
      error: {
        code: string;
        retryable: boolean;
        adapterArtifactDigest: Digest;
      };
    });

type ActorRef =
  | {
      format: "change-run-actor/1";
      kind: "agent";
      identityDigest: Digest;
      role: string;
      provider: string;
      runtime: string;
      principalIdentityDigest: Digest;
      sessionIdentityDigest: Digest;
      adapter: { id: string; version: string; artifactDigest: Digest };
    }
  | {
      format: "change-run-actor/1";
      kind: "command";
      identityDigest: Digest;
      adapter: { id: string; version: string; artifactDigest: Digest };
      executable: { id: string; artifactDigest: Digest };
    }
  | {
      format: "change-run-actor/1";
      kind: "host";
      identityDigest: Digest;
      adapter: { id: string; version: string; artifactDigest: Digest };
      principalIdentityDigest: Digest;
    };

type ChangeRunControlRequest = {
  format: "change-run-control/1";
  ref: ExactChangeRunRef;
  expectedRecordVersion: RecordVersion;
  command:
    | { kind: "resume"; waitId: WaitId }
    | { kind: "decision"; waitId: WaitId; decisionId: string; outcome: string;
        evidence?: readonly EvidenceRef[] }
    | { kind: "accept-workspace-revision"; waitId: WaitId;
        revision: WorkspaceRevision; evidence: readonly EvidenceRef[] }
    | { kind: "escalate"; reason: string } // Run-global
    | { kind: "cancel"; reason?: string }; // Run-global
};
```

The completion codec is an exact discriminated union: fields required by one
variant are forbidden in the others. A domain `blocked` result cannot carry a
partial/unknown effect observation; per-effect observations require an exact
`effectId` and strong bound evidence; infrastructure observations require the
frozen Adapter artifact identity and never carry a domain result. Canonical
receipt bytes cover the variant discriminator and every semantic field.
Idempotency is keyed by `(ActionId, kind, EffectId-or-absent, receiptDigest)`;
the same identity with different canonical bytes is `receipt_conflict`.
The `result` and `observation` values are bounded JSON decoded by the exact
stored capability/evidence contract before canonicalization; `unknown` denotes
contract ownership, not an open wire payload.
`ActorRef` is also closed and bounded. `identityDigest` is recomputed from its
domain-separated variant fields and checked against the Action's frozen actor
constraints and a trusted Adapter attestation; a caller-authored actor object
has no authority. Agent role/principal/session, command executable/artifact,
and host Adapter/principal
identity cannot be interchanged. Session and host values are one-way digests:
raw credentials, user identifiers, absolute paths, environment values, and
provider tokens are forbidden from ActorRef and receipt canonical bytes. This
also gives later ReviewCycle semantics stable author/verifier comparisons:
same-principal comparisons use `principalIdentityDigest`, while session
separation uses `sessionIdentityDigest`. If trusted identity cannot be proven,
completion fails/suspends; it never accepts self-report.

`ChangeRunView` is a versioned projection contract rather than an accidental
serialization of the Record:

```ts
interface ChangeRunView {
  format: "change-run-view/1";
  engine: "reconciler";
  runId: RunId;
  change: {
    planningSpaceId: PlanningSpaceId;
    projectId: ProjectId; // lineage/display only
    changeId: ChangeId;
    instanceId: ChangeInstanceId;
  };
  recordVersion: RecordVersion;
  status: RunStatus;
  sourceState: "active" | "archived" | "missing";
  workspace: {
    instanceId: WorkspaceInstanceId;
    scope: "current" | "other";
  };
  drift: DriftView;
  sections: readonly ChangeRunViewSection[];
}

interface ChangeRunReceipt {
  format: "change-run-receipt/1";
  disposition:
    | "created" | "reused" | "advanced" | "idempotent"
    | "waiting" | "terminal";
  view: ChangeRunView;
  actions: readonly RunAction[];
}

interface RootDagViewSection {
  kind: "root-dag";
  version: 1;
  frontier: readonly NodeId[]; // stable order
  activeInvocations: readonly {
    invocationId: InvocationId;
    nodeId: NodeId;
    attemptId: AttemptId;
    actionIds: readonly ActionId[];
    effects: readonly {
      slot: string;
      effectId: EffectId;
      state: EffectViewState;
    }[];
  }[];
  actions: readonly RunActionView[];
  waits: readonly WaitView[];
  terminal?: TerminalView;
  workspace: {
    current: WorkspaceRevision;
    expectedByActiveWriters: readonly WorkspaceRevision[];
  };
  effectDiagnostics: readonly {
    effectId: EffectId;
    slot: string;
    state: EffectViewState;
    reason?: string;
  }[];
  allowedControls: readonly AllowedControlView[];
}

interface WorkspaceRevision {
  format: "workspace-revision/1";
  head:
    | { kind: "commit"; digest: Digest; detached: boolean }
    | { kind: "unborn"; detached: false };
  treeDigest: Digest;
  dirtyWorktreeDigest: Digest;
}

type RunStatus =
  | "running" | "waiting" | "completed"
  | "escalated" | "failed" | "cancelled";
type DriftState = "unchanged" | "changed" | "unavailable";
type EffectViewState =
  | "admitted" | "succeeded" | "failed" | "not_executed"
  | "uncertain" | "infrastructure_failed";
type ActionDeliveryState =
  | "admitted_undelivered" | "granted" | "closed";

interface DriftView {
  definition: DriftState;
  sourceRevision: {
    provenance: DriftState;
    content: DriftState;
    semantic: DriftState;
    current?: {
      layer: "project" | "user" | "package";
      sourceId: string;
      authoredContentDigest: Digest;
      semanticDigest: Digest;
    };
  };
  capability: DriftState;
  policy: DriftState;
  workspace: DriftState;
  currentCapabilityProfileDigest?: Digest;
  currentPolicyDigest?: Digest;
}

interface RunActionView {
  format: "change-run-action-view/1";
  kind: "agent" | "command" | "host";
  actionId: ActionId;
  invocationId: InvocationId;
  attemptId: AttemptId;
  nodeId: NodeId;
  deliveryState: ActionDeliveryState;
  capability: {
    id: string;
    contractVersion: string;
    contractDigest: Digest;
    artifactDigest: Digest;
  };
  effects: readonly {
    slot: string;
    effectId: EffectId;
    state: EffectViewState;
  }[];
}

type WaitView =
  | { kind: "gate"; waitId: WaitId; nodeId: NodeId;
      invocationId: InvocationId; occurrence: number; gateId: string;
      decisionIds: readonly string[] }
  | { kind: "domain-blocked"; waitId: WaitId; nodeId: NodeId;
      invocationId: InvocationId; occurrence: number; attemptId: AttemptId;
      actionId: ActionId; effectIds: readonly EffectId[]; reasonCode: string;
      evidence: readonly EvidenceRef[] }
  | { kind: "infrastructure"; waitId: WaitId; nodeId: NodeId;
      invocationId: InvocationId; occurrence: number; attemptId: AttemptId;
      actionId: ActionId; effectIds: readonly EffectId[]; code: string;
      retryable: boolean; artifactDigest: Digest }
  | { kind: "uncertain-effect"; waitId: WaitId; nodeId: NodeId;
      invocationId: InvocationId; occurrence: number; attemptId: AttemptId;
      actionId: ActionId;
      effectIds: readonly EffectId[] }
  | { kind: "capability-unavailable"; waitId: WaitId; nodeId: NodeId;
      invocationId: InvocationId; occurrence: number; attemptId: AttemptId;
      actionId: ActionId; effectIds: readonly EffectId[]; code: string;
      capabilityDigest: Digest }
  | { kind: "workspace-drift"; waitId: WaitId;
      workspaceInstanceId: WorkspaceInstanceId; expected: WorkspaceRevision;
      observed: WorkspaceRevision }
  | { kind: "workspace-reservation"; waitId: WaitId;
      workspaceInstanceId: WorkspaceInstanceId;
      intents: readonly {
        nodeId: NodeId;
        invocationId: InvocationId;
        occurrence: number;
        attemptId: AttemptId;
        actionId: ActionId;
        access: "read" | "write";
      }[] };

type TerminalView =
  | { kind: "completed"; outcome: string }
  | { kind: "escalated"; code: string; reason?: string }
  | { kind: "failed"; code: string; reason?: string }
  | { kind: "cancelled"; reason?: string };

type AllowedControlView =
  | { kind: "resume"; waitId: WaitId }
  | { kind: "decision"; waitId: WaitId; decisionId: string;
      outcomes: readonly string[] }
  | { kind: "accept-workspace-revision"; waitId: WaitId;
      revision: WorkspaceRevision }
  | { kind: "escalate" } // Run-global
  | { kind: "cancel" };  // Run-global
```

The v1 core fields are closed. `ChangeRunViewSection` is an additive
discriminated union whose concrete v1 member is the closed
`RootDagViewSection` above; this child always emits exactly one `root-dag/1`.
Later children may add
`review-cycle/1`, `composite/1`, `round/1`, `parallel/1`, or `evidence/1`
without changing the facade or Record owner. Consumers of
`change-run-view/1` ignore or preserve unknown additive section kinds while
continuing to render the core. An unknown top-level major fails with
`unsupported_view_version`; it is never interpreted as v1. The shared
projector is the only production creator of this value.

All arrays are sorted by stable full identity, effect slot, or declared
decision order as applicable. `waits` is sorted by `waitId`; each `waitId`
binds its exact node/invocation/occurrence/attempt/action/effect context and is
stable while that wait remains active. Independent ready branches may therefore
expose actions and waits together. Top-level status is `running` while at least
one action or mechanically ready branch can progress, otherwise `waiting` when
one or more waits remain. Terminal statuses have exactly one matching terminal
and no waits/actions/controls. `allowedControls` is the stable sorted union of
the controls derivable for each exact wait plus any Run-global escalate/cancel;
wait-scoped controls carry `waitId`. Effect IDs are unique by slot, active
Action/Invocation/wait references must close over section members, and
decoders reject rather than normalize violated invariants.

Receipt `disposition` describes the request outcome, not a second Run state.
Priority is: a newly published start is `created`; accepted same-key start is
`reused`; byte-identical repeat completion is `idempotent`; otherwise a newly
terminal view is `terminal`; a quiescent view with no actions and one or more
waits is `waiting`; every other successful mutation is `advanced`. The view's
status remains authoritative when actions and waits coexist.
Receipt `actions` are execution grants only when this call durably transitions
them to `granted` (at admission or first deferred claim), or when the stored
policy explicitly approves safe recovery/redelivery. An idempotent completion
replay, terminal/waiting no-op, and any
conflict/error current-view response carries `actions: []`. A reused start
carries no grant; exact resume performs recovery classification and may carry
only recovery-approved retry-same-action grants. Ambiguous work first suspends
and carries none. `RunActionView` entries inside the view are
diagnostic state, never executable grants. A caller that lost a completion
response uses exact `resume`, which classifies recovery before any redelivery.

`RuntimeMutationContext.deliveryMode` is trusted caller context, not a field
accepted from completion/control JSON and not part of receipt identity.
`grant` commits admitted Actions as `granted` before returning their executable
payload. `defer` commits them as `admitted_undelivered` and returns
`actions: []`. A trusted exact CLI resume atomically changes the stable sorted
undelivered frontier to `granted` and returns it as the first delivery; two
claimers serialize and only one receives grants. Only response loss after that
grant enters safe-redelivery/uncertain recovery. The projector exposes delivery
state but never the executable payload.

Receipts, actions, and file-fed mutations are root-versioned too.
`change-run-receipt/1` has the closed disposition/view/actions fields above;
every action is `change-run-action/1` with an exact
`kind: "agent" | "command" | "host"` discriminant plus its common base; and
completion/control envelopes are `change-run-completion/1` and
`change-run-control/1`. Callers never infer a wire type from optional
properties. Unknown majors fail typed; additive view sections remain the
designated forward-compatible extension seam.

`PlanningSpaceId = H("planning-space/1", registryEntry.home)` is the
machine-local execution namespace. `registryEntry.home` is the exact persisted
machine-home relative name, never re-derived from `projectId` or an absolute
path. It is stable across linked worktrees, benign root aliases, project moves,
and `RASEN_HOME` relocation, while two independently registered clones remain
distinct even when they share a lineage/display `projectId`.

Each source incarnation also has a frozen `ChangeInstanceId`. On first use of
an active Change, a private machine-home association registry maps a proven
physical directory identity (device/inode on POSIX; volume/file index plus
creation/birth identity on Windows) to
`H("change-instance/1", PlanningSpaceId, changeId,
canonicalPhysicalChangeDirIdentity)`. `WorkspaceInstanceId` likewise is
`H("workspace-instance/1", PlanningSpaceId,
canonicalPhysicalWorkspaceRootIdentity)`.

Physical identity has a versioned canonical byte codec: POSIX encodes unsigned
device, inode, and reliable birth-generation fields in fixed-width big-endian
form; Windows encodes volume serial, full file index, and creation identity the
same way. The implementation rereads it around association and rejects
unavailable/zero/truncated/reused-with-conflicting-history identities.
Same-volume rename preserves the identity. A runtime archive completion moves
the binding to the verified archive alias; a manual move that cannot be proven
or a cross-volume copy is `missing`/new, never guessed. Recreating the same
Change name gets a different
instance. Run source state and host targets are always resolved through this
binding, so an old Run cannot act on the new directory.

`launchRequestId` is a caller-stable idempotency key within
`(PlanningSpaceId, ChangeInstanceId)`, not a timestamp or random value generated
inside the runtime. The same textual key is independent in another planning
space or Change incarnation.
`start`, `resume`, `complete`, and
`control` settle the candidate Record to its
next quiescent point and commit once. They return executable actions only when
the trusted delivery context grants them, plus a view of that same committed
Record version. `inspect` is read-only. Ordinary callers
never receive an internal plan or Record.
Every canonical facade operation after start, including inspect, requires the
full `RunId`. Optional Run selection exists only in the CLI's read-only
candidate-discovery layer; it must resolve one exact Run before invoking the
facade and is never accepted by the core codec.
Read-only exact inspection may project a stored Run from another linked
worktree as top-level `workspace.scope: "other"` with no mutation controls and
all receipt action grants empty. Every
resume/complete/control/host mutation re-proves that the selected project root
has the stored `WorkspaceInstanceId` and ChangeInstance binding; mismatch is
`workspace_scope_mismatch` with zero writes. This slice has no cross-workspace
administrative mutation.

Internally, focused tests may call:

```ts
openStoredPlan(planEnvelope): RuntimePlan
reconcile(plan, record): ReconcileDecision
reduce(plan, record, stimulus): ReduceResult
settle(plan, record): SettledRecord
selectCompatibleAdmissions(candidates, reservationSnapshot): AdmissionSelection
project(plan, record, drift): ChangeRunView
```

These modules are not re-exported from the package or pipeline-registry barrel.
The deletion test is strong: removing the facade would force plan integrity,
identity, result admission, idempotency, recovery, engine, and projection
rules into every CLI/API/host caller.

Alternative considered: expose `reconcile`, `commit`, and the store to every
launcher. Rejected because it maximizes host ceremony and lets callers become
peer runtime owners. The selected facade has greater Depth and caller
Locality, while pure internals retain testability.

All facade requests pass one outer admission codec before store, lock, root, or
plan resolution. It reuses `validateChangeName` with an additional 128-byte
bound; rejects absolute, traversal, encoded-separator, option-like, NUL, and
non-kebab Change IDs; requires full branded digest identities rather than
prefixes; bounds the launch key and every nested input; and validates that
`projectRoot` is an existing canonical planning root with the operation's
read/write semantics. Syntactically invalid requests perform zero filesystem,
registry, lock, or hashing I/O. Only a syntactically admitted request may
canonicalize a root. `start` first performs an `{ ensure: false }` registration
and deterministic RunId lookup; a valid same-key existing Run returns without
requiring active source. Only the new-Run branch requires the active Change to
exist. Operations on an existing exact Run deliberately do not.

### 2. Open the phase-1 opaque plan through one non-public codec

Resume must not re-read or recompile current Pipeline source as execution
truth. Extract the phase-1 payload construction/canonical digest rules into a
non-barrel internal module, for example
`src/core/pipeline-registry/definition-plan-internal.ts`.

The Definition module uses that internal module to seal a plan; the Run module
uses it to open a serialized plan. Opening performs all of the following:

1. validate the public envelope version and exact closed payload shape;
2. recompute the plan digest from canonical payload bytes;
3. validate the normalized Definition and frozen descriptors again;
4. lower only the runtime subset installed by this child into an immutable
   private `RuntimePlan`;
5. reject unknown plan versions, corrupt digests, unsupported nodes, or
   capabilities before a Run is created or resumed.

Phase 1 deliberately excludes `version: "legacy"` capabilities from
`payload.capabilities`; every v1 `bug-fix` stage currently has that version.
Therefore the phase-1 envelope alone cannot freeze executable meaning. For a
new launch only, `ChangePipelineRuntime.start` performs the existing source
preparation once and then calls one private
`sealRuntimeExecutionPlan(basePlan, sourceRevision, profileSnapshot)` function.
It returns another `ChangeRunPlan` with the same public `version: 1` and
`payload: unknown` API, but its closed internal payload additionally contains
one `RuntimeExecutionProfile`:

```ts
interface RuntimeExecutionProfile {
  format: "change-run-execution-profile/1";
  sourceRevision: {
    layer: "project" | "user" | "package";
    kind: string;
    sourceId: string;          // path-independent
    authoredContentDigest: Digest;
    semanticDigest: Digest;
  };
  capabilities: readonly RuntimeCapabilityBinding[];
  policy: EffectiveRunPolicy;
  capabilityProfileDigest: Digest;
  policyDigest: Digest;
  profileDigest: Digest;
}
```

`RuntimeCapabilityBinding` is keyed by exact node/capability identity and
freezes a versioned trusted contract ID/digest, action kind, embedded result
and evidence contract, recovery policy, and exact Adapter
artifact identity `{ id, version, contentDigest }`. The effective policy
reuses the authoritative effective-stage metadata resolver/shape and freezes
every action- or host-orchestration-shaping field with provenance: role, model,
effort, runtime, sandbox, Gate policy, session-reuse, handoff/reuse thresholds
and limits, plus every supported override. Values not used by this preview are
still either frozen faithfully or explicitly rejected by support analysis;
they are never ignored or recomputed on resume. Missing, ambiguous, or
unsupported overrides reject before Run creation, and start never silently
defaults them.

The source revision comes from the winning `PreparedPipelineResolution`, not
the normalized semantic Definition alone, and reuses its authoritative
`PipelineSourceLayer = "project" | "user" | "package"` type. Built-in/package
provenance belongs in `kind`/`sourceId`; selected store/project space is a
separate Change scope, not an invented source layer. Absolute source paths may
appear in human diagnostics but never in this profile or an identity digest. A
package/user/project shadow, raw authored edit with the same semantics,
semantic edit, delete, or source-ID change is therefore observable
independently.

The execution seal recomputes the capability and plan digests over the complete
profile. `launch.json` and Record bind the accepted plan/profile, capability,
policy, and SourceRevision digests. A same-key retry finds this binding before
source/profile/policy preparation and returns it unchanged. On resume, the
stored sealed profile is the only action/policy truth. The current trusted
table, installed skill catalog, and config stack are consulted only for a new
launch or read-only drift comparison; they are never a fallback decoder or a
way to repair a stored profile. Profile tampering or an unsealed legacy-only
payload fails `plan_integrity`.

This is a deepening of the one opaque plan seal, not a public plan union or
second source compiler. `EcpDefinitionModule.prepare` retains its public
envelope version and opaque payload contract.

The private lowering reads the legacy metadata already frozen by
`normalizeV1`, including exact stage IDs, dependencies, gates, and
`verifyPolicy`. It does not look at `pipeline.yaml`, `auto-run.json`, current
workflow definitions, or filesystem paths. The lowerer supplies an implicit
root success finish for a valid v1 DAG and models `verifyPolicy: adaptive` as
an explicit result route:

```text
verify.result.route = simple  -> normal downstream
verify.result.route = complex -> durable wait:
                                 review_cycle_capability_unavailable
```

The complex route has no edge to `ship`. It can only remain suspended,
escalate, or cancel in this child.

One read-only `ReconcilerSupportAnalyzer` consumes the same prepared Definition
and candidate execution profile used by start. Pipeline show, management
Pipeline detail, Canvas, and start project its result as additive
`availableEngines` / `reconcilerSupport { supported, reason, profileDigest }`.
Only the exact validated `bug-fix` profile is supported in this slice; other
v1/v2 Pipelines remain explicitly unavailable. The existing phase-1
`capability.executionMode: "legacy"` field stays compatible but is no longer
the sole engine-availability statement, and no surface guesses support from
the Pipeline name.

Alternative considered: add a second runtime compiler that reloads the winning
Pipeline by name. Rejected because source drift would silently replace frozen
meaning. Alternative considered: publish the compiled node union. Rejected
because that weakens the Definition module and lets ordinary callers implement
their own reducers.

### 3. Use an immutable filesystem Record ledger, not SQLite or one replaced file

The production store is local-substitutable: focused tests use an in-memory
Adapter; production uses the Change's registered machine-home work directory.
Start first performs syntactic/root admission and resolves the registered
PlanningSpace. If an active Change exists, it proves that physical
ChangeInstanceId before doing lookup/create only in that instance; only when no
active source exists may it perform the unique historical same-key lookup
described below. A genuinely new Run then resolves
`resolveChangeWorkDir(projectRoot, changeId, { ensure: true })` only after
active-instance validation. Once a Run exists,
resume/complete/inspect/control/status resolve the same registered
PlanningSpaceId/ChangeInstanceId work association with `{ ensure: false }`;
they do not require
the active Change directory to remain present. This lets an archive action move
or delete the source Change before its host completes the exact Run. Failure to
resolve the existing machine home is `run_store_unavailable`; canonical state
is never recreated in the repository or under a newly minted identity.

The private association registry is itself an immutable, bounded,
`SafeRunPath`-protected revision ledger. It records `PlanningSpaceId`,
`projectId`, `changeId`, `ChangeInstanceId`, proven physical source identity,
active/archive aliases, and state. Archive host evidence updates that ledger
before downstream source-targeting work is admitted. An old archived/missing
Run remains exactly inspectable and may complete an already admitted archive
or recovery observation, but ordinary resume/control cannot target a newly
created same-name Change and fails `change_instance_inactive`.

Production layout:

```text
<workDir>/
  change-runs/
    <runId>/
      plan.json
      launch.json
      records/
        record-000000000000.json
        record-000000000001.json
        ...
      evidence/
        sha256/
          <digest-prefix>/<full-digest>.evidence
```

Generated directory/file prefixes and widths are named constants. Paths are
built only with `path.join`/`path.resolve`. The store canonicalizes the
existing project root for identity comparisons but never places an absolute
path in a digest.

Every read, enumeration, create, temp write, and publish passes a private
`SafeRunPath` Adapter. Starting at a validated physical work-directory anchor,
it `lstat`s every component, rejects symbolic links, junctions, mount/reparse
points, hard-linked/non-regular files, and non-directory parents, verifies
resolved containment, and rechecks physical identity around open/rename.
`plan.json`, `launch.json`, every final Record, and exact temporary file must be
a real regular file; `change-runs`, Run, and `records` must be real directories.
It uses no-follow flags where Node exposes them, then fstat/realpath/lstat
identity and containment rechecks after open; new files use same-parent
exclusive create plus pre/post-rename checks. Pre-existing links/reparse points
are rejected before target access, and any observed replacement race is
discarded as `run_store_corrupt`/`unsafe_path` before semantic use/commit.

Node does not expose handle-relative `openat`/Windows `CreateFile` controls
needed to prove zero target I/O against a malicious same-user junction swap in
the nanosecond between check and open. This first local-only slice does not add
a native dependency and explicitly excludes that concurrent same-user attack
from its strong guarantee; it still detects best-effort and fails closed.
Stronger adversarial same-user protection requires a reviewed native SafeFs
Adapter and dedicated Windows CI before the guarantee can be widened.

Each `record-N` is the complete immutable canonical Record at version `N`,
including its predecessor digest. On every load, the store treats the
`records/` namespace as closed and validates the complete published sequence
from exact fixed-width `record-000000000000.json` through the numerically
highest final-name revision. Version numbers must start at zero with no gap,
and every file's name/version, closed schema, canonical digest, predecessor
digest, Run/plan identity, and immutable fields must validate. Only after the
whole sequence passes is its highest revision the current canonical Record;
older revisions are immutable history within that same ledger, not a fallback
candidate or independently writable event truth.

Only files carrying the store's exact generated temporary/staging naming
scheme may be ignored after a crash. Any unexpected entry in `records/`, any
final-name corruption, missing version, gap, duplicate numeric revision
encoded through a case/width/name variant, over-width or otherwise abnormal
revision name, or later final revision beyond a gap makes the entire Run
`run_store_corrupt`. A missing/corrupt/mismatched `plan.json` is
`plan_integrity`. In either case load/list/inspect/resume/complete/control fail
closed for that Run: they do not choose an earlier valid revision, reconcile,
or emit an action. Operations may isolate and report the invalid Run while
continuing to list unrelated healthy Runs.

Launch derives `RunId` from `PlanningSpaceId`, `ChangeInstanceId`, Change ID,
and required `launchRequestId`, then takes the instance-level create lock. This
tuple is the complete idempotency namespace; no cross-instance or cross-space
mutable key index exists. The `launch.json` value records that audit scope, a digest of
canonical in-scope caller intent (Pipeline, normalized inputs, and engine), and
the accepted frozen plan plus execution-profile/capability/policy/SourceRevision
digests. If that Run directory already exists, the
store validates it before doing any current-source preparation: the same key
and canonical caller intent in that scope return the original Run/plan without
a second Run, while the same scoped key with different caller intent returns
`launch_request_conflict`. A reused start returns the current view with
`actions: []` and does not advance the Record; it never treats projected active
actions as delivery grants. The caller then uses exact `resume`, which applies
the stored recovery policy: safe/read-only or explicitly idempotent work may
redeliver the same ActionId under dispatch serialization, while
`suspend-if-ambiguous` commits its exact uncertain-effect wait and returns no
grant until observation. This is conservative whether the first response was
lost after execution or before delivery. Current source
drift after the first
accepted launch cannot turn a retry into a new Run. Reusing the same textual
key for another Change incarnation or planning space addresses another Run and
does not conflict.

Start with an active Change first resolves its physical `ChangeInstanceId` and
looks up or creates only in that instance. If the active source is absent,
start may return a same-key accepted historical Run only when exactly one
instance matches; multiple historical instances return
`launch_instance_ambiguous` and require an exact `runId`. A same-name recreated
active Change never reuses an old instance's key or Run.

For a new key, the store derives the next display/history `runOrdinal` from
valid committed Run directories, writes `launch.json`, the exact plan, and the
version-zero Record into a same-parent staging directory, fsyncs files, then
renames the directory once. A failed pre-rename launch is invisible; a
post-rename crash is a resumable Run. `runOrdinal` never provides launch
idempotency and never participates in deciding whether a retry is new.

Commit takes the per-Run lock, validates the entire published Record sequence
and stored plan as above,
reduces and settles in memory, writes a new `record-(N+1)` temporary file with
`wx`, fsyncs it, and atomically renames it to the previously absent final name.
It never overwrites an existing Record revision. POSIX directory fsync is
best-effort after rename; Windows relies on closed-file flush plus the
same-volume atomic rename to a new name.

Engine, create, and commit locks use a new change-run-specific
`OwnershipSafeLock` Adapter, not the existing mtime-stealable helper. Its
bounded paths live outside project registration:

```text
<getGlobalDataDir()>/locks/change-run-v1/
  bootstrap/<sha256(resolveRegistrationRoot NUL changeId)>.lock
  association/<sha256(PlanningSpaceId NUL changeId)>.lock
  engine/<sha256(PlanningSpaceId NUL ChangeInstanceId)>.lock
  create/<sha256(PlanningSpaceId NUL ChangeInstanceId)>.lock
  commit/<sha256(PlanningSpaceId NUL ChangeInstanceId NUL fullRunId)>.lock
  workspace/<sha256(WorkspaceInstanceId)>.lock
  ipc/<bounded-lock-digest>.<token>.sock   # Unix only
```

The hashed names are path-safe coordination keys. `resolveRegistrationRoot` is
reused so linked worktrees share a bootstrap scope. When a project is already
registered, mutations use the stable planning-space and instance scope, which
survives path aliases and registry relocation.

The global coordination root has its own `SafeCoordinationPath` contract.
`getGlobalDataDir()` is physically resolved once as an anchor; below it every
`locks/change-run-v1` component must be a real directory and every canonical
lock/staging entry a regular same-device file. Symlink, junction, reparse,
non-directory, invalid hard-link topology, cross-device claim, or parent identity
replacement fails `lock_unavailable` after pre/post physical identity checks.
Benign aliases above the resolved global-data anchor converge; aliases or
replacement below it never create a second physical lock namespace.

An unregistered operation first takes the bootstrap lease and rereads the
registry inside it. Unregistered legacy resume remains under that lease. A
canonical start mints project identity and derives `PlanningSpaceId`, then uses
the instance-association lease
`H("instance-association/1", PlanningSpaceId, changeId)` whenever the physical
source has no association. The same lease guards every association-ledger
mutation, including old-instance archive alias/state updates and same-name
recreation. Inside it, start rereads and deterministically writes the
association, then bridges to the stable instance engine lease. A registered
operation with an existing association goes directly to engine; registration
alone is never mistaken for instance resolution.

Every unresolved-instance ownership path, including registered legacy resume,
also takes that association lease, rereads the active physical identity, and
derives the same deterministic ChangeInstanceId before bridging to its engine
lease. Legacy resume need not publish an association revision, but it holds the
derived engine lease through authoritative selection and legacy output.
Therefore first canonical start versus legacy resume serializes even when the
project was already registered and no prior association existed.

Waiters reread after every bridge and cannot continue under an obsolete path or
pre-instance scope. Bootstrap is released before ordinary instance work;
instance-association is held only through association publication and the bridge
to engine, then released. These short bootstrap/instance/engine transitions are
the only multi-lease bridges and never call a facade recursively. Concurrent
first start, benign aliases, separate linked-worktree source directories, and
archive/recreate races therefore converge on the appropriate exact association.

Before publishing owner metadata, acquisition starts a token-bound Node `net`
challenge listener: a Unix-domain socket inside the same physically anchored
`ipc/` directory on Linux/macOS, or a Windows named pipe, with a bounded
endpoint derived from the lock digest and random token. If the platform socket
path limit cannot contain the anchored Unix endpoint, acquisition returns
`lock_unavailable`; it never relocates to an unchecked temp namespace.
The closed metadata binds protocol version, endpoint, token, and a diagnostic
PID. Acquisition then creates a same-parent uniquely named staging regular file
with `wx`, writes and closes that metadata, then fsyncs and fstats it. It atomically
claims the canonical name with same-volume `fs.link(staging, canonical)`;
hard-link creation is no-replace and returns `EEXIST` for a competing holder.
The canonical and staging names must identify the same inode/file identity
before staging is unlinked. Filesystems that cannot supply this tested
same-volume hard-link claim return `lock_unavailable`; the implementation never
falls back to replacement-capable rename.

A canonical lock legitimately has link count one, or temporarily two when the
only companion is one strict staging name with the same inode and identical
complete token metadata. Both forms are challenged before any classification or
cleanup; link-before-unlink and crash residuals are valid live ownership, not
corruption. Count above two, a companion that cannot be exhaustively proven, or
metadata/identity mismatch fails busy/corrupt and is never auto-stolen.
Residual staging cleanup requires the same token, challenge-liveness result,
and physical identity proof as canonical release.

Only the canonical regular-file name represents ownership. A crash before link
leaves a strictly named non-owner staging orphan; a crash after link leaves
complete durable owner facts even if the staging link remains. An
incomplete/invalid/mismatched canonical lock, including an unprovable companion
topology, is unknown-busy `coordination_lock_corrupt`: it is never
automatically quarantined or stolen because a live holder's metadata may have
been damaged after acquisition. Only explicit offline/operator recovery may
remove it after independently excluding live work.

A contender probes the bound endpoint with a fresh nonce and accepts ownership
only when the listener returns the protocol- and token-bound response. Success
means live. Timeout, permission denial, malformed response, or any uncertain
network state means busy and is never stealable. Only stable
`ENOENT`/`ECONNREFUSED` observed twice with unchanged canonical file identity
and still-complete token/endpoint metadata proves dead; a paused event loop
therefore yields unknown/busy, not recovery. On proven death, recovery moves
the old canonical file to a unique quarantine,
validates the moved identity, and only then permits another claim. A stale Unix
socket is removed only after that proof. OS process exit closes the challenge
listener; PID and clock are diagnostic only, so PID reuse is irrelevant.

Listener close/error marks the lease lost. Before any Run/association/
reservation publish, the owner proves the listener is still serving and rereads
the canonical token and physical file identity. Release performs the same
compare-check before unlink; mismatch is a no-op, so an old owner cannot delete
a replacement. This protocol never uses mtime, a shell, or platform process
tables as ownership truth.

Archive completion identifies its target read-only, then acquires association
before that instance's engine lease and rechecks both Record and binding.
Thus archive-versus-recreate and crash retry cannot lose an association-ledger
revision.

Lock order is bootstrap, instance-association, engine, workspace, create, commit,
and no operation
reacquires a held lock. Workspace admission is planned before a Run commit, so
no path takes workspace while holding commit.
Crash-after-acquire, a live holder beyond any former stale threshold,
dead-owner recovery, ABA steal/release, and multi-process exactly-once are
contract tests. Fault injection covers staging write/fsync, before/after link,
two concurrent links, post-publish return, live-owner metadata corruption
remaining unknown-busy, strict
staging-orphan cleanup, Unix stale socket, paused listener, listener loss,
Windows hard-link/capability failure, and old-token release after replacement.
Random tokens, endpoints, PIDs, and lock clocks are mechanical only and never enter
deterministic runtime values.

Untrusted request objects and disk JSON are bounded before expensive work.
Direct facade values first pass an iterative structural budget walker before
clone/canonicalization. Disk files are `lstat`/`stat` checked, read through a
bounded handle, parsed only after the byte limit passes, and structurally
validated before clone/digest canonicalization. The closed v1 budgets are:

| Value | Limit |
| --- | --- |
| launch inputs | 256 KiB encoded; depth 16; 512 total keys; arrays 1,024; strings 64 KiB |
| completion envelope/result | 1 MiB / 512 KiB; at most 64 evidence refs |
| evidence | 16 MiB content; 256 KiB envelope; 32 files/32 MiB uploads per request; 10,000 files/512 MiB per Run |
| control envelope/reason | 64 KiB / 4 KiB |
| `plan.json` / `launch.json` / one Record | 4 MiB / 256 KiB / 16 MiB |
| ledger | 4,096 revisions and 128 MiB cumulative canonical bytes; 50,000 transitions; 10,000 actions; 64 evidence refs per action |
| generic JSON | depth 32; 16,384 total keys; arrays 16,384; strings 1 MiB |
| list page | 100 Run summaries; at most 512 candidate directories or 256 MiB physical reads per request; opaque stable cursor |

Versions, ordinals, counts, and sizes are non-negative safe integers and must
also fit the fixed filename width. Request excess is `input_too_large`; stored
excess or structural violation is `run_store_corrupt`; a ledger/evidence
cumulative excess is `run_store_too_large`. Sparse files are charged by logical
size and rejected before read. List is stable-sorted by full identity, validates
within the page work/byte budget, returns an opaque cursor, and projects an
isolated error summary for one invalid Run without consuming unbounded work or
blocking healthy Runs on later pages.

This design was compared twice:

| Design | Depth | Locality | Result |
| --- | --- | --- | --- |
| SQLite database with plan/record rows and transactional CAS | Strong transactional depth, but introduces connection/schema/migration lifecycle and a database-wide storage concern into a file-oriented per-Change product seam | SQLite details concentrate in one Adapter, but WASM locking/durability and close discipline become new cross-platform operational knowledge | Rejected for this first vertical slice |
| Immutable per-Run filesystem Record revisions behind `RunStore` | Store Interface remains `create/load/commit/list`; crash interpretation is visible and deterministic; no caller learns files | Reuses machine-home locality and existing lock/atomic-file practices; all filename and recovery rules stay in one Adapter | Selected |

A third shallow option—replace one `record.json` in place—was rejected because
replacement failure semantics vary more across Windows/POSIX and make
crash-before/after-replace injection less precise.

### 4. Define one Record and validated transition vocabulary

The canonical Record is closed and deeply readonly:

```ts
interface CanonicalRunRecord {
  format: "change-run-record/1";
  runId: RunId;
  runOrdinal: number;
  change: {
    planningSpaceId: PlanningSpaceId;
    projectId: string;
    changeId: string;
    instanceId: ChangeInstanceId;
  };
  workspaceInstanceId: WorkspaceInstanceId;
  pipeline: string;
  engine: "reconciler";
  launchRequestDigest: Digest;
  planDigest: Digest;
  sourceRevisionDigest: Digest;
  capabilityDigest: Digest;
  policyDigest: Digest;
  executionProfileDigest: Digest;
  initialWorkspaceRevision: WorkspaceRevision;
  currentWorkspaceRevision: WorkspaceRevision;
  recordVersion: RecordVersion;
  previousRecordDigest: Digest | null;
  status: "running" | "waiting" | "completed" |
          "escalated" | "failed" | "cancelled";
  transitions: readonly CommittedTransition[];
  actions: Readonly<Record<ActionId, CommittedAction>>;
  inputs: Readonly<Record<string, JsonValue>>;
  terminal?: TerminalOutcome;
}
```

Transitions include `RunStarted`, `ActionAdmitted`, `ActionGranted`,
`ActionResultCommitted`, `GateAwaiting`, `GateDecided`,
`RunSuspended`, `RunResumed`, `RunEscalated`, `RunCancelled`, and
`RunFinished`. They live inside the Record revision. There is no separate
event writer, mutable stage map, projection cache, or compatibility file read
by the Reconciler.

A validated `blocked` completion closes the original Attempt exactly once and
commits a `domain-blocked` durable wait with structured reason, evidence, and
projected allowed controls. It is not terminal failure, Adapter infrastructure
failure, or uncertain-effect recovery. Only a version-checked resume/decision
allowed by the frozen capability policy may close that wait; it increments the
committed `attemptOrdinal` and admits a new Attempt/Action. `EffectId` remains
stable for that logical Invocation/effect slot; a genuinely new logical effect
requires an explicit new occurrence or effect slot. The completed blocked
Action is never reused, and a control cannot immediately recreate the same
wait without a new admission. Repeated blocked receipts are idempotent; stale
or concurrent controls write nothing. A partial or unknown effect is never
classified as blocked and must use uncertain-effect recovery. `failed` follows
the frozen terminal/retry policy, while Adapter infrastructure errors suspend
without fabricating a domain result.

Every durable wait also carries
`WaitId = H("wait", RunId, waitKind, NodeId, InvocationId, occurrence,
AttemptId?, ActionId?, stableSortedEffectIds, decisionOccurrence?)`. Optional
tuple fields use explicit absent markers. This distinguishes two Gates with the
same authored decision ID and future repeated occurrences. A wait-scoped
control must match the exact currently active `waitId`; wrong, closed, or stale
wait identity performs no write.

The aggregated `workspace-reservation` variant uses
`H("wait", RunId, "workspace-reservation", WorkspaceInstanceId,
H(stableSorted(nodeId, invocationId, occurrence, attemptId, actionId, access)))`
instead of selecting one singular intent. Any changed intent set closes that
WaitId and creates another; insertion order cannot change it.

`reduce` validates a proposed stimulus and returns a new value or a typed
failure; it performs no I/O. `settle` applies only mechanically implied
transitions and admissions until it reaches one of:

- one or more admitted external actions;
- one or more Gate/domain-blocked/human/capability/uncertain-effect waits with
  no additional mechanically ready progress;
- a terminal outcome.

Waits are branch-local, not a global stop flag. Settling may return independent
actions and waits together; it continues all unblocked ready branches until
each is action-bound, wait-bound, or terminal. A terminal outcome is emitted
only when the whole root slice satisfies its declared finish/failure rule.

The facade persists the settled value once, so a result and the next admitted
frontier cannot be separated by a projection crash.

Alternative considered: append events and rebuild a separate snapshot.
Rejected in this child because two independently writable artifacts could
disagree. Historical transitions remain useful, but only inside the
versioned canonical Record.

### 5. Derive every identity from frozen meaning and committed ordinals

Use one canonical SHA-256 identity allocator with domain-separated tuples:

```text
PlanningSpaceId = H("planning-space/1", registryEntry.home)
RunId        = H("run", PlanningSpaceId, ChangeInstanceId, changeId,
                 launchRequestId)
NodeId       = compiled authored stable node identity
InvocationId = H("invocation", RunId, hierarchicalNodePath, occurrence)
AttemptId    = H("attempt", InvocationId, attemptOrdinal)
EffectId     = H("effect", InvocationId, effectSlot)
EffectSet    = H("effect-set", stableSortedEffectDescriptors)
ActionId     = H("action", AttemptId, actionKind, EffectSet)
WaitId       = H("wait", RunId, waitKind, exact contextual identities)
```

`launchRequestId` is required caller-stable intent within the frozen planning
space/Change-instance scope. `occurrence` and `attemptOrdinal` come only from the
committed Record. Root nodes have
occurrence zero in this child. `EffectId` remains stable across delivery
retries of the same logical invocation; a genuinely new attempt has a new
`AttemptId`/`ActionId`. `runOrdinal` is presentation/history metadata and is
not an identity or idempotency input.

Every route that may increment `attemptOrdinal`—confirmed `not_executed`,
domain-blocked resume, or infrastructure retry—is governed by sealed finite
`maxAttempts`, per-Run `maxActions`, and applicable execution budgets. The
reducer checks committed counters before admission. Reaching a limit commits
the frozen failed/escalated outcome; it never generates unbounded Actions,
Record revisions, or identity ordinals.

Clock time, randomness, process IDs, temp names, absolute project paths,
filesystem mtimes, and Record version are not allocator inputs. A clock may be
used only by lock mechanics or optional presentation metadata that the
Reconciler ignores.

The Record retains a separate `runOrdinal` only for display and historical
ordering.

Identities use full digests in state; user-facing views may display a prefix
but never accept that prefix where an exact identity is required.

### 6. Keep reconciliation pure and root semantics deliberately small

`reconcile(runtimePlan, record)`:

- validates engine/plan/record identity;
- reduces committed transitions into node state;
- sorts ready nodes by stable hierarchical Node ID;
- emits the same typed candidate actions and wait/terminal decision for identical
  plan/Record values;
- reads no files, catalog, clock, environment, process, network, or Adapter;
- mutates neither input.

The installed runtime subset is:

- root DAG dependency readiness;
- typed AtomicStage admission;
- human Gate before a stage;
- the explicit simple/complex adaptive verification route;
- durable suspend/resume/escalate/cancel;
- implicit v1 root finish and explicit supported root Finish.

A terminal Record emits no action. A rejected Gate maps to a declared
fail/escalate outcome; it cannot skip forward. An invalid or unsupported
choice result suspends/fails closed. Unsupported `CompositeRef`,
`BoundedLoop`, `FanOut`, or `Join` in a candidate plan is rejected at start,
not partially interpreted.

No task in this child implements a ReviewCycle body, loop round, Composite
identity, Composite-internal fan-out, or join barrier. Independent ready nodes
in the supported root DAG may still be admitted as one deterministic frontier.

Start asks a private local-substitutable `WorkspaceObserver` for a
path-independent `WorkspaceRevision { headDigest, treeDigest,
dirtyWorktreeDigest }` and binds it into the sealed profile and version-zero
Record. The observer also resolves a `WorkspaceInstanceId` from the proven
physical Git worktree identity. Linked worktrees and independent clones are
distinct workspace instances; a verified registry alias migration preserves
identity across a move, while an unprovable alias change fails closed. Every
capability binding freezes orthogonal workspace access/resources and exact
effect descriptors, and each admitted
Action carries the expected before revision. Before an admitted action is
returned after any fresh process boundary, the facade re-observes the workspace
outside the pure Reconciler. If a workspace-writer Action is active, an
unexpected tree/dirty/HEAD value is first treated as that Action's possible
effect and enters `uncertain-effect` bound to its original
Action/Invocation/Effect; it can close only through strong
succeeded/failed/not_executed observation. Only when no writer is active (or
all active actions are read-only) does an unexpected revision become a general
`workspace-drift` wait.

`WorkspaceObserver` uses bounded Git plumbing plus physical file reads, not
`git diff`, mtimes, or a directory path hash. It builds a canonical manifest
from HEAD tree, index stages/modes/blob IDs, tracked working bytes and modes,
untracked non-ignored files, deletions, symlink target bytes, and submodule
gitlink/worktree commit state. Paths use Git's `/` representation and Unicode
NFC; case-colliding entries on a case-insensitive filesystem are unsupported
rather than folded. HEAD records commit vs unborn and detached state.
`treeDigest` covers the complete current manifest; `dirtyWorktreeDigest` covers
the canonical staged/unstaged/untracked delta from HEAD.

Submodules are deliberately conservative in v1. A clean initialized submodule
contributes its superproject gitlink plus checked-out commit. For each
submodule, bounded `rev-parse`/`diff-index` and `ls-files --others
--exclude-standard -z` checks prove HEAD, tracked/index cleanliness, and no
untracked content; its index is also checked for nested gitlink mode. Any
internal staged/unstaged/untracked/mode/symlink dirtiness, nested submodule,
uninitialized/unreadable state, race, timeout, or output budget excess fails
typed (`workspace_submodule_dirty` or
`workspace_submodule_unsupported`). This slice does not recursively digest a
dirty submodule, so unchanged submodule HEAD can never hide inner mutations.

Observation is read-only and bounded by manifest path/byte limits. It takes two
complete passes with HEAD/ref, index content/identity, per-file lstat/fstat, and
submodule identity rechecks; unequal passes retry once, then fail
`workspace_observation_raced`. Unsupported file types, unsafe links outside
the workspace, excessive traversal, unreadable submodules, or ambiguous
case/path normalization fail typed. Golden manifests cover staged/index-only,
tracked mode/content, untracked, symlink, clean/dirty/nested submodule,
unborn/detached HEAD,
concurrent mutation, and Windows path/case behavior.

Completion of a workspace writer requires trusted evidence of exact before
revision, after revision, and bounded delta; the verifier re-observes and the
Record advances `currentWorkspaceRevision` only with that validated result.
`not_executed` for a writer must prove both tree and delta remained unchanged.
Wrong/stale before, false after, external edits, or an apply crash suspend/fail
closed without admitting downstream work. Without a true filesystem snapshot,
this child conservatively makes a workspace writer mutually exclusive with
every workspace reader or writer across every Change and Run using the same
`WorkspaceInstanceId`. Multiple readers may run together only while no writer
is admitted; `workspace.access: "none"` Actions may remain parallel.
Disjoint/composable writer scopes require a later explicit policy and are not
guessed. A stale writer or reader result can never compose merely because its
Action was once admitted.

Ready candidate selection is deterministic and rechecked under the workspace
lease. Candidates are sorted by full NodeId. `workspace.access:none` candidates
join every otherwise valid batch. Considering all effective existing
reservations (including this Run, after applying the exact closing delta), a
writer blocks every new reader/writer. With existing readers, all ready readers
are selected and writers remain frontier. With no existing access, the first
sorted candidate requiring workspace access sets the batch: if it is a writer,
select only that writer; if it is a reader, select all ready readers and leave
all writers frontier. Thus two writers choose the lower NodeId, reader/writer
mixtures have one stable outcome, and external reservation races cannot change
the decision after validation. Ready local workspace intents blocked by
effective reservations enter one closed durable `workspace-reservation` wait
containing only WorkspaceInstanceId and stable-sorted local candidate
identities/access; it never stores another Run's identity or reservation
digest. Access-none candidates may still be admitted in the same Record, so
actions and this wait may coexist. Start can publish version zero already
waiting with `actions: []`. Resume/control while still busy is idempotent with
no new version; after release, exact facade resume or a version+WaitId resume
control closes the wait and admits the deterministic compatible subset.
Management uses defer, so a browser retry produces undelivered Actions rather
than grants. The pure Reconciler emits stable candidates, and the pure
`selectCompatibleAdmissions` produces the same subset for the same explicit
reservation snapshot.

Cross-Run admission uses the global workspace lease and a bounded immutable
reservation registry keyed by `WorkspaceInstanceId`; entries bind exact
Run/Action/Attempt/effect access and Record digest. Admission takes workspace
then Run commit lease, writes a pending reservation containing expected next
Record version/digest, commits the Record containing that reservation, then
finalizes the registry; it returns an Action only after both are durable.
Recovery may discard pending-only state only when the exact expected Record
does not exist and ledger head is still the exact predecessor version/digest
bound by the pending token. A same-version different digest, advanced head
without the reservation, or abnormal ledger remains busy/corrupt; it is never
cleaned speculatively. If the Record contains the reservation while the registry is
pending/missing, recovery rebuilds/finalizes before dispatch. Completion first commits
the Record closing the Action and only then removes its reservation; a residual
entry is removable only after the exact closed Record is proven. Thus every
crash boundary is conservative and no second process sees a false free slot.
The registry is bounded and indexed, so admission never scans all Changes/Runs.
Different workspace instances never share this lease or registry.

A mutation that closes upstream workspace access and settles downstream
admission uses one reservation-delta transaction under the same workspace then
Run commit leases. Compatibility is computed as if the exact closing
reservations were removed, while their durable final entries remain present.
The transaction writes all new read/write pending reservations (none for
`access:none`) with one token and expected next Record, commits one Record that
both closes the old Actions and admits all downstream Actions, finalizes every
new reservation, then deletes the exact old reservations. This permits
writer-to-reader, writer-to-writer, and one-to-many-reader self-handoff without
splitting the canonical Record, while another Run can never observe a false
free slot.

Crash recovery treats that token as one delta: at the exact unchanged
predecessor it removes all new pendings and retains old finals; at the exact
committed Record it finalizes all new entries before removing any old entry.
Partial finalize/delete is idempotently completed from the Record. Any
different head/digest or incompatible external reservation remains busy or
corrupt. No newly admitted Action is returned until the complete delta is
durable.

A general `workspace-drift` wait never offers ordinary resume. Its projected
controls are escalate, cancel, and—only when the frozen policy allows it—a
versioned `accept-workspace-revision` decision carrying strong WorkspaceObserver
evidence for one exact new revision. The verifier reobserves that revision
under the commit lease, commits `WorkspaceRevisionAccepted`, invalidates stale
admissions, and lets settling allocate a new Attempt. Stale/concurrent
acceptance writes nothing. This explicit transition is the only rebase-like
path; current workspace state is never silently adopted. It is unavailable
while an active writer owns an uncertain-effect wait.

### 7. Admit typed actions and accept results only through `complete`

For a new launch, the current trusted registry supplies exact versioned
capability and Adapter bindings to the execution seal. After that point the
stored profile, never the current registry or a name pattern, constructs
actions:

```ts
type RunAction = AgentRunAction | CommandRunAction | HostRunAction;

interface RunActionBase {
  format: "change-run-action/1";
  runId: RunId;
  nodeId: NodeId;
  invocationId: InvocationId;
  attemptId: AttemptId;
  actionId: ActionId;
  effects: readonly {
    slot: string;
    effectId: EffectId;
    kind: "workspace" | "external";
    resource: string;
    recovery: "retry-same-action" | "suspend-if-ambiguous";
    operation: {
      operationKey: string;
      ownershipMarkerContract: string;
      conflictPolicy: "fail" | "uncertain";
    };
  }[];
  executionProfileDigest: Digest;
  capability: {
    id: string;
    authoredVersion: string;
    contractId: string;
    contractVersion: string;
    contractDigest: Digest;
    artifact: { id: string; version: string; contentDigest: Digest };
  };
  resultContractDigest: Digest;
  evidenceContractDigest: Digest;
  policyDigest: Digest;
  workspace: {
    access: "none" | "read" | "write";
    resources: readonly string[];
  };
  expectedBeforeWorkspace: WorkspaceRevision;
}

interface AgentRunAction extends RunActionBase {
  kind: "agent";
  agent: {
    role: string;
    model: string;
    reasoningEffort: string;
    runtime: string;
    sandbox: string;
    input: JsonValue;
    session: {
      reuse: "never" | "same-invocation";
      handoffTokenLimit: number;
      reuseRoundLimit: number;
    };
  };
}

interface CommandRunAction extends RunActionBase {
  kind: "command";
  command: {
    artifact: { id: string; version: string; contentDigest: Digest };
    executable: { identity: string; contentDigest: Digest };
    argv: readonly string[];
    env: Readonly<Record<string, string>>; // frozen allowlisted names only
    workspaceInstanceId: WorkspaceInstanceId;
    workingDirectory: string; // validated workspace-relative POSIX form
    timeoutMs: number;
    shell: false;
  };
}

interface HostRunAction extends RunActionBase {
  kind: "host";
  host: {
    operation: "workspace-apply" | "verify" | "ship" | "archive";
    input: JsonValue;
  };
}
```

These are closed major-v1 variants: another variant's payload and unknown
fields are forbidden. Their nested strings, arrays, inputs, argv/env counts,
and timeouts use the sealed action budgets. Command execution resolves the
exact artifact/executable digest, passes argv without a shell, supplies only
the frozen environment allowlist, and revalidates workspace/workdir identity;
ambient `PATH`, shell expansion, inherited env, and current config cannot alter
meaning. Unknown majors and extra fields fail typed before dispatch.

Effect descriptors are sorted by exact slot before Action identity is
allocated. A single-effect Action is the length-one case. Each logical external
or workspace effect has its own stable `EffectId`; retries change Attempt/Action
but not the Effect ID for the same Invocation/slot.

Every effect contract freezes a provider-specific idempotency/ownership
strategy whose `operationKey` embeds or maps to the exact `EffectId`. Git
commits/refs use a frozen trailer/ref namespace plus expected-old lease; push
uses that marked ref and remote lease; PR creation uses exact head plus a
machine-readable ownership marker in supported metadata/body; archive uses a
bound manifest and move receipt. A pre-existing same-content artifact without
the exact marker is never credited. Another Run's marker is
`effect_owner_conflict`; a tampered marker fails evidence validation. If a
provider cannot atomically create or query the exact ownership marker, response
loss remains `uncertain-effect` rather than guessing success. Two Runs may
target the same human resource only through distinct operation keys or a typed
conflict.

Definitions can select only trusted capabilities frozen in the plan; they
cannot provide executable code, commands, Adapter paths, or validators.

The completion contract is a closed union of whole-action domain results,
per-effect trusted observations, and infrastructure observations. Receipts,
evidence, and uncertain waits bind one or more exact effect slots. Composite
ship delivery freezes separate local-commit/HEAD, push, and PR effect slots;
archive freezes repository mutation and filesystem-move slots. Recovery can
therefore distinguish local committed/remote not pushed, pushed/no PR, and PR
opened/response lost instead of collapsing the whole Action into one ambiguous
effect. Domain success commits only when every required effect and result
contract is reconciled.

Before execution an Adapter must resolve the exact `{ id, version,
contentDigest }` artifact and revalidate its digest. A changed skill prompt or
same-named newer artifact is never substituted. Disablement/removal/current
version changes are drift only if the exact frozen artifact remains available;
if it is unavailable, the Run enters typed `capability_artifact_unavailable`
suspension without executing another version. The current trusted table is
never an execution backdoor.

Admission is stored before an action appears in a receipt. Agent/command/host
Adapters execute outside the Reconciler. Their output is untrusted until
`complete` verifies:

- exact Run/Action/Invocation relationship and active state;
- actor shape and any action constraint;
- result status and capability-specific schema;
- required evidence through the frozen evidence contract;
- a recomputed canonical receipt digest.

`EvidenceRef` is a closed, path-free public value:

```ts
interface EvidenceRef {
  format: "change-run-evidence-ref/1";
  store: "change-run";
  evidenceDigest: Digest;
  contentDigest: Digest;
  mediaType: string;
  size: number;
  observationKind: string;
  producer: { id: string; version: string; identityDigest: Digest };
  binding: {
    planningSpaceId: PlanningSpaceId;
    changeInstanceId: ChangeInstanceId;
    projectId: ProjectId;
    changeId: ChangeId;
    runId: RunId;
    actionId: ActionId;
    effectId?: EffectId;
    treeDigest?: Digest;
    schema: string;
  };
}
```

A private local-substitutable `EvidenceStore`/`EvidenceVerifier` has in-memory
and filesystem contract suites. Trusted hosts may stage content-addressed
evidence, but receipt payload and refs remain untrusted. Each stored evidence
object is a canonical envelope whose `evidenceDigest` covers
`{contentDigest, binding, mediaType, size, producer, observationKind}` plus its
plan-required attestation. Content-addressing by that envelope digest prevents
the same bytes being relabeled for another Action, Effect, tree, or schema.
The frozen EvidenceContract requires either a canonical attestation verified
against the plan-bound trusted producer identity or a fresh verifier query;
plain logs and caller-authored binding fields carry no authority.

Before Record commit, the verifier performs a bounded, no-follow physical
read; recomputes envelope and content digests; verifies
regular-file/containment and stable file identity; and checks planning-space/
Change-instance/project/Run/Action/Effect/tree/schema/producer/observation binding
against the frozen capability contract. Absolute, link/reparse, traversal,
missing, oversized, tampered, cross-binding reuse, or replacement-race
evidence fails closed. The verifier cannot write a Record. In particular,
`not_executed` requires the strong `effect-not-executed` observation kind and
its trusted attestation/query; a generic log or caller-reported string can
never authorize a second irreversible effect.

A narrow private `HostEvidenceWriter.stage` is the production ingestion seam.
The trusted host supplies bounded bytes or a no-follow local source plus the
expected frozen binding; the writer validates the producer/attestation,
atomically copies and fsyncs the immutable envelope into EvidenceStore, and
returns the final `EvidenceRef` without exposing Record, plan, store layout, or
a writable evidence path. Identical envelope staging is idempotent; the same
claimed digest with another envelope/binding conflicts. Named fault points
before and after publish prove invisible pre-publish state and idempotent
post-publish retry. A stage crash before `complete` leaves an unreferenced
content-addressed orphan that cannot advance a Run; bounded retention may
later remove only unreferenced evidence under its own policy.

Staging charges pre- and post-open `stat`/`fstat` logical bytes, rejects sparse
or changing sources, enforces the per-request and per-Run file/byte budgets,
and reserves capacity before publish. Request excess is `input_too_large`;
stored excess is `run_store_corrupt`; a valid Run at its sealed evidence budget
returns `evidence_budget_exceeded`. Orphan collection is never part of
status/inspect/list. An explicit maintenance pass examines at most 256 stable
entries, only considers objects older than 24 hours, rechecks physical identity
and the complete bounded Record reference set under the Run commit lease, and
deletes only still-unreferenced objects. Its cursor and byte budget make cleanup
incremental; a race or uncertain reference keeps the evidence.

The CLI completion transport may carry bounded `evidenceUploads` for a trusted
execution host. The wrapper stages them first, replaces them with returned refs,
and passes only canonical refs to `ChangePipelineRuntime.complete`; uploads are
transport-only and excluded from receipt digest bytes. This supplies the real
fresh-process dogfood path without widening the runtime facade or browser UI.

The `bug-fix` verification result has an explicit
`route: "simple" | "complex"`. Only `simple` can satisfy the verify node.

`infrastructure_failed` is a closed trusted-host observation with stable code,
retryability, exact Adapter/artifact identity, and required evidence. It
commits `ActionInfrastructureObserved`, never a domain `ActionResultCommitted`.
Artifact resolution, spawn, timeout, or sandbox setup failure therefore enters
a typed infrastructure wait or the frozen terminal/escalation policy. A
version-checked allowed resume allocates the next Attempt/Action with the same
logical EffectId; it never reuses the closed Action. Identical observations
are receipt-idempotent and conflicting observations fail closed. Operations
projects the typed wait and allowed controls.

Alternative considered: let Adapters receive the store and commit directly.
Rejected because Adapter-specific failures could bypass the one reducer.

### 8. Make Action receipt idempotency independent of Record versions

`complete` deliberately has no `expectedRecordVersion`. It takes the per-Run
lock and evaluates against the latest Record:

- an active matching Action is validated and committed;
- an already completed completion slot
  `(ActionId, kind, EffectId-or-domain-slot)` with the same recomputed
  `receiptDigest` and
  canonical receipt bytes returns idempotent success without a new Record
  version;
- that same slot with another digest/body returns `receipt_conflict`, while
  distinct EffectId slots remain independently admissible;
- an unknown, cancelled, superseded, or otherwise inadmissible Action fails
  closed.

Thus two independently admitted root actions may both complete after observing
the same earlier view: the first increments the Record; the second reloads that
Record and still commits if its own Action remains active.

Receipt canonicalization orders object keys, uses one JSON encoding, and
excludes transport-only metadata. The runtime recomputes the digest rather
than trusting the supplied string. A byte-identical canonical repeat is always
idempotent; no promise is made that two different result values are
interchangeable.

Human `control` is intentionally different: every command carries
`expectedRecordVersion`. A stale Gate decision, resume, escalation, or cancel
returns `record_version_conflict` plus the current view and performs no write.

### 9. Suspend ambiguous effects and close them only with typed observation

An admitted action may have been executed even if no result was committed.
On `resume`:

- `retry-same-action` returns the same `ActionId` and stable sorted effect set
  for safe, idempotent, or read-only recovery;
- `suspend-if-ambiguous` commits `RunSuspended` with
  `wait.kind = "uncertain-effect"` and the exact active Invocation/Action plus
  every unresolved effect slot/EffectId;
- no human `resume` control is offered for an uncertain-effect wait.

The simple `bug-fix` capability table marks any action that may perform an
irreversible delivery effect as `suspend-if-ambiguous`. This may suspend a
never-dispatched action after a host crash, but it cannot duplicate a push/PR
or fabricate completion.

The trusted Adapter closes each unresolved slot through `complete` using the
original Action/Invocation/Effect identity:

- a schema- and evidence-valid `succeeded` or `failed` receipt commits the
  observed result for that original action;
- an evidence-valid `not_executed` receipt proves that exact effect did not
  occur, closes the ambiguous attempt without pretending the Action completed,
  and lets settling allocate a new deterministic AttemptId/ActionId containing
  only effects still required by the frozen delivery policy; already confirmed
  effects remain committed and are not repeated;
- if the Adapter still cannot distinguish those facts, it submits no terminal
  receipt and the Run remains suspended.

Receipt idempotency applies to each committed observation. Human controls for
an uncertain-effect wait are limited to escalate and cancel; they cannot
assert that an effect succeeded or did not execute. This prevents `resume`
from cycling immediately back into the same suspension while retaining a
closed recovery path.

Domain failure, Adapter infrastructure failure, blocked work, and ambiguous
effect are distinct typed states. None is represented by free-text alone.

### 10. Freeze engine ownership and keep legacy recovery intact

Canonical Records created here always freeze `engine: "reconciler"` with the
stored plan. Existing `auto-run.json` records are implicitly
`engine: "legacy"` and are never imported or edited.

Add one `EngineOwnershipGuard` over the resolved Change and the hashed global
coordination protocol defined in Decision 3. An unregistered legacy Change and
a concurrent canonical start meet under the registration-root bootstrap key;
after registration and association every path converges on the stable
`(PlanningSpaceId, ChangeInstanceId)` engine key. Every
code-controlled state-advancing or action-emitting path takes the resulting
authoritative lease, checks both stores, and holds it through selection plus
the relevant create, commit, or legacy output:

- reconciler `start`, `resume`, `complete`, and `control` refuse to advance or
  return an action when an active legacy record also exists;
- legacy Run creation helpers, if invoked by code, and `resumeLegacy` refuse to
  advance when any active canonical Run exists;
- an unreadable/corrupt canonical candidate is `run_store_corrupt` or
  `plan_integrity`; a present legacy artifact whose ownership/terminality
  cannot be validated is `legacy_owner_unknown`. Neither is evidence that its
  owner is absent, so dispatch does not advance the other engine;
- `inspect` and Operations remain read-only but report the detected owner
  conflict/integrity condition.

Conflicting active ownership fails with `engine_owner_conflict` and neither
engine writes. The complete order is bootstrap, association, instance engine,
workspace, create, commit, with earlier leases skipped when not needed. Each
mutation acquires the engine lock exactly
once: no public facade method assumes its caller already holds it, and no
coordinator calls a lock-taking facade method while retaining an outer lease.
Status, inspect, list, and candidate discovery use `{ ensure: false }`, take no
write lock, and create no global directory, registry entry, machine home, or
repository file. A true legacy resume may transiently create only its hashed
global coordination lock/directory; the repository, project registry, and
Change work directory remain byte-for-byte unchanged.
The reconciler preview accepts only a plan that
the installed support analyzer can execute and, for dogfood, only the exact
simple `bug-fix` capability path. Unsupported Pipelines fail before creating a
Run rather than falling back.

The prompt/external process that directly writes `auto-run.json` cannot be
forced to honor this code-owned lock. That is an explicit boundary, not
permission for dual progress: if such a file appears after reconciler launch,
the next controlled reconciler mutation and every legacy resume detect both
owners and refuse to reconcile, emit, complete, or control until an operator
resolves the conflict.

Owner probing is not conditional on the active source directory. It checks
legacy work-directory state, active-directory fallback, and exact archived
locations read-only, while canonical ownership comes from the registered
machine-home RunStore. After archive/move/delete, an exact canonical Run remains
the owner and can complete; missing current source merely makes drift
unavailable.

Ownership comparison is scoped to exact PlanningSpaceId/ChangeInstanceId, not
Change name alone. A legacy artifact read from an active or verified archive
alias is bound to that alias's proven physical instance for the guard check.
An older machine-home legacy artifact with no provable instance binding is
`legacy_owner_unknown`, never silently assigned to a same-name recreation.
Thus two proven distinct incarnations do not become one engine owner, while
ambiguous legacy state cannot authorize canonical progress. Legacy host targets
and canonical external-effect markers likewise carry the resolved instance so
neither engine can act on another incarnation.

Refactor `PipelineCommand.resume` by extraction. Candidate discovery is
read-only and non-authoritative; the selected mutation path then acquires and
rechecks under the guard. Canonical dispatch calls the public runtime, which
acquires the guard itself exactly once. Legacy dispatch calls `resumeLegacy`
inside one guard lease. A competing owner created after discovery is therefore
observed by the locked recheck, while nested acquisition is impossible:

```text
resume candidate discovery (read-only)
  -> corrupt/unreadable canonical candidate? typed integrity failure
  -> active canonical + active legacy? engine_owner_conflict
  -> explicit or unique active canonical Run? runtime.resume
       (facade acquires guard and rechecks before commit/action)
  -> more than one active canonical candidate? active_run_ambiguous
  -> no active canonical candidate? guard.runLegacy(resumeLegacy)
       (guard rechecks before legacy output)
```

The legacy branch's JSON/human fields, workDir-first fallback, invalid-file
diagnostics, portfolio behavior, skill mapping, and exit behavior stay covered
by their existing tests. `start` does not replace the prompt-owned launcher in
this child.

Alternative considered: opportunistically migrate an existing
`auto-run.json`. Rejected because it cannot reconstruct committed action
receipts or prove which effects already happened.

### 11. Treat source/capability/policy drift as observation, never resume input

The stored plan and Record carry frozen SourceRevision, capability profile,
effective policy, workspace, and plan digests.
`resume`, `inspect`, and Operations may ask a read-only `DriftObserver` to
prepare the currently winning source, runtime profile/catalog, and effective
policy solely for comparison.

The view reports independently:

```ts
drift: {
  definition: "unchanged" | "changed" | "unavailable";
  sourceRevision: {
    provenance: "unchanged" | "changed" | "unavailable";
    content: "unchanged" | "changed" | "unavailable";
    semantic: "unchanged" | "changed" | "unavailable";
    current?: { layer: PipelineSourceLayer; sourceId: string;
                authoredContentDigest: Digest; semanticDigest: Digest };
  };
  capability: "unchanged" | "changed" | "unavailable";
  policy: "unchanged" | "changed" | "unavailable";
  workspace: "unchanged" | "changed" | "unavailable";
  currentCapabilityProfileDigest?: Digest;
  currentPolicyDigest?: Digest;
}
```

Changing, deleting, disabling, or shadowing the current Pipeline/capability,
editing a skill prompt, or changing effective config does not replace the
stored plan and does not change `reconcile`. Same-semantics raw edits and
package/user/project shadowing remain visible through SourceRevision. A
missing/corrupt stored plan/profile or a mismatch with Record digests fails
closed. Drift observation failure degrades to `unavailable`; it does not make
a valid frozen Run irrecoverable. Workspace mismatch is different: because it
changes action safety, an advancing facade commits the typed workspace-drift
wait described above.

The same frozen prepared-registry operation is used for one drift observation,
preserving the Definition child’s one-catalog meaning.

### 12. Add an engine-aware CLI without breaking current JSON

Extend `rasen pipeline` with:

```text
rasen pipeline start <change> --pipeline <name>
  --launch-request-id <stable-id> [--json]
rasen pipeline status <change> [--run <runId>] [--json]
rasen pipeline resume <change> [--run <runId>] [--json]
rasen pipeline complete <change> --run <runId> --from <receipt.json> [--json]
rasen pipeline control <change> --run <runId> --from <control.json> [--json]
rasen pipeline cancel <change> --run <runId>
  --expected-version <n> [--reason <text>] [--json]
```

Every command threads the existing `--store`/`--project` root selector. For
reconciler operations, selection must resolve one exact registry entry and then
derive PlanningSpaceId from persisted `entry.home`. If
`--project <projectId>` matches multiple distinct homes/clones, resolution
fails `project_selector_ambiguous` with candidate PlanningSpaceIds (and roots
in local human output); it never chooses registry order. Add
`--planning-space <full-PlanningSpaceId>` as the exact machine selector.
Implicit nearest-root and store selection still resolve through their exact
physical root/entry. Legacy read-only compatibility may retain its established
surface, but no reconciler mutation proceeds from an ambiguous projectId.
`start` returns whether the accepted launch was idempotently reused.
`complete --from` accepts a regular file or `-` for stdin and applies a bounded
body size before parsing; trusted-host transport uploads are staged through
`HostEvidenceWriter` before the core receives refs. `control --from` contains the expected Record
version and typed command. `cancel` is only typed sugar over `control`.

`status --json` emits `change-run-view/1`. Mutation receipts add
`actions` and `disposition` around that same view. Errors use stable codes and
non-zero exit status. Paths in human diagnostics are native; JSON identity
values never depend on separators.

The existing `resume --json` legacy object remains byte-shape-compatible when
no reconciler Run is selected. Reconciler JSON is engine-discriminated.

### 13. Deepen the existing runs API into Change-run Operations

Keep `GET /api/v1/runs` fresh and space-scoped. Existing
`autoRun`/`portfolio`/`goalRun` fields remain additive-compatible; each Change
entry gains reconciler Run summaries produced by the same projector.
Discovery is the read-only union of active Change IDs and already registered
machine-home `changes/*/work/change-runs` directories that physically contain
Runs, then filters default summaries to the `WorkspaceInstanceId` resolved from
the selected project root. Shared PlanningSpace storage does not mix linked
worktree branch state. Exact IDs may be inspected across that filter only as
read-only `workspace.scope: "other"`. Discovery creates no writable index or
second truth. A Run whose source Change
was archived/moved/deleted remains listed with `sourceState:
"archived" | "missing"`, especially while archive completion or
uncertain-effect recovery is pending. Exact detail remains addressable after
source disappearance. Reads never mint a registry/project identity.

Add exact encoded-segment routes:

```text
GET  /api/v1/runs/<changeId>/<runId>?space=...
POST /api/v1/runs/<changeId>/<runId>?space=...
```

GET performs a read-only `inspect` with `{ ensure: false }` behavior and never
mints a project identity. POST accepts one typed version-checked control and
uses the established CLI-backed management mutation pattern; the server
validates exact IDs/body/space, spawns the local CLI with structured arguments,
and returns its JSON receipt. It does not edit Record files in-process.

The management selector accepts the server's exact launch-root space, a full
`planning:<PlanningSpaceId>`, or the existing project token only when that
projectId maps to one home. Duplicate-clone `project:<id>` is
`project_selector_ambiguous`; the response may list candidate PlanningSpaceIds
but never selects the first registry entry. UI navigation carries a
server-issued opaque selected-space token backed by exact PlanningSpaceId and
selected project root. Every reconciler mutation re-resolves that root and
rechecks stored WorkspaceInstanceId/ChangeInstanceId before spawning.
The management bridge always invokes runtime control with sealed
`deliveryMode: "defer"`; request JSON cannot override it. HTTP responses never
contain executable Agent/Command/Host payloads, only the committed view and an
empty receipt action list. A subsequent trusted CLI resume performs the first
atomic grant. Browser response loss therefore cannot turn an unconsumed
admission into an uncertain already-delivered effect.

List summaries and detail both come from `ChangeRunProjector`; malformed,
oversized, unsafe-link, or corrupt canonical Run entries are reported
individually without falling back or failing unrelated Changes. Unknown/deeper
routes and disallowed methods keep the existing 401/405/error-envelope posture.

Alternative considered: let the management handler patch a Run view directly.
Rejected because it violates both the one-truth invariant and the existing
CLI-backed workspace-mutation security posture.

### 14. Put the first Operations UI on Task detail

The current Task detail route is the natural Change-scoped observation plane.
Add an Operations section that:

- lists reconciler Runs for each child Change without mixing planning spaces;
- opens one Run detail;
- renders the server-projected core and `root-dag/1` frontier/invocations,
  domain-blocked/infrastructure/workspace/uncertain wait reason, terminal
  reason, source state, and definition/capability/policy/workspace drift;
- uses full IDs in accessible detail/copy affordances even when the visible
  label is shortened;
- shows only controls allowed by the current projection;
- submits the displayed `recordVersion`, handles a conflict by refetching, and
  never optimistically mutates the local view.

For the simple proof, controls are Gate decision, resume, escalate, and cancel.
Agent/command/host `complete` stays a trusted CLI/host seam and is not exposed
as an arbitrary browser result form.

Existing session launch/kill and legacy Run displays remain unchanged.
This child does not map Run terminal state to Board/Issue lifecycle: multi-Run,
multi-child acceptance and Issue completion belong to the 0.2.0 Issue
Execution Plan. The UI does not independently recompute `root-dag/1` frontier
or wait reasons.

### 15. Make crash boundaries and parity first-class test seams

The filesystem Adapter accepts a test-only `RunStoreFaultInjector` with named
points:

```text
launch.after_stage_before_publish
launch.after_publish_before_return
commit.after_temp_fsync_before_publish
commit.after_publish_before_return
```

Tests prove:

- pre-publish crash leaves no visible Run/new Record;
- post-publish crash followed by the same launch request returns the original
  Run without incrementing its Record version;
- the same launch key with different canonical intent fails with
  `launch_request_conflict`;
- concurrent same-key launches publish exactly one Run and return the same ID,
  while different keys in one Change and the same key in different Changes
  publish distinct deterministic IDs without a global key index;
- result received before commit does not advance;
- committed result is never admitted again;
- post-commit/pre-projection crash returns idempotent success on identical
  completion;
- concurrent independent completions both commit exactly once;
- conflicting receipt and stale human control never write;
- exact generated temp/staging files are ignored, but any corrupt, gapped,
  duplicate/variant, over-width, abnormally named, or chain-invalid published
  revision makes the whole Run fail closed without falling back to an earlier
  Record;
- skill/table/config/source-layer mutations change drift only; stored
  capability/Adapter/policy/SourceRevision digests and admitted Actions remain
  byte-stable, while a missing exact artifact suspends instead of selecting a
  newer one;
- domain-blocked, infrastructure retry, and `not_executed` create bounded new
  Attempts with stable logical Effect identity and stop at sealed limits;
- workspace before/after/delta evidence rejects stale writers and external
  edits; only read-only actions may complete independently in parallel here;
- evidence relabel/tamper/link/missing/TOCTOU cases fail, while stage
  before/after-publish retries are atomic and idempotent;
- symlink/junction/reparse substitution at every store component fails without
  reading or modifying an outside sentinel;
- oversized/deep facade or disk values fail before clone/canonicalize/mutation;
- live long-held locks are never stolen, dead exact owners recover, old-token
  release cannot delete a replacement, and lock crash retry preserves
  exactly-once;
- archive-before-complete survives a fresh process and stays visible through
  Operations exact detail and union discovery.

One fixture matrix is asserted through pure projection, CLI `status --json`,
management detail JSON, and UI rendering. The compared fields are
`format`, `runId`, `change`, `engine`, `recordVersion`, `status`,
`sourceState`, top-level `workspace`, `drift`,
and the complete ordered `root-dag/1` section (frontier, activeInvocations,
actions/effects, waits, terminal, workspace revisions/effect diagnostics, and
allowedControls);
plane-specific wrappers may differ, the canonical view may not. Compatibility
fixtures prove v1 consumers ignore additive unknown sections and reject an
unknown top-level major.

Filesystem tests run with `path.join`, realpath-canonicalized project
identities, Windows/POSIX separators, benign root aliases, rejected
symlink/junction/reparse store components, concurrent writers, and rename fault
injection. Unregistered legacy-resume versus canonical-start tests isolate
`RASEN_HOME`/`XDG_DATA_HOME`, assert only the hashed coordination root may be
touched, and keep repository, registry, and Change work directory unchanged.
Status/inspect assert absolutely zero writes. Cleanup uses resolved explicit
temporary roots only.

## Risks / Trade-offs

- **[Risk] Immutable full-Record revisions grow quadratically for long Runs.**
  -> The simple root proof is bounded and small. Keep the store Interface
  independent of layout so a later evidence-backed compaction/SQLite Adapter
  can replace it without changing runtime callers.
- **[Risk] A project override named `bug-fix` has a different shape.**
  -> Select by exact name only for product eligibility, then validate the
  frozen plan's complete node/capability subset; name alone never authorizes
  execution.
- **[Risk] Capability mode/idempotency metadata is incomplete in phase 1.**
  -> Seal an exact versioned runtime capability/Adapter/policy profile into the
  opaque plan for this dogfood path and fail unsupported values before launch.
  Current tables are preparation/drift inputs, never resume truth.
- **[Risk] A recovered ambiguous action may suspend even if it never executed.**
  -> Prefer a false-positive wait to duplicate irreversible effects; the
  trusted Adapter can prove `not_executed` and obtain a new attempt without
  allowing a human to fabricate effect state.
- **[Risk] A prompt or external process writes legacy state after canonical
  launch.** -> All code-controlled mutations share the bilateral ownership
  guard and refuse both engines once conflict is detected. External writers
  cannot be prevented from bypassing the lock, but their file is never treated
  as permission for either controlled owner to continue.
- **[Risk] Current source disappears, so drift cannot be computed.**
  -> Report drift as unavailable and continue from the verified stored plan.
- **[Risk] API control could bypass management mutation policy.**
  -> Use the same CLI-backed subprocess bridge and admission/body limits as
  existing mutations; no management handler writes state directly.
- **[Trade-off] This child implements a generic deterministic spine but proves
  only one simple built-in path.** -> Unsupported complex semantics suspend or
  reject explicitly. Later children extend private reducers and projections
  without changing the facade or state owner.

## Migration Plan

1. Add internal execution-profile sealing/opening, SourceRevision/effective
   policy/capability bindings, canonical contracts, identity allocator, pure
   reducer/Reconciler/projector, and in-memory tests with no CLI behavior change.
2. Add bounded SafeRunPath/EvidenceStore/WorkspaceObserver, ownership-safe
   global locks, filesystem ledger, crash injection, and facade; keep the production
   engine guard disabled until focused durability tests pass.
3. Enable explicit reconciler start for the supported `bug-fix` simple path.
   Preserve legacy start mechanisms and extract legacy resume without semantic
   edits.
4. Add CLI status/complete/control/cancel and reconciler-aware resume.
5. Add additive Operations wire/list/detail/control handling and Task-detail
   UI consumption.
6. Run the real simple `bug-fix` dogfood, including Gate interruption, a
   crash-before/after-commit exercise, and a separate complex-result exercise
   that proves suspension before ship.

Rollback disables new reconciler start and removes the new Operations
affordances. Existing legacy files remain untouched and continue through the
legacy resume branch. Already-created canonical Runs remain self-contained
under machine-home and can be inspected/exported by the matching build; they
are never downgraded into `auto-run.json`.

## Open Questions

None for this child. ReviewCycle result schemas, loop limits, Composite paths,
compatibility report projection, and wider engine defaults are deliberately
owned by later serial Changes.
