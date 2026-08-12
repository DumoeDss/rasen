## MODIFIED Requirements

### Requirement: Registry is the single source of context-window sizes

The context-limit map used by `rasen agent context` for Claude transcripts (`resolveModelLimit`) SHALL delegate to the model-preset registry, preserving its existing resolutions (haiku-family 200000; opus-4/opus-5/sonnet-5/sonnet-4-6/fable/mythos 1000000) and its conservative 200000 default for unknown models. The registry SHALL cover the current Anthropic Opus generation, so a session running it is measured against its real context window rather than the conservative default.

#### Scenario: Existing model-limit resolutions unchanged

- **WHEN** `resolveModelLimit` is called with a model id it resolved before this change (e.g. one containing `haiku` or `fable`)
- **THEN** it SHALL return the same limit as before, now sourced from the registry

#### Scenario: Current Opus generation resolves to its real window

- **WHEN** `resolveModelLimit` is called with a model id containing `opus-5`, with or without a provider prefix
- **THEN** it SHALL return 1000000
- **AND** occupancy and handoff advice computed from it SHALL reflect that window rather than the conservative default

#### Scenario: Preset overridden by ordinary config

- **WHEN** a pipeline configures any threshold value at stage, role, or pipeline level for a stage whose model has a preset
- **THEN** the configured value SHALL win over the preset's suggested value
