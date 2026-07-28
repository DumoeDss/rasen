## 1. Versioned Definition Contract

- [x] 1.1 RED: Add core schema fixtures/tests for unversioned, v1, valid v2, every closed v2 node discriminator, and an unsupported explicit version with an actionable `/version` diagnostic
- [x] 1.2 GREEN: Extend the existing Pipeline schema/loader with the v1/v2 discriminated source types, stable definition/node identities, typed inputs/artifacts/outcomes, and closed node vocabulary
- [x] 1.3 RED: Add compatibility tests proving current v1 parser outputs and stored sources are unchanged by read/preparation
- [x] 1.4 GREEN: Add `EcpDefinitionModule.prepare(source, catalog)` at the existing definition/registry boundary and route syntax/version dispatch through it without a sibling parser

## 2. Legacy Normalization and Identity

- [x] 2.1 RED: Add golden tests for unversioned/v1 stage DAG, gate/condition, review-cycle, and goal-loop normalization, including stable IDs independent of JSON/YAML formatting and Windows/POSIX absolute paths
- [x] 2.2 GREEN: Implement pure v1-to-v2 semantic normalization for stages, dependencies, gates/choices, and legacy loop declarations while retaining legacy runtime ownership metadata
- [x] 2.3 RED: Add tests proving semantically equivalent built-in and Custom Composite declaration forms normalize through one model and recursive references are discoverable by stable identity
- [x] 2.4 GREEN: Implement shared root/Composite declaration normalization and explicit identity maps without name-pattern inference

## 3. Trusted Capability Catalog and Canonical Digests

- [x] 3.1 RED: Add in-memory catalog tests for reordered descriptors, duplicate IDs/versions, missing, disabled, forbidden, and version-changed capabilities plus typed port/outcome incompatibility
- [x] 3.2 GREEN: Implement the immutable versioned `CapabilityCatalogSnapshot`, production catalog adapter, explicit descriptor lookups, and test snapshot builder
- [x] 3.3 RED: Add digest golden tests proving whitespace, comments, object-key order, non-semantic collection order, and platform path spelling do not change source/capability/plan digests while semantic edits do
- [x] 3.4 GREEN: Implement centralized semantic canonicalization and stable source/capability digest functions using explicit ordering and path-independent inputs

## 4. Complete Static Validation

- [x] 4.1 RED: Add table-driven diagnostics tests for duplicate identities, ordinary cycles, direct/indirect Composite recursion, nested loops, missing/unreachable exits, port mismatches, invalid limits, and impossible budgets
- [x] 4.2 RED: Add deterministic multi-error tests asserting stable severity/code/message/JSON-Pointer ordering and related producer/call-site paths
- [x] 4.3 GREEN: Implement whole-definition root/Composite graph, loop, exit, typed-port, limit, budget, and capability validators with closed diagnostic codes
- [x] 4.4 GREEN: Aggregate independent errors in `DefinitionReadError`, retain ordered warnings on success, and expose a pure diagnostic ordering/locator contract

## 5. Opaque ChangeRunPlan Compilation

- [x] 5.1 RED: Add compiler fixtures for every closed node kind, equivalent built-in/Custom declarations, v1-normalized input, stable plan serialization, and plan-digest sensitivity to nodes, ports, exits, limits, outcomes, and capability revisions
- [x] 5.2 RED: Add TypeScript contract tests proving registry/API/UI callers cannot access or discriminate the compiled payload while the branded plan remains deeply readonly and serializable
- [x] 5.3 GREEN: Implement deterministic compilation from the validated semantic model to the internal plan payload and return the versioned branded `ChangeRunPlan` envelope
- [x] 5.4 GREEN: Complete `PreparedDefinition` with normalized definition, ordered warnings, opaque plan, three digests, and separate plan-availability/executability fields

## 6. Registry Integration and Execution Guard

