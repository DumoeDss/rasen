## Context

The prerequisite Change made Definition v2 the canonical blank/new format, added one canonical v2 serializer and prepared execution view, and migrated exactly six Change-level built-ins. The browser already holds the full authored `WirePipelineDefinition`, uses a browser-safe mirror of the core blank factory, validates through the Management API, and saves through the server's canonical serializer. It also has useful pure graph/declaration mutations and can author AtomicStage, CompositeRef, a minimal BoundedLoop, Choice, Gate outcomes, Finish, and custom Composite bodies.

That foundation is incomplete as an authoring product. `isV2EditableNodeKind()` deliberately excludes FanOut and Join; their panels are read-only. A new AtomicStage lacks the required `execution.version: 1` declaration. Gate cannot edit `target` or the complete outcome-disposition map. BoundedLoop only edits `maxIterations` and does not create the required lifecycle policy. FanOut/Join wire mirrors omit their closed fields. Definition-level limits/contracts and nested execution/lifecycle fields have no structured controls. Finally, `definitionIssuePathTarget()` maps only root nodes/connections: declaration paths and `/limits/budget` are deliberately treated as unmapped, so users can see but cannot locate several errors they must repair.

The kernel remains authoritative for the Definition language, diagnostics, capability compatibility, preparation, lowering, and digests. Canvas is an authored-source editor, not an executable-profile interpreter. The implementation must also retain the current authored-v1 editor and duplicate behavior without converting v1 to v2.

## Goals / Non-Goals

**Goals:**

- Make every currently supported v2 node kind genuinely creatable, editable, connectable where applicable, deletable, saveable, and reloadable from Canvas.
- Expose the complete authored contracts needed for valid AtomicStage, Composite declarations/bodies, BoundedLoop, Choice, FanOut/Join, Gate, and Finish definitions.
- Preserve all unedited fields, including future or UI-unexposed fields, through local edits and server round trips.
- Keep reference-changing mutations coherent across connections, Gate targets, FanOut/Join membership, and declaration references.
- Make shared server diagnostics locatable at definition, root graph, declaration, body graph, and nested property controls.
- Verify Canvas-authored definitions with the real server preparation and canonical serializer, including digest equality on a no-op save/reload and intentional-delta equality after one edit.
- Preserve authored-v1 edit/save/duplicate semantics and blank-v2 factory parity.

**Non-Goals:**

- Creating or duplicating a second Definition model, serializer, graph validator, prepared execution view, capability resolver, or lifecycle reducer in the UI.
- Executing the final blank-Canvas loop-plus-parallel pipeline as a canonical Run; the following vertical-proof Change owns that evidence.
- Session process execution, public effect observation, worker reuse/lifecycle enforcement, or ECP self-hosting (ECP-7).
- Release/version/changelog/tag closure or legacy-retirement decisions (ECP-8).
- Issue, Execution Plan, Dispatch, portfolio, or `auto-decompose` v2 migration (0.3.0).
- Recursive Composite references, nested BoundedLoops, arbitrary script nodes, remote runtimes, or widening the kernel's closed v2 vocabulary.

## Decisions

### D1: The complete wire Definition remains the only Canvas source of truth

Strengthen the existing wire interfaces so they mirror the kernel's closed authored contracts: AtomicStage execution; Gate target/dispositions; FanOut members, cap, budget, and Join id; Join partitions/outcomes; required BoundedLoop lifecycle; and optional phase/variant metadata. Keep the top-level and graph extension index signatures so a draft loaded from a newer compatible server retains unexposed fields.

All edits continue to return a new `WirePipelineDefinitionV2` by shallow-copying the path being changed and retaining every sibling. Nested helpers patch `execution`, `workspace`, `handoff`, `limits`, `lifecycle`, `strategy`, exits, members, and outcomes rather than reconstructing an entire node or definition. Save posts that same authored draft to the existing validation/save bridge; serialization, canonical ordering, preparation, and digest computation stay server-side.

