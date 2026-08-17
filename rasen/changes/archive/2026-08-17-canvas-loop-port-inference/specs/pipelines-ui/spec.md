## ADDED Requirements

### Requirement: The loop carries its entry and exit

The back-edge loop review SHALL derive a side's contract rows from the back-edge
itself when the region's extraction severs no connection on that side: the entry input
port SHALL be named for the back-edge's target stage and typed as a control input, and
the exit outcome SHALL be named for the back-edge's source stage. The editor SHALL
apply this fallback per side: a side whose extraction severs connections SHALL derive
exactly the rows it derived before this change, so a region wired to external stages
first keeps identical results. The derived rows SHALL remain editable defaults in the
review, and the declaration's contract SHALL remain editable afterwards as before.

A loop synthesized from a standalone cycle SHALL therefore render an input handle and
an exit outcome handle, so external stages can be connected onto the loop after the
fact and the order in which the author draws the cycle and the external connections
SHALL not change what the loop offers.

#### Scenario: A standalone cycle yields a connectable loop

- **WHEN** the author wires two stages into a cycle on an otherwise empty canvas and confirms the loop review
- **THEN** the synthesized bounded loop renders an input handle named for the back-edge's target stage and an exit outcome handle named for the back-edge's source stage
- **AND** the loop body declaration carries those same rows in its contract

#### Scenario: External stages connect after the loop exists

- **WHEN** such a loop exists and the author draws a connection from an external stage onto the loop's entry handle
- **THEN** the connection lands on the loop's entry port
- **AND** once the author aligns the loop's declaration contract with the definition outcomes (producible body outcome names, a control-typed entry row, and the loop lifecycle's exit outcome declared), Validate reports zero errors for the loop graph
- **AND** the synthesized default rows are an author-alignment step today: the editor does not mint engine-clean defaults for a new loop, and the deeper synthesis-defaults fix is deliberately deferred to the sibling change canvas-loop-validate-clean-synthesis

#### Scenario: Severed connections keep precedence

- **WHEN** the region's extraction severs connections on a side, as when external stages were wired before the cycle was closed
- **THEN** that side's derived rows and the confirmed definition are identical to before this change

#### Scenario: Mixed sides take their own rule

- **WHEN** the region's extraction severs incoming connections but none outgoing, or severs outgoing connections but none incoming
- **THEN** the severed side derives its rows from the severed connections and the empty side derives its rows from the back-edge

#### Scenario: The derived names stay the author's to change

- **WHEN** the review is open over a standalone cycle and the author renames the derived input or outcome row before confirming
- **THEN** the confirmed declaration and the loop's rendered handles use the author's name
- **AND** renaming the declaration's rows afterwards through the declaration contract editor keeps the referencing loop's exit mapping consistent

#### Scenario: A single-stage self loop gets both handles

- **WHEN** the author draws a back-edge from a stage back to itself and confirms the review
- **THEN** the synthesized loop's entry port and exit outcome are both named for that stage and the loop is connectable like any other
