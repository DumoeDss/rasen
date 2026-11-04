## ADDED Requirements

### Requirement: The canvas packages a selection into a reusable declaration

In the v2 editor, a multi-selection of nodes SHALL be offered a package-into-reusable-block
action that moves the selected nodes into a new Custom Composite declaration and replaces them
in the root graph with one reference to that declaration. The editor SHALL derive the cut from
the draft itself: each root connection entering the selected set from outside SHALL become one
declaration input port (one port per distinct target stage and port), each root connection
leaving the selected set SHALL become one declaration outcome (one outcome per distinct source
stage and port, defaulting to the source stage's name), connections with both ends inside the
set SHALL move into the declaration body unchanged, and the crossing root connections SHALL be
rewired onto the reference's corresponding ports. When no connection leaves the set, the
declaration SHALL carry a single default outcome. Moved stages and moved connections SHALL keep
their existing fields, and the editor SHALL NOT add runtime-ownership metadata to any node it
moves or creates.

Before the change applies, the editor SHALL present the derived declaration for review: the
author names the declaration id and may edit the derived input, artifact, and outcome rows,
with the same blank and uniqueness rules the declarations editor enforces. Confirming SHALL
leave the new reference selected, and the declaration SHALL appear in the declarations panel
as a custom row whose insert action works exactly as before.

The action SHALL be offered only for selections the model can package, and the editor SHALL
name every blocker otherwise: a selection containing anything other than plain stages SHALL be
refused (only plain stages may live in a declaration body), as SHALL a selection containing a
stage that an approval gate outside the set targets, that an outside fan-out or barrier counts
as a parallel member or input, or that a consultation binding references.

#### Scenario: A selected pair becomes one reusable block

- **WHEN** the user box-selects two connected stages that sit between an upstream stage and a finish, and confirms the package action with the derived defaults
- **THEN** a custom declaration exists whose body holds the two stages and their internal connection, with one derived input and one derived outcome
- **AND** the root graph shows one reference to that declaration, wired from the upstream stage and to the finish, and the reference is the selection

#### Scenario: The review step edits the derived contract

- **WHEN** the package review is open and the author renames an outcome and adds an artifact row before confirming
- **THEN** the created declaration carries the edited outcome and artifact, and the rewired root connection uses the edited outcome as its source port

#### Scenario: Mixed or non-stage selections are refused with the reason

- **WHEN** the selection contains a fan-out or a finish alongside plain stages
- **THEN** the package action reports that only plain stages can be packaged, and the draft is unchanged

#### Scenario: A stage under outside structural references is refused

- **WHEN** the selection contains a stage an approval gate targets, or a stage counted as a parallel member by an outside fan-out, or a stage a consultation binding references
- **THEN** the package action names that stage and the blocker, and the draft is unchanged

#### Scenario: The extracted declaration stays reusable

- **WHEN** a selection has been packaged into a declaration and the author uses that declaration row's insert action
- **THEN** a second reference to the same declaration is added to the root graph

#### Scenario: Definition content survives the packaging

- **WHEN** a packaged stage carried unedited execution settings and a crossing connection carried extension fields
- **THEN** the moved stage keeps its settings verbatim inside the declaration body and the rewired connection keeps its extension fields with only its endpoints and identity rewritten
- **AND** no node in the resulting definition carries runtime-ownership metadata it did not carry before