Alternative considered: convert v2 into a UI-specific form model and regenerate a Definition on save. Rejected because it would be a second serializer and would necessarily drop fields the current UI does not know.

### D2: Authoring controls follow Definition ownership boundaries

Add one structured definition-contract surface for top-level inputs, artifacts, outcomes, and optional max-action/budget limits. Retain and extend `DeclarationsPanel` for declaration identity, provenance guard, typed inputs/artifacts/outcomes, body AtomicStages, body connections, and body-stage execution/phase metadata. Keep `V2NodePanel` responsible for one selected root node and split its substantial sections into focused editors for Atomic execution, Gate decisions, BoundedLoop policy, and parallel structure.

The root palette exposes all eight closed kinds, but availability is based on the current draft and catalog: AtomicStage needs an enabled exact capability, CompositeRef needs a referenceable declaration, BoundedLoop needs a non-empty body declaration, Gate needs an AtomicStage target, and parallel authoring needs eligible member nodes. A disabled affordance names the missing prerequisite; it never inserts a knowingly incomplete object and pretends authoring succeeded.

Alternative considered: keep advanced YAML/JSON textareas for the missing fields. Rejected because it would not provide Canvas parity, safe coupled mutations, or field-level diagnostics.

### D3: Node creation produces complete authored shapes and exposes all semantics

Creation and property editing use the existing trusted catalog and shared wire vocabulary:

- AtomicStage receives an exact capability revision plus a complete `execution.version: 1` object. Role, workspace access, lead-review, verification, runtime/model/effort, sandbox, session reuse, and handoff are structured edits. Optional fields are omitted when cleared; retired `execution.gate` is never authored.
- CompositeRef selects a declaration and derives its visible ports from that declaration's typed contract.
- Choice edits a unique ordered outcome set used by typed outgoing connections.
- Gate selects exactly one AtomicStage in the same graph, edits a unique ordered decision set, and assigns every decision exactly one `proceed | fail | escalate` disposition. Gate is the only gate authority.
- Finish selects or authors the terminal outcome deliberately.
- BoundedLoop selects its declaration body, edits positive iteration/action/budget limits, optional goal variant, every body-outcome `continue | exit(outcome)` mapping, and the complete `bounded-loop-lifecycle/1` policy: stall/block thresholds, bounded strategy attempts, exact optional strategy capability, material-change requirement, and all six mechanical trigger dispositions.

The browser model may provide visible starter values, but no starter is treated as executable truth. In particular, a zero-attempt strategy omits capability; raising attempts requires choosing an exact capability. The real preparation endpoint validates capability compatibility, phase roles/workspace, typed ports, exits, and lifecycle completeness before save.

Alternative considered: infer role, workspace, strategy, or Gate policy from a selected skill or node label. Rejected because the prerequisite established these as authored facts and capability compatibility belongs to server preparation.

### D4: FanOut and Join are edited as one referentially coherent parallel contract

Replace the read-only FanOut/Join boundary with a paired parallel builder. The user chooses existing root member nodes, stable member ids/paths, required versus optional status, conditions, a positive concurrency cap and budget, a stable paired Join id, and distinct proceed/failed outcomes. The builder writes the FanOut `branches`/`members`/`joinNodeId` and Join `inputs`/partitions/outcomes together, while both nodes remain independently selectable on the graph.

Editing membership updates both halves atomically. Renaming a member or the Join rewrites FanOut branches/member paths, Join inputs/partitions, `joinNodeId`, and typed connections. Removing a member updates both halves when at least one member remains; an operation that would leave no legal member is refused with an actionable message. Removing either structural half requires an explicit paired removal so a hidden dangling half is not left behind. Server diagnostics remain the final legality authority for cap/budget, exact partitions, required-member suppression, paths, and connections.

Alternative considered: expose independent free-form arrays on FanOut and Join. Rejected because the kernel requires those arrays to agree and ordinary rename/delete actions would create hard-to-repair split-brain metadata.

