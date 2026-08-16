## ADDED Requirements

### Requirement: The v2 root palette offers author gestures

In v2 edit mode the root palette SHALL present author-meaningful gestures rather than the
Definition's internal node kinds. The palette SHALL offer exactly four gestures — **Stage**,
**Parallel**, **Loop**, and **Finish** — and SHALL NOT offer `Choice`, `Gate`, `Join`, or
`CompositeRef` as separate palette entries. The Stage gesture SHALL list the installed skills
reported by the pipeline catalog and SHALL create a stage bound to the skill the user picks;
skills the catalog reports as disabled, or that carry no exact capability revision, SHALL be
visibly greyed with their state named and SHALL NOT be placeable. The Parallel gesture SHALL
create a complete parallel frontier — its fan-out and its barrier together — as a single action,
so a half of a parallel frontier can never be created on its own. Which gestures are currently
available SHALL be decided by one rule shared with the insertion itself, and an unavailable
gesture SHALL be visibly unavailable rather than failing after the click.

#### Scenario: Palette presents gestures, not node kinds

- **WHEN** the user opens a v2 pipeline in edit mode
- **THEN** the root palette offers Stage, Parallel, Loop, and Finish
- **AND** it offers no separate Choice, Gate, Join, or CompositeRef entry

#### Scenario: Stage gesture lists the installed skills

- **WHEN** the user opens the Stage gesture with skills installed in the catalog
- **THEN** the installed skills are listed and choosing one creates a stage bound to that skill's exact capability revision
- **AND** a skill the catalog reports as disabled is greyed with its state named and cannot be placed

#### Scenario: One Parallel gesture yields a complete frontier

- **WHEN** the user invokes the Parallel gesture on a graph that has at least one stage
- **THEN** a fan-out and its paired barrier are created together in one action, already referencing each other
- **AND** the user is never able to create a lone fan-out or a lone barrier from the palette

#### Scenario: An unavailable gesture is visibly unavailable

- **WHEN** the draft has no declaration carrying a body graph
- **THEN** the Loop gesture is shown unavailable rather than accepting the click and reporting a failure afterwards

### Requirement: Gate and Choice are authored where they belong

Approval and branching SHALL be authored as properties of the thing they govern rather than as
free-standing palette items.

Approval SHALL be a property of a stage: the stage's properties panel SHALL offer an approval
control that, when turned on, attaches an approval gate to that stage with a default decision
vocabulary and its dispositions, and when turned off removes it. The attached gate SHALL remain
visible on the canvas and its decisions and dispositions SHALL remain editable.

A branch condition SHALL be a property of an outgoing connection: selecting a connection SHALL
offer a condition, and setting one SHALL route that connection through a branch point whose
matched outcome continues to the original destination. Clearing the condition SHALL restore the
direct connection. Clearing SHALL be refused, with an explanation and no change, whenever the
branch point carries more wiring than a single restored connection can represent — another
outcome of that branch point being wired, more than one connection leading into it, or its
matched outcome leading to more than one destination — so no connection that clearing could
have restored is instead silently discarded.

#### Scenario: Approval is turned on from the stage

- **WHEN** the user turns on approval in a stage's properties panel
- **THEN** an approval gate targeting that stage exists in the saved definition with its decisions and dispositions
- **AND** the gate is visible on the canvas and its dispositions remain editable there

#### Scenario: Approval is turned off again

- **WHEN** the user turns approval off for a stage that has an approval gate
- **THEN** the gate and every connection touching it are removed from the draft
- **AND** the stage itself is unchanged and can now be deleted

#### Scenario: A condition on a connection creates the branch

- **WHEN** the user selects the connection from stage A to stage B and sets a condition on it
- **THEN** the saved definition routes A through a branch point whose matched outcome leads to B
- **AND** the condition text is preserved through save, reload, and export

#### Scenario: Clearing a condition will not discard a wired branch

- **WHEN** the user clears the condition on a branch whose other outcome is connected to a further stage
- **THEN** the editor refuses with an explanation naming the wired branch
- **AND** the draft is unchanged

#### Scenario: Clearing a condition will not discard a duplicate connection

- **WHEN** the user clears the condition on a branch point that has a second connection leading into it, or whose matched outcome leads to a second destination
- **THEN** the editor refuses with an explanation naming the connections it cannot restore
- **AND** the draft is unchanged

#### Scenario: Clearing an unwired condition restores the direct connection

- **WHEN** the user clears the condition on a branch whose other outcome is not connected
- **THEN** the branch point is removed and the original connection from A to B is restored

## MODIFIED Requirements

### Requirement: The canvas page fits a single viewport

