# issue-acceptance-close Specification — Delta

## MODIFIED Requirements

### Requirement: The acceptance record is durable close evidence

The acceptance record SHALL be one record per Issue, written at the Issue's own location, never
rewritten, and SHALL carry: when the acceptance happened, the conditions revision it accepted
with that revision's digest, the gate snapshot at acceptance — completed and total required
nodes, the health value, and that no status problem stood — the gate's lifecycle accounting —
every `cancelled` or `superseded` exclusion that stood at acceptance, each with its node,
lifecycle, and recorded reason — an optional note, and a digest over its own canonical content
that a read verifies, so the total the record freezes is explained by the record itself rather
than only by a later read's evaluation. The exclusions field SHALL be omitted from the stored
canonical form when no exclusion stood, so an acceptance over a plan with no exclusions writes
the bytes that field's absence defines, and a record accepted before the field existed SHALL
read back unchanged with its digest verifying. A record whose stored digest does not match its
content SHALL be refused on read and reported, and the Issue SHALL not present as done from
unreadable bytes. A read surface that presents the record SHALL present the exclusions it
carries, in both human and `--json` forms.

#### Scenario: The record freezes what was accepted

- **WHEN** an acceptance record is read back
- **THEN** it names the conditions revision and that revision's digest at acceptance time
- **AND** a later conditions revision does not change what the record says was accepted

#### Scenario: The record explains its own total

- **WHEN** an Issue whose latest revision marks one node `superseded` with a recorded reason is accepted over its required nodes
- **THEN** the acceptance record carries that exclusion with the node, the superseded lifecycle, and the recorded reason beside the gate snapshot
- **AND** a read of the record presents the exclusion in both human and `--json` forms, so the smaller total needs no later read to explain it

#### Scenario: A record with no exclusions writes the absent form

- **WHEN** an Issue whose plan carries no cancelled or superseded nodes is accepted
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
