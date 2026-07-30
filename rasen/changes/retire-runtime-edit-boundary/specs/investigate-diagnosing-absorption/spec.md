## ADDED Requirements

### Requirement: Investigate declares and verifies its change scope

The `investigate` skill SHALL, after minimizing the reproduction and before
making a fix, record the narrowest affected area supported by current evidence.
If root-cause evidence requires edits outside that area, investigate SHALL
record the reason and revised area before making those edits. Before
completion, it SHALL compare the actual changed-file set and diff with the
latest declared scope and SHALL classify every unexpected change as justified
scope expansion or unresolved out-of-scope work. The guidance SHALL state that
this discipline is evidence and review, not mechanical write enforcement.

#### Scenario: Localized investigation remains within declared scope

- **WHEN** the root cause and fix remain within the initially declared affected
  module
- **THEN** investigate SHALL inspect the final changed-file set and confirm
  that every changed file is within that area
- **AND** SHALL record the scope check with its verification evidence

#### Scenario: Evidence expands the affected area

- **WHEN** root-cause analysis proves that a necessary fix crosses the initial
  affected-area boundary
- **THEN** investigate SHALL record the evidence and revised scope before
  editing the additional area
- **AND** the final diff audit SHALL evaluate changes against the revised scope

#### Scenario: Unexpected change is not silently accepted

- **WHEN** the final changed-file inspection finds a file outside the latest
  declared scope without a recorded justification
- **THEN** investigate SHALL report it as unresolved out-of-scope work
- **AND** SHALL NOT describe the investigation as complete until the change is
  reverted or its scope expansion is justified and verified

### Requirement: Investigate has no boundary transition lifecycle

The `investigate` skill SHALL NOT invoke or instruct users to invoke
freeze/unfreeze or `rasen agent edit-boundary` transitions. Investigation
cleanup SHALL consist of resolving its temporary debugging changes and
verifying the final diff, with no machine-local boundary state to clear.

#### Scenario: Generated investigate contains no retired invocation

- **WHEN** the installed investigate `SKILL.md` is inspected
- **THEN** it SHALL contain no freeze, unfreeze, guard, edit-boundary set,
  edit-boundary status, or edit-boundary clear invocation
- **AND** SHALL retain its feedback-loop, root-cause, regression, and
  risk-proportional verification gates
