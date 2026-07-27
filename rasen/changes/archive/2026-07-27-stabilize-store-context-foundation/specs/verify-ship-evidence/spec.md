## ADDED Requirements

### Requirement: A completion gate names the evidence that settles it

A task written as a gate on completing work SHALL state the evidence that settles
it, in terms a later reader can check. A gate SHALL NOT be written as a condition
the project is already known not to meet for reasons outside the work being
gated, because such a gate can never be honestly settled and leaves permanent
unreconciled debt behind. Where the outcome a gate depends on is produced by
someone other than the person writing it, the gate SHALL say whose result settles
it. A gate SHALL NOT be recorded as met unless the evidence it names was actually
obtained.

#### Scenario: A gate states checkable evidence

- **WHEN** a task is written as a gate on completing work
- **THEN** it SHALL name the evidence that settles it
- **AND** a later reader SHALL be able to check that evidence

#### Scenario: An unsatisfiable gate is not written

- **WHEN** a gate would depend on a condition the project is already known not to meet for reasons outside the work being gated
- **THEN** that gate SHALL NOT be written in those terms
- **AND** it SHALL instead state the outcome the work itself is responsible for

#### Scenario: A gate settled by someone else says so

- **WHEN** the result that settles a gate is produced by someone other than the person who wrote the gate
- **THEN** the gate SHALL say whose result settles it

#### Scenario: A gate is never marked met without its evidence

- **WHEN** the evidence a gate names has not been obtained
- **THEN** the gate SHALL NOT be recorded as met

### Requirement: A combined verification result accounts for every failure it observed

A verification result covering several completed pieces of work SHALL record what
was run, what passed, and what failed, and SHALL account for every failure it
observed rather than reporting only the ones it chose to explain. Each failure
SHALL be attributed to a stated cause, and an attribution placing a failure
outside the work being verified SHALL name the evidence supporting that
placement. A failure that cannot be attributed outside the work being verified
SHALL count against that work. A verification result SHALL NOT be reported as
satisfying a gate while it contains a failure it did not account for.

#### Scenario: Every observed failure is accounted for

- **WHEN** a combined verification result is recorded
- **THEN** it SHALL list every failure it observed
- **AND** each failure SHALL carry a stated cause

#### Scenario: A failure placed outside the work names its evidence

- **WHEN** a failure is attributed to a cause outside the work being verified
- **THEN** the result SHALL name the evidence supporting that attribution

#### Scenario: An unattributable failure counts against the work

- **WHEN** a failure cannot be attributed to a cause outside the work being verified
- **THEN** it SHALL count as a failure of that work
- **AND** the gate it would settle SHALL stay open

#### Scenario: An unaccounted failure cannot settle a gate

- **WHEN** a verification result contains a failure it did not account for
- **THEN** that result SHALL NOT be reported as satisfying any gate
