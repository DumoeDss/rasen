## MODIFIED Requirements

### Requirement: An Oh My Pi session's context occupancy is measurable

Rasen SHALL report context-window occupancy for an Oh My Pi session, so a session running in that harness receives the same occupancy answer, in the same reported fields, that a Claude Code or Codex session receives. The measurement SHALL be taken from the figures the session itself recorded for its most recent assistant turn, so the number describes this conversation rather than an estimate.

The measurement SHALL describe the context the harness would actually send, not every turn the journal happens to retain. An Oh My Pi session records its history as an append-only structure in which the live context is a subset of the file: the harness marks points where earlier history stops contributing, and it can move the active branch so that entries written later belong to an abandoned one. Occupancy SHALL be read over the entries that remain part of the live context after those markers are applied, so a session that has replaced or abandoned part of its history reports what it currently occupies rather than what it once did.

A session whose history was replaced by a summary SHALL therefore report the occupancy of the summarized context, not the occupancy of the history the summary replaced. A session whose active branch is not the most recently written one SHALL report the active branch's occupancy.

Where the journal offers no such marker, occupancy SHALL continue to come from the most recent turn that recorded a measurement, unchanged.

#### Scenario: A session whose history was replaced reports the replacement

- **WHEN** a user probes an Oh My Pi session whose earlier history has been replaced by a summary
- **THEN** the reported occupancy SHALL describe the context after that replacement
- **AND** SHALL NOT report the occupancy recorded before it

#### Scenario: An abandoned branch does not report as the session's occupancy

- **WHEN** a user probes an Oh My Pi session whose active branch is not the most recently written entry
- **THEN** the reported occupancy SHALL describe the active branch
- **AND** SHALL NOT report a figure recorded on a branch the session has left

#### Scenario: An ordinary session is unaffected

- **WHEN** a user probes an Oh My Pi session that has neither replaced nor branched its history
- **THEN** the reported occupancy SHALL be the same figure it reports today, taken from the most recent turn that measured one
