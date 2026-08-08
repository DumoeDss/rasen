## MODIFIED Requirements

### Requirement: Store space board offers a member chip filter

When the board renders a store space whose store does not declare planning layout v2, it SHALL offer a member chip row built from the store's members as reported by the spaces listing: an "All" chip (selected by default, showing the full member rollup) plus one chip per member. Selecting a member SHALL narrow the board to the Tasks attributed to that member; selecting "All" SHALL restore the full rollup. Member attribution SHALL be derived from session provenance — a Task is attributed to a member when it has a session whose working directory lies within that member's root — introducing no new persisted state. A Task with no attributing session SHALL appear only under "All". A project space board SHALL NOT render a member chip row. A store space whose store declares layout v2 SHALL NOT render a member chip row either: in layout v2 a card's owning project is a committed planning fact, and session provenance is a weaker source that can disagree with it, so that board renders project and target-line grouping instead.

#### Scenario: Store board renders All plus a chip per member

- **WHEN** the board loads a store space whose store does not declare layout v2 and whose spaces-listing entry has two members
- **THEN** a chip row shows "All" (selected) and one chip for each of the two members

#### Scenario: Selecting a member narrows the board

- **WHEN** the user selects a member chip and a Task has a session whose working directory is within that member's root
- **THEN** the board shows that Task and hides Tasks with no session attributed to that member

#### Scenario: Unattributed Task appears only under All

- **WHEN** a Task has no session run for any of its changes
- **THEN** it appears when "All" is selected and is hidden under every specific member chip

#### Scenario: Project space has no chip row

- **WHEN** the board loads a project space
- **THEN** no member chip row is rendered

#### Scenario: Layout v2 store board has no chip row

- **WHEN** the board loads a store space whose store declares planning layout v2
- **THEN** no member chip row is rendered
- **AND** the board groups its cards by project and target line instead

## ADDED Requirements

### Requirement: A layout v2 store board groups its changes by project and target line

When the board renders a store space whose store declares planning layout v2, it SHALL take its data from the Store aggregate query and SHALL present the result as groups keyed by project and target line, in the grouping the query returns rather than one the board recomputes. Every card SHALL state its project, its target line, and its Change instance; a card for an archived Change SHALL additionally state its finalization outcome, and an entry whose record is a relocated legacy one SHALL be shown as having no outcome rather than a default. When the aggregate result is incomplete, the board SHALL display an explicit incomplete-result indication naming the refs that could not be searched.

#### Scenario: Two projects sharing a change alias are not merged

- **WHEN** two projects in the store have an active change with the same alias
- **THEN** the two cards appear in their own project and target-line groups
- **AND** neither card is presented as the other's duplicate

#### Scenario: Every card carries its scope and outcome

- **WHEN** a layout v2 store board renders active and archived cards
- **THEN** each card shows its project, target line, and Change instance
- **AND** each archived card shows its finalization outcome, or shows no outcome when its record is a relocated legacy one

#### Scenario: An incomplete aggregate is visible on screen

- **WHEN** the aggregate result reports completeness as false with one unsearched ref
- **THEN** the board displays an incomplete-result indication naming that ref
- **AND** the partial result is not presented as the store's full contents

### Requirement: Cross-project Issues are a store-space view whose nodes reference project changes

A store space SHALL offer an Issues view listing the store's Issues with their operator-declared state, and an Issue detail showing the latest Execution Plan revision's nodes, each node's kind, its project and target line, and its dependency edges. A node referencing a Change SHALL link to that Change in its owning project, and a node declaring intent SHALL be shown as not yet created rather than as a missing Change. A node reported as unresolved or ambiguous, and an Issue reported as divergent, SHALL be shown as that state with the evidence the query supplied, never as an empty value or a zero. The view SHALL be read-only with respect to the referenced Changes.

#### Scenario: A plan shows both node kinds distinctly

- **WHEN** an Issue's latest revision mixes nodes referencing existing Changes with nodes declaring intent
- **THEN** each referencing node links to its Change in the owning project
- **AND** each intent node is shown as declared-not-yet-created rather than as a broken link

#### Scenario: Unresolved and divergent states are shown as themselves

- **WHEN** a node is reported unresolved or ambiguous, or an Issue is reported divergent across two refs
- **THEN** the view shows that state with the claimants or refs the query listed
- **AND** it does not render the node or Issue as empty, zero, or resolved

#### Scenario: Viewing an Issue changes no Change

- **WHEN** a user opens an Issue and its plan revision
- **THEN** no request that mutates a Change, a project partition, or the Issue is issued

### Requirement: An aggregate view never submits a project mutation with an incomplete scope

A project mutation offered from a store aggregate view SHALL require the user to choose its project and its target line explicitly before it can be submitted. The action SHALL remain unavailable until both are chosen, the submitted values SHALL come from the mutation's own form, and the view's current filter, grouping, last-viewed selection, or sole visible project SHALL NOT supply a scope segment. The submitted request SHALL carry the store, the project, and the target line.

#### Scenario: The action stays unavailable until the scope is chosen

- **WHEN** a user opens the create action from a store aggregate board with a project filter active
- **THEN** the action remains unavailable until the project and target line are chosen in its own form
- **AND** the active filter does not pre-satisfy either choice

#### Scenario: The filter never becomes the scope

- **WHEN** the user chooses a project and target line in the form that differ from the board's current filter
- **THEN** the submitted request carries the chosen values
- **AND** no filter value appears in the request

#### Scenario: The request is scope-complete

- **WHEN** a project mutation is submitted from an aggregate view
- **THEN** the request carries the store, project, and target line
- **AND** the server is never asked to complete a missing segment
