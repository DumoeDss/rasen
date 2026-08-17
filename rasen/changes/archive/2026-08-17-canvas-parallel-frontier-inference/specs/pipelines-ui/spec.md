## ADDED Requirements

### Requirement: The canvas offers a parallel frontier when branches reconverge

In the v2 editor, the editor SHALL offer to turn a drawn parallel frontier into a parallel
fan-out and barrier: the shape is one source whose outgoing edges reach two or more branch
stages that each connect onward to one common target. The offer SHALL be non-blocking and
SHALL appear when a successfully drawn connection completes the shape; declining or
dismissing it SHALL change nothing (the drawn connections are legal and remain as drawn).

A branch stage SHALL count toward the frontier only when its sole incoming connection is from
the source and its sole outgoing connection is to the common target; a shape with fewer than
two such branches SHALL offer nothing. Before anything changes, the editor SHALL present a
review: the branch stages with a required-versus-optional choice each, the concurrency cap,
the budget, and the proceed and failed outcomes picked from the definition's outcomes, with
the source and target shown read-only.

Confirming SHALL remove the drawn branch connections (they SHALL NOT survive alongside the
synthesized structure) and replace them with the parallel pair's wiring: the source connects
to the fan-out, the fan-out dispatches to every branch stage, the branch stages feed the
barrier, and the barrier connects to the target. The fan-out SHALL be selected after the
change, and the pair SHALL remain editable through its properties panel exactly as an
explicitly authored one. No node the editor creates in the result SHALL carry runtime-ownership
metadata. The explicit parallel gesture on the palette SHALL keep working unchanged.

#### Scenario: A completed reconverge offers the frontier

- **WHEN** the author has drawn source to two branch stages and both branches onward to one target, and then the completing connection lands
- **THEN** a non-blocking offer to run the branches in parallel appears
- **AND** dismissing it leaves every drawn connection in place

#### Scenario: Two branches are the minimum

- **WHEN** the source reaches only one branch stage that connects to the target
- **THEN** no offer is made

#### Scenario: A shared branch does not count

- **WHEN** a branch stage also receives a connection from elsewhere or sends one elsewhere besides the target
- **THEN** that stage is not part of the offered frontier, and the offer appears only if at least two clean branches remain

#### Scenario: The review sets the contract

- **WHEN** the review is open and the author marks one branch optional, sets the cap to 2 and the budget to 4, and picks the definition's second outcome for proceed
- **THEN** confirming creates the fan-out and barrier with exactly that membership metadata, cap, budget, and outcome mapping

#### Scenario: Confirming consumes the drawn branch connections

- **WHEN** the author confirms the review over source, two branches, and target
- **THEN** the drawn source-to-branch and branch-to-target connections are gone from the root graph
- **AND** the root graph instead carries source-to-fan-out, fan-out-to-branch, branch-to-barrier, and barrier-to-target connections
- **AND** the fan-out is the selection and its properties panel is open

#### Scenario: The pair stays editable and the gesture still works

- **WHEN** the inferred pair exists and the author edits its membership through the properties panel, or uses the palette's parallel gesture
- **THEN** both behave exactly as they do for an explicitly authored pair

#### Scenario: Content survives the synthesis

- **WHEN** a branch stage carried unedited execution settings
- **THEN** the stage keeps its settings verbatim — only the connections around it change
- **AND** neither the fan-out nor the barrier carries runtime-ownership metadata
