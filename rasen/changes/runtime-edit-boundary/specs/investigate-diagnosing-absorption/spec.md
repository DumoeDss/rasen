## MODIFIED Requirements

### Requirement: Investigate registration survives expert retirement

The `investigate` base name and expert registration SHALL remain present. Its
installed skill SHALL introduce `rasen agent edit-boundary set|status|clear`,
define `hard`, `soft`, and `unsupported`, and SHALL read the returned status
before describing any restriction. Removal of the three standalone boundary
experts SHALL reduce aggregate expert counts without changing investigate's
own identity or diagnosing behavior.

#### Scenario: Investigate uses the base runtime

- **WHEN** the installed `rasen-investigate` skill narrows a debugging scope
- **THEN** it SHALL invoke the base edit-boundary command rather than probe a sibling skill or write `freeze-dir.txt`
- **AND** it SHALL not claim hard enforcement for a soft or unsupported result

#### Scenario: Investigate remains registered after count update

- **WHEN** catalog and generation count assertions are evaluated after retirement
- **THEN** `rasen-investigate` SHALL remain present
- **AND** the totals SHALL reflect removal of exactly `freeze`, `guard`, and `unfreeze`
