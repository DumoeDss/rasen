# issue-acceptance-close Specification — Delta

## MODIFIED Requirements

### Requirement: The acceptance gate is derived and visible before it is crossed

Rasen SHALL evaluate an Issue's acceptance gate on read from the tri-axis status: the gate holds
when every required node of the latest readable plan has completed or finalized work (the same
observation rule execution binding uses), the Issue's health is not `failed`, and no status
problem stands between the reader and the facts. A node whose lifecycle is `optional` SHALL
never contribute an un-terminal blocker — its incomplete work is not demanded; a node whose
lifecycle is `cancelled`, `superseded`, or `deferred` SHALL be excluded from the required
total, and the gate report SHALL show that exclusion beside the gate with the node's recorded
reason, so a smaller total is explained rather than silently absorbed. A deferral never holds
Done: a `deferred` node SHALL NOT block the gate on its incompleteness or its recorded
failure, and its exclusion — named with the `deferred` lifecycle and the recorded reason — is
the record that distinguishes postponed work from abandoned or replaced work. `rasen store
issue show` SHALL report the gate — eligible, or every blocker named: each un-terminal
required node with its observed execution state, each node behind a failed health, and each
open status problem — alongside the latest conditions revision, in both human and `--json`
forms.

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

#### Scenario: A deferred node is excluded and does not hold the gate

- **WHEN** an Issue's latest revision marks one incomplete node `deferred` with a recorded reason and every required node's work is complete
- **THEN** the gate reports eligible over the required nodes alone
- **AND** the gate report shows the deferred node's exclusion with the `deferred` lifecycle and its recorded reason beside the gate

#### Scenario: A deferred node's recorded failure is not a gate blocker

- **WHEN** a node marked `deferred` carries run-state recording a failure escalation while every required node's work is complete and no other failure stands
- **THEN** the gate reports eligible, naming no failing-node blocker for the deferred node
- **AND** the deferred node's observation stays reported on its node line

### Requirement: The acceptance record is durable close evidence

The acceptance record SHALL be one record per Issue, written at the Issue's own location, never
rewritten, and SHALL carry: when the acceptance happened, the conditions revision it accepted
with that revision's digest, the gate snapshot at acceptance — completed and total required
nodes, the health value, and that no status problem stood — the gate's lifecycle accounting —
every `cancelled`, `superseded`, or `deferred` exclusion that stood at acceptance, each with
its node, lifecycle, and recorded reason — an optional note, and a digest over its own
canonical content that a read verifies, so the total the record freezes is explained by the
record itself rather than only by a later read's evaluation. The exclusions field SHALL be
omitted from the stored canonical form when no exclusion stood, so an acceptance over a plan
with no exclusions writes the bytes that field's absence defines, and a record accepted before
the field existed SHALL read back unchanged with its digest verifying. A record whose stored
digest does not match its content SHALL be refused on read and reported, and the Issue SHALL
not present as done from unreadable bytes. A read surface that presents the record SHALL
present the exclusions it carries, in both human and `--json` forms.

#### Scenario: The record freezes what was accepted

- **WHEN** an acceptance record is read back
- **THEN** it names the conditions revision and that revision's digest at acceptance time
- **AND** a later conditions revision does not change what the record says was accepted

#### Scenario: The record explains its own total

- **WHEN** an Issue whose latest revision marks one node `superseded` with a recorded reason is accepted over its required nodes
- **THEN** the acceptance record carries that exclusion with the node, the superseded lifecycle, and the recorded reason beside the gate snapshot
- **AND** a read of the record presents the exclusion in both human and `--json` forms, so the smaller total needs no later read to explain it

#### Scenario: A record with no exclusions writes the absent form

- **WHEN** an Issue whose plan carries no cancelled, superseded, or deferred nodes is accepted
- **THEN** the record's stored bytes omit the exclusions field
- **AND** those bytes are identical to the shape the field's absence defined before it existed

#### Scenario: A pre-field record reads back unchanged

- **WHEN** an acceptance record written before the exclusions field existed is read back
- **THEN** its stored digest still verifies against its bytes
- **AND** it reads back with no exclusions, reported as the absence it is rather than as an error

#### Scenario: A tampered record never presents as done

- **WHEN** a stored acceptance record's content is altered without updating its digest
- **THEN** reading it is refused with the mismatch reported as a status problem
- **AND** the Issue does not present as done from the unreadable record

#### Scenario: A deferral that stood at acceptance is frozen in the record

- **WHEN** an Issue whose latest revision marks one node `deferred` with a recorded reason is accepted over its required nodes
- **THEN** the acceptance record carries that exclusion with the node, the `deferred` lifecycle, and the recorded reason beside the gate snapshot
- **AND** a read of the record presents the deferral in both human and `--json` forms, so the postponement needs no later read to explain it
