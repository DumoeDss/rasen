# ecp-definition-preparation Specification

## Purpose
Own the authoritative seam between an authored Pipeline Definition v2 and anything that
executes it: one closed, typed node language; statically bounded Composite and
BoundedLoop declarations; complete, path-addressed static validation; trusted and
reproducible capability catalogs; and deterministic, immutable, opaque prepared plans.

Preparation reports whether a definition is executable. It does NOT own runtime
progression — that belongs to `ecp-change-run-runtime` and the executable-* capabilities.

## Requirements
### Requirement: Pipeline Definition v2 has one closed, typed language

Rasen SHALL accept a Pipeline Definition v2 envelope with stable definition and
node identities, typed definition inputs, artifact outputs, and named outcomes.
The root graph SHALL use only `AtomicStage`, `CompositeRef`, `BoundedLoop`,
`Choice`, `FanOut`, `Join`, `Gate`, and `Finish` nodes. Node kinds outside that
closed vocabulary SHALL be rejected rather than treated as extension hooks.

#### Scenario: A complete v2 definition is accepted

- **WHEN** a version 2 definition has a stable source identity, unique stable node identities, compatible typed ports, and a root graph made from the closed vocabulary
- **THEN** preparation returns one normalized v2 definition with the declared inputs, artifacts, outcomes, and identities preserved

#### Scenario: An open-ended node kind is rejected

- **WHEN** a version 2 definition contains a node kind outside the closed vocabulary
- **THEN** preparation fails with an error diagnostic at that node's `kind` path
- **AND** the diagnostic does not offer arbitrary node-kind plug-ins as a fallback

### Requirement: Composite and bounded-loop declarations are statically bounded

Rasen SHALL support built-in and Custom Composite declarations through the same
version 2 semantic contract. Composite call graphs MUST be non-recursive.
Bounded loops MUST declare valid limits, an explicit exit for every reachable
outcome, and a non-looping body; nested bounded loops SHALL be rejected.

#### Scenario: Built-in and Custom Composite declarations share one contract

- **WHEN** equivalent built-in and Custom Composite declarations expose the same typed ports, body, limits, and outcome mapping
- **THEN** preparation validates and compiles both through the same Composite definition path

#### Scenario: Recursive Composite calls fail closed

- **WHEN** Composite declarations form a direct or indirect recursive call chain
- **THEN** preparation fails with path-addressed diagnostics identifying the call sites and recursion chain

#### Scenario: Nested loops and missing exits fail closed

- **WHEN** a bounded-loop body contains another bounded loop or omits an exit mapping for a reachable outcome
- **THEN** preparation fails at the nested loop or missing exit path before a plan is returned

### Requirement: Preparation is the authoritative definition seam

The Definition Module SHALL expose one `prepare(source, catalog)` operation used
for registry loading, validation, save preflight, export preflight, and launch
compilation. Preparation SHALL normalize valid unversioned and version 1
definitions into the version 2 semantic model, validate version 2 without a
second executable graph, and fail closed for every unsupported explicit
version.

#### Scenario: Legacy source normalizes without being rewritten

- **WHEN** preparation receives a valid unversioned or version 1 definition
- **THEN** it returns a deterministic normalized v2 semantic definition and compiled plan
- **AND** merely reading or preparing the source does not rewrite its stored version or text

#### Scenario: Unknown version provides upgrade guidance

- **WHEN** preparation receives an explicit definition version other than 1 or 2
- **THEN** it returns an error at `/version` naming the received versions, the supported versions, and the need for a compatible Rasen upgrade

#### Scenario: Every product plane uses preparation

- **WHEN** the same source and capability catalog are loaded by the registry, validated in Canvas, checked before save or export, or compiled for launch
- **THEN** every plane receives the same normalized meaning and error diagnostics from the authoritative preparation contract

### Requirement: Static validation is complete and path-addressed

