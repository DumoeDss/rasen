## ADDED Requirements

### Requirement: Generated canonical specifications are written commit-clean

When Rasen writes a canonical specification produced by reconciling a delta — creating a capability that did not exist or replacing an existing capability's content — the written content SHALL end with exactly one newline character and SHALL NOT end with a blank line or with trailing whitespace. This SHALL hold regardless of how many newline characters the source delta or the existing canonical file ended with, regardless of whether the input used LF or CRLF line endings, and regardless of whether `## Requirements` is the final section of the specification.

Apart from that terminal normalization, the written content SHALL be byte-identical to what delta reconciliation produced: requirement order, requirement bodies, scenario text, the preamble, and any section following `## Requirements` SHALL be unaffected. Writing an already-normalized specification again SHALL produce identical bytes.

#### Scenario: A newly created capability ends with one newline

- **WHEN** a delta creates a canonical specification for a capability that did not previously exist
- **THEN** the written file SHALL end with exactly one newline character
- **AND** SHALL NOT end with a blank line

#### Scenario: An updated capability ends with one newline

- **WHEN** a delta replaces requirements in an existing canonical specification whose final section is `## Requirements`
- **THEN** the written file SHALL end with exactly one newline character
- **AND** the requirement bodies and their order SHALL be unchanged by the normalization

#### Scenario: Input terminating newlines do not change the result

- **WHEN** the same delta is applied to inputs that end with no newline, with one newline, and with several newline characters, including a CRLF input
- **THEN** every written file SHALL end with exactly one newline character

#### Scenario: A trailing section after the requirements is preserved

- **WHEN** the canonical specification carries a section after `## Requirements`
- **THEN** that section SHALL be written unchanged
- **AND** the file SHALL still end with exactly one newline character

#### Scenario: Rewriting a normalized specification is a no-op

- **WHEN** a canonical specification written by this rule is rewritten from an equivalent delta
- **THEN** the written bytes SHALL be identical to the existing file

#### Scenario: A staged generated specification passes the repository whitespace check

- **WHEN** canonical specifications written by an archive are staged for the archive commit
- **THEN** the repository's staged-whitespace check SHALL NOT report a new blank line at end of file for them
