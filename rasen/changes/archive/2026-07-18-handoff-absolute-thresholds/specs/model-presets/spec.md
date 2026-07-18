# model-presets Delta Specification

## ADDED Requirements

### Requirement: Built-in model-preset registry

The CLI SHALL provide a built-in model-preset registry (`src/core/model-presets.ts`) keyed by case-insensitive model-id substring patterns, where each preset carries the family's context-window size and optional suggested `handoffThreshold` / `reuseThreshold` values (each a fraction in (0, 1] or `{ remainingTokens: <positive integer> }`). Resolution SHALL be ordered most-specific-first with first match winning, so provider-prefixed ids (e.g. `us.anthropic.claude-...`) resolve correctly. An id matching no entry SHALL resolve to no preset.

#### Scenario: Known model family resolves to its preset
- **WHEN** a model id containing `gpt-5` is resolved against the registry
- **THEN** the registry SHALL return that family's preset with its context-window size and suggested absolute handoff/reuse thresholds

#### Scenario: Unknown model resolves to no preset
- **WHEN** a model id matching no registry entry (or an absent model id) is resolved
- **THEN** the registry SHALL return no preset
- **AND** consumers SHALL fall back to their existing defaults

#### Scenario: Large-window families carry no suggested thresholds
- **WHEN** the preset for a 1M-context family (e.g. ids containing `fable`) is resolved
- **THEN** it SHALL provide the context-window size
- **AND** SHALL provide no suggested handoff/reuse thresholds, so the built-in fraction defaults apply unchanged

### Requirement: Registry is the single source of context-window sizes

The context-limit map used by `rasen agent context` for Claude transcripts (`resolveModelLimit`) SHALL delegate to the model-preset registry, preserving its existing resolutions (haiku-family 200000; opus-4/sonnet-5/sonnet-4-6/fable/mythos 1000000) and its conservative 200000 default for unknown models.

#### Scenario: Existing model-limit resolutions unchanged
- **WHEN** `resolveModelLimit` is called with a model id it resolved before this change (e.g. one containing `haiku` or `fable`)
- **THEN** it SHALL return the same limit as before, now sourced from the registry

#### Scenario: Preset overridden by ordinary config
- **WHEN** a pipeline configures any threshold value at stage, role, or pipeline level for a stage whose model has a preset
- **THEN** the configured value SHALL win over the preset's suggested value
