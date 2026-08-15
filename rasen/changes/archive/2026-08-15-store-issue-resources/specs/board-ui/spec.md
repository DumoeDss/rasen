## ADDED Requirements

### Requirement: A layout v2 Store board groups its changes by project and target line

A Store board for a Store declaring layout version 2 SHALL group its Changes by project and by target
line, so the same Change alias in two projects appears as two entries rather than one ambiguous entry.
A project or target line with no Changes SHALL appear as present and empty rather than be hidden.

#### Scenario: The same alias in two projects is two board entries

- **WHEN** two of the Store's projects each hold a Change named `refresh-cache`
- **THEN** the board shows both, each under its own project and target line

#### Scenario: An empty project or line is shown as empty

- **WHEN** a project or target line holds no Changes
- **THEN** it appears on the board with an empty group
- **AND** it is not hidden

### Requirement: Cross-project Issues are a Store-level view whose nodes reference project changes

The operations UI SHALL present a Store's Issues as a Store-level view, not inside any project's view,
and each Issue SHALL show its state and the Changes its current Execution Plan references, together
with the project each referenced Change belongs to. A referenced Change the Store cannot read SHALL be
shown as unreadable rather than omitted.

#### Scenario: An Issue shows what it references and where

- **WHEN** an Issue with a published plan is viewed
- **THEN** each referenced Change is shown with the project it belongs to

#### Scenario: An unreadable reference is shown, not hidden

- **WHEN** a referenced Change cannot be read
- **THEN** it is shown as unreadable with the reason
- **AND** it is not silently dropped from the view

### Requirement: An aggregate view never submits a mutation with an incomplete scope

A mutation initiated from a Store-level or aggregate view SHALL carry its complete scope — Store,
project, and target line. The view SHALL NOT fill a missing part from the current selection, the only
visible candidate, or the item's position in a list, and SHALL make the mutation unavailable until the
scope is complete rather than submit and let the server refuse.

#### Scenario: An incomplete scope blocks the mutation in the view

- **WHEN** the scope needed for a mutation is not fully determined in an aggregate view
- **THEN** the mutation is unavailable in that view
- **AND** no request with a partial scope is sent

#### Scenario: A sole visible candidate is not adopted as scope

- **WHEN** exactly one project is visible in the view and the mutation's project is undetermined
- **THEN** that project is not adopted as the scope
