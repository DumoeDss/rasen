# remove-conductor-config Specification

## Purpose
Deletes the orphan `skills/gstack/conductor.json` — a Conductor multi-worktree orchestrator hook with no accompanying script and no reference anywhere in the tree. Part of the phase0b slim that drops transplanted dead weight; because nothing references it, removal needs no wiring changes.

## Requirements
### Requirement: Orphan conductor.json removed
The orphan `skills/gstack/conductor.json` (a Conductor multi-worktree orchestrator hook with no accompanying script) SHALL be deleted. No code in the tree references it, so deletion requires no wiring changes.

#### Scenario: conductor.json absent
- **WHEN** the source tree is inspected
- **THEN** `skills/gstack/conductor.json` SHALL NOT exist

#### Scenario: No dangling reference to conductor.json
- **WHEN** the repository is searched for `conductor.json`
- **THEN** no source, script, or generated file SHALL reference it