- [x] 6.1 RED: Add registry tests for unversioned/v1/v2 resolution in package, user, and project layers, unsupported-version fail-closed precedence, and equivalent built-in/Custom preparation
- [x] 6.2 GREEN: Route registry load/list/detail through injected Definition preparation and preserve winning authored source/provenance alongside normalized preparation data
- [x] 6.3 RED: Add capability tests proving valid v2 reports plan available but runtime unavailable, cannot enter legacy or partial reconciler launch paths, and existing v1 legacy capability remains explicit
- [x] 6.4 GREEN: Implement stable registry capability/executability reporting and the v2 launch-preflight guard without adding a runtime facade or reducer

## 7. Management Wire, Save, and Export Parity

- [x] 7.1 RED: Add management wire/handler tests for backward-compatible v1 detail plus full v2 detail, shared diagnostics, digests, and capability fields
- [x] 7.2 GREEN: Add the version-discriminated Pipeline wire types and map registry preparation results into catalog/detail without exposing compiled plan internals
- [x] 7.3 RED: Add API tests proving draft validation and save return identical preparation diagnostics, errors never mutate the user layer, and warnings remain visible
- [x] 7.4 GREEN: Route draft validation and save preflight through the same injected `prepare` and frozen catalog snapshot used by registry load
- [x] 7.5 RED: Add v2 save/detail/export round-trip tests covering declarations, unexposed fields, ports, limits, exits, outcomes, semantic digests, invalid-export no-write behavior, and `path.join`/`path.resolve` expectations
- [x] 7.6 GREEN: Implement semantic-lossless v2 serialization/package export while keeping v1 read/export source-compatible and all filesystem handling cross-platform

## 8. UI Contract and Definition Draft

- [x] 8.1 RED: Add UI API contract tests for the v1/v2 discriminated definition, diagnostics, digests, plan availability, executable status, and stable unavailable reason
- [x] 8.2 GREEN: Mirror the additive management wire types in the UI client and keep one complete versioned Definition draft rather than a derived executable graph
- [x] 8.3 RED: Add draft reducer/serialization tests proving v1 editing is unchanged and unexposed v2 declarations/node fields survive unrelated edits and saves
- [x] 8.4 GREEN: Adapt Canvas load/edit/save state to preserve full authored v1/v2 definitions and invalidate stale diagnostics after semantic edits

## 9. Canvas v2 Root Graph and Diagnostics

- [x] 9.1 RED: Add Canvas component/interaction tests for rendering, creating, connecting, selecting, editing, and deleting v2 `AtomicStage`, `Gate`, `Choice`, and `Finish` nodes with stable IDs and typed ports/outcomes
- [x] 9.2 GREEN: Implement the enabled v2 root-node cards, palette/property controls, typed connection mapping, branch outcomes, and terminal outcome mapping
- [x] 9.3 RED: Add tests that known later-slice node kinds remain visibly unsupported but losslessly preserved, rather than flattened or treated as plug-ins
- [x] 9.4 GREEN: Add preserved unsupported-kind cards and prevent unsupported edits while retaining the original Definition payload
- [x] 9.5 RED: Add diagnostic-locator tests mapping shared JSON Pointer paths to nodes, edges, and fields while retaining declaration-level/unmapped issues
- [x] 9.6 GREEN: Wire server preparation diagnostics into Canvas markers and issue navigation, keeping client connection checks advisory
- [x] 9.7 RED: Add UI tests proving a valid v2 draft can save/export but Run stays disabled with the server reason and no Operations controls appear
- [x] 9.8 GREEN: Render separate valid/plan-available/executable states and enforce the v2 Run affordance guard

## 10. Cross-Plane and Regression Verification

- [x] 10.1 RED: Add shared invalid/valid fixture parity tests across core preparation, registry, management validation/save/export, and Canvas locator mapping
- [x] 10.2 GREEN: Resolve any plane-specific adapters until identical fixtures produce the same semantic digests and diagnostic codes/paths everywhere
- [x] 10.3 Run the complete existing v1 registry, package, CLI, management API, and Canvas suites plus focused Definition v2 tests and record green results
- [x] 10.4 Add or extend Windows CI coverage for Definition save/export path handling and run the same path-focused suite on Windows and a POSIX runner
- [x] 10.5 Run typecheck, lint, UI build, package build, and the cross-plane parity suite; confirm no runtime facade, Run Record, Reconciler, Operations control, or loop domain reducer entered the diff
