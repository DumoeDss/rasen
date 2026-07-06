# pipeline-handoff-config Specification

## Purpose
Adds an optional `handoff` configuration block to pipeline definitions at both pipeline and stage level — `threshold`, per-role overrides, `maxRelays`, and `stallLimit` — with a defined resolution order and validation. This lets a pipeline declare when workers should hand off and how many relays are allowed, and surfaces the resolved config together with run-state handoff records.

## Requirements
### Requirement: Handoff configuration block
Pipeline definitions SHALL accept an optional `handoff` block at pipeline level and at stage level, carrying `threshold` (0–1), `roles` (per-role threshold overrides), `maxRelays`, and `stallLimit`.

#### Scenario: Valid handoff config parses
- **WHEN** a pipeline.yaml declares `handoff: { threshold: 0.5, roles: { reviewer: 0.65 }, maxRelays: 3, stallLimit: 2 }` and a stage declares `handoff: { threshold: 0.7, maxRelays: 5 }`
- **THEN** `openspec validate <name> --type pipeline` SHALL pass
- **AND** `openspec pipeline show <name> --json` SHALL expose the resolved handoff config

#### Scenario: Invalid handoff config rejected
- **WHEN** a pipeline.yaml declares a `threshold` outside (0, 1] or a non-positive `maxRelays`/`stallLimit`
- **THEN** validation SHALL fail with an actionable message

### Requirement: Handoff config resolution order
The effective handoff config for a stage SHALL resolve as: stage-level `handoff` > pipeline `handoff.roles[<stage role>]` (threshold only) > pipeline `handoff` > built-in defaults (`threshold: 0.5`, `maxRelays: 3`, `stallLimit: 2`).

#### Scenario: Role threshold applies when stage has no override
- **WHEN** a stage with `role: reviewer` has no stage-level `handoff` and the pipeline declares `handoff.roles.reviewer: 0.65`
- **THEN** the resolved threshold for that stage SHALL be 0.65
- **AND** its `maxRelays`/`stallLimit` SHALL come from the pipeline block or built-in defaults

#### Scenario: Defaults apply when nothing is configured
- **WHEN** neither the pipeline nor the stage declares `handoff`
- **THEN** the resolved config SHALL be the built-in defaults

### Requirement: Run-state handoff records
The run-state reader SHALL accept optional `sessionHandoff` (top level) and per-stage `handoffs[]` records, and `openspec pipeline resume` SHALL report them.

#### Scenario: Resume surfaces handoff pointers
- **WHEN** `auto-run.json` contains a `sessionHandoff` and a stage with `handoffs[]`
- **THEN** `openspec pipeline resume <change> --json` SHALL include the session handoff record and, per stage, the latest handoff document path
- **AND** run-states without these fields SHALL parse exactly as before

