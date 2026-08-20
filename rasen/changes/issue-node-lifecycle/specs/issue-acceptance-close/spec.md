## MODIFIED Requirements

### Requirement: The acceptance gate is derived and visible before it is crossed

Rasen SHALL evaluate an Issue's acceptance gate on read from the tri-axis status: the gate holds
when every required node of the latest readable plan has completed or finalized work (the same
observation rule execution binding uses), the Issue's health is not `failed`, and no status
problem stands between the reader and the facts. A node whose lifecycle is `optional` SHALL
never contribute an un-terminal blocker — its incomplete work is not demanded; a node whose
lifecycle is `cancelled` or `superseded` SHALL be excluded from the required total, and the
gate report SHALL show that exclusion beside the gate with the node's recorded reason, so a
smaller total is explained rather than silently absorbed. `rasen store issue show` SHALL report
the gate — eligible, or every blocker named: each un-terminal required node with its observed
execution state, each node behind a failed health, and each open status problem — alongside the
latest conditions revision, in both human and `--json` forms.

#### Scenario: The gate names what is not accepted yet

- **WHEN** an Issue with acceptance conditions has one required node in flight and one with an invalid run-state
- **THEN** the gate reports not eligible, naming the in-flight node and the unreadable run-state problem
- **AND** no other fact is invented to fill the gap

#### Scenario: A passing gate is reported eligible

- **WHEN** every required node's work is complete or finalized, health is not failed, and no status problem stands
- **THEN** the gate reports eligible
- **AND** names the conditions revision it would accept

#### Scenario: Failed health holds the gate

- **WHEN** an Issue's health is `failed`
- **THEN** the gate reports not eligible, naming the nodes whose recorded failure drives the health

#### Scenario: An unfinished optional node does not hold the gate

- **WHEN** every required node's work is complete or finalized and one optional node has not started
- **THEN** the gate reports eligible
- **AND** the optional node's not-started observation is reported on its node line, not as a blocker

#### Scenario: A cancelled node is excluded with its recorded reason

- **WHEN** an Issue's latest revision marks one node `cancelled` with a recorded reason and every required node's work is complete
- **THEN** the gate reports eligible over the required nodes alone
- **AND** the gate report shows the cancelled node's exclusion and its recorded reason beside the gate

#### Scenario: A superseded node is excluded and named

- **WHEN** an Issue's latest revision marks one node `superseded` whose reason names its successor
- **THEN** the gate report shows the superseded node's exclusion with that reason
- **AND** the successor is findable from the reason the revision records

#### Scenario: A gate over zero required nodes reports what it is

- **WHEN** an Issue's latest readable revision names Change nodes whose lifecycles are all `optional`, `cancelled`, or `superseded`
- **THEN** the gate reports eligible with zero required nodes, saying that no work is demanded
- **AND** the exclusions and optional nodes are named beside the gate rather than hidden by the empty total
