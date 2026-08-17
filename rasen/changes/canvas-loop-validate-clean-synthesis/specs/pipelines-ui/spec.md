## MODIFIED Requirements

### Requirement: The canvas turns a drawn back-edge into a bounded loop

In the v2 editor, when the author draws a connection that would close a cycle, the editor SHALL
recognize the drawn edge as loop intent and offer to turn it into a bounded loop, instead of
refusing it outright. The offered loop SHALL enclose the region the edge closes: the drawn
edge's two endpoints and every node on a path between them. The editor SHALL present a review
before anything changes: the enclosed region, the derived declaration contract (entry input rows
typed as control ports, and outcome rows naming the terminal outcomes the enclosed body can
actually produce), the loop's maximum iterations, and the definition outcome the loop exits to.
Declining the review SHALL leave the draft exactly as it was, with the same refusal explanation
as before this change.

Confirming SHALL move the enclosed region into a new Custom Composite declaration (the same
extraction the package-into-block action performs), synthesize one bounded-loop node pointing
at that declaration carrying the author's iteration bound and exit mapping, and rewire every
root connection that crossed the region onto the loop's corresponding ports: incoming crossings
onto the derived entry rows, outgoing crossings onto the loop's exit outcome. Confirming SHALL
also declare, in the definition's outcome contract, every outcome the loop can emit as an exit
that the definition does not already declare. The chosen exit outcome SHALL be a declared
definition outcome; a confirm naming an undeclared outcome SHALL be refused with a named
message. The drawn edge SHALL NOT appear as a root connection anywhere in the result, the
synthesized loop SHALL be the
selection, and no node the editor creates or moves in the result SHALL carry runtime-ownership
metadata it did not carry before.

A region the extraction rules refuse SHALL be refused here too, naming the same blockers: only
plain stages may be enclosed, and no outside approval gate, parallel member listing, or
consultation binding may reference an enclosed stage. A body stage whose capability is missing
from the catalog SHALL likewise be refused in the review, naming the stage, because the loop's
exit outcomes cannot be derived for it. The explicit loop gesture on the palette SHALL keep
working unchanged.

#### Scenario: A drawn back-edge offers a loop

- **WHEN** the author draws a connection from a downstream stage back to an upstream stage that already reaches it
- **THEN** the loop review opens showing the two endpoints and the stages between them, with the iteration bound and exit outcome ready to adjust

- **AND** no connection has been added to the draft

#### Scenario: Declining keeps the refusal outcome

- **WHEN** the review is open and the author cancels
- **THEN** the draft is unchanged and the cycle-refusal message stands, exactly as before this change

#### Scenario: Confirming synthesizes the loop

- **WHEN** the author confirms the review with three stages enclosed between an external upstream stage and an external finish
- **THEN** a custom declaration holds the three stages, one bounded-loop node references it with the author's iteration bound, the incoming external connection is rewired onto the derived entry row, the outgoing external connection is rewired onto the loop's exit outcome, and the loop is the selection
- **AND** the definition's outcome contract has gained every outcome the loop can emit as an exit that it did not already declare
- **AND** the drawn back-edge exists nowhere in the root graph

#### Scenario: The exit mapping follows the author's choice

- **WHEN** the review's exit outcome is set to the definition's second outcome and confirmed
- **THEN** the loop's exit action resolves to that outcome, and the loop remains editable afterwards through its properties panel as before

#### Scenario: An undeclared exit outcome is refused

- **WHEN** a confirm names an exit outcome the definition does not declare
- **THEN** the model refuses the synthesis with a message naming the outcome, and the draft is unchanged

#### Scenario: An unextractable region is refused with its blockers

- **WHEN** the enclosed region contains a fan-out or a stage an outside approval gate targets
- **THEN** the review reports the named blockers and offers no confirm, and the draft is unchanged

#### Scenario: A body capability missing from the catalog is refused in the review

- **WHEN** an enclosed stage's capability is not in the catalog
- **THEN** the review reports a refusal naming that stage and offers no confirm, and the draft is unchanged

#### Scenario: The explicit loop gesture still works

- **WHEN** the author uses the palette's loop gesture after this change
- **THEN** it creates a bounded loop over its declaration exactly as it did before, and the same synthesis declares the loop's exit outcomes in the definition contract when absent

#### Scenario: Content survives the synthesis

- **WHEN** an enclosed stage carried unedited execution settings and a crossing connection carried extension fields
- **THEN** the moved stage keeps its settings verbatim inside the declaration body and the rewired connection keeps its extension fields with only its endpoints and identity rewritten
- **AND** neither the synthesized loop nor any moved node carries runtime-ownership metadata it did not carry before

### Requirement: The loop carries its entry and exit

