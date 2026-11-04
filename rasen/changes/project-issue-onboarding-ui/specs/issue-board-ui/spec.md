## MODIFIED Requirements

### Requirement: The Issue read surface is reachable from store-space navigation

A store space's navigation SHALL offer the Issue Board, and each Issue's Detail SHALL be
addressable by its own URL within the store space, so a specific Issue's read can be shared
and revisited directly. Project navigation SHALL offer an Issues entry that opens a
transitional Store-membership onboarding surface. The Issue Board and Issue Detail SHALL
remain Store-owned and SHALL be rendered only under Store-prefixed URLs; the Project
onboarding URL SHALL NOT become an Issue Board or Detail home.

#### Scenario: A store space navigates to its Board

- **WHEN** a viewer is in a store space
- **THEN** the navigation offers the Issues section and it presents that store's Board

#### Scenario: A deep link lands on the Detail

- **WHEN** a viewer opens an Issue Detail URL directly
- **THEN** the Detail for that store's Issue renders without visiting the Board first

#### Scenario: A project space offers no Issue surface

- **WHEN** a viewer is in a project space
- **THEN** the navigation offers an Issues section that opens that Project's Store-membership onboarding surface rather than an Issue Board
- **AND** no Issue read surface is rendered under the Project prefix

#### Scenario: A project Issue URL never mounts the read surface

- **WHEN** a viewer opens the Project's transitional `/issues` URL
- **THEN** neither an Issue Board nor an Issue Detail renders under the Project prefix
- **AND** successful onboarding continues at a Store's canonical `/issues` URL
