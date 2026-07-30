## ADDED Requirements

### Requirement: Canvas holds one complete versioned Definition draft

Canvas SHALL load and save a complete version-discriminated Pipeline Definition
draft. It SHALL preserve v1 editing behavior and SHALL represent v2 directly;
Canvas MUST NOT maintain a second executable graph or flatten v2 into the v1
stage model.

#### Scenario: v2 fields survive an unrelated edit

- **WHEN** a user edits one exposed property of a v2 draft that contains declarations or typed fields the current panel does not expose
- **THEN** save preserves every unedited v2 field and the server returns the same semantic plan digest except for the intended edit

#### Scenario: v1 draft remains editable

- **WHEN** a user opens an existing editable v1 Pipeline
- **THEN** the existing stage editing experience and save contract remain available
- **AND** opening the draft does not rewrite it to version 2

### Requirement: Canvas edits the enabled v2 root vocabulary

In this slice, Canvas SHALL render, create, connect, select, edit, and delete v2
`AtomicStage`, `Gate`, `Choice`, and `Finish` root nodes. It SHALL expose stable
node identity, typed connections, branch outcomes, and terminal outcome mapping
needed by those nodes. Other known v2 kinds SHALL remain preserved in the draft
and visibly identified without claiming complete authoring support in this
slice.

#### Scenario: User assembles an enabled v2 root graph

- **WHEN** a user creates AtomicStage, Gate, Choice, and Finish nodes and connects compatible typed ports
- **THEN** Canvas retains stable node identities and submits the resulting v2 root graph for authoritative preparation

#### Scenario: Known but not yet editable kind is preserved

- **WHEN** Canvas loads a v2 definition containing a known node kind whose editor lands in a later slice
- **THEN** Canvas identifies the node as not editable in this version and preserves its definition content
- **AND** it does not reinterpret the node as an AtomicStage or unknown plug-in

### Requirement: Canvas and server diagnostics have locator parity

Canvas SHALL consume the server's shared diagnostic severity, code, message,
and JSON Pointer path and map paths to the corresponding root node, edge, or
property control. Client-side connection checks MAY provide immediate feedback,
but server preparation remains authoritative.

#### Scenario: Same invalid graph is marked in both planes

- **WHEN** a v2 graph has an invalid typed connection and is checked locally and by draft validation
- **THEN** Canvas and server identify the same consuming node and property path
- **AND** the server diagnostic remains visible in the issue list and on the mapped graph element

#### Scenario: Definition-level issue is not dropped

- **WHEN** a diagnostic points to a definition or declaration path rather than a visible root node
- **THEN** Canvas lists the issue with its full path and does not silently discard it

### Requirement: Canvas communicates preparation and execution capability

Canvas SHALL distinguish a valid draft, an available compiled plan, and an
executable runtime. A valid v2 definition with no installed runtime owner MAY be
saved and exported, but its Run affordance SHALL be unavailable with the
server-provided reason.

#### Scenario: Valid v2 draft can be authored but not run

- **WHEN** a v2 draft validates and compiles during this Definition-only slice
- **THEN** Canvas allows save and export
- **AND** Run is disabled with guidance that the reconciler runtime is not yet available
- **AND** Canvas exposes no Operations run controls
