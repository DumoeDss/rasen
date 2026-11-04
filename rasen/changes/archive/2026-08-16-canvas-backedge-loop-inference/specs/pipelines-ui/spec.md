## ADDED Requirements

### Requirement: The canvas turns a drawn back-edge into a bounded loop

In the v2 editor, when the author draws a connection that would close a cycle, the editor SHALL
recognize the drawn edge as loop intent and offer to turn it into a bounded loop, instead of
refusing it outright. The offered loop SHALL enclose the region the edge closes: the drawn
edge's two endpoints and every node on a path between them. The editor SHALL present a review
before anything changes: the enclosed region, the derived declaration contract (input ports and
outcomes implied by the connections the region's extraction would sever), the loop's maximum
iterations, and the definition outcome the loop exits to. Declining the review SHALL leave the
draft exactly as it was, with the same refusal explanation as before this change.

Confirming SHALL move the enclosed region into a new Custom Composite declaration (the same
extraction the package-into-block action performs), synthesize one bounded-loop node pointing
at that declaration carrying the author's iteration bound and exit mapping, and rewire every
root connection that crossed the region onto the loop's corresponding ports. The drawn edge
SHALL NOT appear as a root connection anywhere in the result, the synthesized loop SHALL be the
selection, and no node the editor creates or moves in the result SHALL carry runtime-ownership
metadata it did not carry before.

A region the extraction rules refuse SHALL be refused here too, naming the same blockers: only
plain stages may be enclosed, and no outside approval gate, parallel member listing, or
consultation binding may reference an enclosed stage. The explicit loop gesture on the palette
SHALL keep working unchanged.

#### Scenario: A drawn back-edge offers a loop

- **WHEN** the author draws a connection from a downstream stage back to an upstream stage that already reaches it
- **THEN** the loop review opens showing the two endpoints and the stages between them, with the iteration bound and exit outcome ready to adjust
- **AND** no connection has been added to the draft

#### Scenario: Declining keeps the refusal outcome

- **WHEN** the review is open and the author cancels
- **THEN** the draft is unchanged and the cycle-refusal message stands, exactly as before this change

#### Scenario: Confirming synthesizes the loop

- **WHEN** the author confirms the review with three stages enclosed between an external upstream stage and an external finish
- **THEN** a custom declaration holds the three stages, one bounded-loop node references it with the author's iteration bound, the external connections are rewired onto the loop, and the loop is the selection
- **AND** the drawn back-edge exists nowhere in the root graph

#### Scenario: The exit mapping follows the author's choice

- **WHEN** the review's exit outcome is set to the definition's second outcome and confirmed
- **THEN** the loop's exit action resolves to that outcome, and the loop remains editable afterwards through its properties panel as before

#### Scenario: An unextractable region is refused with its blockers

- **WHEN** the enclosed region contains a fan-out or a stage an outside approval gate targets
- **THEN** the review reports the named blockers and offers no confirm, and the draft is unchanged

#### Scenario: The explicit loop gesture still works

- **WHEN** the author uses the palette's loop gesture after this change
- **THEN** it creates a bounded loop exactly as it did before this change

#### Scenario: Content survives the synthesis

- **WHEN** an enclosed stage carried unedited execution settings and a crossing connection carried extension fields
- **THEN** the moved stage keeps its settings verbatim inside the declaration body and the rewired connection keeps its extension fields with only its endpoints and identity rewritten
- **AND** neither the synthesized loop nor any moved node carries runtime-ownership metadata it did not carry before
