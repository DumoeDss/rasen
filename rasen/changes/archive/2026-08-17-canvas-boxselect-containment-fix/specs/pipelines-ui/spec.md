## MODIFIED Requirements

### Requirement: Canvas selection is a set

The canvas editor SHALL treat selection as a set of nodes and connections rather than a single
chosen element. Holding Shift and dragging on the canvas SHALL draw a selection box that selects
every node and connection the box overlaps — full containment is NOT required, and a box that
clips any part of a node's bounds selects that node; clicking with the platform multi-select key
held (Control on Windows and Linux, Command on macOS) SHALL add one element to the selection or
remove it if already selected; a plain click on an element SHALL leave exactly that element
selected; clicking empty canvas SHALL leave nothing selected. Nodes and connections SHALL be
selectable together in one selection.

Panels SHALL follow the selection's shape. When exactly one node is selected, that node's
existing properties panel SHALL open and behave as it does today; when exactly one connection
is selected, the connection's existing panel SHALL open and behave as it does today. When two
or more elements are selected, the editor SHALL present a selection summary stating how many
nodes and how many connections are selected, naming the selected node kinds, and offering a
delete action for the selection. Selecting an issue in the issues list SHALL leave exactly the
one element the issue points at selected, opening its panel.

Deleting a multi-selection SHALL remove every selected node the editor permits to delete, each
with the same reference cleanup a single delete performs. A parallel pair SHALL be treated as
one unit in deletion: a selected fan-out SHALL be removed together with its paired barrier. A
selected barrier whose fan-out is not selected SHALL be refused, as SHALL a stage still
targeted by an approval gate and a parallel pair's only member. Every refusal SHALL be
reported in a single summary message naming each refused element and why, presented once for
the whole deletion. Elements removed by any edit SHALL leave the selection, and the selection
SHALL otherwise survive edits: after adding a node or editing a contract, the elements still
present SHALL remain selected (their positions may re-layout).

The same set selection SHALL apply to the v1 stage editor: selecting several stage cards and
deleting SHALL remove all of them together with every dependency reference to them.

#### Scenario: Box-select gathers many nodes

- **WHEN** the user holds Shift and drags a selection box around four nodes in the v2 editor
- **THEN** all four nodes are selected together and the selection summary reports four nodes

#### Scenario: A clipped node still selects

- **WHEN** the user holds Shift and drags a selection box that fully covers three nodes but enters only the outer ten pixels of a fourth node's left edge
- **THEN** all four nodes are selected — overlap, not full containment, is the rule

#### Scenario: A single-node rectangle selects its node

- **WHEN** the user holds Shift and drags a small selection box that overlaps exactly one node without fully containing it
- **THEN** that node is selected and the selection summary reports one node

#### Scenario: Multi-select key augments the selection

- **WHEN** two nodes are selected and the user clicks a third node while holding the platform multi-select key
- **THEN** the selection grows to three nodes, and clicking an already-selected node with the key held removes it

#### Scenario: Nodes and connections select together

- **WHEN** a selection box encloses two nodes and the connection between them
- **THEN** the selection summary reports two nodes and one connection

#### Scenario: A single selection keeps today's panels

- **WHEN** exactly one node is selected
- **THEN** that node's properties panel opens exactly as before this change, and likewise exactly one selected connection opens the connection panel

#### Scenario: Multi-delete removes the whole selection

- **WHEN** three stages are selected and the user deletes the selection from the summary panel
- **THEN** all three nodes are removed and every connection and member reference to them is cleaned up

#### Scenario: A fan-out deletes with its barrier

- **WHEN** the selection contains a fan-out whose barrier is not selected, and the user deletes the selection
- **THEN** the fan-out and its paired barrier are both removed together with their connections

#### Scenario: Refusals arrive as one summary

- **WHEN** the selection contains two plain stages, a barrier whose fan-out is not selected, and a stage targeted by an approval gate, and the user deletes the selection
- **THEN** the two plain stages are removed while the barrier and the gate-targeted stage remain
- **AND** exactly one message names the barrier and the gate-targeted stage with the reason each was refused

#### Scenario: Selection survives a non-destructive edit

- **WHEN** two nodes are selected and the user adds another node from the palette
- **THEN** the two previously selected nodes are still selected after the new node appears

#### Scenario: An issue selects exactly its target

- **WHEN** several nodes are selected and the user clicks an issue in the issues list that maps to one stage
- **THEN** that stage becomes the only selected element and its properties panel opens

#### Scenario: v1 stages delete as a set

- **WHEN** the user box-selects three stage cards in a v1 pipeline and deletes the selection
- **THEN** all three stages are removed together with every dependency reference to them
