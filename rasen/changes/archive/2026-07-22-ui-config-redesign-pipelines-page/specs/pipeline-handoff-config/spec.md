# pipeline-handoff-config Delta Specification

> Stacked delta: the REMOVED requirement below is the ADDED text of the pending `ui-config-redesign-store-scope` (W1) change's delta to this spec — W1 must archive before this change.

## REMOVED Requirements

### Requirement: Handoff config resolution order with a store configuration layer

**Reason**: A per-stage configured threshold (`pipelines.<name>.handoff.<stage>`) becomes the new top of the chain — above the stage-level `handoff` — so a user can tune one stage's threshold without touching any pipeline definition. Replaced by "Per-stage configured thresholds top the handoff resolution order".
**Migration**: Every existing layer and its precedence is unchanged below the new top layer; stages with no per-stage instance resolve identically to before.

## ADDED Requirements

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
