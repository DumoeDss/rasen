## ADDED Requirements

### Requirement: The canvas names a sink's outcome

In the v2 editor, the editor SHALL recognize a terminal node: a root node with no outgoing
connection of its own. For a selected terminal plain stage or parallel barrier, the node's
properties panel SHALL offer to name the endpoint's outcome, presenting the definition's
outcomes as the choice. The offer SHALL be absent for a node that has an outgoing connection
and for other node kinds (their terminal wiring stays with the explicit gesture).

Confirming SHALL append one Finish node carrying the author's chosen outcome, wired from the
terminal node to the Finish, and the Finish SHALL be the selection afterwards. A parallel
barrier SHALL be promoted the same way, by appending a Finish after it; the barrier itself
SHALL never be converted (a Finish is its own kind and a barrier's outcomes are barrier
semantics). The promoted Finish SHALL remain editable through its properties panel exactly as
an explicitly authored one, and the explicit Finish gesture on the palette SHALL keep working
unchanged. No node the editor creates SHALL carry runtime-ownership metadata.

#### Scenario: A terminal stage offers to name its outcome

- **WHEN** the author selects a plain stage that has no outgoing connection
- **THEN** its properties panel offers the endpoint-naming section with the definition's outcomes as the choice

#### Scenario: A node with an outgoing edge offers nothing

- **WHEN** the author selects a stage that still connects onward
- **THEN** the endpoint-naming section is absent

#### Scenario: Confirming appends the named Finish

- **WHEN** the author picks the definition's second outcome and confirms
- **THEN** a Finish carrying that outcome exists, wired from the terminal stage, and the Finish is the selection
- **AND** the terminal stage's own settings are unchanged

#### Scenario: A parallel barrier is promoted, never converted

- **WHEN** the author names the outcome of a terminal parallel barrier
- **THEN** a Finish is appended after the barrier and wired from it, and the barrier remains a barrier with its own semantics intact

#### Scenario: Other terminal kinds keep the explicit path

- **WHEN** the author finishes a definition whose ending is a loop or a composite reference
- **THEN** the endpoint-naming section is absent for it, and the palette's Finish gesture still adds a Finish the author wires themselves

#### Scenario: The promoted Finish stays editable

- **WHEN** the promoted Finish exists and the author changes its outcome through its properties panel
- **THEN** the change applies exactly as it does for an explicitly authored Finish

#### Scenario: Content survives the promotion

- **WHEN** the terminal stage carried unedited execution settings
- **THEN** the stage keeps its settings verbatim, and neither the Finish nor the wiring carries runtime-ownership metadata