The pipeline graph route (view and edit modes) SHALL fit within the browser viewport: in a real browser the document SHALL present no page-level scrollbar on this route — the application shell itself is bounded to the viewport, so no amount of panel content can grow the page. The skills palette, the stage properties panel, and the v2 definition-authoring column (the definition contract and declarations editors) SHALL each hold a fixed width and scroll independently within their own bounds, and the canvas area SHALL fill the remaining space, keeping the canvas, its toolbar, and any feedback surfaces (including validation errors at the canvas bottom) simultaneously visible regardless of how many skills are installed and regardless of how much contract, port, or declaration content the definition carries. No authoring panel SHALL size itself to its content at the canvas's expense. Other routes keep their normal scrolling behavior. Because DOM-only test environments perform no layout, this contract SHALL be verified against real browser layout (measured panel widths and a measured document that does not exceed the viewport height), not solely by asserting markup.

#### Scenario: Long skill list never hides the canvas

- **WHEN** the user opens the canvas editor with more installed skills than fit the viewport height
- **THEN** the skills palette scrolls within its own panel while the canvas, toolbar, and feedback surfaces stay fully visible without scrolling the page

#### Scenario: The v2 authoring column never squeezes the canvas

- **WHEN** the user opens a v2 pipeline in edit mode in a real browser, with declarations and typed contract rows present
- **THEN** the definition-authoring column is measured at its fixed width and scrolls its own overflow
- **AND** the canvas column is measured wider than that authoring column, with the graph legible rather than compressed to a sliver

#### Scenario: No document scrollbar in a real browser

- **WHEN** the canvas editor is opened in a real browser with a fully populated skills palette
- **THEN** the document's scrollable height does not exceed the viewport (no page-level scrollbar), and validation feedback at the bottom of the canvas is on screen

#### Scenario: Only the canvas route is viewport-locked

- **WHEN** the user navigates from the canvas back to the Pipelines list or any other page
- **THEN** those pages scroll normally as before

### Requirement: Canvas edits the enabled v2 root vocabulary

Canvas SHALL render, connect, select, edit, and delete every v2 root node kind the Definition
admits, and SHALL expose stable node identity, typed connections, branch outcomes, and terminal
outcome mapping. Creation SHALL be offered through the author gestures and the property
affordances named elsewhere in this capability rather than one palette button per node kind; every
node kind that was creatable through the editor SHALL remain creatable, and the approval gate, the
parallel fan-out and barrier, and the composite reference SHALL be created in the same shape the
editor produced for them before the palette changed.

Branch points SHALL be the one deliberate narrowing. Because a branch point is now authored only
as a condition on a connection, a newly authored branch point SHALL always carry a non-blank
condition and the closed matched/skipped outcome vocabulary; the editor SHALL NOT offer any way to
create a branch point without a condition, nor to clear the condition off one while keeping the
node. This is an improvement rather than a loss: the withdrawn palette button could only produce a
branch point with placeholder outcome labels and no condition at all, which the engine cannot
evaluate. The outcome labels of any branch point SHALL remain freely editable afterwards, and a
definition that already contains a branch point in any other shape SHALL still load, render,
select, edit, and save in that shape without the editor rewriting it.

Node kinds whose full property editor has not landed SHALL remain preserved in the draft and
visibly identified without claiming complete authoring support.

#### Scenario: User assembles an enabled v2 root graph

- **WHEN** a user creates stages, a parallel frontier, an approval gate, a branch condition, and a terminal outcome through the editor's gestures and property panels, and connects compatible typed ports
- **THEN** Canvas retains stable node identities and submits the resulting v2 root graph for authoritative preparation

#### Scenario: Every kind that could be authored before can still be authored

- **WHEN** an author reproduces a v2 root graph containing a stage, an approval gate, a branch, a parallel fan-out and barrier, a bounded loop, a composite reference, and a terminal outcome
- **THEN** each of those kinds is reachable through some affordance in the editor
- **AND** the approval gate, the parallel fan-out and barrier, and the composite reference are the same shape the editor produced for those kinds before the palette changed
- **AND** the branch point carries the author's condition and the matched/skipped outcomes, with its outcome labels still editable

#### Scenario: A branch point authored before the narrowing still loads and edits

- **WHEN** Canvas loads a v2 definition whose branch point carries arbitrary outcome labels and no condition
- **THEN** the branch point renders, is selectable, and its outcome labels remain editable
- **AND** saving preserves that node in its own shape, without the editor adding a condition or rewriting the outcomes into the matched/skipped vocabulary

#### Scenario: Known but not yet editable kind is preserved

- **WHEN** Canvas loads a v2 definition containing a known node kind whose editor lands in a later slice
- **THEN** Canvas identifies the node as not editable in this version and preserves its definition content
- **AND** it does not reinterpret the node as an AtomicStage or unknown plug-in
