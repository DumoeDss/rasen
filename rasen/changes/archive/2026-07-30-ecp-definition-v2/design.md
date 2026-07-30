## Context

Pipeline loading currently terminates in the v1 `PipelineYamlSchema`: a flat
stage DAG with loop metadata interpreted by orchestration playbooks. Registry,
management API, package export, and Canvas consequently share source data but
not one validated executable meaning. Later `executable-composite-pipelines`
children need a stable Definition/compiler seam before any runtime, Run Record,
or reducer work can begin.

This first child establishes that seam. It must preserve every v1 and
unversioned compatibility path, add a complete v2 semantic language, and let
server and Canvas author the same Definition value. It must also make the
absence of a v2 runtime explicit: compiling a plan in this change is not
permission to run it.

The parent interface decision fixes the public entry point:

```ts
interface EcpDefinitionModule {
  prepare(
    source: DefinitionSource,
    catalog: CapabilityCatalogSnapshot,
  ): Result<PreparedDefinition, DefinitionReadError>;
}
```

## Goals / Non-Goals

**Goals:**

- Define one version 2 envelope and closed node vocabulary with stable
  definition/node/source identity, typed inputs, artifacts, and outcomes.
- Normalize unversioned and v1 sources into the same v2 semantic model without
  rewriting legacy files on read.
- Validate complete root, Composite, bounded-loop, capability, port, exit,
  limit, and budget semantics before returning a plan.
- Compile one immutable, serializable, opaque `ChangeRunPlan` and stable
  semantic source, capability, and plan digests.
- Make `prepare` the shared registry, validate, save, export, Canvas, and future
  launch-compilation seam.
- Preserve v1 wire clients while adding semantic-lossless v2 detail,
  validation, save, and export.
- Let Canvas edit the enabled v2 root vocabulary directly and map the server's
  path-addressed diagnostics to graph elements.
- Expose plan availability and executable runtime availability separately so
  no v2 definition enters an incomplete runtime.
- Provide pure, injectable test seams for normalization, catalog resolution,
  validation, canonicalization, compilation, diagnostics, and cross-plane
  parity.

**Non-Goals:**

- The `ChangePipelineRuntime.start/resume/complete/inspect/control` facade.
- A canonical Run Record, durable run storage, compare-and-commit protocol,
  Reconciler, result reducers, action adapters, or projections.
- Operations run lists, details, or controls.
- ReviewCycle or GoalLoop domain result schemas and reducers.
- Full Custom Composite authoring UX or real Custom Composite execution.
- FanOut/Join runtime semantics or full Canvas authoring for later vocabulary.
- Launcher convergence or changing current v1 legacy execution ownership.

## Decisions

### 1. Deepen the existing Pipeline schema loader into one Definition Module

`EcpDefinitionModule` is introduced under the existing core Pipeline
definition/registry boundary. `PipelineYamlSchema` remains the syntax entry
point and becomes version-discriminated; no sibling YAML/JSON parser is added.
Registry load, draft validation, save, export, and the future runtime call
`prepare` rather than composing subsets of schema and graph checks themselves.

Internally, `prepare` is a deterministic pipeline:

```text
parse/version dispatch
  -> v1 or v2 normalization
  -> semantic canonicalization
  -> whole-definition validation
  -> opaque plan compilation
  -> digest and capability report
```

Each step is a pure internal function with fixture-friendly inputs. The module
aggregates all independent static errors before returning
`DefinitionReadError`; successful preparation can still carry ordered warnings.

Alternative considered: keep v1 loading untouched and add a new v2 compiler
beside it. Rejected because registry, server, and Canvas would choose between
two meanings and v1-to-plan parity could not be guaranteed.

### 2. Use one semantic v2 model for authored v2 and normalized legacy input

The authored v2 envelope contains definition identity and version, typed
definition inputs/artifacts/outcomes, optional Composite declarations, and one
root graph. Every node has an authored stable ID and a discriminator from the
closed vocabulary:

- `AtomicStage`
- `CompositeRef`
- `BoundedLoop`
- `Choice`
- `FanOut`
- `Join`
- `Gate`
- `Finish`

Extension occurs only through typed capability references and declarative
Composite definitions; node-kind plug-ins are not accepted. Composite
declarations and root graphs use the same node/port contracts. Built-in and
Custom provenance is metadata, not a compiler branch.

The v1 normalizer maps stages and `requires` edges to stable v2 nodes and
connections. Existing gate/condition and review-cycle/goal loop declarations
map to the corresponding semantic control declarations without changing their
current legacy runtime ownership. Derived identities use definition/source
identity plus authored stage IDs, never absolute filesystem paths, so Windows
and POSIX path spellings do not affect semantic digests.

