## ADDED Requirements

### Requirement: The canvas keeps the author's node placement

In a v2 edit session the canvas SHALL keep the placement an author gives a node by
dragging: after any subsequent non-destructive edit that rebuilds the flow (adding a
node, editing a contract, declaring an outcome, wiring a connection), a dragged node
SHALL render at the author's placement. Elements the author has not dragged (palette
adds, synthesized references, loops, parallel pairs, inserted declaration refs) SHALL
receive computed layout positions. The canvas SHALL capture a placement when a drag ends
and SHALL apply it by node identity. Placement SHALL follow a node through a rename.
When an element leaves the root graph (deletion or extraction into a declaration) the
canvas SHALL drop its placement, and an element later added under the same id SHALL
receive a computed layout position. The Re-layout action SHALL clear the session's
placement memory and return every element to computed layout. Placement SHALL remain
edit-session state: the definition payload the canvas saves SHALL carry no placement
fields, and a fresh edit session SHALL start from computed layout.

#### Scenario: A dragged node keeps its placement across a follow-up edit

- **WHEN** the author drags a node in a v2 edit session and then adds another node from the palette
- **THEN** the dragged node renders at the author's placement and the added node renders at a computed layout position

#### Scenario: A dragged node keeps its placement across a contract edit

- **WHEN** the author drags a node and then edits the definition contract (for example declaring an outcome) in the same session
- **THEN** the dragged node still renders at the author's placement after the rebuild

#### Scenario: Undragged elements always lay out afresh

- **WHEN** the flow is rebuilt after a mutation and an element has no captured placement (palette add, synthesized reference, loop, pair, or inserted declaration ref)
- **THEN** that element renders at its computed layout position

#### Scenario: Placement follows a rename

- **WHEN** the author renames a node that has a captured placement
- **THEN** the renamed node renders at the same placement under its new identity

#### Scenario: A departed element leaves no placement behind

- **WHEN** a node with a captured placement leaves the root graph by deletion or by being packaged into a declaration, and an element with the same id is later added again
- **THEN** the re-added element renders at a computed layout position, not the departed placement

#### Scenario: Re-layout resets placement and the payload stays clean

- **WHEN** the author presses Re-layout after dragging nodes, and then saves
- **THEN** every element returns to computed layout, subsequent edits keep treating all elements as undragged, and the definition payload the canvas submits contains no placement fields
