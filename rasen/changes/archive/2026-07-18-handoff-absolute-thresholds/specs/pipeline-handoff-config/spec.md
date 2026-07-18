# pipeline-handoff-config Delta Specification

## MODIFIED Requirements

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

### Requirement: Handoff config resolution order
The effective handoff config for a stage SHALL resolve as: stage-level `handoff` > pipeline `handoff.roles[<stage role>]` (threshold only) > pipeline `handoff` > model preset (threshold only — the suggested `handoffThreshold` of the preset matching the stage's resolved model, per the stage-model resolution `stage model > pipeline agents[<role>] model`) > built-in defaults (`threshold: 0.5`, `maxRelays: 3`, `stallLimit: 2`). The resolved config's `source` SHALL name the layer that supplied the resolved THRESHOLD specifically, in this same precedence order (including `preset`) — not merely a layer whose `handoff` block is non-empty. Only when no layer supplies a threshold (every field falls through to the built-in default) SHALL `source` fall back to naming whichever layer configured `maxRelays`/`stallLimit`. A stage with no resolvable model, or whose model has no preset (or a preset without a suggested handoff threshold), SHALL skip the preset layer.

#### Scenario: Role threshold applies when stage has no override
- **WHEN** a stage with `role: reviewer` has no stage-level `handoff` and the pipeline declares `handoff.roles.reviewer: 0.65`
- **THEN** the resolved threshold for that stage SHALL be 0.65
- **AND** its `maxRelays`/`stallLimit` SHALL come from the pipeline block or built-in defaults

#### Scenario: Model preset applies when nothing is configured
- **WHEN** neither the pipeline nor the stage declares any handoff threshold and the stage's resolved model matches a preset carrying a suggested handoff threshold
- **THEN** the resolved threshold SHALL be the preset's suggested value
- **AND** the resolved config's `source` SHALL be `preset`
- **AND** `maxRelays`/`stallLimit` SHALL remain the built-in defaults

#### Scenario: Configured threshold overrides the preset
- **WHEN** the pipeline declares any handoff threshold (stage, role, or pipeline level) for a stage whose model matches a preset
- **THEN** the configured value SHALL win over the preset's suggested value

#### Scenario: Defaults apply when nothing is configured
- **WHEN** neither the pipeline nor the stage declares `handoff` and the stage has no resolvable model preset
- **THEN** the resolved config SHALL be the built-in defaults