### D5: Reference-aware mutations protect all authored identities

Extend the existing pure mutation layer rather than placing rewrite logic in components. Root-node rename/delete helpers update typed connection endpoints and every structured reference owned by another node: Gate target, FanOut branches/members/join id, and Join inputs/partitions. Declaration rename rewrites CompositeRef `declarationId` and BoundedLoop `body`; deletion retains the existing referenced-declaration refusal. Body-stage rename continues to rewrite body connections while its other execution/phase fields survive.

The helpers refuse blank/duplicate identities and mutations that cannot preserve a complete paired structure. They do not implement semantic validation such as port type compatibility or loop reachability; those stay with the shared server preparation.

Alternative considered: allow every structural edit and rely exclusively on the next Validate click. Rejected for local identity integrity because Canvas itself owns the rename/delete operation and can avoid manufacturing obvious dangling references without duplicating kernel semantics.

### D6: Diagnostic routing is a typed locator tree, not root-only regex matching

Parse diagnostic JSON Pointer segments and resolve them against the exact draft arrays used in the validation request. Extend `DefinitionIssueTarget` to distinguish definition field, root node/connection, declaration, declaration body node, and declaration body connection. Nested tails such as `execution/workspace/access`, `limits/budget`, `lifecycle/exits/blocked/action`, `members/2/condition`, and declaration `graph/nodes/1/execution/role` remain attached as field paths.

The page uses this target to select the corresponding root node or declaration/body stage and to highlight the closest structured control. `IssuesDrawer` always shows severity, code, message, and full path. A valid but currently unrepresented path remains visibly unmapped; no diagnostic is dropped or rewritten by the client.

Alternative considered: continue listing declaration and definition issues only by raw path. Rejected because full parity requires users to locate and repair exactly those fields, including the currently proven `/declarations/...` and `/limits/budget` gaps.

### D7: Round-trip proof crosses the real Canvas, API, and canonical writer

Use three complementary levels of evidence:

1. Pure model matrices prove every kind's complete shape, nested lossless patching, coupled identity rewrites, declaration/body operations, diagnostic mapping, and v1 no-op behavior.
2. Component journeys drive actual controls from a browser-safe blank v2 draft, capture the save request, reload the returned detail, and verify every contract plus sentinel unexposed fields.
3. Root integration tests pass the captured/representative Canvas-authored document through real preparation and canonical serialize/read/save/export/import boundaries, comparing normalized semantics and source/capability/plan digests. A no-op round trip keeps all three digests; an intentional edit changes only its expected semantic surface and stabilizes after reload.

Cross-platform tests build paths with Node's `path` APIs, use temporary directories, and compare semantic bytes after canonical serialization rather than assuming a slash style. The parent PR remains responsible for normal Windows, Linux, and macOS CI.

Alternative considered: assert only that the POST body contains fields. Rejected because that cannot detect server canonicalization loss, capability-pin drift, or reload divergence.

### D8: Source-version compatibility is explicit in edit and duplicate flows

Existing v1 definitions continue through the v1 panels and origin stamp. Duplicate copies the authored v1 definition, changes only the duplicate identity/name fields already owned by that flow, and remains v1. No Canvas entry point normalizes it to authored v2.

Fresh/not-found flows still use the browser-safe blank-v2 mirror pinned to the core factory. A v2 duplicate is a source fork: it updates the name plus stable user-definition/source identities through one duplication helper while preserving contracts and graph content. It does not retain package provenance as though the new user definition were still the built-in source.

Alternative considered: normalize all duplicates to v2 now that v2 is the default. Rejected because v1 is an accepted compatibility source and migration must be explicit, not a side effect of editing.

## Acceptance Matrix

