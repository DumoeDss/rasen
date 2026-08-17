## ADDED Requirements

### Requirement: The loop shows its body

The canvas SHALL let the author open a bounded loop's body inside the node itself: a
collapsed loop renders exactly the compact card it renders today, and an expand control
on that card SHALL turn the node into a frame showing the declaration's body stages and
the connections between them, laid out inside the frame with the frame sized to fit
them. The frame SHALL keep the node's identity and its external connection handles, and
external connections SHALL be unaffected by expanding or collapsing. The same affordance
SHALL work on a composite reference, which carries its declaration by the same
mechanism.

A loop created by a synthesis SHALL open expanded (the drawn back-edge review, the
palette loop gesture, and the package-into-block extraction alike), so the author
immediately sees what was captured. Expansion SHALL be edit-session state only and
SHALL never become part of the saved definition. Selecting a body stage SHALL show its
facts in a read-only panel naming the owning declaration; body stages SHALL NOT start
connections, drag, or mutate the draft through any interaction. Placement of root nodes
SHALL survive expanding and collapsing.

#### Scenario: A collapsed loop keeps today's card

- **WHEN** a loop node exists and has not been expanded
- **THEN** it renders the same compact card with the same handles as before this change, and no body stages render anywhere in the flow

#### Scenario: Expanding shows the body inside

- **WHEN** the author clicks the expand control on a loop whose declaration body holds two stages joined by a connection
- **THEN** the node becomes a frame sized to its content, the two body stages and the connection between them render inside the frame, and the frame keeps the loop's identity and its external handles

#### Scenario: Collapsing restores the compact card

- **WHEN** an expanded frame's collapse control is clicked
- **THEN** the body stages and their connections stop rendering and the node renders the compact card again, with its handles and external connections unchanged

#### Scenario: The synthesized loop opens expanded

- **WHEN** the author confirms a loop review, uses the palette loop gesture, or confirms a package-into-block extraction
- **THEN** the newly created loop or reference node renders expanded, showing the captured body immediately

#### Scenario: Selecting a body stage opens a read-only panel

- **WHEN** an expanded frame is showing and the author clicks one of its body stages
- **THEN** a panel shows that stage's identity, kind, and capability, and names the declaration it lives in
- **AND** the panel offers no edits for the body stage, and clicking the pane clears the panel

#### Scenario: Body stages are inert

- **WHEN** the author interacts with a body stage's handles or tries to drag a body stage
- **THEN** no connection is started, nothing moves, and the draft is unchanged

#### Scenario: A composite reference expands the same way

- **WHEN** the author expands a composite reference whose declaration carries a body graph
- **THEN** it renders as a frame with its body stages and connections inside, exactly like a loop, keeping its own identity and handles

#### Scenario: Placement survives expanding and collapsing

- **WHEN** the author has dragged a root node to a placement and then expands and collapses a loop elsewhere on the canvas
- **THEN** the dragged node keeps the author's placement throughout