Preparation SHALL reject duplicate or unstable identities, ordinary graph
cycles, Composite recursion, nested loops, missing exits, incompatible ports,
invalid or impossible limits and budgets, and unknown, disabled, or forbidden
capabilities. Every diagnostic SHALL carry a stable severity, code, message,
and JSON Pointer path into the submitted definition.

#### Scenario: Port mismatch identifies both endpoints

- **WHEN** an edge connects an outcome or artifact to an incompatible input port
- **THEN** preparation fails with a diagnostic at the consuming port and related context identifying the producing port

#### Scenario: Ordinary graph cycle is rejected

- **WHEN** root graph edges form a cycle that is not represented by a valid `BoundedLoop`
- **THEN** preparation fails with diagnostics identifying the cycle path

#### Scenario: Invalid capability and budget are rejected together

- **WHEN** a graph references a disabled capability and also declares a budget that cannot admit its required actions
- **THEN** preparation reports both path-addressed errors in deterministic order

### Requirement: Capability catalogs are trusted and reproducible

Preparation SHALL consume a trusted, versioned `CapabilityCatalogSnapshot`.
Descriptors SHALL use a closed catalog schema and declare stable capability
identity and version, availability, typed input/artifact/outcome contracts, and
the limits needed for static admission. Definitions cannot add to or override
the trusted snapshot.

#### Scenario: Catalog order does not change preparation

- **WHEN** two catalog snapshots contain the same descriptors and versions in different source order
- **THEN** preparation yields the same normalized catalog meaning, capability digest, diagnostics, and plan digest

#### Scenario: Definition cannot self-authorize a capability

- **WHEN** a definition embeds a descriptor intended to authorize a capability absent or forbidden in the trusted snapshot
- **THEN** preparation rejects the reference using the trusted snapshot and ignores the embedded authorization claim

### Requirement: Prepared plans are deterministic, immutable, and opaque

A successful preparation SHALL return an immutable, serializable
`ChangeRunPlan` plus stable semantic source, capability, and plan digests.
Ordinary registry, API, Canvas, and launcher callers SHALL be able to retain and
pass the plan but SHALL NOT depend on its compiled node representation.
Semantically identical definitions and catalog snapshots SHALL produce
identical digests and serialized plans.

#### Scenario: Formatting does not change a plan

- **WHEN** JSON and YAML sources differ only in whitespace, comments, object-key order, or other non-semantic presentation
- **THEN** preparation returns identical semantic source, capability, and plan digests

#### Scenario: Meaningful change changes the plan digest

- **WHEN** a node identity, typed connection, capability version, limit, exit, or outcome mapping changes
- **THEN** the relevant source or capability digest and the resulting plan digest change

#### Scenario: Ordinary caller sees only the opaque contract

- **WHEN** a registry, management API, Canvas, or launcher caller receives a prepared definition
- **THEN** it can use preparation status, diagnostics, digests, and the serializable plan value
- **AND** it is not required or permitted by the public contract to branch on compiled plan internals

### Requirement: Preparation reports executability without claiming runtime ownership

A prepared result SHALL distinguish definition validity, plan availability, and
runtime executability. Until a complete reconciler runtime owns version 2
runs, a valid v2 definition SHALL report a stable non-executable reason and
MUST NOT be routed into either the legacy prompt-owned runner or a partial
reconciler implementation.

#### Scenario: Valid v2 plan is not accidentally launched

- **WHEN** a version 2 definition prepares successfully before reconciler runtime support is installed
- **THEN** capability reporting states that the definition and plan are valid but execution is unavailable
- **AND** launch preflight refuses with the reported reason instead of selecting a legacy or partial runtime

#### Scenario: Existing v1 legacy execution remains available

- **WHEN** an existing version 1 definition is read during this compatibility slice
- **THEN** its current legacy execution capability remains unchanged
- **AND** its prepared v2 semantic plan is not treated as reconciler ownership

