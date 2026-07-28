## ADDED Requirements

### Requirement: A decomposed parent's remaining work is answered from its portfolio record

When a change was split into child changes, `rasen pipeline resume` SHALL answer
from that change's portfolio record and report the children that can be worked on
next, rather than from the parent's own stage list. A parent that still has any
child which has not reached a finished state SHALL NOT be reported as ready to
deliver, and SHALL NOT present delivery as its next step or as available work,
regardless of what its own stage list says. Delivery SHALL become available only
once every child has reached a finished state, and a change recorded as split
while listing no children at all SHALL NOT be reported as complete — a record
naming nothing that finished is not evidence that anything did.

#### Scenario: A split change listing no children is not complete

- **WHEN** a change is recorded as split into children but its portfolio lists none
- **THEN** it SHALL NOT be reported as complete
- **AND** delivery SHALL NOT be offered

#### Scenario: A parent with children remaining never offers delivery

- **WHEN** a user resumes a parent change whose portfolio still lists children that have not finished
- **THEN** the next step SHALL be the child work that remains
- **AND** delivery SHALL NOT appear as the next step or as available work

#### Scenario: A parent whose children have all finished can deliver

- **WHEN** a user resumes a parent change and every child in its portfolio has reached a finished state
- **THEN** the portfolio SHALL be reported as complete
- **AND** delivery SHALL be available

#### Scenario: A parent's own stage list cannot overrule its children

- **WHEN** a parent change's own stage list shows nothing outstanding but its portfolio still lists unfinished children
- **THEN** the children SHALL decide the answer
- **AND** delivery SHALL NOT be offered

### Requirement: An unreadable portfolio record is reported, never read as absent

`rasen pipeline resume` SHALL report a portfolio record it located but cannot
read — malformed, or failing validation after normalization — distinctly from the
case where a change has no portfolio record at all, so the failure is diagnosable
instead of masquerading as "this change was never split". A change whose
portfolio record cannot be read SHALL NOT be answered as though it were an
ordinary undivided change, because that substitution can present delivery as the
next step for work that is not finished. The report SHALL name the record's
location and the reason it could not be read, and SHALL offer no next step until
the record is repaired.

#### Scenario: An unreadable portfolio record is reported with its reason

- **WHEN** a user resumes a change whose portfolio record is present but cannot be read
- **THEN** the result SHALL state that the portfolio record is unreadable
- **AND** SHALL name the record's location and the reason it could not be read

#### Scenario: An unreadable portfolio record never offers a next step

- **WHEN** a user resumes a change whose portfolio record is present but cannot be read
- **THEN** no next step SHALL be offered, and delivery in particular SHALL NOT be offered
- **AND** the change SHALL NOT be answered as though it had never been split

#### Scenario: A change that was never split is unaffected

- **WHEN** a user resumes a change that has no portfolio record at all
- **THEN** the answer SHALL come from that change's own stages exactly as before
- **AND** nothing SHALL be reported as unreadable

### Requirement: Work handed to children is recorded as delegated, not skipped

A parent SHALL be able to record that a stage was handed to its children, as a
state distinct from a stage that was deliberately not needed. Delegated work
SHALL count as outstanding, so a parent that delegated its work is never mistaken
for one that finished it. A stage recorded as deliberately not needed SHALL keep
counting as settled, and records written before this distinction existed SHALL
keep being readable and keep their current meaning.

#### Scenario: Delegated work keeps a parent unfinished

- **WHEN** a parent records stages as delegated to its children
- **THEN** those stages SHALL count as outstanding work
- **AND** the parent SHALL NOT be reported as having finished them

#### Scenario: Deliberately skipped work still counts as settled

- **WHEN** a stage is recorded as deliberately not needed
- **THEN** it SHALL count as settled, exactly as before

#### Scenario: Existing records keep their meaning

- **WHEN** a record written before delegation could be expressed is read
- **THEN** it SHALL be readable
- **AND** its stages SHALL keep the meaning they had when written

### Requirement: Child progress covers proposed work, and an unrecognized state counts as unfinished

A child's recorded progress SHALL be able to say that its proposal is complete
while its implementation has not started, and that state SHALL count as
unfinished. A child progress state the system does not recognize SHALL be
preserved as recorded and treated as unfinished, and SHALL NOT cause the
portfolio it belongs to to become unreadable or to be treated as absent. An
unrecognized state SHALL never be able to make a portfolio appear complete.

#### Scenario: A proposed child keeps the portfolio unfinished

- **WHEN** a child's progress records that its proposal is complete but its implementation has not started
- **THEN** that child SHALL count as unfinished
- **AND** the portfolio SHALL NOT be reported as complete

#### Scenario: An unrecognized child state is kept and counted as unfinished

- **WHEN** a portfolio record describes a child's progress in a way the system does not recognize
- **THEN** the recorded value SHALL be preserved as written
- **AND** that child SHALL count as unfinished

#### Scenario: An unrecognized child state does not hide the portfolio

- **WHEN** a portfolio record describes a child's progress in a way the system does not recognize
- **THEN** the portfolio SHALL still be recognized as a portfolio
- **AND** the change SHALL NOT be answered as though it had never been split

#### Scenario: An unrecognized child state cannot complete a portfolio

- **WHEN** every other child has finished and one child carries an unrecognized progress state
- **THEN** the portfolio SHALL NOT be reported as complete
- **AND** delivery SHALL NOT be offered
