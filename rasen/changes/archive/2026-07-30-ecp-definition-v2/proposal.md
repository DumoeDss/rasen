## Why

Rasen's public Pipeline contract is still a flat v1 DAG whose loop declarations
are interpreted by the LEAD playbook, so Canvas, save/export, and future runtime
consumers cannot share one validated executable meaning. The first 0.1.6 slice
must establish that shared Definition/compilation seam before any child can own
Run state or reconciliation.

## What Changes

- Add Pipeline Definition v2 with stable source/node identity, typed inputs,
  artifact outputs and outcomes, and a closed node vocabulary:
  `AtomicStage`, `CompositeRef`, `BoundedLoop`, `Choice`, `FanOut`, `Join`,
  `Gate`, and `Finish`.
- Add declarative, non-recursive Composite contracts and bounded feedback
  declarations with explicit limits, exits, and outcome mappings; reject
  ordinary cycles, recursive Composite calls, nested loops, invalid ports,
  missing exits, and impossible budgets.
- Deepen the existing Pipeline loader into `EcpDefinitionModule.prepare(source,
  catalog)`, normalizing unversioned/v1 inputs into one v2 semantic model and
  compiling an immutable, serializable, opaque `ChangeRunPlan`.
- Freeze a trusted, versioned capability-catalog snapshot and produce stable
  source, capability, and plan digests for semantically identical inputs.
- Extend Pipeline detail, validation, save, and export so v1 remains readable
  without source rewrites and v2 round-trips without semantic loss.
- Extend Canvas's single Definition draft to render and edit the v2 root
  vocabulary enabled in this slice, with the same path-addressed diagnostics as
  server preparation.
- Report definition/plan capability and executability explicitly so v2
  definitions cannot enter either a partial reconciler path or the legacy
  prompt-owned runtime.
- Preserve the existing v1 wire and source compatibility contract; no breaking
  rewrite or migration is required.

## Capabilities

### New Capabilities

- `ecp-definition-preparation`: The public Definition v2 language, trusted
  capability snapshot, deterministic preparation contract, opaque immutable
  ChangeRunPlan, digests, and complete static diagnostics.

### Modified Capabilities

- `opsx-pipeline-registry`: Accept and normalize v1/unversioned and v2
  definitions through one loader/registry seam while failing closed on unknown
  versions.
- `pipeline-http-api`: Preserve v1/v2 semantics across detail, validation,
  save, export, catalog, and capability/executability reporting.
- `pipelines-ui`: Make Canvas's Definition draft and root graph understand the
  v2 vocabulary enabled by this slice and present server-parity diagnostics.

## Impact

The change affects `src/core/pipeline-registry/**`, a new deep Definition module
under `src/core`, Pipeline package/save/export handling, management Pipeline
wire types and handlers, and the UI API mirrors and `packages/ui/src/canvas/**`.
Focused registry/compiler, package, CLI/management API, Canvas, digest, and
cross-plane parity tests will expand. It deliberately does not add the
`ChangePipelineRuntime` facade, canonical Run Record, Reconciler ownership,
Operations controls, or launcher convergence; those remain dependent Changes.