The back-edge loop review SHALL derive the entry input rows and the outcome rows so the
synthesized loop offers connectable handles and validates as minted: the entry input port for a
side that severed no connection SHALL be named for the back-edge's target stage, and every
derived input row SHALL be typed as the engine's control port type. The outcome rows SHALL name
the terminal outcomes the enclosed body actually produces (its stages' capability outcomes not
consumed by the region's internal connections), on every side alike, because the engine accepts
only outcome rows the body can produce. Severed connections SHALL keep precedence for the ENTRY
row names: a side whose extraction severs connections derives its entry names from the severed
edges exactly as before, and a side that severs none falls back to the back-edge's target. The
input rows SHALL remain editable defaults in the review, and the declaration's contract SHALL
remain editable afterwards as before.

A loop synthesized from a standalone cycle SHALL therefore render an input handle and an
exit outcome handle, so external stages can be connected onto the loop after the
fact and the order in which the author draws the cycle and the external connections
SHALL not change what the loop offers.

#### Scenario: A standalone cycle yields a connectable loop

- **WHEN** the author wires two stages into a cycle on an otherwise empty canvas and confirms the loop review
- **THEN** the synthesized bounded loop renders an input handle named for the back-edge's target stage and an exit outcome handle named for a terminal outcome the enclosed body produces
- **AND** the loop body declaration carries those same rows in its contract, with the entry row typed as a control port

#### Scenario: External stages connect after the loop exists

- **WHEN** such a loop exists and the author draws a connection from an external stage onto the loop's entry handle, and a connection from the loop onward
- **THEN** the connections land on the loop's entry port and exit outcome
- **AND** Validate reports zero errors for the wired graph with no author edits to any contract

#### Scenario: Severed connections keep precedence for entry names

- **WHEN** the region's extraction severs connections on a side, as when external stages were wired before the cycle was closed
- **THEN** that side's entry row names derive from the severed connections exactly as before this change
- **AND** the outcome rows still name the body's producible terminal outcomes, deliberately superseding the earlier severed-name rows that could not validate

#### Scenario: Mixed sides take their own rule

- **WHEN** the region's extraction severs incoming connections but none outgoing, or severs outgoing connections but none incoming
- **THEN** the severed side derives its entry names from the severed connections and the empty side falls back to the back-edge's target, while the outcome rows always derive from the body's producible terminal outcomes

#### Scenario: Input names stay the author's to change

- **WHEN** the review is open over a standalone cycle and the author renames the derived input row before confirming
- **THEN** the confirmed declaration and the loop's rendered handles use the author's name
- **AND** renaming the declaration's input rows afterwards through the declaration contract editor keeps the referencing loop's exit mapping consistent

#### Scenario: Outcome rows mirror what the body produces

- **WHEN** the derived outcome rows are shown in the review
- **THEN** they name exactly the body's producible terminal outcomes, and an outcome consumed by an internal connection of the region is not among them
- **AND** an author renaming or removing an outcome row produces a definition Validate rejects, because the rows mirror what the body produces

#### Scenario: A single-stage self loop gets both handles

- **WHEN** the author draws a back-edge from a stage back to itself and confirms the review
- **THEN** the synthesized loop's entry port is named for that stage, its exit outcome handle names an outcome that stage produces, and the loop is connectable like any other

## ADDED Requirements

### Requirement: Loop synthesis needs no contract repair

Loop synthesis SHALL mint defaults that the definition validator accepts with zero author
edits to any contract, for both the drawn back-edge path and the palette loop gesture: entry
rows typed as control ports, outcome rows the body can produce, an exit mapping that covers
them, and every outcome the loop can emit as an exit declared in the definition's outcome
contract by the synthesis transaction itself. The loop review SHALL show, before confirming,
which outcome names confirming will add to the definition's outcome contract. A body stage
whose capability is absent from the catalog SHALL be surfaced as a review refusal rather than
as a validation error.

#### Scenario: A drawn-back-edge loop validates with zero contract edits

- **WHEN** the author starts from an empty canvas, wires two stages into a cycle, confirms the loop review (declaring the exit outcome it asks for), connects an external stage onto the loop's entry and the loop onward, and presses Validate
- **THEN** the validator reports zero errors with no edits to the declaration contract or the definition contract beyond what confirming declared

#### Scenario: The lifecycle exit outcome is declared at synthesis

- **WHEN** a loop is synthesized and the definition's outcome contract does not declare the default lifecycle's exit outcome
- **THEN** confirming appends that outcome to the definition's outcome contract, and a definition that already declares it is left unchanged

#### Scenario: The palette gesture loop validates too

- **WHEN** the author uses the palette loop gesture over a declaration whose contract matches its body graph and presses Validate
- **THEN** the validator reports zero errors for the loop, with the same synthesis-time declarations applied

#### Scenario: An underivable body is refused, not failed by Validate

- **WHEN** a loop review opens over a region containing a stage whose capability is missing from the catalog
- **THEN** the review reports the refusal naming the stage and offers no confirm, and nothing reaches Validate

#### Scenario: Consumed outcomes are not terminal

- **WHEN** an internal connection of the enclosed region consumes one of a body stage's outcomes
- **THEN** that outcome is not among the derived outcome rows