| Surface | Positive evidence | Negative/fail-closed evidence | Round-trip evidence |
| --- | --- | --- | --- |
| Blank/definition contract | Fresh and not-found drafts are complete v2; inputs, artifacts, outcomes, and limits are editable | Duplicate identities, invalid types, and non-positive limits produce mapped server diagnostics and block save | Blank parity fixture; save/detail reload preserves contract and canonical digests |
| AtomicStage and body stage | Exact capability plus execution role/workspace/policy can be created and edited in root and declaration bodies | Missing execution, retired gate field, incompatible phase/capability/access, and disabled capability fail before save/Run | Unexposed execution/handoff fields survive unrelated edits and reload |
| CompositeRef/declarations | Custom declaration/body create, rename, connect, reference, and delete guards work | Duplicate ids, body cycles, missing declarations, nested loops/unsupported body shapes remain rejected | Declaration contracts, body graph, phase metadata, and references reload unchanged |
| BoundedLoop | Limits, body exits, variant, complete lifecycle triggers, and exact strategy capability are editable | Missing lifecycle keys, invalid thresholds, strategy/capability mismatch, nested loop, and unmapped outcomes block save with located fields | Lifecycle and body mappings preserve semantic/capability/plan digests after no-op reload |
| Choice/Gate/Finish | Typed decisions/outcomes, Gate target and all dispositions, and terminal outcome are editable | Duplicate decisions, missing disposition, non-Atomic target, and invalid terminal mapping are located and blocked | Authored Gate remains sole authority after save/reload; Finish outcome remains exact |
| FanOut/Join | Paired create/edit with members, conditions, required/optional partition, cap/budget, join target/outcomes | Empty/duplicate members, inconsistent partitions, bad cap/budget, missing Join, and illegal required suppression are located and blocked | Both halves, member identities, connections, and plan digest reload unchanged |
| Diagnostics | Definition/root/declaration/body/nested paths select and highlight their owning control | Malformed/out-of-range pointers remain visible as unmapped rather than selecting the wrong item | Detail and validation show the same codes/messages/paths |
| V1 compatibility | Existing v1 edit, save, and duplicate remain available | No v1 open/duplicate operation silently creates v2 or a reconciler ownership claim | Reloaded duplicate remains authored v1 with compatibility metadata |

## Risks / Trade-offs

- [Risk] Dense lifecycle and parallel controls overwhelm the existing narrow properties column. → Group advanced fields into collapsible sections, keep summaries visible, and retain independent panel scrolling within the viewport lock.
- [Risk] Paired FanOut/Join rewrites accidentally change a valid graph beyond the user's selection. → Centralize each transaction in pure model helpers and table-test before wiring components.
- [Risk] UI wire types drift from the kernel's closed language. → Pin representative objects to real preparation tests and make all server diagnostics/path cases part of the Canvas matrix.
- [Risk] A starter execution or lifecycle policy looks like inferred executable truth. → Make authored values visible/editable, label exact capability revisions, and rely on server preparation rather than local execution claims.
- [Risk] Digest assertions become brittle when testing an intentional semantic edit. → Compare exact equality only for no-op round trips; for edits assert the expected changed projection and then equality across subsequent serialize/reload cycles.
- [Risk] Full component coverage increases UI suite time. → Keep mutation combinatorics in pure tests and reserve mounted journeys for one representative positive/negative path per contract family.

## Migration Plan

1. Strengthen wire mirrors and pure model helpers behind the existing version-discriminated draft without changing v1 code paths.
2. Land definition/declaration, Atomic/Gate/loop, and paired parallel controls with focused tests; keep server validation mandatory before save.
3. Add nested diagnostic routing and component-selection/highlight coverage.
4. Add end-to-end save/reload/digest and cross-platform serializer evidence, then run full UI/root validation.
5. Rollback is a code revert: no stored source migration occurs, and definitions written by the new editor are ordinary canonical v2 documents already accepted by the kernel. Authored v1 files remain untouched.

## Open Questions

None. The kernel contracts, source-version boundary, serial portfolio ownership, and final vertical-proof boundary are fixed by the prerequisite Changes and Direction slice.