Alternative considered: make v2 a superset of the v1 stage object. Rejected
because optional fields would permit ambiguous node shapes, make typed ports
unreliable, and preserve the flat-DAG model as the de facto runtime language.

### 3. Keep Composite and loop power declarative and statically bounded

Composite bodies declare typed inputs, artifact outputs, named outcomes, and
their root node. `CompositeRef` binds those ports by declaration identity.
`BoundedLoop` references a non-looping body, declares finite limits, maps every
reachable body outcome to an explicit continue or exit decision, and exposes
typed exit outcomes.

Validation builds explicit root and Composite call graphs. It rejects:

- ordinary graph cycles;
- direct or indirect Composite recursion;
- nested `BoundedLoop` nodes;
- missing or unreachable exits;
- invalid port and outcome mappings;
- non-finite, contradictory, or impossible limits and budgets;
- unknown or forbidden capabilities.

Graph and declaration traversal uses stable identity maps and explicit
discriminator lookups. It does not infer node types or generated artifacts by
name patterns.

Alternative considered: allow recursive Composite calls with a global depth
limit. Rejected because recursion obscures the bounded work proof and would
prematurely constrain the future durable runtime protocol.

### 4. Freeze a closed capability-catalog snapshot before validation

`CapabilityCatalogSnapshot` is a trusted, versioned value assembled from the
existing installed/enabled capability sources. Each descriptor has a stable
capability ID and version, availability state, typed input/artifact/outcome
contracts, and static limit information. The snapshot is immutable during one
preparation.

Definitions reference catalog IDs and versions; they cannot contribute or
override descriptors. Normalization sorts descriptors by explicit ID/version
and rejects duplicates. Compilation binds the exact frozen descriptor revision
into the plan. Disabled, missing, incompatible, and forbidden capabilities
produce distinct stable diagnostic codes.

The first implementation supplies production catalog construction plus an
in-memory snapshot builder for focused tests. It does not add execution
Adapters or an open capability discovery protocol.

Alternative considered: resolve skills on demand while compiling each node.
Rejected because registry mutations during preparation could make validation
and compilation disagree and would make the plan digest non-reproducible.

### 5. Return an opaque plan with deterministic canonical digests

`PreparedDefinition` exposes the normalized semantic definition, ordered
warnings, a capability/executability report, digests, and a branded,
deeply-readonly `ChangeRunPlan`. The plan has a versioned serializable envelope
and an internal payload typed as unknown outside the Definition Module.
Ordinary callers can retain, serialize, digest, and later pass it to its owner,
but cannot build behavior by switching on compiled plan nodes.

Canonicalization is explicit:

- remove parser-only presentation such as comments, whitespace, and object-key
  order;
- preserve all semantic optional-vs-explicit values after default
  normalization;
- order maps and independent sets by stable IDs;
- preserve order only where it is semantic;
- encode numbers and strings through one canonical JSON representation;
- exclude filesystem location and Canvas session coordinates.

The semantic source digest covers the normalized Definition, the capability
digest covers the normalized frozen snapshot entries actually relevant to
preparation, and the plan digest covers the plan version, both input digests,
and canonical compiled payload. Digest tests use golden fixtures but do not
snapshot private payload structure into registry, API, or UI tests.

Alternative considered: expose the compiled node union publicly so launchers
can interpret it. Rejected because that would turn every caller into a runtime
and prevent later changes from evolving compiler internals behind the deep
module.

### 6. Diagnostics use one ordered JSON Pointer contract

Every error or warning has:

```ts
type DefinitionDiagnostic = Readonly<{
  severity: "error" | "warning";
  code: DefinitionDiagnosticCode;
  path: string;          // RFC 6901 JSON Pointer into submitted Definition
  message: string;
  related?: readonly { path: string; message: string }[];
}>;
```

Diagnostics are sorted by path, severity, code, then message so server, CLI,
tests, and Canvas receive stable results. Cross-node problems place the primary
diagnostic on the actionable consuming/calling path and include producing or
called paths as related context. Parse errors, unsupported versions, cycles,
recursion, nested loops, exits, ports, capabilities, limits, and budgets use
closed codes.

Canvas consumes this exact wire type. A pure locator maps a diagnostic path to
a root node, edge, or property; declaration-level and unmappable issues remain
in the list. Client connection checks are convenience checks only and do not
create a second validation standard.

Alternative considered: retain server text messages and reconstruct paths in
Canvas. Rejected because message parsing is unstable and would make
cross-plane parity untestable.

### 7. Extend management wire types additively and preserve authored versions

Pipeline detail uses a discriminated `definition` union. Existing v1 fields
remain present for compatible clients, while v2 returns the full envelope and
root graph. Shared additive metadata reports:

