## ADDED Requirements

### Requirement: The Issue Board creates an Issue from its title

The Issue Board SHALL provide a create action whose normal form asks only for the Issue title. It
SHALL send title-only input to the Store mutation, SHALL use the identity returned by that mutation,
and SHALL refresh server-derived Board truth after success. It SHALL NOT manufacture identity from
the title or require the viewer to satisfy a filesystem naming contract.

#### Scenario: Create dialog has no Issue ID field

- **WHEN** a viewer opens the Issue Board create dialog
- **THEN** the form presents a required title input and no required Issue ID input
- **AND** a valid non-ASCII title can be submitted without inventing an ASCII identifier

#### Scenario: Created identity comes from the server

- **WHEN** the title-only create mutation succeeds
- **THEN** the Board uses the returned UID and key for navigation and presentation
- **AND** it refreshes the projection reads rather than adding a client-invented card

## MODIFIED Requirements

### Requirement: The Issue Board renders one card per Issue in the five phase lanes

The Issue Board SHALL render a store space's Issues as exactly one card per authoritative Issue UID,
each placed in exactly one of five lanes named by the projection's closed phase vocabulary —
planning, ready, active, review, done — verbatim from the Issue's projected phase. The Board SHALL
show the stable generated Issue key beside the title and SHALL link the card to the canonical UID
detail route. It SHALL present phase, health, and progress as three separate facts, never blended
into a single invented status. A card SHALL show at most its single most important attention item,
taken first from the attention read's own fail-first ordering; a card SHALL NOT list the Issue's
Changes, nodes, or threads. The Board SHALL render Issues only — never a Task, a Change, or any other
abstraction dressed as an Issue.

#### Scenario: A card sits in the lane its projected phase names

- **WHEN** the Board renders an Issue whose projected phase is any of the five vocabulary values
- **THEN** the Issue's card appears in the lane of that name and in no other lane
- **AND** all five lanes are present even when empty

#### Scenario: The three axes stay separate on the card

- **WHEN** a card renders an Issue whose projection carries a phase, a health, and a progress
- **THEN** the card presents each as its own fact — lane placement for phase, a distinct health indicator, and the completed-over-total progress pair — with no value computed by the Board itself

#### Scenario: The card carries its most important attention item

- **WHEN** the attention scan reports items for an Issue
- **THEN** the Issue's card shows the first item in the scan's own ordering and no others
- **AND** an Issue with no attention items shows no attention line

#### Scenario: A card links to its Issue's detail

- **WHEN** a viewer sees and follows an Issue card
- **THEN** the card presents the generated human key and title
- **AND** the Issue Detail route is keyed by the Issue's authoritative UID
