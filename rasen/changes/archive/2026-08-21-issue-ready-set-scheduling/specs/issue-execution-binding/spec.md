# issue-execution-binding Specification — Delta

## MODIFIED Requirements

### Requirement: Confirming a plan composes the launch contract set

`rasen store issue confirm <issue-id> [--revision <id>]` SHALL be the Issue dispatch's confirm step: it SHALL resolve the named revision, or the latest readable revision when none is named, refusing an Issue with no readable revision toward planning exactly as start does. It SHALL verify every Change node's instance against committed Store evidence and compose, for every node the plan still wants whose dependencies' work is complete and whose Change is bound, the same launch contract `store issue start` would emit for it — working directory, project, line, and pipeline under the same resolution order, suggestion included. A node the plan still wants whose observation is anything other than `not-started` SHALL receive that same per-node resolution regardless of its dependencies' observed state — dependency gating applies to fresh launches, and a begun node is reported as what it is (a resume-oriented or report-only contract, or an unprepared report), never as waiting. Every intent node the revision still carries SHALL be reported as pending Change creation, named with its target project, target line, and suggestion, because confirm composes contracts and mints nothing. The command SHALL write nothing — the Issue record, every revision, every run-state file, and the workspace index are byte-identical before and after — and SHALL refuse, naming the defect, a revision whose Change reference does not resolve or whose revision cannot be read. Confirm is a read: the five declared Issue mutations stay five, and starting a confirmed node remains the operator's per-node act.

#### Scenario: Confirm reports the launchable set and the pending work

- **WHEN** an Issue's latest revision carries one launchable Change node and one intent node and `rasen store issue confirm` runs
- **THEN** the report carries the Change node's launch contract and names the intent node as pending Change creation with its target project, line, and suggestion
- **AND** the human and `--json` forms carry the same facts

#### Scenario: A begun node keeps its per-node resolution over an incomplete dependency

- **WHEN** a wanted node's observation is in-flight while a dependency it still names has not started
- **THEN** the report carries the begun node's resume-oriented contract, not a waiting entry
- **AND** the not-started dependency is itself part of the launchable scope exactly as the ready set derives it

#### Scenario: Confirm refuses an unresolvable reference

- **WHEN** the resolved revision names a Change instance no committed Store evidence resolves
- **THEN** confirm refuses, naming the node and the missing evidence
- **AND** no contract set is reported as launchable

#### Scenario: Confirm refuses a named revision that does not read back with the readable range

- **WHEN** `--revision` names a revision that does not read back on an Issue that has published revisions
- **THEN** confirm refuses with its own refusal, naming the requested revision id and the Issue's readable revision range with its latest
- **AND** the refusal's advice points at reading the ordinals, never at publishing a new revision

#### Scenario: Confirm writes nothing

- **WHEN** `rasen store issue confirm` runs to completion
- **THEN** the Issue record, every plan revision, every run-state file, and the workspace index are byte-identical before and after
- **AND** no Change, worktree, or run is created
