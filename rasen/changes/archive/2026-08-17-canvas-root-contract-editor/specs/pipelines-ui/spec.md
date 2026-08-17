## ADDED Requirements

### Requirement: The canvas declares the definition's outcome contract

The v2 canvas edit session SHALL let the author declare the root definition's named
outcome contract in the definition contract panel: edit the named outcome list (adding,
renaming, or removing entries) with the list-field idiom used for declaration outcomes,
committing on blur. The list-field commit SHALL canonicalize the text into the trimmed,
non-blank, deduplicated names in typed order, so a blank or duplicate entry in the text
never reaches the contract from the list. Refusal of blank and duplicate names SHALL
live at the contract rule site every contract write goes through (the typed input and
artifact row edits and the single-outcome declare helper reach it): a refusal there
SHALL surface a diagnostic and keep the previous contract. The definition's typed input
and artifact rows SHALL remain editable in the same panel under the same refusal rules.
Outcome pickers elsewhere on the canvas SHALL stay read-only over the declared contract:
the loop review's exit-outcome choice and the sink endpoint offer SHALL offer exactly the
declared outcomes and create none on their own. The loop review SHALL read the
definition's current outcomes while it is open, and, while it is open and the definition
declares no outcomes, SHALL offer an inline declare affordance that appends one outcome
through the same contract rule site without closing the review. The sink endpoint offer,
when the definition declares no outcomes, SHALL say so and SHALL offer an action that
locates the definition contract's outcome list instead of presenting an empty choice.

#### Scenario: An undeclared terminal outcome is declared from the contract panel

- **WHEN** a definition whose graph produces a terminal outcome that its contract does not declare shows the corresponding issue, and the author adds that outcome to the definition contract panel's named outcome list and re-runs validation
- **THEN** the issue is gone and no other edit was made to the definition

#### Scenario: The outcome list commits on blur and canonicalizes

- **WHEN** the author edits the named outcome list text and focus leaves the field
- **THEN** the definition's outcomes equal the trimmed, non-blank, deduplicated names in typed order
- **WHEN** the committed text contains a blank or duplicate outcome name
- **THEN** the commit canonicalizes it away (blanks dropped, duplicates merged) and no refusal is raised, because the list-field commit never submits a blank or duplicate name to the contract rule site

#### Scenario: Typed input and artifact rows stay editable

- **WHEN** the author adds, renames, or removes a typed input row or an artifact row in the definition contract panel
- **THEN** the definition contract reflects the edited rows, and a blank or duplicate row name is refused with a diagnostic

#### Scenario: The loop review reads the live contract and can declare inline

- **WHEN** the loop review is open and the definition declares no outcomes, and the author enters a name in the inline declare affordance and confirms it
- **THEN** the definition gains that outcome as its single declaring transaction, the exit-outcome choice offers it, and the review stays open with its other edits intact
- **WHEN** the inline declare name is blank
- **THEN** the affordance's confirm action stays disabled, so a blank never reaches the contract rule site; a duplicate cannot be submitted through this affordance (it renders only while the definition declares nothing), and the rule site's own blank/duplicate refusal is the model's guarantee for every write path

#### Scenario: The sink endpoint offer points at the contract when no outcomes exist

- **WHEN** the selected promotable sink's endpoint offer renders while the definition declares no outcomes
- **THEN** the offer states that no outcomes are declared and presents an action that locates the definition contract's outcome list rather than an empty outcome choice

#### Scenario: Pickers offer exactly the declared outcomes

- **WHEN** the definition declares one or more outcomes and the loop review or the sink endpoint offer renders
- **THEN** their outcome choices list exactly the declared outcomes and none beyond them
