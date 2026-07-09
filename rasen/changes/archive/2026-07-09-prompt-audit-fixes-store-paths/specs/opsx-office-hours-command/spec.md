## ADDED Requirements

### Requirement: Office-Hours Resolves Its Output Paths From Status JSON

The office-hours workflow command SHALL resolve its design-document write paths from `rasen status --json` rather than hardcoded repo-local literals, so the output lands in the correct location when the change lives in a registered store. The active-change document SHALL be written under `changeRoot`; the no-active-change document SHALL be written under the `office-hours/` directory resolved from the planning home (the sibling of `planningHome.changesDir`) — the same location `propose` scans when it consumes office-hours output as input context. Office-hours output remains in-repo/in-store permanent knowledge; this requirement changes only how its path is resolved, not that it is committed.

#### Scenario: Active-change output resolves under changeRoot

- **WHEN** office-hours writes its design document and an active change context exists
- **THEN** it SHALL write to `office-hours-design.md` under `changeRoot` from the status JSON
- **AND** SHALL NOT assume a literal repo-relative `rasen/changes/<name>/` path

#### Scenario: No-active-change output resolves from the planning home

- **WHEN** office-hours writes its design document and no active change exists
- **THEN** it SHALL write to `<topic-slug>.md` under the `office-hours/` directory resolved from the planning home (sibling of `planningHome.changesDir`)
- **AND** SHALL NOT assume a literal repo-relative `rasen/office-hours/` path
- **AND** this SHALL be the same location that `propose` scans for office-hours input context, so producer and consumer agree in store mode