- authored and normalized semantic versions;
- definition validity and ordered diagnostics;
- semantic source, capability, and plan digests when available;
- plan availability;
- executable status and a stable unavailable reason.

Draft validation and save call `prepare` with the same catalog snapshot
construction used by registry load. Save writes canonical authored-version
content only after successful preparation. Detail and export do not rewrite a
v1/unversioned source merely by reading it. Version 2 save/detail/export may
change presentation formatting but must re-prepare to the same semantic model
and plan digest.

Filesystem targets continue to use `path.join`/`path.resolve`; neither digests
nor wire locators contain platform-specific separators.

Alternative considered: always return normalized v2 from detail, including for
v1. Rejected because it would silently turn a compatibility read into a public
migration and break clients that edit and resubmit v1.

### 8. Canvas edits a full Definition draft, with a deliberately bounded v2 UI

The UI API mirror models the same v1/v2 discriminated union and never derives a
separate executable graph. Existing v1 Canvas behavior remains intact. The v2
root graph initially supports full create/render/connect/edit/delete behavior
for `AtomicStage`, `Gate`, `Choice`, and `Finish`, including stable IDs, typed
ports, branches, and terminal outcome mappings.

Other known v2 node kinds render as preserved, explicitly unsupported editor
cards in this slice. Their source fields survive unrelated edits. Composite
body authoring and FanOut/Join editing land in their dependent changes; this
slice defines and validates their server contracts without pretending their UI
or runtime is complete.

Save and export remain enabled for valid v2 definitions. Run is disabled when
the server reports no complete runtime owner, with the stable reason displayed.
No Operations controls are introduced.

Alternative considered: hide v2 until its full runtime is available. Rejected
because Definition authoring and round-trip parity are the contract this child
must establish, while explicit capability reporting safely prevents execution.

### 9. Design test seams before product integration

The Definition Module exposes only `prepare` publicly, but its implementation
keeps pure internal seams testable in focused files:

- parse/version fixtures for JSON, YAML, unversioned, v1, v2, and future
  versions;
- v1 normalization fixtures and stable ID derivation independent of absolute
  path separators;
- in-memory catalog snapshots with reordered, missing, disabled, forbidden,
  and version-changed descriptors;
- validator fixtures for every closed diagnostic code and multi-error ordering;
- compiler/canonicalizer golden inputs for stable digests and semantic-change
  sensitivity;
- branded-plan compile-time tests preventing ordinary callers from accessing
  private payload types;
- injected `prepare`/catalog factories at registry and management handler seams;
- pure UI diagnostic-locator and Definition-draft reducer tests;
- cross-plane fixtures submitted to core preparation, HTTP validation, and
  Canvas mapping to assert semantic and locator parity.

Integration tests assert public meaning and digests, not private compiled-node
snapshots. This keeps the plan opaque while giving later runtime work a stable
input contract.

## Risks / Trade-offs

- **[Risk] The v2 grammar becomes too broad before runtime consumers prove it.**
  → Keep node kinds closed, make unsupported Canvas kinds explicit, and test
  each construct's static boundedness without adding runtime reducers here.
- **[Risk] Legacy normalization accidentally changes v1 execution.** → Keep
  source preservation and legacy ownership separate from normalized plan
  availability; run the current v1 suite plus dedicated semantic fixtures.
- **[Risk] “Semantically identical” canonicalization is underspecified.** →
  Centralize canonicalization, document which ordering is meaningful, and use
  formatting/order/path-independent golden tests.
- **[Risk] API and UI drift on diagnostics or versions.** → Share discriminated
  wire shapes and use the same fixture corpus in core, HTTP, and Canvas parity
  tests.
- **[Risk] A compiled v2 plan is mistaken for an executable run.** → Model
  `planAvailable` and `executable` independently and fail launch preflight with
  a stable runtime-unavailable reason.
- **[Trade-off] Custom Composite declaration validation precedes its full
  authoring and execution product.** → This is intentional: later children
  consume the common contract rather than introducing a Custom-only language.

## Migration Plan

1. Add the v2 and shared wire types without changing current v1 responses.
2. Route current v1 parsing through `prepare` and prove existing registry,
   package, CLI, API, and Canvas tests remain green.
3. Enable v2 registry/detail/validate/save/export with explicit
   non-executable capability status.
4. Enable the bounded v2 Canvas root editor and cross-plane diagnostic parity.
5. Leave v1 sources untouched and keep legacy execution ownership unchanged.

Rollback removes v2 authoring and wire handling while retaining the unchanged
v1 source files. Any v2 definition already saved remains a fail-closed
unsupported-version input to an older build rather than being downgraded or
silently interpreted as v1.

## Open Questions

None for this slice. Runtime storage, plan rehydration ownership, result
commit, reducers, Operations projections, and launcher selection are explicitly
deferred to dependent Changes.
