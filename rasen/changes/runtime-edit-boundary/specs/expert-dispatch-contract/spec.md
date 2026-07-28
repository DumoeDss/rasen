## MODIFIED Requirements

### Requirement: Denied-edit honesty in Fix-First flows

The Fix-First / fix-loop guidance carried in the PREAMBLE SHALL state that
when a covered write is denied by an active hard runtime edit boundary, the fix
did NOT land and SHALL be reported as an un-applied finding—never as
`[AUTO-FIXED]`—and SHALL NOT be silently dropped. The same guidance SHALL
require cooperation rather than claiming denial for a soft boundary and SHALL
state that an unsupported result leaves edits unrestricted.

#### Scenario: Enforcement-aware honesty stated in generated preamble

- **WHEN** the generated PREAMBLE section on fixes is inspected
- **THEN** it SHALL report a hard-boundary denial as un-applied, not `[AUTO-FIXED]`
- **AND** it SHALL not describe soft or unsupported enforcement as a host denial
