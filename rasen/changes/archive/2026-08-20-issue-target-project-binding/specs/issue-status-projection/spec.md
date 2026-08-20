## MODIFIED Requirements

### Requirement: The Issue read surface shows the projection

`rasen store issue list` SHALL show each Issue's phase, health, and progress alongside its
state and title, and `rasen store issue show` SHALL show the Issue's tri-axis status followed by
one line per plan node carrying that node's identifier, kind, target project,
Change alias, observed execution state, and any dependency or diagnostic that explains it. A node whose lifecycle is not
`required` SHALL have that lifecycle named on its node line, and a `cancelled` or `superseded`
node SHALL have its recorded reason shown with it. A node's target project
SHALL be shown as the fact the revision records — the project the plan's
author targeted — and SHALL drive no phase, health, or progress value: a
revision whose nodes name one project and a revision whose nodes name several
derive their axes by the same rules. The `--json` form of both commands
SHALL carry every fact the human form carries, including per-node target
project, per-node lifecycle, observations and status
problems.

#### Scenario: The list carries the status column

- **WHEN** Issues with derived statuses are listed
- **THEN** each line shows the Issue's state together with its phase, health, and progress pair

#### Scenario: The show command explains the status node by node

- **WHEN** an Issue with a published plan is shown
- **THEN** the status section reports the three axes
- **AND** one line per node reports its observed execution state and Change alias

#### Scenario: Node lines name the target project

- **WHEN** an Issue whose plan carries nodes targeted at two different member projects is shown
- **THEN** each node line names that node's own target project
- **AND** a plan whose nodes share one project shows that project on every node line

#### Scenario: The project fact derives nothing

- **WHEN** the same published revision is read after the target project began being shown
- **THEN** its phase, health, and progress are the values the same evidence derived before
- **AND** the target project is reported on the node line, not interpreted into any axis

#### Scenario: Node lines name the lifecycle a node carries

- **WHEN** an Issue's plan carries one optional node and one cancelled node with a recorded reason
- **THEN** the show command names `optional` on the one node's line
- **AND** names `cancelled` and the recorded reason on the other's

#### Scenario: Both forms agree

- **WHEN** the same Issue is listed and shown in human form and in `--json` form
- **THEN** the phase, health, progress, per-node target projects, per-node lifecycles, per-node observations, and status problems are the same facts in both forms
