# ECP Shared Interface Decision

## Context

Three independent designs explored the 0.2.0 Definition/runtime seam:

- `design-alternatives/minimal-interface.md`
- `design-alternatives/extensible-interface.md`
- `design-alternatives/default-caller-interface.md`

They were compared by **Depth**, **Locality**, and seam placement.

## Comparison

| Alternative | Strongest property | Main weakness |
| --- | --- | --- |
| Minimal `compile / commit / inspect` | Smallest external Interface and strongest canonical-state protection | Ordinary launchers must understand plan and durable stimulus sequencing |
| Extensible `prepare / reconcile / commit / project` | Best closed control algebra, typed capability extension, and projection model | Store CAS and host orchestration leak too far into common callers |
| Default caller `start / resume / inspect / control` | Trivial built-in/Custom launch and strong caller Locality | Missing an explicit trusted result-completion seam for external Adapters |

## Decision

Adopt a hybrid with one deep product runtime Module and a separate Definition
Module:

```ts
interface EcpDefinitionModule {
  prepare(
    source: DefinitionSource,
    catalog: CapabilityCatalogSnapshot
  ): Result<PreparedDefinition, DefinitionReadError>;
}

interface ChangePipelineRuntime {
  start(request: StartChangePipeline): Promise<ChangeRunReceipt>;
  resume(request: ResumeChangePipeline): Promise<ChangeRunReceipt>;
  complete(request: CompleteRunAction): Promise<ChangeRunReceipt>;
  inspect(ref: ChangeRunRef): Promise<ChangeRunView>;
  control(request: ChangeRunControlRequest): Promise<ChangeRunReceipt>;
}
```

`start` and `resume` are the common launcher Interface. `inspect` and `control`
are the Operations Interface. `complete` is the trusted execution-host Seam used
by Agent/command/host Adapters; ordinary launchers do not call it.

The runtime Implementation privately owns:

```ts
prepare(source, catalog) -> ChangeRunPlan
reconcile(plan, record) -> ReconcileDecision
commit(plan, record, stimulus) -> CommittedRecord
project(plan, record) -> ChangeRunView
```

The pure Pipeline Reconciler and canonical Run Record are internal/test seams,
not ordinary caller Interfaces.

## Runtime protocol

### Start

1. Resolve an idempotent launch request key.
2. Load a registered built-in or Canvas-authored Pipeline by the same name path.
3. Normalize v1 or validate v2 through `prepare`.
4. Freeze source/capability revisions and compile an immutable `ChangeRunPlan`.
5. Resolve and freeze `engine: legacy | reconciler`.
6. Atomically create the plan and canonical Run Record.
7. Reconcile and durably admit ready typed actions before returning them.
8. Return one receipt containing admitted actions and a view derived from the
   same committed Record version.

### Resume

1. Load the frozen engine, plan, and Record; never recompile current source as
   replacement truth.
2. Reconcile admitted/in-flight effects through their Adapter recovery policy.
3. Durably admit newly ready actions.
4. Return admitted/recoverable actions plus the current view.

### Complete

```ts
interface CompleteRunAction {
  runId: RunId;
  actionId: ActionId;
  invocationId: InvocationId;
  receiptDigest: Digest;
  actor: ActorRef;
  result: unknown;
  evidence: readonly EvidenceRef[];
}
```

- Result completion does not require an observed Record version. Independent
  FanOut members may complete against the same earlier snapshot.
- The runtime serializes commits and accepts a result only while its stable
  ActionId remains admitted/active.
- Repeating the same ActionId and receipt digest is idempotent.
- Reusing an ActionId with conflicting content fails closed.
- Schema, actor, tree, identity, evidence, and effect rules are checked before
  the Record advances.
- A successful commit immediately reconciles and returns the next receipt.

### Control

Human/Operations `resume`, `cancel`, and `decision` commands require
`expectedRecordVersion`. A stale human view cannot overwrite a newer decision.
Controls append validated transitions; they never patch a projection.

## Extension policy

The Reconciler control algebra is closed in Definition v2:

- AtomicStage
- CompositeRef
- BoundedLoop
- Choice
- FanOut / Join
- Gate
- Finish

Safe extension occurs through:

- trusted, versioned typed capability descriptors;
- declarative non-recursive Custom Composite definitions;
- Agent/command/host Adapters for admitted actions;
- versioned read-only projections.

User-supplied code, open node-kind plugins, recursive Composite calls, nested
loops, and projection write-back are rejected in 0.2.0.

## Storage and Adapter seams

- Definition normalization, compilation, reconciliation, validation, and
  projection are in-process pure Implementation.
- Plan/Record/evidence storage is local-substitutable behind private filesystem
  or SQLite and in-memory test Adapters.
- Agent, command, and host execution are typed external Adapters. They can
  execute admitted actions and submit untrusted results, but never edit state.
- Ambiguous external effects suspend fail closed unless the Adapter can reconcile
  by stable idempotency identity.

The initial durable storage format remains an implementation choice. JSONL/WAL
or SQLite must satisfy atomic compare-and-commit and recovery tests without
appearing in the public Interface.

## Cross-plane contract

- Canvas edits the complete Pipeline Definition v2 value and consumes
  `prepare` diagnostics.
- The compiler emits the only immutable `ChangeRunPlan`.
- The runtime owns the only canonical Run Record.
- CLI and Operations consume one `ChangeRunView`.
- Markdown, timeline, `auto-run.json`, `goal-run.json`, and review reports are
  versioned read-only projections.
- Built-in and Custom Composite definitions use the same Definition Module,
  compiler, Reconciler, identity scheme, and projection path.

## Consequences for child Changes

- `ecp-definition-v2` implements `prepare`, the closed public vocabulary,
  capability catalog snapshot, wire/Canvas parity, and opaque plan contract.
- `ecp-run-spine` implements the `ChangePipelineRuntime` facade, canonical
  storage, private reducers, and the `start/resume/complete/inspect/control`
  protocol.
- Later children extend only the closed plan/reducer registries and typed
  projections; they must not add sibling runtimes or writable run-state models.
