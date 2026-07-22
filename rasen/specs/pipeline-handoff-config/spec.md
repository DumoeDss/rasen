# pipeline-handoff-config Specification

## Purpose
Adds an optional `handoff` configuration block to pipeline definitions at both pipeline and stage level — `threshold`, per-role overrides, `maxRelays`, and `stallLimit` — with a defined resolution order and validation. This lets a pipeline declare when workers should hand off and how many relays are allowed, and surfaces the resolved config together with run-state handoff records.

## Requirements
### Requirement: Handoff configuration block
Pipeline definitions SHALL accept an optional `handoff` block at pipeline level and at stage level, carrying `threshold`, `roles` (per-role threshold overrides), `maxRelays`, and `stallLimit`. Every threshold value (pipeline-level, per-role, stage-level) SHALL accept two forms: a bare number, which is ALWAYS a fraction of the context window in (0, 1], or the object `{ remainingTokens: <positive integer> }`, an absolute required-headroom threshold in tokens. No bare number SHALL ever be interpreted as a token count.

#### Scenario: Valid handoff config parses
- **WHEN** a pipeline.yaml declares `handoff: { threshold: 0.5, roles: { reviewer: 0.65 }, maxRelays: 3, stallLimit: 2 }` and a stage declares `handoff: { threshold: 0.7, maxRelays: 5 }`
- **THEN** `rasen validate <name> --type pipeline` SHALL pass
- **AND** `rasen pipeline show <name> --json` SHALL expose the resolved handoff config

#### Scenario: Absolute threshold form parses
- **WHEN** a pipeline.yaml declares `handoff: { threshold: { remainingTokens: 60000 }, roles: { implementer: { remainingTokens: 40000 } } }` or a stage declares `handoff: { threshold: { remainingTokens: 60000 } }`
- **THEN** `rasen validate <name> --type pipeline` SHALL pass
- **AND** `rasen pipeline show <name> --json` SHALL expose the resolved threshold as the `{ remainingTokens }` object

#### Scenario: Invalid handoff config rejected
- **WHEN** a pipeline.yaml declares a bare-number `threshold` outside (0, 1], a `remainingTokens` that is not a positive integer, an unknown key inside a threshold object, or a non-positive `maxRelays`/`stallLimit`
- **THEN** validation SHALL fail with an actionable message

### Requirement: Per-stage configured thresholds top the handoff resolution order

The effective handoff config for a stage SHALL resolve as: a `pipelines.<name>.handoff.<stage>` configuration instance first (threshold only; itself resolving project over store over global), then stage-level `handoff` > pipeline `handoff.roles[<stage role>]` (threshold only) > pipeline `handoff` > project config `handoff.roles[<stage role>]` (threshold only) > project config `handoff.threshold` (threshold only) > inherited store config `handoff.roles[<stage role>]` (threshold only) > inherited store config `handoff.threshold` (threshold only) > global config `handoff.roles[<stage role>]` (threshold only) > global config `handoff.threshold` (threshold only) > model preset (threshold only) > built-in defaults (`threshold: 0.5`, `maxRelays: 3`, `stallLimit: 2`). Within each machine config scope a role-specific threshold SHALL win over that scope's scalar, the scopes SHALL rank project > store > global entirely, and the store layer applies only under active inheritance (see `store-config-inheritance`). The config layers, the per-stage instance, and the preset layer tune only the threshold; `maxRelays` and `stallLimit` resolve from pipeline declarations or built-in defaults. Every threshold value at every layer — including the per-stage instance — SHALL accept the dual form: a bare fraction of the context window in (0, 1], or `{ remainingTokens: <positive integer> }`. The resolved config's source SHALL name the supplying layer specifically, with the per-stage configured layer reported scope-qualified above the existing vocabulary (`stage`, `role`, `pipeline`, `project-role`, `project-config`, `store-role`, `store-config`, `global-role`, `global-config`, `preset`, `default`). Setting a per-stage instance SHALL NOT write any pipeline definition file.

#### Scenario: Per-stage instance beats the stage-level handoff

- **WHEN** a stage declares `handoff: { threshold: 0.7 }` in its pipeline definition and `pipelines.<name>.handoff.<that stage>` is set to `0.5` at project scope
- **THEN** the resolved threshold is 0.5 with a per-stage project source, `maxRelays`/`stallLimit` still come from the stage declaration or defaults, and the definition file is unmodified

#### Scenario: Per-stage instance accepts the absolute form

- **WHEN** `pipelines.<name>.handoff.<stage>` is set to `{ "remainingTokens": 60000 }` at store scope with no project instance
- **THEN** the resolved threshold is that absolute form with a per-stage store source

#### Scenario: Chain below the top layer is unchanged

- **WHEN** no per-stage instance exists for a stage
- **THEN** resolution ranks stage > role > pipeline > project-role > project-config > store-role > store-config > global-role > global-config > preset > default byte-identically to before this capability, including every store-layer and no-store behavior

### Requirement: Run-state handoff records
The run-state reader SHALL accept optional `sessionHandoff` (top level, including an optional generation number `n`) and per-stage `handoffs[]` records, and `rasen pipeline resume` SHALL report them.

#### Scenario: Resume surfaces handoff pointers
- **WHEN** `auto-run.json` contains a `sessionHandoff` and a stage with `handoffs[]`
- **THEN** `rasen pipeline resume <change> --json` SHALL include the session handoff record and, per stage, the latest handoff document path
- **AND** run-states without these fields SHALL parse exactly as before

#### Scenario: Session handoff generation surfaces on resume
- **WHEN** `auto-run.json` contains a `sessionHandoff` with `n`
- **THEN** `rasen pipeline resume <change> --json` SHALL include `n` in the session handoff record
- **AND** a `sessionHandoff` without `n` SHALL parse as before and be treated as generation 1

